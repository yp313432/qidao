import { useEffect, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { useDismissable } from "@/lib/dismiss-stack";
import { HEALTH_TOOLS, heartPointGroups, loadHealthDashboard, loadWorkouts, type HealthDashboard, type Workout } from "@/lib/health-data";
import { callTool } from "@/lib/mcp";
import { useApp } from "@/lib/store";
import type { McpServer } from "@/lib/types";

const HOUR = 3600000;
const detailNames = { steps: "步数", sleep: "睡眠", workouts: "运动记录" };
type Detail = keyof typeof detailNames;

function timezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function clock(at: number): string {
  return new Date(at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
}

function reader(id: string, url: string, signal: AbortSignal) {
  return async (tool: string, args: Record<string, unknown>) => {
    const app = useApp.getState();
    const server = app.mcp.find((item) => item.id === id && item.enabled && item.url === url);
    if (!server || signal.aborted) throw new Error("身体数据来源已变更。");
    const result = await callTool(server, tool, args, { structured: true, signal });
    const current = useApp.getState().mcp.find((item) => item.id === id);
    const clientId = result.oauthPatch?.clientId ?? server.oauth?.clientId;
    if (result.oauthPatch && clientId && !signal.aborted && current?.url === url && current.oauth === server.oauth) {
      app.patchMcp(id, { oauth: { ...server.oauth, ...result.oauthPatch, clientId } });
    }
    if (!result.ok) throw new Error("暂时读不到 Horizon 数据。请检查工具页的连接和授权。");
    return result.data;
  };
}

function Pulse({ bpm }: { bpm: number }) {
  return <div className="k-health-pulse">
    <span>心跳节拍 · 按心率播放</span>
    <svg viewBox="0 0 300 57" aria-hidden="true">
      <g className="k-health-pulse__track" style={{ "--k-health-beat": `${60 / bpm}s` } as CSSProperties}>
        {[0, 100, 200, 300].map((offset) => <path key={offset} transform={`translate(${offset})`}
          d="M0 44 H22 C31 44 35 42 40 35 S48 12 54 12 S62 39 70 42 S81 44 100 44" />)}
      </g>
    </svg>
  </div>;
}

function HeartTrend({ data }: { data: HealthDashboard | null }) {
  const [selection, setSelection] = useState<number>();
  const points = data?.points ?? [];
  const focus = points.find((point) => point.at === selection) ?? points.at(-1);
  const start = (data?.now ?? 0) - HOUR;
  const min = Math.min(...points.map((point) => point.bpm)) - 4;
  const max = Math.max(...points.map((point) => point.bpm)) + 4;
  const x = (at: number) => 12 + (at - start) / HOUR * 296;
  const y = (bpm: number) => 8 + (max - bpm) / (max - min) * 76;
  return <section className="k-health-card" aria-label="心率实测趋势">
    <div className="k-health-row"><h2>最近 1 小时</h2><span>5 分钟平均值</span></div>
    {points.length ? <>
      <svg viewBox="0 0 320 92" className="k-health-trend" role="img" tabIndex={0}
        aria-label="心率趋势，左右方向键可查看读数"
        onPointerDown={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const target = (event.clientX - box.left) / box.width * 320;
          const closest = points.reduce((best, point) => Math.abs(x(point.at) - target) < Math.abs(x(best.at) - target) ? point : best);
          setSelection(closest.at);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const index = focus ? points.indexOf(focus) : points.length - 1;
          setSelection(points[Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))]!.at);
        }}>
        {heartPointGroups(points).map((group) => <polyline key={group[0]!.at}
          points={group.map((point) => `${x(point.at)},${y(point.bpm)}`).join(" ")} />)}
        {points.map((point) => <circle key={point.at} cx={x(point.at)} cy={y(point.bpm)} r={point === focus ? 4 : 2.5} />)}
      </svg>
      {focus && <p className="k-health-caption" aria-live="polite">{clock(focus.at)} · {Math.round(focus.bpm)} bpm</p>}
    </> : <p className="k-health-empty">这一小时暂无心率读数。</p>}
  </section>;
}

function HealthDetail({ detail, data, source, onClose }: {
  detail: Detail; data: HealthDashboard; source: McpServer; onClose: () => void;
}) {
  const [workouts, setWorkouts] = useState<Workout[]>();
  const [error, setError] = useState(false);
  useDismissable(true, onClose);
  const { id, url } = source;
  const to = data.today;
  const from = data.days[0]?.date ?? to;
  useEffect(() => {
    if (detail !== "workouts") return;
    const controller = new AbortController();
    void loadWorkouts(reader(id, url, controller.signal), from, to, timezone())
      .then((rows) => { if (!controller.signal.aborted) setWorkouts(rows); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [detail, from, to, id, url]);

  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="k-copy-scrim" />
      <Dialog.Content className="k-copy-sheet k-health-detail">
        <div className="k-health-row">
          <Dialog.Title>{detailNames[detail]}</Dialog.Title>
          <Dialog.Close className="k-btn k-btn--icon" aria-label="关闭详情"><X /></Dialog.Close>
        </div>
        <Dialog.Description className="k-health-caption">最近 7 天</Dialog.Description>
        {detail === "workouts" ? <>
          {workouts?.map((item) => <div className="k-health-session" key={item.id}>
            <div className="k-health-row"><span>{clock(item.at)}</span><strong>{duration(item.seconds)}</strong></div>
            {(item.distance !== null || item.calories !== null) && <p className="k-health-caption">
              {[item.distance === null ? null : `${(item.distance / 1000).toFixed(2)} 公里`,
                item.calories === null ? null : `${item.calories} 千卡`].filter(Boolean).join(" · ")}
            </p>}
          </div>)}
          {(!workouts?.length || error) && <p className="k-health-caption" role="status">{error ? "暂时读不到运动记录。" : workouts ? "最近 7 天暂无运动记录。" : "正在读取…"}</p>}
        </> : [...data.days].reverse().map((day) => <div className="k-health-row" key={day.date}>
          <span>{day.date.slice(5)}</span>
          <strong>{detail === "steps"
            ? day.steps === null ? "暂无记录" : `${day.steps.toLocaleString()} 步`
            : day.sleep ? duration(day.sleep.seconds) : "暂无记录"}</strong>
        </div>)}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function Dashboard({ source }: { source: McpServer }) {
  const [data, setData] = useState<HealthDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const { id, url } = source;

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refreshData() {
      if (pending || document.hidden || controller.signal.aborted) return;
      pending = true;
      setLoading(true);
      try {
        const result = await loadHealthDashboard(reader(id, url, controller.signal), Date.now(), timezone());
        if (!controller.signal.aborted) { setData(result); setError(""); }
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refreshData();
    const timer = window.setInterval(() => void refreshData(), 60000);
    document.addEventListener("visibilitychange", refreshData);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshData);
    };
  }, [id, url, refresh]);

  const today = data?.days.find((day) => day.date === data.today);
  const sleep = data?.days.filter((day) => day.sleep !== null).at(-1);
  const workouts = data?.days.filter((day) => day.workouts !== null).at(-1);
  const workoutLabel = workouts && (workouts.workouts === 1 && workouts.workoutSeconds !== null
    ? duration(workouts.workoutSeconds) : `${workouts.workouts} 次`);
  const lastDays = data?.days.slice(-5) ?? [];
  const maxSteps = Math.max(1, ...lastDays.map((day) => day.steps ?? 0));
  const latest = data?.latest;
  return <>
    <PageHeader title="身体数据" right={<button type="button" className="k-btn k-btn--icon" aria-label="刷新身体数据"
      disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={17} /></button>} />
    <div className="k-health-dashboard" aria-busy={loading}>
      {error && <p className="k-health-caption" role="status">{error}</p>}
      <section className="k-health-hero" aria-label="最新心率">
        <h2>心率</h2>
        <div className="k-health-hero__value">{latest ? Math.round(latest.bpm) : "—"} <span>bpm</span></div>
        <p className="k-health-caption">{latest ? `最近测量 · ${clock(latest.at)}` : loading ? "正在读取心率…" : "暂无心率记录"}</p>
        {latest && <Pulse bpm={latest.bpm} />}
      </section>
      <HeartTrend data={data} />
      <section className="k-health-card k-health-metrics" aria-label="步数、睡眠和运动">
        <button type="button" className="k-health-metric" disabled={!data} onClick={() => setDetail("steps")}>
          <span>步数</span>
          <strong>{today?.steps == null ? "—" : today.steps.toLocaleString()} <small>步</small></strong>
          <span className="k-health-bars" title="最近五天步数" aria-hidden="true">
            {lastDays.map((day) => <i key={day.date} data-empty={day.steps === null}
              style={{ height: day.steps === null ? undefined : `${Math.max(3, day.steps / maxSteps * 100)}%` }} />)}
          </span>
        </button>
        <button type="button" className="k-health-metric" disabled={!data} onClick={() => setDetail("sleep")}>
          <span>睡眠</span>
          <strong>{sleep?.sleep ? duration(sleep.sleep.seconds) : "—"}</strong>
          {sleep?.sleep && <span className="k-health-sleepbar" aria-hidden="true">
            {Object.entries(sleep.sleep.stages).map(([stage, seconds]) => seconds
              ? <i key={stage} data-stage={stage} style={{ flexGrow: seconds }} /> : null)}
          </span>}
          {sleep && sleep.date !== data?.today && <small>{sleep.date.slice(5)} 醒来</small>}
        </button>
        <button type="button" className="k-health-row k-health-workout" disabled={!data} onClick={() => setDetail("workouts")}>
          <strong>运动记录</strong><span>{workouts ? `${workouts.date === data?.today ? "今天" : workouts.date.slice(5)} · ${workoutLabel}` : "暂无记录"} <ChevronRight size={15} /></span>
        </button>
      </section>
    </div>
    {detail && data && <HealthDetail key={detail} detail={detail} data={data} source={source} onClose={() => setDetail(null)} />}
  </>;
}

export function HealthView() {
  const mcp = useApp((state) => state.mcp);
  const [chosen, setChosen] = useState("");
  const sources = mcp.filter((server) => server.enabled && server.url.trim()
    && [HEALTH_TOOLS.summary, HEALTH_TOOLS.samples].every((name) => server.tools.some((tool) => tool.name === name)));
  const source = sources.find((server) => server.id === chosen) ?? (sources.length === 1 ? sources[0] : undefined);
  if (source) return <Dashboard key={source.id + source.url} source={source} />;
  return <>
    <PageHeader title="身体数据" />
    <div className="k-health-dashboard">
      {sources.length > 1 ? <section className="k-health-card">
        <h2>选择身体数据来源</h2>
        {sources.map((server) => <button key={server.id} type="button" className="k-btn" onClick={() => setChosen(server.id)}>{server.name}</button>)}
      </section> : <section className="k-health-card">
        <h2>还没找到身体数据来源</h2>
        <p className="k-health-empty">请在工具页连接 Horizon，并刷新它的工具清单。</p>
        <Link to="/tools" className="k-btn">打开工具</Link>
      </section>}
    </div>
  </>;
}
