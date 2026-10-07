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
 * ⚠️ 三条纪律（官方文档写死的，别踩）：
 *   ① 每次被叫起来**最多干 30 秒**（安卓上限 10 分钟，但要照顾跨平台）
 *   ② 每次都是**全新的上下文** —— 上一次的变量不会留着，要记东西只能写 `CapacitorKV`
 *   ③ 干完**必须**调用 `resolve()` 或 `reject()`，否则系统会把这段代码当卡死杀掉
 *
 * ⚠️ 这个文件是**给原生加载的普通 JS**：不能有 import、不能用 TypeScript、
 * 不能引用项目里的任何模块（它跑在一个没有 DOM 的环境里）。
 * 它通过 `capacitor.config.ts` 的 `plugins.BackgroundRunner.src` 指过来。
 */

/** 通知的固定 id（测试用）——安卓要 32 位整数 */
var NOTIFY_ID_BASE = 9000;

addEventListener("qidaoWake", function (resolve, reject) {
  try {
    var now = new Date();
    var stamp = now.toISOString().replace("T", " ").slice(0, 19);

    /** 记一笔"我醒过"（KV 是唯一能跨唤醒保留的东西） */
    var prevCount = 0;
    var prevLog = "";
    try {
      prevCount = Number((CapacitorKV.get("wake_count") || {}).value || "0");
      prevLog = (CapacitorKV.get("wake_log") || {}).value || "";
    } catch (e) {
      /* 第一次跑还没有这些 key，正常 */
    }
    var count = prevCount + 1;
    var nextLog = ["#" + count + " " + stamp].concat(
      prevLog.split("\n").filter(function (s) {
        return s;
      }),
    );
    CapacitorKV.set("wake_count", String(count));
    CapacitorKV.set("wake_log", nextLog.slice(0, 40).join("\n"));

    /**
     * 弹一条真通知（这一轮只为了证明"后台真的会醒"）。
     *
     * 下一轮要做的：这里先 `fetch` 问 AI"现在该不该说话、说什么"，
     * 把 AI 生成的那句话放进 body —— 那时通知里就是**他此刻说的话**，
     * 而不是这种测试文案。
     */
    CapacitorNotifications.schedule([
      {
        id: NOTIFY_ID_BASE + (count % 1000),
        title: "栖岛 · 后台唤醒",
        body: "第 " + count + " 次醒来：" + stamp,
      },
    ]);

    /** ③ 必须收尾，否则会被系统当卡死 */
    resolve();
  } catch (err) {
    reject(err);
  }
});
