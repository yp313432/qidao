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

/** 出错时的调试通知最短间隔（分钟）—— 上游一直挂的话，别每 25 分钟吵他一次 */
var ERR_NOTIFY_COOLDOWN_MIN = 60;

/** 被"关掉"之后，隔多久才再去确认一次（分钟）。见下面 `muted_at` 的说明。 */
var MUTED_RECHECK_MIN = 240;

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

function notify(id, title, body) {
  try {
    CapacitorNotifications.schedule([{ id: id, title: title, body: body }]);
  } catch (e) {
    /* 弹不出来就算了 */
  }
}

function logLine(text) {
  try {
    var prev = cfg("wake_log");
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

      /** ⑤ 直接问你的上游 */
      fetch(baseUrl.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: "现在，你要主动说一句什么？（或者回 SKIP）" },
          ],
          max_tokens: 200,
          temperature: 0.9,
          stream: false,
        }),
      })
        .then(function (res) {
          return res.text().then(function (body) {
            return { status: res.status, body: body };
          });
        })
        .then(function (r) {
          if (r.status < 200 || r.status >= 300) {
            logLine("#" + count + " " + stamp + " 上游 " + r.status);
            errorNotify(count, stamp, "上游返回 " + r.status + "：" + String(r.body).slice(0, 80));
            resolve();
            return;
          }
          var data = null;
          try {
            data = JSON.parse(r.body);
          } catch (e) {
            data = null;
          }
          var said = data ? cleanReply((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "", aiName) : "";

          /* "上次没说 → 这次必定说"：他耍赖回 SKIP，就带"不许 SKIP"再问一次 */
          if (!said && mustSpeak) {
            fetch(baseUrl.replace(/\/+$/, "") + "/chat/completions", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
              body: JSON.stringify({
                model: model,
                messages: [
                  { role: "system", content: system + "\n\n【最后一次】你必须说一句话，不许回 SKIP。哪怕只是问一句在干嘛。" },
                  { role: "user", content: "说一句。" },
                ],
                max_tokens: 200,
                temperature: 0.9,
                stream: false,
              }),
            })
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
                  ? cleanReply((d2.choices && d2.choices[0] && d2.choices[0].message && d2.choices[0].message.content) || "", aiName)
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
        })
        .catch(function (err) {
          var msg = err && err.message ? err.message : "网络出问题";
          logLine("#" + count + " " + stamp + " 请求失败：" + String(msg).slice(0, 60));
          errorNotify(count, stamp, "问不到上游：" + msg);
          resolve();
        });

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
          notify(NOTIFY_ID_BASE + (count % 1000), aiName, said);
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
        if (data.muted) kvSet("muted_at", now);
        if (data.action === "speak" && data.text) {
          kvSet("last_spoke_at", now);
          /** 说成一句 → "醒了几次"归零（同主路；用户要求） */
          kvSet("wake_count", 0);
          notify(NOTIFY_ID_BASE + (count % 1000), data.aiName || "栖岛", data.text);
          logLine("#" + count + " " + stamp + " 说了（程度 " + data.urge + "）");
        } else if (data.ok === false) {
          logLine("#" + count + " " + stamp + " 失败：" + String(data.why || "").slice(0, 60));
          errorNotify(count, stamp, data.why || "他没答上来");
        } else {
          logLine("#" + count + " " + stamp + " 没说：" + String(data.why || "").slice(0, 40));
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
    /* ③ 无论如何都要收尾 */
    reject(err);
  }
});
