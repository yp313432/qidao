/**
 * **他此时在干什么** —— 聊天里那一枚小胶囊（用户 m04513 选的是方案 B）。
 *
 * 状态不是随手写的：它由**他真做过的动作**推出来（钓鱼中 / 落子 / 浇花 / 摆塔罗…），
 * 所以跟蹤跡里记的那条对得上，不会"嘴上说在钓鱼、实际上没去"。
 *
 * 过期规则（用户 m04513："空闲就写空闲吧"）：最后一个动作之后 **15 分钟**没有新动作，
 * 就退回"空闲"。这样他不会一直挂着"钓鱼中"。
 */

/** 多久没新动作算"空闲" */
import { readVestigia } from "@/lib/garden-trace";

/** 多久没新动作算"空闲" */
export const STATUS_TTL_MS = 15 * 60_000;

/** 没动作 / 过期时显示的字 */
export const IDLE_STATUS = "空闲";

/** 动作 → 状态。没列到的动作不给状态（保持上一条，别乱覆盖） */
const ACTION_STATUS: Record<string, string> = {
  "garden.walk": "在花园",
  "garden.fish.cast": "钓鱼中",
  "garden.fish.reel": "收竿",
  "garden.gomoku.play": "落子",
  "garden.gomoku.pass": "让了一手",
  "garden.gomoku.new": "新开一局",
  "garden.tarot.draw": "摆塔罗",
  "garden.flower.plant": "种花",
  "garden.flower.water": "浇花",
  "garden.flower.feed": "施肥",
  "garden.flower.pick": "剪花",
  "garden.flower.gift": "送花给你",
  "garden.cesta.look": "看竹篮",
};

/** 这个动作会把他的状态改成什么（不认识就 undefined） */
export function statusForAction(kind: string): string | undefined {
  return ACTION_STATUS[kind];
}

/**
 * 现在该显示什么状态。
 *
 * **不从 store 读**：踪跡（`garden-trace` 的 kv）本来就已经记下了他每一次动作的时间，
 * 状态直接由"最近一条花园动作"推出来 —— 于是聊天里那枚胶囊、
 * 踪跡页、动作回执看到的是同一份事实，也不会因为 store 里多存一份而两边不一致。
 */
export function currentStatusText(now = Date.now()): string {
  const last = readVestigia()[0];
  if (!last) return IDLE_STATUS;
  if (now - last.at > STATUS_TTL_MS) return IDLE_STATUS;
  return statusForAction(last.kind) ?? IDLE_STATUS;
}
