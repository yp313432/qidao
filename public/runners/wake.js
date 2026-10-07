/**
 * **后台唤醒** —— 这段代码**不在网页里跑**，是安卓系统在后台把一小段 JS 叫起来执行的。
 *
 * 为什么要有它（用户的原话）：
 *   "那个定时任务还是只有点开 app 才可以发消息，即使我后台一直开着，不省电那些也设置了"
 *   "我想要是它根据当时情景说的话，而不是预设"
 *   "我们现在已经是一个 app 了，不要再留网页的设计思路了"
 *
 * 根因就是网页思路：原来的定时任务靠**页面里每 30 秒查一次**（`window.setInterval`），
 * 而安卓一切到后台就冻结网页的定时器 —— 所以 App 一关就什么都不会发生。
 *
 * ── 现在它在干什么（"乙"方案：AI 的调用在 Worker 上）────────────────
 * 系统把它叫起来 → 它去问 Worker 一句"现在要不要说话、说什么" → 把他返回的那句话弹成通知。
 * Worker 那边（`src/routes/api/wake.ts`）负责：两道便宜闸门（夜间不打扰、最短间隔）+
 * 滚一个"想找你的程度"（0/25/50/75/100）+ 问 AI。
 *
 * 这里能用的东西只有三样（官方限制，别惦记别的）：
 *   · `fetch`               —— 联网
 *   · `CapacitorKV`         —— 存东西（跨唤醒保留）
 *   · `CapacitorNotifications` —— 直接弹真通知
 *
 * ⚠️ 五条纪律（官方文档 + 插件源码 + 真机踩坑读出来的）：
 *   ① 每次被叫起来**最多干 30 秒**（安卓上限 10 分钟，但要照顾跨平台）
 *   ② 每次都是**全新的上下文** —— 上一次的变量不会留着，要记东西只能写 `CapacitorKV`
 *   ③ 干完**必须**调用 `resolve()` 或 `reject()`。
 *      插件安卓侧是这样等的：`future.conditionalAwait { it != null }` —— **没有超时**，
 *      不回调它就永远挂着（后台那条路会把这一次后台任务白白耗掉）。
 *   ④ **不许用 `toISOString()`** —— 它给的是 UTC。用户在国内（UTC+8），
 *      第一版就这么写的，通知上写 09:09、实际 17:09，差 8 小时，白让人绕一圈。
 *   ⑤ 这个文件是**给原生加载的普通 JS**：不能 import、不能 TypeScript、没有 DOM
 *      （`window`/`document`/`localStorage` 全都没有）。
 *
 * ⚠️ **App 侧永远不要调 `dispatchEvent`**（曾经有个"现在试一次"按钮那么干）：
 * 那个方法在安卓侧用 `runBlocking` 挡住主线程、再无限期等这里的回调 →
 * 主线程等 JS、JS 等主线程 → **死锁，整个 App 卡死**。见 `src/lib/wake-sync.ts`。
 */

/**
 * Worker 上的那个接口地址（形如 `https://…/api/wake?pass=…`）。
 *
 * ⚠️ **这个值由 CI 从 GitHub 密钥注入**（`QIDAO_WAKE_URL`），仓库里只有下面那一处占位符 ——
 * 因为仓库是公开的，地址和口令不能写进来。
 * 没注入时（本地开发、没配密钥）就退回"第 N 次醒来"的调试通知，**绝不请求一个假地址**。
 *
 * ⚠️ 占位符在全文件里**只允许出现那一处**（CI 是按它整串替换的；注释里再写一遍会让人
 * 误以为要替换两处，而 `replace` 只换第一处 —— 那就会换到注释、把功能换成哑的）。
 */
var WAKE_URL = "__QIDAO_WAKE_URL__";

/** 通知 id 的基数（安卓要 32 位整数）。用加法错开，避免几条通知互相覆盖。 */
var NOTIFY_ID_BASE = 9000;

/** 出错时的调试通知最短间隔（分钟）—— 上游一直挂的话，别每 15 分钟吵他一次 */
var ERR_NOTIFY_COOLDOWN_MIN = 60;

/** 时间戳 —— 必须是**本地时间**，理由见上面纪律 ④ */
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

/** 读一个数（读不到当 0） */
function kvNum(key) {
  try {
    return Number((CapacitorKV.get(key) || {}).value || "0") || 0;
  } catch (e) {
    return 0;
  }
}

function kvSet(key, value) {
  try {
    CapacitorKV.set(key, String(value));
  } catch (e) {
    /* 记不上不算失败 —— 下面还要接着干活 */
  }
}

/** 弹一条通知（单独包一层，出问题也别影响主流程） */
function notify(id, title, body) {
  try {
    CapacitorNotifications.schedule([{ id: id, title: title, body: body }]);
  } catch (e) {
    /* 弹不出来就算了 */
  }
}

/** 把这一轮的经过记一行（跨唤醒保留，用来排查"它到底醒没醒、有没有说话"） */
function logLine(text) {
  try {
    var prev = (CapacitorKV.get("wake_log") || {}).value || "";
    var next = [text].concat(
      prev.split("\n").filter(function (s) {
        return s;
      }),
    );
    CapacitorKV.set("wake_log", next.slice(0, 40).join("\n"));
  } catch (e) {
    /* 同上 */
  }
}

/** 出错时弹一条"调试通知"（带冷却，免得刷屏）—— 让"他没说话"和"这条路坏了"分得开 */
function errorNotify(count, stamp, why) {
  var lastErr = kvNum("last_err_at");
  var now = Date.now();
  if (lastErr > 0 && (now - lastErr) / 60000 < ERR_NOTIFY_COOLDOWN_MIN) return;
  kvSet("last_err_at", now);
  notify(
    NOTIFY_ID_BASE + 999,
    "栖岛 · 主动找你（没成功）",
    "第 " + count + " 次醒来：" + String(why || "").slice(0, 120),
  );
}

addEventListener("qidaoWake", function (resolve, reject) {
  try {
    var now = Date.now();
    var stamp = localStamp();
    var count = kvNum("wake_count") + 1;
    kvSet("wake_count", count);

    /**
     * 地址能不能用：注入成功后它就是个 http(s) 地址；没注入时还是上面那个占位符（以 `__` 开头）。
     *
     * ⚠️ **这里不能写字面占位符去做比较**（第一版是 `WAKE_URL.indexOf("__…__") === -1`）：
     * CI 是**整串全替换**的，会把这一句里的占位符也换成真地址 ——
     * 于是它变成"判断自己是不是包含自己"，恒为假 → 永远以为没配、永远不请求 Worker。
     * 这种错**不报错**，只是安静地不工作。改成"长得像不像一个网址"就没有这个耦合了。
     */
    var ready = /^https?:\/\//.test(WAKE_URL);
    if (!ready) {
      notify(NOTIFY_ID_BASE + (count % 1000), "栖岛 · 后台唤醒", "第 " + count + " 次醒来：" + stamp + "（本地时间）");
      logLine("#" + count + " " + stamp + " 未配置地址（只报醒）");
      resolve();
      return;
    }

    /**
     * 距**上一次真问过 AI**过了多久 —— 这是 Worker 判断"最短间隔"的依据。
     * ⚠️ 是"上次问他"，不是"上次说话"：否则他回一次 SKIP，15 分钟后又要问一遍。
     */
    var lastAsk = kvNum("last_ask_at");
    var since = lastAsk > 0 ? String(Math.max(0, Math.round((now - lastAsk) / 60000))) : "";
    var url = WAKE_URL + (WAKE_URL.indexOf("?") === -1 ? "?" : "&") + "since=" + since;

    fetch(url, { method: "GET", headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.text();
      })
      .then(function (raw) {
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

        /** 带 `urge` = 这一轮**真问过 AI**（Worker 那边定的规矩）→ 记下时间，供下一轮算间隔 */
        if (typeof data.urge === "number") kvSet("last_ask_at", now);

        if (data.action === "speak" && data.text) {
          kvSet("last_spoke_at", now);
          notify(NOTIFY_ID_BASE + (count % 1000), data.aiName || "栖岛", data.text);
          logLine("#" + count + " " + stamp + " 说了（urge " + data.urge + "）：" + String(data.text).slice(0, 40));
        } else if (data.ok === false) {
          logLine("#" + count + " " + stamp + " 失败：" + String(data.why || "").slice(0, 60));
          errorNotify(count, stamp, data.why || "他没答上来");
        } else {
          // 他决定不说 / 还没到间隔 / 夜间不打扰 —— 都是"正常地保持安静"，不弹任何东西
          logLine("#" + count + " " + stamp + " 没说：" + String(data.why || "").slice(0, 50));
        }
        resolve();
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : "网络出问题";
        logLine("#" + count + " " + stamp + " 请求失败：" + String(msg).slice(0, 60));
        errorNotify(count, stamp, "请求失败：" + msg);
        resolve();
      });
  } catch (err) {
    /** ③ 无论如何都要收尾 */
    reject(err);
  }
});
