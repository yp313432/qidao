/**
 * **闸门执行动作时的保险丝** —— 保证"一笔动作永远不会把队列堵死"。
 *
 * ── 为什么必须有这个文件（2026-11 真机踩到）──────────────────────
 *
 * 用户原话："他发出去的动作没有卡片弹出来……明明我已经允许的权限他也卡住了，
 * 发出去的动作全挂着。"
 *
 * 根因不在动作本身，而在**闸门这一层没有兜住失败**：
 *   · `action-gate.tsx` 里是 `const msg = await runAction(...)`，**没有 try/catch**；
 *   · `runAction()` 又是一条几百行的 switch，任何一步抛错都会往外冒；
 *   · 一旦抛了，`resolveAction()` 就**永远不会被调用** → 那笔动作一直留在
 *     `pendingActions` 里；
 *   · 而闸门**只渲染队头**（`pending[0]`）→ 队头是个"自动允许、正在跑"的动作时
 *     不显示卡片，后面排队的动作既没有卡片、也永远不动 —— 用户看到的正是"全挂着"。
 *
 * 所以这里补两件事，**两件都要**（少一件就还能堵）：
 *   ① 抛错 → 收成一句人话（`kind:"error"`），闸门照样记账、队列照样往前走
 *   ② 卡住 → 到点收成一句人话（`kind:"timeout"`），绝不无限等
 *
 * ⚠️ 超时**不等于**"没做成"这件事可以含糊：万一它其实跑完了，那就说"没拿到结果"，
 * 而不是"已经做好了"——措辞在下面，别改成乐观的说法。
 */

/** 一笔动作最长等多久（超过就记账"没拿到结果"，让队列继续走） */
export const GATE_RUN_TIMEOUT_MS = 20_000;

export type GuardedRun =
  | { ok: true; message: string }
  | { ok: false; kind: "timeout" | "error"; message: string };

/**
 * 跑一次动作执行器，**保证返回、绝不抛**。
 *
 * @param fn 真正的执行器（`() => runAction(action, ctx)`）
 * @param timeoutMs 超时（验收脚本会调小来测这条路）
 */
export async function runGuarded(
  fn: () => Promise<string>,
  timeoutMs = GATE_RUN_TIMEOUT_MS,
): Promise<GuardedRun> {
  /**
   * ⚠️ 两个结果都用 `.then(onFulfilled, onRejected)` 收掉 —— 这样这个 promise
   * **永远不会 reject**：就算超时之后它才抛错，也不会变成"未处理的拒绝"
   * （那种东西在 WebView 里只会安静地烂掉，正是这个 bug 难查的原因之一）。
   */
  const settled = fn().then(
    (message) => ({ kind: "done" as const, message }),
    (e: unknown) => ({ kind: "error" as const, message: errText(e) }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" as const }), timeoutMs);
  });

  try {
    const r = await Promise.race([settled, timeoutPromise]);
    if (r.kind === "done") return { ok: true, message: r.message };
    if (r.kind === "timeout") {
      return {
        ok: false,
        kind: "timeout",
        /**
         * 措辞里带"没有结果"是**故意的**：`tool-loop.ts` 的 `looksRefused()` 靠它
         * 认出"这笔记的是没做成"，界面上才不会出现 `✅ 等了 20 秒没有结果`这种自相矛盾。
         */
        message: `等了 ${Math.round(timeoutMs / 1000)} 秒没有结果，这次没执行完 —— 别当成已经做了。`,
      };
    }
    /** 措辞里带"失败"同理（`looksRefused` 认它） */
    return { ok: false, kind: "error", message: `执行时报错了（这次失败）：${r.message}` };
  } finally {
    /** 清掉计时器：不让一个已经没人等的 20 秒定时器拖着（验收脚本里会因此白等 20 秒） */
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 异常 → 一句人话（原生报错常只有英文类名，但**不能吞**：那是唯一能查的线索） */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  const s = String(e ?? "").trim();
  return s || "没给原因";
}
