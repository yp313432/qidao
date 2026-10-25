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
 * ── 只走一条路 ────────────────────────────────────────────
 *   只问用户自己在设置里配的上游（直连，不经过任何中转）。
 *   曾经的「备路：Cloudflare Worker 中转」在 2026-10 整条移除 ——
 *   它会把系统提示词、最近对话、连 apiKey 一起发给中转方；
 *   对主路没有增益，却是真实的数据外流口子。
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
  /*
    ⚠️ 2026-10 真机第二次事故：后台记录里**每小时都醒**，但一行"开始问他 / 他说了 /
    他没说 / 上游报错"都没有 —— 说明进程在"问上游"那一步被系统掐断了（安卓给后台任务
    的时间很短，30 秒预算 + 3 次重试很容易超）。所以预算收窄到 18 秒、单次 6 秒、
    只重试一次（6 + 1.5 + 6 ≈ 14 秒，留出写日志和弹通知的时间）。
  */
  /**
 * 预算与超时（用户 m11252 的通知：`问不到上游（timeout）：等了 6000 毫秒没回应`）。
 *
 * 6000ms 对一次**非流式**的 LLM 请求根本不够：DeepSeek 这类带思考的模型，
 * 首字 5~10 秒、整段 10~30 秒都算正常。于是每次醒来都在 6 秒处被自己掐断，
 * 表现就是"每小时都醒、永远没话说"。
 *
 * 安卓后台任务整体窗口大约 30 秒，所以把单次尝试放到 22 秒、总预算 28 秒
 * （留 6 秒给收尾落库）。时间不够就**不重试**了 —— 与其两次都半途而废，
 * 不如一次跑完；这一帧没说完，session 会存下来，下一次唤醒接着做。
 */
var WAKE_BUDGET_MS = 28000;

/** 单次上游请求最多等多久（这个引擎里没有 AbortController，只能让定时器跟 fetch 赛跑） */
var ATTEMPT_TIMEOUT_MS = 22000;

/** 网络类失败后的重试间隔；最多 3 次尝试，所以只要两档（2s / 5s） */
var RETRY_DELAYS_MS = [];

/** 还剩多少时间才值得再试一次（给下一次尝试留出余地） */
var MIN_ATTEMPT_MS = 1500;

/**
 * **一段生活**（2026-10-21 批1+2，用户："唤醒他醒过来，就跟人起床一样……是一段时间，不是一个动作"）
 *
 * 一次唤醒 = 跑"一帧"：问上游、拿到动作、记下回执、接着问下一步……
 * 直到步数用完 / 预算不够 / 他自己说"这段到这儿"。
 *    · 一帧最多 2 步（30 秒预算，一次请求 8~15 秒，再多就必然被掐断）
 *    · 一段最多 4 步（跨帧续跑：这次没跑完就把进度存进抽屉，下次醒来接着）
 */
var LIFE_MAX_STEPS = 4;
var LIFE_STEPS_PER_FRAME = 2;

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

/* ── 主动说话的"别烦人"计数（2026-11）──────────────────────────────
   用户定的默认值：**至少隔 40 分钟**、**一天最多 8 条**。
   ⚠️ 抽屉里没配这两个键时（老包的配置）用默认值 —— 不能因为读不到就不限流，
      那样正好退化成"想发就发"，也就是用户最怕的骚扰。 */
var DEFAULT_MIN_GAP_MIN = 40;
var DEFAULT_DAILY_MAX = 8;

/** 读一个"带默认值"的配置（抽屉里存的都是字符串） */
function cfgNumOr(key, fallback) {
  var raw = cfg(key);
  if (!raw) return fallback;
  var n = Number(raw);
  return isFinite(n) && n >= 0 ? n : fallback;
}

/** 本地日期（跨天要重置当天额度，所以用**本地**日期不是 UTC） */
function dayStamp(now) {
  var d = new Date(now);
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

/** 今天已经主动说了几条 */
function spokeToday(now) {
  return cfg("spoke_day") === dayStamp(now) ? kvNum("spoke_day_count") : 0;
}

/** 说成了一条 → 记当天一笔（跨天自动从 1 开始） */
function bumpSpokeToday(now) {
  var key = dayStamp(now);
  if (cfg("spoke_day") !== key) {
    kvSet("spoke_day", key);
    kvSet("spoke_day_count", 1);
  } else {
    kvSet("spoke_day_count", kvNum("spoke_day_count") + 1);
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
 *
 * ⚠️ **不传 `smallIcon`**（2026-11 用户定的口径）：荣耀/华为会把"自定义的小图标"
 * 单独画在通知右边，而别的 App 右边什么都没有 —— 用户要的是"跟其他通知一样"。
 * 要恢复自定义图标，就在下面 `n` 里加 `smallIcon: "ic_stat_qidao"`（那张图还在包里）。
 * 这条路**只有小图标**：`Notifications.kt` 里压根没有大图标（没有 setLargeIcon），
 * 所以"给后台这条通知加大图/头像"是做不到的 —— 别在这上面浪费时间。
 */
function notify(id, title, body, actionTypeId) {
  try {
    var n = {
      id: id,
      title: maskSecrets(title),
      body: maskSecrets(body),
    };
    if (actionTypeId) n.actionTypeId = actionTypeId;
    /*
      ⚠️ `scheduleAt` 在 Background Runner 的 `NotificationScheduleOptions` 里是**必填**
      （见 @capacitor/background-runner 的 apis.d.ts）。原来没传 —— 插件解析参数时
      可能直接不弹，而下面 catch 又把异常吞掉，于是"他说了、抽屉里有、就是没通知"，
      用户只能点开 App 才补到那一条（m07120）。补一个 1 秒后的时间即可立即弹。
    */
    n.scheduleAt = new Date(Date.now() + 1000);
    CapacitorNotifications.schedule([n]);
  } catch (e) {
    /* 弹不出来要留痕，否则"没收到通知"永远查不出来 */
    logLine("通知没弹出来：" + String(e && e.message ? e.message : e).slice(0, 120));
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
  logLine(
    "#" + ctx.count + " " + ctx.stamp + " 问不到上游（" + kind + "，" + tries + " 次）：" +
      String(msg).slice(0, 60),
  );
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

/**
 * **从回复里抠出一个"动作"**（2026-10 方案一：他自己过日子）。
 *
 * 后台只能拿到一段文字 —— 所以这里只认**白名单**里的种类，其它一律返回 null
 * （前台还会再按同一份白名单兜一道；两边都拦，删东西/改设置这类永远进不来）。
 * 抠不出来就返回 null，**绝不编**。
 */
function extractAction(text) {
  var s = String(text || "");
  var allow = {
    "diary.add": 1,
    "moment.post": 1,
    "letter.write": 1,
    "moment.comment": 1,
    "moment.like": 1,
    "emotion.report": 1,
    /**
     * 2026-10-21 批1：**花园里的身体动作**也放行。
     *
     * 原来只认 6 个"写东西"的动作 → 他醒来想的"去池塘钓鱼"根本落不了地，
     * 竿永远是文字里的竿。现在这些动作由前台真正执行（改花园状态）。
     * 仍然**只增不改**：没有删除、没有设置、没有外部工具。
     */
    "garden.walk": 1,
    "garden.fish.cast": 1,
    "garden.fish.reel": 1,
    "garden.flower.plant": 1,
    "garden.flower.water": 1,
    "garden.flower.feed": 1,
    "garden.flower.pick": 1,
    "garden.flower.gift": 1,
    "garden.gomoku.play": 1,
    "garden.tarot.draw": 1,
    "garden.read": 1,
  };
  /**
   * ⚠️ 2026-10 真机踩到的坑：模型把动作写成**数组**（`[{...}]`，甚至两个动作），
   * 老写法（一个贪婪 `/\{[\s\S]*\}/` + 一次 `JSON.parse`）会当场失败 →
   * 结果"原始 JSON 被当成他说的话"发进了对话（用户截图看到的就是这个）。
   * 所以现在：① 先试整段数组 ② 再**逐个抠平衡的花括号对象**，谁先合法用谁。
   */
  var tries = [];
  var arrMatch = /\[[\s\S]*\]/.exec(s);
  if (arrMatch) tries.push(arrMatch[0]);
  var depth = 0;
  var start = -1;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        tries.push(s.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (var j = 0; j < tries.length; j++) {
    try {
      var v = JSON.parse(tries[j]);
      if (Object.prototype.toString.call(v) === "[object Array]") v = v[0];
      if (v && typeof v.kind === "string" && allow[v.kind]) return v;
    } catch (e) {
      /* 试下一个 */
    }
  }
  return null;
}

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
    /**
     * **配置指纹自检**（2026-10 加，用户提出的"唤醒还开着用旧那家 API"那件事）。
     *
     * 规则跟 `src/lib/data/wake-config.ts` 的 `checkWakeDrawer()` **必须一致**
     * （runner 是独立 JS，不能 import TS；`verify-data-layer.mjs` 会盯这两边）。
     *
     * 为什么必须有：以前"设置里没上游"时前台**跳过推送**，抽屉里那份旧配置就一直留着，
     * 后台每天还用**旧那家**发消息（用户已经停用/换家了他也不知道）。
     * 现在：没有指纹（= 旧版写的，无法确认跟 App 设置一致）→ **不发**，改为提示用户开一次 App。
     */
    var fp = cfg("cfg_fingerprint");
    var configFresh = fp !== "" && /^[0-9a-f]{8}$/.test(fp);
    /** 抽屉里有配置 → **甲**（直接问你的 AI） */
    var direct = /^https?:\/\//.test(baseUrl) && apiKey !== "" && model !== "";

    if (direct && !configFresh) {
      /* 配置来路不明（没有指纹）→ 宁可不说，也不能拿旧配置乱发 */
      kvSet("muted_at", now);
      logLine("#" + count + " " + stamp + " 抽屉里的配置没有指纹（旧版写的）→ 这次不发，等 App 同步");
      errorNotify(count, stamp, "唤醒配置需要刷新：打开一次栖岛，让它把当前的上游同步过来", "stale-config");
      resolve();
      return;
    }

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
      /*
        上次是不是死在「问上游」那步（进程被系统掐断）—— 不写这一行，用户下一次
        看到的就是"醒了、也没说话"，跟概率问题分不开。`wake_stage` 由请求前写入、
        `finish()` 收尾时清掉。
      */
      if (cfg("wake_stage") === "asking") {
        logLine("#" + count + " " + stamp + " 上次醒来停在「问上游」没跑完（后台任务被系统掐断了）");
        /* 只报一次：留着的话每次醒来都会重复这一行 */
        kvSet("wake_stage", "");
      }

      var lookAcc = kvNum("look_acc");
      /*
        ⚠️ 2026-10 真机事故："一天都没通知"，后台记录里却连着 6 次"这次没看他"。
        设计上"没看 → 下次必定看"最多隔一次，出现连续 6 次说明**`look_acc` 没生效**
        （抽屉被清过 / 写没落盘 / 前台重推配置把键冲掉了）。掷骰子本身别动（用户定的 50%），
        但要有一条**不依赖那个键的兜底**：距上次真的看他超过 3 小时，这次一定看。
        否则一旦那个键失效，他就可能整天空转 —— 这是"没通知"最坏的一种。
      */
      var lastLook = kvNum("last_look_at");
      var lookOverdue = lastLook > 0 && now - lastLook > 3 * 60 * 60 * 1000;
      var look = lookAcc === 1 || lookOverdue || Math.random() < 0.5;
      if (!look) {
        kvSet("look_acc", 1);
        logLine(
          "#" + count + " " + stamp + " 这次没看他（50% 那半，look_acc=" + lookAcc + "）→ 下次必定看",
        );
        resolve();
        return;
      }
      if (lookAcc !== 1 && !lookOverdue) {
        logLine("#" + count + " " + stamp + " 这次看他（50% 命中）");
      } else {
        logLine(
          "#" + count + " " + stamp + " 这次看他（" + (lookAcc === 1 ? "上次没看→必定看" : "已 3 小时没看→兜底") + "）",
        );
      }
      kvSet("look_acc", 0);
      kvSet("last_look_at", now);

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
      /*
        同一条兜底：`speak_acc` 万一失效，也别让他"看了却不开口"一整天。
        距上次说话超过 5 小时 → 这次必定说（下面的闸门仍然照常拦：忙/最短间隔/每天上限）。
      */
      if (!mustSpeak && (lastSpoke <= 0 || now - lastSpoke > 5 * 60 * 60 * 1000)) {
        mustSpeak = true;
      }

      /*
        ④.5 **三道闸门**（2026-11 用户要的"别烦人"）：
          · 他说了「我在忙」→ 彻底不打扰（他自己声明的，不是我们猜的）
          · 最短间隔：两次主动说话至少隔这么久（用户定的 40 分钟）
          · 每天上限：一天最多主动说几条（用户定的 8 条）
        ⚠️ 顺序有意义：忙 > 间隔 > 上限。**任何一条命中都是"这次不说"，不是"出错"**，
           所以只记一行日志、不弹错误通知（弹了就成了骚扰本身）。
      */
      var busyUntil = kvNum("cfg_busy_until");
      if (busyUntil > now) {
        logLine("#" + count + " " + stamp + " 他说了「我在忙」→ 这次不打扰（到 " + new Date(busyUntil).toLocaleString() + "）");
        resolve();
        return;
      }
      var minGapMs = cfgNumOr("cfg_min_gap_min", DEFAULT_MIN_GAP_MIN) * 60000;
      if (minGapMs > 0 && lastSpoke > 0 && now - lastSpoke < minGapMs) {
        logLine("#" + count + " " + stamp + " 距上次主动说话不到 " + minGapMs / 60000 + " 分钟 → 这次不说");
        resolve();
        return;
      }
      var dailyMax = cfgNumOr("cfg_daily_max", DEFAULT_DAILY_MAX);
      if (dailyMax > 0 && spokeToday(now) >= dailyMax) {
        logLine("#" + count + " " + stamp + " 今天主动说话的额度用完了（" + dailyMax + " 条）→ 这次不说");
        resolve();
        return;
      }

      /**
       * ⑤a **他自己的日子：日记保底**（2026-10 方案一「草稿 + 通知」）──────────
       * 条件全满足才走这条：总开关开 · 日记开关开 · 在窗口内（默认 20:30–22:00）·
       * **今天他还没写过**（前台推来的 `cfg_action_day` 或后台自己记的 `diary_done_day`）。
       * 命中就用"动作指令"问他一次；他给的动作**交给前台**按白名单执行（后台不写库）。
       * ⚠️ 完全不动下面原来那条"主动说话"的逻辑 —— 没命中时 `actionMode` 是空串，一切照旧。
       */
      var actionMode = "";
      if (cfg("cfg_autonomy_on") === "1" && cfg("cfg_action_prompt")) {
        var today = dayStamp(now);
        /* ⚠️ `now` 是 `Date.now()` 的**数字**，不能直接 `.getHours()` ——
           2026-10 真机：这里抛 TypeError，被最外层 catch 吞掉，
           于是"每小时都醒、却从没说过话/没写日记"，后台记录里只有 look 那行。 */
        var nowClock = new Date(now);
        var nowMin = nowClock.getHours() * 60 + nowClock.getMinutes();
        /**
         * 优先级（用户定的）：**回响 > 日记保底 > 自由活动**，一次醒来只做一件。
         */
        /* ① 回响：App 把你互动过的料推进抽屉了（你发动态 / 评论了他 / 点了赞） */
        if (cfg("cfg_action_echo") === "1" && cfg("cfg_echo_what")) {
          var echoMax = cfgNumOr("cfg_action_echo_max", 3);
          var echoCount = cfg("echo_day") === today ? kvNum("echo_count") : 0;
          if (echoCount < echoMax) actionMode = "echo";
        }
        /* ② 日记保底：窗口内（默认 20:30–22:00）+ 今天他还没写过 */
        if (!actionMode && cfg("cfg_action_diary") === "1") {
          var dTarget = cfgNumOr("cfg_action_hour", 20) * 60 + cfgNumOr("cfg_action_minute", 30);
          var wroteToday = cfg("cfg_action_day") === today || cfg("diary_done_day") === today;
          if (nowMin >= dTarget && nowMin <= dTarget + 90 && !wroteToday) actionMode = "diary";
        }
        /* ③ 自由活动：9:00–22:00 + **掷骰子**（用户要的"不定时"）+ 当天不超上限 */
        if (!actionMode && cfg("cfg_action_free") === "1") {
          var freeMax = cfgNumOr("cfg_action_free_max", 1);
          var freeCount = cfg("free_day") === today ? kvNum("free_count") : 0;
          var pct = cfgNumOr("cfg_action_free_pct", 30);
          if (nowMin >= 9 * 60 && nowMin <= 22 * 60 && freeCount < freeMax && Math.random() * 100 < pct) {
            actionMode = "free";
          }
        }
      }

      /* ⑤ 挑指令：平时那段允许他回 SKIP；"必定说"那段不许 */
      var tpl = actionMode
        ? cfg("cfg_action_prompt")
        : cfg(mustSpeak ? "cfg_prompt_force" : "cfg_prompt_normal");
      if (!tpl) {
        logLine("#" + count + " " + stamp + " 抽屉里没有指令（App 还没交过来？）");
        errorNotify(count, stamp, "抽屉里没有指令：App 还没把配置交过来");
        resolve();
        return;
      }
      var system = tpl
        .replace(/\{\{TIME\}\}/g, stamp)
        .replace(/\{\{ELAPSED\}\}/g, elapsedText(elapsed));

      /**
       * **回响**（用户："我发动态他现在能知道并反应吗"）：把 App 推进来的那份料
       * 贴给他，让他**只针对这一条**回应 —— 评论 / 点赞 / 或写点什么都行；
       * **没感觉就回一个空对象 {}**（那就什么都不做，不会硬凑）。
       */
      if (actionMode === "echo") {
        var echoId = cfg("cfg_echo_id");
        system =
          system +
          "\n\n【这次是为了回应他】" +
          cfg("cfg_echo_what") +
          "\n只针对这一条。可以评论：{\"kind\":\"moment.comment\",\"momentId\":\"" +
          echoId +
          "\",\"text\":\"你想说的话\"}；也可以点赞：{\"kind\":\"moment.like\",\"momentId\":\"" +
          echoId +
          "\"}；想写封信或单发一条动态也行。" +
          "\n**没感觉就回 {}**（空对象 = 什么都不做）。";
      }

      /**
       * ⑤ 直接问你的上游（失败会自己诊断"为什么找不到上游"）
       *
       * ⚠️ 2026-10 改（用户提的"换家 API 唤醒就白做了"）：
       *   以前这里**写死** `+ "/chat/completions"` + `Bearer` —— 是跟前台**两套写法**。
       *   现在路径/鉴权都由**前台**推过来（`cfg_chat_path` / `cfg_auth_style`），
       *   后台只"照单发"：换任何一家上游，前台知道怎么发，后台就跟着怎么发。
       */
      var chatPath = cfg("cfg_chat_path") || "/chat/completions";
      var authStyle = cfg("cfg_auth_style") || "bearer";
      var askUrl = baseUrl.replace(/\/+$/, "") + chatPath;
      var askHeaders = function () {
        var h = { "content-type": "application/json" };
        if (authStyle === "bearer") h.authorization = "Bearer " + apiKey;
        else if (authStyle === "x-api-key") h["x-api-key"] = apiKey;
        /* authStyle === "none" → 不带鉴权头（本地/自建代理那种） */
        return h;
      };
      var askInit = function (sys, userLine) {
        return {
          method: "POST",
          headers: askHeaders(),
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
          logLine("#" + count + " " + stamp + " 上游回了 " + status + "：" + String(body).slice(0, 60));
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

      /**
       * **自主活动改走"一段生活"**（2026-10-21 批1+2）。
       *
       * 原来是"问一次 → 抠一个动作 → 结束"：竿抛出去就没人管了，他永远只有第一步。
       * 现在 free / life 两种模式都进 loop：一帧最多 2 步，跨帧续跑。
       */
      if (actionMode === "free" || actionMode === "life") {
        kvSet("wake_stage", "asking");
        runLifeFrame();
        return;
      }

      /* 进请求前先落一行：这样"卡在问上游"和"问到了但没说"就能分开 */
      kvSet("wake_stage", "asking");
      ctx.log("→ 开始问他（预算 " + Math.round(WAKE_BUDGET_MS / 1000) + " 秒）");
      /* 用户 m09886："醒来了，但是还是没有消息" —— 界面上只看到"看他"那几行，
         分不清是"问上游卡住"还是"问到了但决定不说"。所以关键三步都写进 wake_log。 */
      logLine("#" + count + " " + stamp + " 开始问他（预算 " + Math.round(WAKE_BUDGET_MS / 1000) + " 秒）");

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

      /* ── 一段生活：一帧多步 + 回执回灌（2026-10-21 批1+2）────────── */

      /** 这段生活的进度（存在抽屉里，跨帧、跨重启都在） */
      function readLife() {
        var raw = cfg("life_session");
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      }

      function saveLife(session) {
        kvSet("life_session", session ? JSON.stringify(session) : "");
      }

      /**
       * **动作 → 一句回执**。
       *
       * 后台看不到 App 的真实状态（鱼有没有咬钩、花开了没），所以这里给的是
       * "他自己心里记下的那一句" —— 确定性写法，真实结果由前台执行后另算。
       * 有回执这件事本身才是关键：没有它，模型看不到"我干了什么"，只能永远重复第一步。
       */
      function receiptOf(act) {
        var k = String(act.kind || "");
        if (k === "garden.walk") return "走到了" + String(act.place || act.spot || "花园里");
        if (k === "garden.fish.cast") return "在" + String(act.spot || "池塘") + "边抛了竿，水面一圈圈散开";
        if (k === "garden.fish.reel") return "收了线（有没有鱼看运气）";
        if (k === "garden.flower.plant") return "把花种下去了";
        if (k === "garden.flower.water") return "给花浇了水";
        if (k === "garden.flower.feed") return "给花松了土、撒了点肥";
        if (k === "garden.flower.pick") return "剪下一枝带着走";
        if (k === "garden.flower.gift") return "给他留了一枝花";
        if (k === "garden.tarot.draw") return "在棋桌那边摆了几张牌";
        if (k === "garden.gomoku.play") return "在棋桌那边摆了一会儿棋子";
        if (k === "garden.read") return "在花园里看了一圈";
        if (k === "diary.add") return "写了一篇日记";
        if (k === "moment.post") return "发了一条动态";
        if (k === "letter.write") return "写了一封信";
        if (k === "emotion.report") return "心里记下了此刻的感觉";
        return "做了一件事";
      }

      /** 把"这段生活的账"贴进系统提示词 —— 这就是**回执回灌** */
      function lifeNote(session) {
        var lines = ["", "", "【你正在过的这一小段时间】"];
        if (session.steps.length === 0) {
          lines.push("刚醒，还什么都没做。");
        } else {
          lines.push("已经做了：");
          for (var i = 0; i < session.steps.length; i++) {
            lines.push("  " + (i + 1) + ". " + session.steps[i].receipt);
          }
          lines.push("（这些都是真的做过了，别重复；接着往下想。）");
        }
        lines.push("现在决定下一步：**只回一个动作 JSON**，不要说话、不要解释。");
        lines.push("做完了、或者觉得这段就到这里，就回 {}。");
        lines.push("能用的动作：garden.walk{place}、garden.fish.cast{spot}、garden.fish.reel{}、");
        lines.push("garden.flower.plant{species}、garden.flower.water{species}、garden.flower.pick{species}（species 取 rosa/giglio/ortensia/margherita/lavanda/glicine）");
        lines.push("diary.add{body}、moment.post{text}、letter.write{title,body}、emotion.report{primaryEmotion,group,intensity,confidence}");
        return lines.join("\n");
      }

      /** 这段生活收尾：把"做了什么"交给前台 + 弹一条通知（一段一条，不是每步一条） */
      function lifeSettle(ending) {
        kvSet("wake_stage", "");
        var session = readLife();
        if (!session || !session.steps || session.steps.length === 0) {
          saveLife(null);
          logLine("#" + count + " " + stamp + " 这段什么也没做");
          resolve();
          return;
        }
        var actions = [];
        var receipts = [];
        for (var i = 0; i < session.steps.length; i++) {
          actions.push(session.steps[i].args);
          receipts.push(session.steps[i].receipt);
        }
        var summary = String(ending || "").trim();
        if (!summary) summary = receipts.join("；") + "。";
        var payload = JSON.stringify({ summary: summary, actions: actions });
        var td = dayStamp(now);
        var fc = cfg("free_day") === td ? kvNum("free_count") : 0;
        kvSet("free_day", td);
        kvSet("free_count", fc + 1);
        kvSet("last_spoke_at", now);
        kvSet("speak_acc", 0);
        kvSet("wake_count", 0);
        kvSet("wake_pending_kind", "actions");
        markPending(payload, urgeFromElapsed(elapsed));
        notify(NOTIFY_ID_BASE + (count % 1000), aiName, summary, WAKE_NOTIFY_ACTION);
        logLine("#" + count + " " + stamp + " 这段生活 " + actions.length + " 步 → " + summary.slice(0, 40));
        saveLife(null);
        resolve();
      }

      /**
       * **跑一帧**：问上游 → 解析动作 → 记回执 → 再问下一步，直到
       * 步数用完 / 预算不够 / 他自己回 {} 说"到这儿"。
       * 预算不够就存进度直接返回，下次醒来接着跑（跨帧续跑）。
       */
      function runLifeFrame() {
        var session = readLife();
        var isNew = !session;
        if (!session) session = { id: "life_" + now, steps: [], target: LIFE_MAX_STEPS };
        var sent = 0;
        var lastSaid = "";

        function next() {
          if (session.steps.length >= session.target) {
            lifeSettle(lastSaid);
            return;
          }
          if (sent >= LIFE_STEPS_PER_FRAME) {
            saveLife(session);
            /* 这一帧是**正常收工**，不是"卡在问上游" —— 标记要清掉 */
            kvSet("wake_stage", "");
            logLine("#" + count + " " + stamp + " 这一帧做了 " + session.steps.length + " 步，剩下的下次醒来接着");
            resolve();
            return;
          }
          if (Date.now() + MIN_ATTEMPT_MS >= ctx.deadline) {
            saveLife(session);
            kvSet("wake_stage", "");
            logLine("#" + count + " " + stamp + " 预算不够，这段存下来下次接着（已做 " + session.steps.length + " 步）");
            resolve();
            return;
          }
          sent++;
          ctx.log("问第 " + sent + " 步（这段已做 " + session.steps.length + " 步）");
          requestWithRetry(
            ctx,
            askUrl,
            askInit(system + lifeNote(session), isNew && sent === 1 ? "现在，你想做什么？" : "下一步。"),
            function (res) {
              res.text().then(
                function (body) {
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
                  lastSaid = said;
                  var act = extractAction(said);
                  if (!act) {
                    lifeSettle(said);
                    return;
                  }
                  session.steps.push({ kind: act.kind, args: act, receipt: receiptOf(act), at: Date.now() });
                  saveLife(session);
                  if (act.kind === "diary.add" || act.kind === "letter.write") {
                    lifeSettle(said);
                    return;
                  }
                  next();
                },
                function () {
                  lifeSettle(lastSaid);
                },
              );
            },
            function () {
              lifeSettle(lastSaid);
            },
          );
        }

        next();
      }

      /**
       * 收尾：说了就弹通知 + 归零；**没说就记着、下次必定说**（用户："这次没说下次必定说"）。
       */
      function finish(said, forced) {
        /* 先把"还在问上游"的标记清掉 —— 下面有好几个 return 分支 */
        kvSet("wake_stage", "");
        if (said) {
          /**
           * **自主行动那条**（actionMode 命中时）：把回复里的动作抠出来交给前台执行。
           * 抠不出来 → **照旧当他"说了一句话"**（不编动作、不硬塞）；这样最坏情况
           * 也只是退化成现在这套行为，绝不会丢东西或者假装做了事。
           */
          var outText = said;
          var outKind = "";
          /**
           * ⚠️ 2026-10 真机：他"开了口却没说出什么" —— 回复被清洗后**只剩空串**
           * （正文只有动作块、或模型什么都没说），却照样发了通知/草稿，
           * 前台就插进一条空的"他自己说的"。**空的一律不发。**
           */
          if (!String(said).trim()) {
            kvSet("speak_acc", 1);
            logLine("#" + count + " " + stamp + " 回复是空的 → 这次不发（不插空消息）");
            return;
          }
          if (actionMode) {
            var act = extractAction(said);
            var td = dayStamp(now);
            if (act) {
              outText = JSON.stringify(act);
              outKind = "action";
              /** 各自记当天的账（独立额度）；回响用掉就把那格料清掉，不会重复回 */
              if (actionMode === "diary") {
                kvSet("diary_done_day", td);
              } else if (actionMode === "free") {
                var fc = (cfg("free_day") === td ? kvNum("free_count") : 0) + 1;
                kvSet("free_day", td);
                kvSet("free_count", fc);
              } else if (actionMode === "echo") {
                var ec = (cfg("echo_day") === td ? kvNum("echo_count") : 0) + 1;
                kvSet("echo_day", td);
                kvSet("echo_count", ec);
                kvSet("cfg_echo_what", "");
                kvSet("cfg_echo_id", "");
              }
              logLine("#" + count + " " + stamp + " 自主行动(" + actionMode + ")：" + act.kind);
            } else if (actionMode === "echo") {
              /**
               * 回响抠不出动作 = **他不想回**（可能就回了个 `{}`）→ 什么都不做
               * （不弹通知、不写草稿），但也记一笔当天的账，免得同一个料每次醒来都再问一遍。
               */
              var ec2 = (cfg("echo_day") === td ? kvNum("echo_count") : 0) + 1;
              kvSet("echo_day", td);
              kvSet("echo_count", ec2);
              kvSet("cfg_echo_what", "");
              kvSet("cfg_echo_id", "");
              logLine("#" + count + " " + stamp + " 回响：他没想回 → 不动任何东西");
              return;
            } else {
              /**
               * ⚠️ 自主行动（日记/自由活动）抠不出动作 → **这次什么都不做**。
               * 绝不把原始 JSON 当"他说的话"发给用户（真机踩过：对话里冒出一段
               * `[{"kind":"moment.comment"…` —— 用户截图就是这个）。
               * 也不记当天的账，下一次醒来再试。
               */
              kvSet("speak_acc", 1);
              logLine(
                "#" + count + " " + stamp + " 自主行动(" + actionMode + ")没抠出动作 → 这次什么都不做（不把原始 JSON 当话发出去）",
              );
              return;
            }
          }
          kvSet("last_spoke_at", now);
          /** ⚠️ 自主行动**不占**"主动说话"的额度（用户定的独立额度） */
          if (!actionMode) bumpSpokeToday(now);
          kvSet("speak_acc", 0);
          /**
           * **说成一句 → "醒了几次"归零**（用户："都跑到 82 次了，看着好多"）。
           * 之前它是"装上以来一共醒了多少次"，从不清零，所以能累到 82；
           * 现在它变成"**他还没说上话之前，已经醒了第几次**" —— 按规矩最多只到 4。
           */
          kvSet("wake_count", 0);
          notify(NOTIFY_ID_BASE + (count % 1000), aiName, said, WAKE_NOTIFY_ACTION);
          /** 这句话**完整**交给前台，好让它落进会话（不只是弹一条点不开的通知） */
          markPending(outText, urgeFromElapsed(elapsed));
          /** 交给前台的"这是动作草稿"标记（前台落库后会把这一格一起置空） */
          if (outKind) kvSet("wake_pending_kind", outKind);
          logLine("#" + count + " " + stamp + " 说了" + (forced ? "（上次没说 → 这次必定说）" : "") + "：" + String(outText).slice(0, 40));
        } else {
          kvSet("speak_acc", 1);
          logLine("#" + count + " " + stamp + " 这次选择不说 → 下次必定说（距上次说话 " + elapsedText(elapsed) + "）");
        }
      }
      return;
    }

    /* 备路（Cloudflare Worker 中转）已整条移除 —— 见文件头「只走一条路」。 */
    logLine("#" + count + " " + stamp + " 主路没走通（备路已移除），这次什么都没发生");
  } catch (err) {
    /* ③ 无论如何都要收尾 —— 但**必须留一行痕**：`reject` 之后界面里什么都看不见，
       否则"醒了却什么都没发生"永远查不出原因（2026-10 真机就是这么瞎了一整天）。 */
    try {
      logLine(
        "#" + count + " " + stamp + " 这次醒来出错了：" +
          String(err && err.message ? err.message : err).slice(0, 120),
      );
    } catch (e2) {
      /* 连日志都写不进去就算了 */
    }
    reject(err);
  }
});
