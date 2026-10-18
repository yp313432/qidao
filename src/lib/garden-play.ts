import { actionToolName } from "@/lib/action-schema";
import { streamChat, type ChatRequest } from "@/lib/chat-client";
import { runActions } from "@/lib/tool-loop";
import type { AssembledToolCall } from "@/lib/tool-calls";
import type { AppAction } from "@/lib/types";
import { stripActions, takeActions } from "@/lib/use-chat";

/**
 * 花园里「他自己动一手」的统一入口。
 *
 * 用户 m02156 把这件事说透了：
 *   "ai 不能控制棋局，是程序在下，我要的是 ai 自己下，他能控制下哪里……
 *    花园不是一个给 ai 看的东西，而是能让他真正控制的，还有钓鱼也是……
 *    把 ai 当作一个可以活动的人，花园就是他的游戏，他要去玩游戏，重点在玩上，这是个动词"
 *
 * 所以花园里的每个动作都是**他调出来的**：
 *   棋桌 → `garden.gomoku.play` / `garden.gomoku.pass` / `garden.gomoku.new`
 *   池塘 → `garden.fish.cast` / `garden.fish.reel`
 * 页面只负责"问他一句、把他写的动作块执行掉、把他说的那句话显示出来"。
 *
 * 为什么走**正文里的动作块**（而不是原生 tools 参数）：
 *   · 棋桌/池塘是**旁路**对话，不该写进主对话，本来就没走 `runToolLoop` 那条管线；
 *   · 模型在正文里写 ```qidao {"kind":…} 是 App 里既有的老协议（`takeActions` 认得），
 *     走这条路不用把半套 agent loop 搬过来，也照样能拿到"执行结果"回执（见 `results`）。
 *
 * ⚠️ 执行走 `runActions`（= 过权限闸门），**不直接调 `runAction`**：
 *   绕过闸门就会出现两套执行路径，那是这个仓库里最危险的一种走散（`tool-loop.ts:209`）。
 */

/** 花园里允许他动的动作 —— 别的动作块一律丢掉（免得他在花园里开始放歌、写日记） */
export type GardenKind = Extract<AppAction, { kind: `garden.${string}` }>["kind"];

export type GardenTurnResult = {
  /** 他这一轮说的正文（已去掉动作块） */
  text: string;
  /** 有没有真的调成一个花园动作 */
  acted: boolean;
  /** 上游没通 / 报错（这种提示不该当成他说的话存起来） */
  failed: boolean;
  /** 每个动作执行完的那句回执（可以显示，也可以不显示） */
  results: string[];
};

/**
 * 问他一轮，并把他写的花园动作执行掉。
 *
 * @param req 跟主对话同一条上游的请求（messages 里最后一条就是"现在轮到你"的说明）
 * @param allow 这一轮允许的动作 kind（只执行这些，其余丢弃）
 * @param onText 流式正文回调（第二参 streaming=true 表示还在写）
 */
export async function gardenTurn(opts: {
  req: ChatRequest;
  allow: readonly GardenKind[];
  onText?: (text: string, streaming: boolean) => void;
  signal?: AbortSignal;
}): Promise<GardenTurnResult> {
  let acc = "";
  let failed = false;
  try {
    await streamChat(
      opts.req,
      (d) => {
        if (d.error) {
          failed = true;
          acc = acc || d.error;
          opts.onText?.(stripActions(acc), true);
        }
        if (d.content) {
          acc += d.content;
          opts.onText?.(stripActions(acc), true);
        }
        if (d.done) opts.onText?.(stripActions(acc), false);
      },
      opts.signal,
    );
  } catch {
    /* 错误已经通过 d.error 落下来了 */
  }

  const text = stripActions(acc).trim();
  opts.onText?.(text, false);

  /**
   * 只认花园动作。
   *
   * 为什么要过滤：他偶尔会顺手写个 `emotion.report`（主对话里每轮都报），
   * 那个动作在花园里也会被闸门执行 —— 不是错，但**不该由花园页面代他决定**；
   * 更要紧的是别让一个写错的动作把页面带偏（比如 navigate）。
   */
  const actions = takeActions(acc).filter((a): a is Extract<AppAction, { kind: GardenKind }> =>
    (opts.allow as readonly string[]).includes(a.kind),
  );
  if (actions.length === 0) {
    return { text, acted: false, failed, results: [] };
  }

  const calls: AssembledToolCall[] = actions.map((a, i) => ({
    index: i,
    name: actionToolName(a.kind),
    args: JSON.stringify(a),
  }));
  const outcomes = await runActions(calls, opts.signal);
  return {
    text,
    acted: true,
    failed,
    results: outcomes.map((o) => o.result),
  };
}
