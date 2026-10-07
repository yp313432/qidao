/**
 * **后台唤醒** —— 这段代码**不在网页里跑**，是安卓系统在后台把一小段 JS 叫起来执行的。
 *
 * 为什么要有它（用户的原话）：
 *   "那个定时任务还是只有点开 app 才可以发消息，即使我后台一直开着，不省电那些也设置了"
 *   "我想要是它根据当时情景说的话，而不是预设，弹通知也像微信那样提醒"
 *   "我们现在已经是一个 app 了，不要再留网页的设计思路了"
 *
 * 根因就是网页思路：原来的定时任务靠**页面里每 30 秒查一次**（`window.setInterval`），
 * 而安卓一切到后台就冻结网页的定时器 —— 所以 App 一关就什么都不会发生。
 *
 * 这个文件走的是原生那条路（`@capacitor/background-runner`）：
 * 系统每隔一段时间（安卓最短 **15 分钟**）把这里叫起来执行一次，
 * 这里能用的东西刚好够我们要的：
 *   · `fetch`               —— 联网（以后用它问 AI："现在该不该说话、说什么"）
 *   · `CapacitorKV`         —— 存东西（跨唤醒保留：上次醒的时间、说过什么）
 *   · `CapacitorNotifications` —— **直接弹一条真通知**（像微信那样）
 *
 * ⚠️ 四条纪律（官方文档 + 插件源码里读出来的，别踩）：
 *   ① 每次被叫起来**最多干 30 秒**（安卓上限 10 分钟，但要照顾跨平台）
 *   ② 每次都是**全新的上下文** —— 上一次的变量不会留着，要记东西只能写 `CapacitorKV`
 *   ③ 干完**必须**调用 `resolve()` 或 `reject()`。
 *      插件安卓侧是这样等的：`future.conditionalAwait { it != null }` —— **没有超时**，
 *      不回调它就永远挂着（后台那条路会把这一次后台任务白白耗掉）。
 *   ④ **顺序要紧**：先弹通知、再记账。
 *      这一版的通知就是"我醒过"的唯一证据；万一 `CapacitorKV` 出岔子，
 *      通知也必须已经发出去了（下面特意把两件事分开 try）。
 *
 * ⚠️ 这个文件是**给原生加载的普通 JS**：不能有 import、不能用 TypeScript、
 * 不能引用项目里的任何模块（它跑在一个没有 DOM 的环境里）。
 * 也不要用 `window` / `document` / `localStorage`（没有这些东西）。
 * 它通过 `capacitor.config.ts` 的 `plugins.BackgroundRunner.src` 指过来。
 *
 * ⚠️ **App 侧永远不要调 `dispatchEvent`**（曾经有个"现在试一次"按钮那么干）：
 * 那个方法在安卓侧用 `runBlocking` 挡住主线程、再无限期等这里的回调 →
 * 主线程等 JS、JS 等主线程 → 死锁，整个 App 卡死。见 `src/lib/background-wake.ts`。
 */

/** 通知 id 的基数（安卓要 32 位整数）。用加法错开，避免几条通知互相覆盖。 */
var NOTIFY_ID_BASE = 9000;

addEventListener("qidaoWake", function (resolve, reject) {
  var now = new Date();
  var stamp = now.toISOString().replace("T", " ").slice(0, 19);

  var count = 1;

  /* ── ① 先弹通知（这一版最重要的动作，单独 try，别被下面拖累） ── */
  try {
    var prevCount = 0;
    try {
      prevCount = Number((CapacitorKV.get("wake_count") || {}).value || "0");
    } catch (e) {
      prevCount = 0;
    }
    count = prevCount + 1;

    CapacitorNotifications.schedule([
      {
        id: NOTIFY_ID_BASE + (count % 1000),
        title: "栖岛 · 后台唤醒",
        body: "第 " + count + " 次醒来：" + stamp,
      },
    ]);
  } catch (notifyErr) {
    try {
      reject(notifyErr);
    } catch (e) {
      /* 连 reject 都调不动就只能放弃了 */
    }
    return;
  }

  /* ── ② 再记账（跨唤醒保留；出问题也不影响上面那条通知） ── */
  try {
    var prevLog = (CapacitorKV.get("wake_log") || {}).value || "";
    var nextLog = ["#" + count + " " + stamp].concat(
      prevLog.split("\n").filter(function (s) {
        return s;
      }),
    );
    CapacitorKV.set("wake_count", String(count));
    CapacitorKV.set("wake_log", nextLog.slice(0, 40).join("\n"));
  } catch (kvErr) {
    /* 记账失败不算失败 —— 通知已经发出去了，这次唤醒就是成功的 */
  }

  /* ── ③ 必须收尾（没有超时，不回调它就永远挂着） ── */
  resolve();
});
