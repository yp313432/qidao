import { useApp } from "@/lib/store";

/**
 * **世界时间是往前走的**（2026-10-21 批4）。
 *
 * 用户 m10034 点破的要害：
 *   "他钓鱼，抛一杆之后算结束了，那鱼竿咋办就一直放在池塘吗，没有连续性"
 *
 * 真因不是"他不记得"，而是**状态没有别人推进**：钓鱼的咬钩时刻存在
 * `gardenPond.biteAt`，但推进它的是"钓鱼页开着时的那个计时器"——
 * 他一走开、或者 App 关着，那条时间线就停了，竿就永远支在那儿。
 *
 * 所以这里给世界一个"自己的心跳"：App 在的时候每 20 秒看一眼时间，
 * 该咬钩就咬钩、放过太久就当鱼跑了。等他回来，看到的是"发生过什么"，
 * 不是"停在离开那一刻"。
 *
 * ⚠️ 只推进**有客观时间参数**的状态（咬钩时刻是 cast 时就算好的随机数），
 * 不替用户做任何决定：不开钓、不收线、不改天气、不写记录。
 */

/** 咬钩之后多久没管它 = 鱼跑了（竿空了，但竿能再抛） */
export const BITE_GRACE_MS = 5 * 60 * 1000;

/** 世界心跳间隔（20 秒：够细，又不至于老醒着耗电） */
export const WORLD_TICK_MS = 20_000;

/**
 * 记忆库体检的节流：合并重复 + 归档淡掉的，每 6 小时最多一次。
 *
 * 挂在这儿是因为 `tickWorld` 已经在跑（App 每 20 秒 call 一次）；
 * 几百条记忆的 O(n²) 比较不能每 20 秒来一遍。
 */
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
let lastSweepAt = 0;

/**
 * 推进一次世界。返回这次真的发生了什么（给调用方决定要不要写进踪迹）。
 *
 * 幂等：同一时刻重复调用不会重复推进（阶段判断在前）。
 */
export function tickWorld(now: number = Date.now()): string[] {
  const st = useApp.getState();
  const notes: string[] = [];
  const pond = st.gardenPond;

  /** ① 到点了 → 水面动（咬钩） */
  if (pond.phase === "waiting" && pond.biteAt > 0 && now >= pond.biteAt) {
    st.pondBite();
    notes.push("水面动了一下");
  }

  /** ② 咬了钩没人来收，过了 5 分钟 → 鱼跑了（别让竿永远支着） */
  const after = useApp.getState().gardenPond;
  if (after.phase === "bite" && after.at > 0 && now - after.at > BITE_GRACE_MS) {
    st.pondSettle("lost");
    notes.push("鱼跑了，竿空着");
  }

  /** ③ 记忆库体检（合并重复 / 归档淡掉的）：每 6 小时最多一次 */
  if (now - lastSweepAt > SWEEP_EVERY_MS) {
    lastSweepAt = now;
    const r = st.sweepMemories();
    if (r.merged > 0) notes.push(`记忆里合并掉 ${r.merged} 条重复的`);
    if (r.archived > 0) notes.push(`有 ${r.archived} 条记忆淡了，收进归档`);
  }

  return notes;
}
