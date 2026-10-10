/*
  ⚠️ 这几个不是浏览器原生 API，是**那个后台插件在运行时注入的全局**：
    · `CapacitorKV`            —— 跨唤醒的键值存储（底层是 SharedPreferences）
    · `CapacitorNotifications` —— 弹本地通知
    · `addEventListener`       —— 注册"被叫醒"的回调（插件按 event 名调它）
  声明在这里是为了两件事：① ESLint 不再把它们当未定义（真误报过）② 下一个人
  一眼看到"这文件跑在什么环境里、能用什么"。
*/
/* global CapacitorKV, CapacitorNotifications */

/**
 * **后台唤醒** —— 这段代码**不在网页里跑**，是安卓系统在后台把一小段 JS 叫起来执行的。
 *
 * 为什么要有它（用户的原话）：
 *   "那个定时任务还是只有点开 app 才可以发消息，即使我后台一直开着，不省电那些也设置了"
 *   "我想要是它根据当时情景说的话，而不是预设"
 *   "我们现在已经是一个 app 了，不要再留网页的设计思路了"
 *   "不是隔多少把它叫醒，而是叫醒和连着发消息是一块的"
 *
 * ── 它现在干什么（甲：**直接问你的 AI**，不经过 Worker、不用梯、不用域名）──
 *   系统每 25 分钟叫醒它 →
 *     ① 看总开关（App 里关掉就什么都不做）
 *     ② 看是不是夜间（夜间不打扰）
 *     ③ 算「程度」：距**他上次开口**过了多久（每 25 分钟一档：0/25/50/75/100）
 *     ④ 按档位从 App 交过来的**五段指令**里挑一段，把 `{{TIME}}`/`{{ELAPSED}}` 换成此刻的值
 *     ⑤ 直接 POST 到你自己的上游（国内那条快的）→ 拿到他生成的那句话 → 弹通知
 *     ⑥ **把完整那句话写回抽屉**（`wake_pending_*`）—— 通知只是一条提醒，
 *        这句话要能被 App **落进会话**才算真的"他说了"（见 `markPending`）
 *
 * ── 问不到上游时它会**自己诊断**（2026-10 加，用户真机上连续 90 次失败那件事）──
 *   前台自检 380ms 就通，后台却连续报
 *   `Unable to resolve host "api.deepseek.com": No address associated with hostname`
 *   —— 光看这一句**分不清**是"后台整条网络不通"还是"只有这个域名解析不了"。
 *   所以现在：网络类失败 → 隔 2s / 5s 重试（最多 3 次尝试）→ 还不行就**再探一个对照组**
 *   （`https://www.baidu.com/`，国内几乎必然能通），把结论写进通知**和** `wake_log`：
 *     · 对照组也不通 → `bg-offline` 后台没网（不是栖岛的问题）
 *     · 对照组通、上游解析不出来 → `dns-only` 只有这个域名拿不到 IP
 *     · 对照组通、上游超时/连不上 → `connect-timeout` / `connect-only`
 *   ⚠️ 4xx/5xx（key 错、余额空）**一次都不重试**；重试和诊断都算进那 30 秒预算。
 *
 * ── 配置从哪来（用户问过："不是 app 问哎吗"）────────────────────
 *   **是 App 里的后台部分在问**，不是界面在问。App 打开时会把配置 + 五段指令
 *   写进一个"抽屉"（`android/.../WakeBridgePlugin.java`），这里醒来时从抽屉里读。
 *   为什么绕这一下：安卓不允许网页那边直接往这里塞东西。
 *
 * ── 备路 ────────────────────────────────────────────────
 *   抽屉里没有配置、但打包时注入过 `WAKE_URL`（Worker 中转）→ 走 Worker 那条
 *   （域名在国内被污染时要挂梯，所以默认不用；将来有域名可以启用）。
 *
 * ── 五条纪律（官方文档 + 插件源码 + 真机踩坑读出来的）──────────────
 *   ① 每次最多干 30 秒（安卓上限 10 分钟，但要照顾跨平台）
 *   ② 每次都是**全新的上下文** —— 变量不留，要记东西只能写 `CapacitorKV`
 *   ③ 干完**必须** `resolve()` / `reject()`：插件那边 `conditionalAwait` **没有超时**，
 *      不回调就永远挂着（那次后台任务白跑）
 *   ④ **不许用 `toISOString()`** —— 它给的是 UTC。用户 UTC+8，第一版就这么写的，
 *      通知上写 09:09、实际 17:09，白让人绕一圈
 *   ⑤ 这是**给原生加载的普通 JS**：不能 import、不能 TypeScript、没有 DOM。
 *      也**不要**用 `window`/`document`/`localStorage`
 *
 * ⚠️ **App 侧永远不要调插件的 `dispatchEvent`**（曾经有个"现在试一次"按钮那么干）：
 * 那个方法在安卓侧用 `runBlocking` 挡住主线程、再无限期等这里的回调 →
 * 主线程等 JS、JS 等主线程 → **死锁，整个 App 卡死**（真机踩过）。
 * 要递东西用"抽屉"（见 `src/lib/wake-bridge.ts`）。
 */

/** Worker 备路的地址（形如 `https://…/api/wake?pass=…`）。⚠️ 由 CI 从 GitHub 密钥注入。 */
var WAKE_URL = "__QIDAO_WAKE_URL__";

/** 通知 id 的基数（安卓要 32 位整数）。用加法错开，避免几条通知互相覆盖。 */
var NOTIFY_ID_BASE = 9000;

/**
 * "他说了一句"那条通知的**身份标记**（进点按 intent，点通知时传回前台）。
 * 前台用它认出该跳到哪条消息；别的调试/失败通知不带这个标记。
 */
var WAKE_NOTIFY_ACTION = "qidao-wake-said";

/** 出错时的调试通知最短间隔（分钟）—— 上游一直挂的话，别每 25 分钟吵他一次 */
var ERR_NOTIFY_COOLDOWN_MIN = 60;

/** 被"关掉"之后，隔多久才再去确认一次（分钟）。见下面 `muted_at` 的说明。 */
var MUTED_RECHECK_MIN = 240;

/* ───────── 失败：重试 + 自诊断（用户要的"把那个问号变成确定答案"）───────── */

/**
 * 这次唤醒的**总预算**。官方文档：iOS 约 30 秒、安卓最多 10 分钟，跨平台按 30 秒算。
 * 重试和诊断都从这里面扣 —— 扣完就放弃本轮（宁可少一次诊断，也不能把这次唤醒拖死）。
 */
var WAKE_BUDGET_MS = 30000;

/** 单次上游请求最多等多久（这个引擎里没有 AbortController，只能让定时器跟 fetch 赛跑） */
var ATTEMPT_TIMEOUT_MS = 5000;

/** 网络类失败后的重试间隔；最多 3 次尝试，所以只要两档（2s / 5s） */
var RETRY_DELAYS_MS = [2000, 5000];

/** 还剩多少时间才值得再试一次（给下一次尝试留出余地） */
var MIN_ATTEMPT_MS = 1500;

/** 对照组探测的超时（"别的地址通不通"要给个明确答案，不能干等） */
var PROBE_TIMEOUT_MS = 5000;

/** 剩余时间少于这个值就跳过诊断（免得把本轮拖过 30 秒） */
var PROBE_MIN_MS = 1200;

/**
 * 对照组地址：**国内几乎必然能通**的一家。
 * 用它把"后台整条网络不通"和"只有你的上游解析不了"分开 —— 这就是用户要的确定答案。
 */
var PROBE_URL = "https://www.baidu.com/";

/** 「已经连续 N 次没成功」的数字封顶：≥20 就写 `20+`（用户："都跑到 82 次了，看着好多"） */
var FAIL_STREAK_CAP = 20;

/** 「程度」的档位间隔：每 25 分钟升一档（跟 App 里的 `wake-prompt.ts` 必须一致） */
/* ───────── 小工具 ───────── */

/** 时间戳 —— 必须是**本地时间**（纪律 ④） */
function localStamp() {
  var d = new Date();
  var p = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    " " +
    p(d.getHours()) +
    ":" +
    p(d.getMinutes()) +
    ":" +
    p(d.getSeconds())
  );
}

/** 读抽屉 / KV 里的字符串 */
function cfg(key) {
  try {
    return String((CapacitorKV.get(key) || {}).value || "");
  } catch (e) {
    return "";
  }
}

function kvNum(key) {
  var v = cfg(key);
  return v ? Number(v) || 0 : 0;
}

function kvSet(key, value) {
  try {
    CapacitorKV.set(key, String(value));
  } catch (e) {
    /* 记不上不算失败 */
  }
}

/**
 * 弹通知。
 *
 * 第 4 个参数 `actionTypeId` 会**原样进那条通知的点按 intent**（插件的
 * `Notifications.kt` 把它塞进 `Intent(".NOTIFICATION_CLICKED")`），点通知时前台
 * 收到的 `backgroundRunnerNotificationReceived` 事件里就带着它 ——
 * 前台靠它认出"这是'他说了一句'那条"，好跳到那条消息（见 `src/lib/wake-sync.ts`）。
 * 不认识这个键的旧版插件会直接忽略它，不会把通知弄坏。
 *
 * ⚠️ 标题和正文都过 `maskSecrets`：文件顶上那条纪律是"**任何写出去的日志/通知**
 * 都先过一遍"（上游偶尔会把 key 回显进正文），而这里原来漏了这一步 ——
 * 顺手补上，正好也让"通知上那句"跟"交给会话那句"逐字一致。
 */
function notify(id, title, body, actionTypeId) {
  try {
    var n = { id: id, title: maskSecrets(title), body: maskSecrets(body) };
    if (actionTypeId) n.actionTypeId = actionTypeId;
    CapacitorNotifications.schedule([n]);
  } catch (e) {
    /* 弹不出来就算了 */
  }
}

/**
 * **任何写出去的日志/通知都先过一遍这个**：key 绝不能出现在日志里（也不许出现在通知上）。
 * 上游的错误正文偶尔会把 key 回显出来（"Incorrect API key provided: sk-…"），所以这里兜一道。
 */
function maskSecrets(text) {
  return String(text == null ? "" : text).replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-****");
}

function logLine(text) {
  try {
    var prev = cfg("wake_log");
    var next = [maskSecrets(text)].concat(
      prev.split("\n").filter(function (s) {
        return s;
      }),
    );
    CapacitorKV.set("wake_log", next.slice(0, 40).join("\n"));
  } catch (e) {
    /* 同上 */
  }
}

/**
 * 「程度」：距他上次开口多久 → 0/25/50/75/100（每 25 分钟一档，跟文件顶上那条注释一致）。
 * 只当**小标记**用（界面上看得出"这句他攒了一会儿才说"），不参与任何判断。
 */
function urgeFromElapsed(elapsedMin) {
  if (!elapsedMin || elapsedMin <= 0) return 0;
  return Math.min(100, Math.floor(elapsedMin / 25) * 25);
}

/**
 * **他说成一句的那一刻，把这句完整写回抽屉** —— 这是"通知"和"会话"之间原来缺的那条通道。
 *
 * 为什么必须写（用户真机原话）：
 *   "我能收到弹窗通知，但是那个通知**不在上下文里**……这样如果我想回他那句消息的话，
 *    进对话里的 AI 是不知道这回事的。"
 *
 * 为什么不能只靠 `wake_log`：那是**给人看的日志**，而且被截成 40 字（见 `logLine`）——
 *   而会话要的是**完整那句话**，一个字都不能少。
 *
 * 谁来收：App 一到前台/被点通知就调 `flushPendingWake()`（`src/lib/wake-sync.ts`），
 *   走 `beginScheduledReply()` 把这句话**当成他发的消息**落进当前会话，然后把下面这几个键**置空**。
 *
 * 四个键：
 *   · `wake_pending_text`    完整那句话
 *   · `wake_pending_at`      本地时间（`localStamp()`，给人看）
 *   · `wake_pending_at_ms`   机器可读的时间戳（排序/去重用）
 *   · `wake_pending_urge`    程度（可选小标记）
 *
 * ⚠️ 只写"他说了"；他回 SKIP 时**一个字都不写** —— 否则会话里会冒出他没说过的话。
 * ⚠️ 过一遍 `maskSecrets`：key 绝不能跟着这句话进通知、日志**或会话**。
 */
function markPending(text, urge) {
  var full = maskSecrets(String(text == null ? "" : text).trim());
  if (!full) return;
  kvSet("wake_pending_text", full);
  kvSet("wake_pending_at", localStamp());
  kvSet("wake_pending_at_ms", String(Date.now()));
  kvSet("wake_pending_urge", urge === null || urge === undefined ? "" : String(urge));
}

/**
 * 失败时的通知（用户真机上还在等它 —— **不许只写进日志**）。
 *
 * 三处按用户要求改过：
 *   ① 「第 N 次醒来」→「**已经连续 N 次没成功**」（语义更准），且数字 ≥20 就写 `20+`
 *   ② 带上**诊断结论**（后台没网 / 只有你的上游解析不出来 / 上游连不上）
 *   ③ 结论**变了**就立刻通知一次（哪怕还在冷却里）—— 不然用户要再等一小时才知道"答案变了"
 *
 * `code` 是诊断结论的代号（`bg-offline` / `dns-only` / `connect-timeout` / `connect-only`）；
 * HTTP 那类错误（4xx/5xx）没有代号，走原来的 60 分钟冷却。
 */
function errorNotify(count, stamp, why, code) {
  /** "连续几次没成功"：每次都加 —— 加在冷却判断**之前**，冷却期里的失败也要算进去 */
  var streak = kvNum("fail_streak") + 1;
  kvSet("fail_streak", streak);
  var lastErr = kvNum("last_err_at");
  var now = Date.now();
  var verdictChanged = Boolean(code) && cfg("last_err_kind") !== code;
  if (!verdictChanged && lastErr > 0 && (now - lastErr) / 60000 < ERR_NOTIFY_COOLDOWN_MIN) {
    logLine("#" + count + " " + stamp + " 没成功（已经连续 " + streak + " 次）—— 通知在冷却里，这条先不吵他");
    return;
  }
  if (code) kvSet("last_err_kind", code);
  kvSet("last_err_at", now);
  var shown = streak >= FAIL_STREAK_CAP ? FAIL_STREAK_CAP + "+" : String(streak);
  notify(
    NOTIFY_ID_BASE + 999,
    "栖岛 · 主动找你（没成功）",
    "已经连续 " + shown + " 次没成功：" + maskSecrets(why).slice(0, 160),
  );
}


/* ───────── 失败自诊断：把"为什么找不到上游"变成确定答案 ───────── */

/**
 * 带超时的 `fetch` —— 这个引擎里**没有 AbortController**（options 也只认 method/headers/body），
 * 所以只能让一个定时器跟 fetch 赛跑：谁先到谁说话。
 * ⚠️ 超时之后那个 fetch 还挂着，但这次唤醒结束时整个上下文会被销毁 —— 不用管它。
 */
function fetchWithTimeout(url, opts, ms) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error("等了 " + ms + " 毫秒没回应（超时）"));
    }, ms);
    fetch(url, opts).then(
      function (res) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      },
      function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 把网络错误的原文分成三类 —— 用户要的"是哪一种"就在这一步定下来：
 *   · `dns`     解析不出来（拿不到 IP）
 *   · `timeout` 能解析但连不通（等超时）
 *   · `connect` 别的连接问题（拒绝、重置、证书…）
 * ⚠️ 真机上那条约 90 次的
 *    `Unable to resolve host "api.deepseek.com": No address associated with hostname`
 *    就是第一类（安卓引擎的原文）。
 */
function classifyNetError(msg) {
  var m = String(msg || "");
  if (
    /unable to resolve host|no address associated|getaddrinfo|enotfound|eai_again|nodename nor servname|name or service not known|解析/i.test(
      m,
    )
  ) {
    return "dns";
  }
  if (/timed out|timeout|超时|abort/i.test(m)) return "timeout";
  return "connect";
}

/** 探一下对照组：**只要能连上就算通**（状态码多少都无所谓，它只证明"这条路上有网"） */
function probeControl(ms) {
  return fetchWithTimeout(PROBE_URL, { method: "GET" }, ms).then(
    function () {
      return "ok";
    },
    function (err) {
      return classifyNetError(err && err.message ? err.message : "");
    },
  );
}

/**
 * **把两个结果翻译成一句人话** —— 这一句就是用户要的确定答案：
 *   · 对照组也不通 → 后台整条网络不通（不是栖岛的问题）
 *   · 对照组通、只有上游解析不出来 → 只有这个域名拿不到 IP
 *   · 对照组通、上游超时/连不上 → 能解析但连不通
 */
function verdictOf(probeKind, upstreamKind, host) {
  if (probeKind !== "ok") {
    return {
      code: "bg-offline",
      text: "后台没网：连 www.baidu.com 都不通（不是栖岛的问题，是系统把后台联网掐了）",
    };
  }
  if (upstreamKind === "dns") {
    return {
      code: "dns-only",
      text: "只有你的上游解析不出来：" + (host || "你的上游") + " 拿不到 IP（百度能通）",
    };
  }
  if (upstreamKind === "timeout") {
    return { code: "connect-timeout", text: "上游连不上：能解析但连不通（连接超时；百度能通）" };
  }
  return { code: "connect-only", text: "上游连不上：能解析但连不通（百度能通）" };
}

/** 按剩余预算算一次请求的超时（永远给个正数，免得算出负数） */
function budgetedTimeout(ctx) {
  return Math.min(ATTEMPT_TIMEOUT_MS, Math.max(1000, ctx.deadline - Date.now() - MIN_ATTEMPT_MS));
}

/**
 * 发一个请求，**网络类失败就重试**（2s / 5s，最多 3 次尝试），成功就交给 `onReply`。
 *
 * ⚠️ 只在"没问到网"时重试：
 *   · 4xx/5xx（比如 key 错了、余额没了）**一次都不重试** —— 重试多少次结果都一样，
 *     只会白拖这次唤醒（拿到回包就算"问到了"，由 `onReply` 自己看状态码）
 *   · 剩余预算不够下一次尝试时也不重试（直接进诊断）
 *
 * `ctx` = `{ deadline, count, stamp, log, done }`（这次唤醒的状态；`done` 就是 `resolve`）。
 * ⚠️ `onFail` **必须自己把这次唤醒收尾**（调 `ctx.done()` 或等诊断完再调）——
 * 漏了它后台那边就永远挂着（纪律 ③）。
 */
function requestWithRetry(ctx, url, init, onReply, onFail) {
  function attempt(n) {
    fetchWithTimeout(url, init, budgetedTimeout(ctx)).then(onReply, function (err) {
      var msg = err && err.message ? err.message : "网络出问题";
      var kind = classifyNetError(msg);
      var delay = RETRY_DELAYS_MS[n - 1];
      var left = ctx.deadline - Date.now();
      if (delay && left > delay + MIN_ATTEMPT_MS + PROBE_MIN_MS) {
        ctx.log("第 " + n + " 次没问到（" + kind + "），" + delay / 1000 + " 秒后再试：" + String(msg).slice(0, 50));
        setTimeout(function () {
          attempt(n + 1);
        }, delay);
        return;
      }
      onFail(msg, kind, n);
    });
  }
  attempt(1);
}

/**
 * 真的问不到了 → **再探一个"几乎肯定能通"的对照组**，把结论写进日志**和**通知。
 *
 * 用户的原话："有网、没挂梯、私人 DNS 是关的、设置没问题" —— 所以不能再回他一句
 * `No address associated with hostname` 让他自己猜；得说清是"后台整条没网"还是"只有这个域名"。
 * ⚠️ 诊断也算进那 30 秒预算：时间不够就**放弃本轮诊断**（下一次还有机会）。
 */
function diagnoseAndNotify(ctx, msg, kind, tries, host) {
  ctx.log("问不到上游（" + kind + "，" + tries + " 次都没成）：" + String(msg).slice(0, 60));
  var left = ctx.deadline - Date.now();
  if (left < PROBE_MIN_MS) {
    ctx.log("诊断：no-time —— 时间不够（剩 " + Math.max(0, Math.round(left / 1000)) + " 秒），跳过对照探测");
    errorNotify(ctx.count, ctx.stamp, "问不到上游（" + kind + "）：" + String(msg).slice(0, 80), "");
    ctx.done();
    return;
  }
  probeControl(Math.min(PROBE_TIMEOUT_MS, left - 500)).then(function (probeKind) {
    var v = verdictOf(probeKind, kind, host);
    /** 每次诊断结论都写进 KV 日志（带本地时间）—— 设置页"后台记录"里看到的就是这些行 */
    ctx.log("诊断：" + v.code + " —— " + v.text + "（对照组 " + probeKind + "）");
    errorNotify(ctx.count, ctx.stamp, v.text + "｜原始报错：" + String(msg).slice(0, 60), v.code);
    ctx.done();
  });
}

/** 给模型看的"过了多久"（人话） */
function elapsedText(elapsedMin) {
  if (elapsedMin === null) return "很久（你们还没聊过）";
  var m = Math.round(elapsedMin);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟";
  var h = Math.floor(m / 60);
  return h + " 小时" + (m % 60 > 0 ? " " + (m % 60) + " 分钟" : "");
}

/** 夜间不打扰（起止相同 = 不启用；跨零点也对，比如 23→7） */
function inQuiet(hour, start, end) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** 模型偶尔把话包在引号里 / 带前缀 —— 清一下（中文引号也要清，验收抓到过） */
function cleanReply(raw, aiName) {
  var text = String(raw || "").trim();
  if (!text) return "";
  if (/^skip\b/i.test(text) || text === "SKIP") return "";
  return text
    .replace(/^["“”「」『』'']+|["“”「」『』'']+$/g, "")
    .replace(new RegExp("^" + aiName + "\\s*[:：]\\s*"), "")
    .trim();
}

/* ───────── 主流程 ───────── */

addEventListener("qidaoWake", function (resolve, reject) {
  try {
    var now = Date.now();
    var stamp = localStamp();
    var count = kvNum("wake_count") + 1;
    kvSet("wake_count", count);

    var baseUrl = cfg("cfg_base_url");
    var apiKey = cfg("cfg_api_key");
    var model = cfg("cfg_model");
    var aiName = cfg("cfg_ai_name") || "栖岛";
    /** 抽屉里有配置 → **甲**（直接问你的 AI） */
    var direct = /^https?:\/\//.test(baseUrl) && apiKey !== "" && model !== "";

    if (direct) {
      /* ① 总开关：App 里关掉就完全安静（连请求都不发） */
      if (cfg("cfg_enabled") === "0") {
        kvSet("muted_at", now);
        logLine("#" + count + " " + stamp + " 你关掉了，什么都不做");
        resolve();
        return;
      }
    }

    /**
     * **静音期**（你关掉了 / 上次 Worker 回了 `muted: true`）→ **连请求都不发**。
     * ⚠️ 这道检查要放在"两条路"的**前面**（一开始只加在主路上，
     * 结果走备路时每个 25 分钟还是照发 —— 验收抓到的）。
     */
    var mutedAt = kvNum("muted_at");
    if (mutedAt > 0 && (now - mutedAt) / 60000 < MUTED_RECHECK_MIN) {
      logLine("#" + count + " " + stamp + " 静音中（你关掉了）");
      resolve();
      return;
    }

    if (direct) {
      kvSet("muted_at", 0);

      /* ② 夜间不打扰 */
      var hour = new Date().getHours();
      var qs = kvNum("cfg_quiet_start");
      var qe = kvNum("cfg_quiet_end");
      if (inQuiet(hour, qs, qe)) {
        logLine("#" + count + " " + stamp + " 夜间不打扰（" + qs + "–" + qe + "）");
        resolve();
        return;
      }

      /*
        ③ **掷骰子：这次要不要真的看他一眼**（用户定的规矩）
           "每隔一小时系统起程序，叫 ai 概率各一半，这次没叫就下次"
           → 每次 50%；**没看就记着、下次必定看**（最多隔一次就会看他）。
           ⚠️ "起程序"≠"看他"：起程序是系统每小时的节拍（很轻），
              看才是真的读对话、调 AI（花钱的那一步）。
      */
      var lookAcc = kvNum("look_acc");
      var look = lookAcc === 1 || Math.random() < 0.5;
      if (!look) {
        kvSet("look_acc", 1);
        logLine("#" + count + " " + stamp + " 这次没看他（50% 那半）→ 下次必定看");
        resolve();
        return;
      }
      kvSet("look_acc", 0);

      /*
        ④ **他醒了：这次要不要说** —— 也是 50%。
           "ai 说话也是说不说各 50，这次没说下次必定说"
           → 被看时 50% 说；**上次没说 → 这次必定说**。
           所以最坏 4 小时一定有一句：没看 + 看了没说 + 没看 + 看了必说（用户算的，对）。
      */
      var speakAcc = kvNum("speak_acc");
      var mustSpeak = speakAcc === 1;

      var lastSpoke = kvNum("last_spoke_at");
      var elapsed = lastSpoke > 0 ? (now - lastSpoke) / 60000 : null;

      /* ⑤ 挑指令：平时那段允许他回 SKIP；"必定说"那段不许 */
      var tpl = cfg(mustSpeak ? "cfg_prompt_force" : "cfg_prompt_normal");
      if (!tpl) {
        logLine("#" + count + " " + stamp + " 抽屉里没有指令（App 还没交过来？）");
        errorNotify(count, stamp, "抽屉里没有指令：App 还没把配置交过来");
        resolve();
        return;
      }
      var system = tpl
        .replace(/\{\{TIME\}\}/g, stamp)
        .replace(/\{\{ELAPSED\}\}/g, elapsedText(elapsed));

      /** ⑤ 直接问你的上游（失败会自己诊断"为什么找不到上游"） */
      var askUrl = baseUrl.replace(/\/+$/, "") + "/chat/completions";
      var askInit = function (sys, userLine) {
        return {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userLine },
            ],
            max_tokens: 200,
            temperature: 0.9,
            stream: false,
          }),
        };
      };
      /** 这次唤醒的状态（30 秒预算从这里算；`done` 就是 resolve —— 收尾只能走它） */
      var ctx = {
        deadline: now + WAKE_BUDGET_MS,
        count: count,
        stamp: stamp,
        log: function (text) {
          logLine("#" + count + " " + stamp + " " + text);
        },
        done: resolve,
      };
      /** 上游的主机名（诊断那句话里要说清是谁拿不到 IP） */
      var upstreamHost = baseUrl.replace(/^https?:\/\//, "").split("/")[0];

      /**
       * 拿到回包（任何状态码都算"问到了"）：
       *   · 非 2xx → **不重试**（key 错、余额空重试多少次都一样），只把状态码说出来
       *   · 2xx   → 走原来的流程（SKIP / 必说档 / 弹通知）
       */
      function onUpstreamReply(status, body) {
        if (status < 200 || status >= 300) {
          ctx.log("上游 " + status);
          errorNotify(count, stamp, "上游返回 " + status + "：" + String(body).slice(0, 80));
          resolve();
          return;
        }
        /** 真问到了 → "连续没成功"直接归零 */
        kvSet("fail_streak", 0);
        var data = null;
        try {
          data = JSON.parse(body);
        } catch (e) {
          data = null;
        }
        var said = data
          ? cleanReply(
              (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "",
              aiName,
            )
          : "";

        /* "上次没说 → 这次必定说"：他耍赖回 SKIP，就带"不许 SKIP"再问一次 */
        if (!said && mustSpeak) {
          fetchWithTimeout(
            askUrl,
            askInit(system + "\n\n【最后一次】你必须说一句话，不许回 SKIP。哪怕只是问一句在干嘛。", "说一句。"),
            budgetedTimeout(ctx),
          )
            .then(function (res2) {
              return res2.text();
            })
            .then(function (body2) {
              var d2 = null;
              try {
                d2 = JSON.parse(body2);
              } catch (e) {
                d2 = null;
              }
              var said2 = d2
                ? cleanReply(
                    (d2.choices && d2.choices[0] && d2.choices[0].message && d2.choices[0].message.content) || "",
                    aiName,
                  )
                : "";
              finish(said2, true);
              resolve();
            })
            .catch(function () {
              finish("", true);
              resolve();
            });
          return;
        }
        finish(said, false);
        resolve();
      }

      requestWithRetry(
        ctx,
        askUrl,
        askInit(system, "现在，你要主动说一句什么？（或者回 SKIP）"),
        function (res) {
          /** 回包都到了，正文读不出来不算"没问到网"（按状态码照常处理） */
          res.text().then(
            function (body) {
              onUpstreamReply(res.status, body);
            },
            function () {
              onUpstreamReply(res.status, "");
            },
          );
        },
        /** 三次都没问到网（或预算不够）→ 探对照组，把结论写进日志 + 通知，然后收尾 */
        function (msg, kind, tries) {
          diagnoseAndNotify(ctx, msg, kind, tries, upstreamHost);
        },
      );

      /**
       * 收尾：说了就弹通知 + 归零；**没说就记着、下次必定说**（用户："这次没说下次必定说"）。
       */
      function finish(said, forced) {
        if (said) {
          kvSet("last_spoke_at", now);
          kvSet("speak_acc", 0);
          /**
           * **说成一句 → "醒了几次"归零**（用户："都跑到 82 次了，看着好多"）。
           * 之前它是"装上以来一共醒了多少次"，从不清零，所以能累到 82；
           * 现在它变成"**他还没说上话之前，已经醒了第几次**" —— 按规矩最多只到 4。
           */
          kvSet("wake_count", 0);
          notify(NOTIFY_ID_BASE + (count % 1000), aiName, said, WAKE_NOTIFY_ACTION);
          /** 这句话**完整**交给前台，好让它落进会话（不只是弹一条点不开的通知） */
          markPending(said, urgeFromElapsed(elapsed));
          logLine("#" + count + " " + stamp + " 说了" + (forced ? "（上次没说 → 这次必定说）" : "") + "：" + said.slice(0, 40));
        } else {
          kvSet("speak_acc", 1);
          logLine("#" + count + " " + stamp + " 这次选择不说 → 下次必定说（距上次说话 " + elapsedText(elapsed) + "）");
        }
      }
      return;
    }

    /* ───────── 备路：Worker 中转（抽屉里没配置，但注入过地址）───────── */

    var ready = /^https?:\/\//.test(WAKE_URL);
    if (!ready) {
      notify(NOTIFY_ID_BASE + (count % 1000), "栖岛 · 后台唤醒", "第 " + count + " 次醒来：" + stamp + "（本地时间）");
      logLine("#" + count + " " + stamp + " 没有任何配置（App 没交过来，也没注入 Worker 地址）");
      resolve();
      return;
    }

    var lastSpoke2 = kvNum("last_spoke_at");
    var since = lastSpoke2 > 0 ? String(Math.max(0, Math.round((now - lastSpoke2) / 60000))) : "";
    var url = WAKE_URL + (WAKE_URL.indexOf("?") === -1 ? "?" : "&") + "since=" + since;

    /**
     * 备路也是"问上游"（只是中间多了个 Worker）——
     * 所以同样：网络类失败隔 2s / 5s 重试，三次都没问到就探对照组、写清结论。
     * （用户最早那批失败就出在这条路上：能拿到一个被污染的 IP，但连不上。）
     */
    var wctx = {
      deadline: now + WAKE_BUDGET_MS,
      count: count,
      stamp: stamp,
      log: function (text) {
        logLine("#" + count + " " + stamp + " " + text);
      },
      done: resolve,
    };
    var workerHost = WAKE_URL.replace(/^https?:\/\//, "").split("/")[0];

    function onWorkerReply(raw) {
      var data = null;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = null;
      }
      if (!data) {
        logLine("#" + count + " " + stamp + " 返回不是 JSON");
        errorNotify(count, stamp, "拿回来的不是 JSON：" + String(raw).slice(0, 80));
        resolve();
        return;
      }
      /** 通道本身是通的（拿到了 JSON）→ "连续没成功"归零；`ok:false` 由下面照旧记账 */
      if (data.ok !== false) kvSet("fail_streak", 0);
      if (data.muted) kvSet("muted_at", now);
      if (data.action === "speak" && data.text) {
        kvSet("last_spoke_at", now);
        /** 说成一句 → "醒了几次"归零（同主路；用户要求） */
        kvSet("wake_count", 0);
        notify(NOTIFY_ID_BASE + (count % 1000), data.aiName || "栖岛", data.text, WAKE_NOTIFY_ACTION);
        /** 备路也是"他说了" → 同样要**完整**交给前台（跟甲那条路一样，不截断） */
        markPending(data.text, data.urge);
        logLine("#" + count + " " + stamp + " 说了（程度 " + data.urge + "）");
      } else if (data.ok === false) {
        logLine("#" + count + " " + stamp + " 失败：" + String(data.why || "").slice(0, 60));
        errorNotify(count, stamp, data.why || "他没答上来");
      } else {
        logLine("#" + count + " " + stamp + " 没说：" + String(data.why || "").slice(0, 40));
      }
      resolve();
    }

    requestWithRetry(
      wctx,
      url,
      { method: "GET", headers: { Accept: "application/json" } },
      function (res) {
        res.text().then(
          function (raw) {
            onWorkerReply(raw);
          },
          function () {
            onWorkerReply("");
          },
        );
      },
      function (msg, kind, tries) {
        diagnoseAndNotify(wctx, msg, kind, tries, workerHost);
      },
    );
  } catch (err) {
    /* ③ 无论如何都要收尾 */
    reject(err);
  }
});
