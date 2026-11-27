export const HEALTH_TOOLS = {
  summary: "health_get_summary",
  samples: "health_get_samples",
  workouts: "health_get_workouts",
} as const;

type HealthReader = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export type HeartPoint = { at: number; bpm: number };
export type HealthDay = {
  date: string;
  steps: number | null;
  heartAt: number | null;
  sleep: { seconds: number; stages: Record<string, number | null> } | null;
  workouts: number | null;
  workoutSeconds: number | null;
};
export type Workout = { id: string; at: number; seconds: number; distance: number | null; calories: number | null };
export type HealthDashboard = { today: string; now: number; days: HealthDay[]; points: HeartPoint[]; latest: HeartPoint | null };

const HOUR = 3600000;
const DAY = 24 * HOUR;
const BUCKET = 5 * 60 * 1000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown, field: string): Record<string, unknown>[] {
  const list = record(value)[field];
  if (!Array.isArray(list)) throw new Error("Horizon 返回的数据格式不匹配。");
  return list.map(record);
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function time(value: unknown): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function healthDate(at: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value;
  return [part("year"), part("month"), part("day")].join("-");
}

function healthDays(value: unknown): HealthDay[] {
  return rows(value, "days").flatMap((row) => {
    if (typeof row.date !== "string") return [];
    const sleep = record(row.sleep);
    const seconds = number(sleep.duration_seconds);
    const stages = record(sleep.stages_seconds);
    const workouts = record(row.workouts);
    return [{
      date: row.date,
      steps: number(row.steps),
      heartAt: time(record(record(row.metrics).heart_rate).latest_at),
      sleep: seconds === null ? null : {
        seconds, stages: Object.fromEntries(["deep", "light", "rem", "awake"].map((stage) => [stage, number(stages[stage])])),
      },
      workouts: number(workouts.count),
      workoutSeconds: number(workouts.active_seconds),
    }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function heartPoints(value: unknown, now: number): HeartPoint[] {
  const points = new Map<number, number>();
  for (const row of rows(value, "records")) {
    const at = time(row.timestamp);
    const bpm = number(row.value);
    if (at !== null && at <= now && bpm !== null && bpm >= 1 && bpm <= 300) points.set(at, bpm);
  }
  return [...points].sort(([a], [b]) => a - b).map(([at, bpm]) => ({ at, bpm }));
}

export async function loadHealthDashboard(read: HealthReader, now: number, timezone: string): Promise<HealthDashboard> {
  const today = healthDate(now, timezone);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY).toISOString().slice(0, 10);
  const days = healthDays(await read(HEALTH_TOOLS.summary, { from, to: today, timezone }));
  const points = heartPoints(await read(HEALTH_TOOLS.samples, {
    from: healthDate(now - HOUR, timezone), to: today, timezone, metric: "heart_rate",
    after: new Date(now - HOUR - 1).toISOString(), limit: 36,
  }), now).filter(({ at }) => at >= now - HOUR);
  let latest = points.at(-1) ?? null;
  const lastRecorded = days.filter((day) => day.heartAt !== null).at(-1)?.heartAt ?? null;
  if (!latest && lastRecorded !== null && lastRecorded <= now) {
    const day = healthDate(lastRecorded, timezone);
    latest = heartPoints(await read(HEALTH_TOOLS.samples, {
      from: day, to: day, timezone, metric: "heart_rate",
      after: new Date(lastRecorded - 1).toISOString(), limit: 1,
    }), now)[0] ?? null;
  }
  return { today, now, days, points, latest };
}

export async function loadWorkouts(read: HealthReader, from: string, to: string, timezone: string): Promise<Workout[]> {
  const result = await read(HEALTH_TOOLS.workouts, { from, to, timezone });
  return rows(result, "records").flatMap((row) => {
    const at = time(row.start_time);
    const seconds = number(row.active_seconds);
    if (at === null || seconds === null) return [];
    const id = typeof row.workout_id === "string" ? row.workout_id : String(at);
    return [{ id, at, seconds, distance: number(row.distance_meters), calories: number(row.active_calories) }];
  }).sort((a, b) => b.at - a.at);
}

/** Missing five-minute buckets leave a visible gap instead of drawing a fictitious reading. */
export function heartPointGroups(points: readonly HeartPoint[]): HeartPoint[][] {
  const segments: HeartPoint[][] = [];
  for (const point of points) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    if (segment && previous && point.at - previous.at <= BUCKET * 1.5) segment.push(point);
    else segments.push([point]);
  }
  return segments;
}
