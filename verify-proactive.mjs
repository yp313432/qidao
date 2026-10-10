#!/usr/bin/env node
/**
 * 验收：**主动说话的三道闸门 + 心情**（纯 node，不起浏览器、不连外网）。
 *
 * 用户原话（2026-11）：
 *   "他醒来之后可以根据我目前的状态……然后说开口说话，根据他现在情绪，
 *    不只是上下 5 条信息内容来判断说话内容。"
 *   "设置一个回复的约定或按钮，我主动说忙，他自动调低，否则原来就行。"
 *   "他自己情绪到了，也可以发吧……或者你给情绪那个加个按钮，只单独管情绪发消息这个。"
 *   "降频那个不用。"
 *
 * 钉四件事：
 *   ① 忙 → **彻底不打扰**（后台那段 JS 真的读这个键，而不是只在界面上写写）
 *   ② 频率地板在**后台**也生效（最短间隔 + 每天上限），且读不到时有默认值
 *   ③ 心情进了唤醒提示词；"情绪能不能单独算理由"由那个开关控制
 *   ④ 这几个键**每次推配置都推**（漏掉 busyUntil 就变成"他在忙他还说"）
 *
 * 跑法：node verify-proactive.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-proactive.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

const base = new URL("./src/", import.meta.url).href;
register(
  `data:text/javascript,${encodeURIComponent(
    [
      "export async function resolve(specifier, context, next) {",
      `  if (specifier.startsWith("@/")) return next(${JSON.stringify(base)} + specifier.slice(2) + ".ts", context);`,
      /** ⚠️ store.ts 那条链里有**相对且不带后缀**的 import（`./action-meta`）—— 也要补 .ts，否则 ERR_MODULE_NOT_FOUND */
      "  if (specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) {",
      "    return next(new URL(specifier + '.ts', context.parentURL).href, context);",
      "  }",
      "  return next(specifier, context);",
      "}",
    ].join("\n"),
  )}`,
  import.meta.url,
);

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}
const j = (v) => JSON.stringify(v);

const wake = src("public/runners/wake.js");

/* ── ① 忙 → 不打扰 ── */
check(
  "① 后台真的读「我在忙」（cfg_busy_until），命中就收工不打扰",
  wake.includes('kvNum("cfg_busy_until")') && /busyUntil > now[\s\S]{0,400}resolve\(\)/.test(wake),
);
check("① 忙的时候**不弹错误通知**（弹了就成了骚扰本身）", !/busyUntil > now[\s\S]{0,200}errorNotify/.test(wake));

/* ── ② 频率地板 ── */
check("② 最短间隔在后台生效", wake.includes('cfgNumOr("cfg_min_gap_min"') && wake.includes("minGapMs > 0"));
check("② 每天上限在后台生效", wake.includes('cfgNumOr("cfg_daily_max"') && wake.includes("spokeToday(now) >= dailyMax"));
check(
  "② 读不到配置时有**默认值**（不能退化成「想发就发」）",
  wake.includes("DEFAULT_MIN_GAP_MIN = 40") && wake.includes("DEFAULT_DAILY_MAX = 8"),
);
check(
  "② 说成一条才计数（两条成功路径都记账）",
  (wake.match(/bumpSpokeToday\(now\)/g) ?? []).length >= 2,
  j((wake.match(/bumpSpokeToday\(now\)/g) ?? []).length),
);
/**
 * ⚠️ 这里**不能**拿「没回」当关键词 —— wake.js 里本来就有一句
 * `等了 N 毫秒没回应（超时）`（网络超时用的），会误伤。要盯的是**那个功能本身**。
 */
check("② 没有「你不理他就降频」那种逻辑（用户明确说不用）", !/降频|unanswered|ignoreCount/.test(wake));

/* ── ③ 心情进提示词 ── */
const promptSrc = src("src/lib/wake-prompt.ts");
check("③ 唤醒提示词里有【你此刻的心情】", promptSrc.includes("【你此刻的心情】"));
check("③ 心情取的是**最近一笔情绪上报**（慢变量快照）", promptSrc.includes("emotionEvents?.[0]"));
check(
  "③ 那个开关真的分叉成两种规矩（开：心情可单独算理由 / 关：只影响怎么说）",
  promptSrc.includes("那本身就可以是理由") && promptSrc.includes("不能单独当成找他的理由"),
);

/* ── ④ 推配置时别漏键 ── */
const sync = src("src/lib/wake-sync.ts");
check(
  "④ 四个键每次推配置都推（busy / 间隔 / 上限 / 心情）",
  sync.includes("[WAKE_KEYS.busyUntil]") &&
    sync.includes("[WAKE_KEYS.minGapMin]") &&
    sync.includes("[WAKE_KEYS.dailyMax]") &&
    sync.includes("[WAKE_KEYS.mood]"),
);
const bridge = src("src/lib/wake-bridge.ts");
check(
  "④ 键名跟后台那段 JS 字面一致",
  bridge.includes('"cfg_busy_until"') &&
    bridge.includes('"cfg_min_gap_min"') &&
    bridge.includes('"cfg_daily_max"') &&
    bridge.includes('"cfg_mood"'),
);

/* ── ⑤ 真跑一遍提示词（不是只看源码说它有） ── */
const { buildWakePrompt } = await import("./src/lib/wake-prompt.ts");
const baseInput = { aiName: "小克", displayName: "他", persona: "", recent: [] };
const withMood = buildWakePrompt({ ...baseInput, mood: "平静（强度 4/5）", emotionSpeak: true }, false);
check("⑤ 真拼出来的提示词带上了心情", withMood.includes("平静（强度 4/5）"), j(withMood.slice(0, 80)));
check("⑤ 开着时写着「心情可以单独算理由」", withMood.includes("那本身就可以是理由"));
const noEmotion = buildWakePrompt({ ...baseInput, mood: "平静", emotionSpeak: false }, false);
check("⑤ 关掉时变成「心情只影响怎么说」", noEmotion.includes("不能单独当成找他的理由"));
const noMood = buildWakePrompt(baseInput, false);
check("⑤ 取不到心情时**不写那一段**（不许编一句心情出来）", !noMood.includes("【你此刻的心情】"));

if (REVERSE) {
  /* 反向：把"忙"那道闸门去掉，断言必须变红 */
  const broken = wake.replace(/var busyUntil = kvNum\("cfg_busy_until"\);/, "var busyUntil = 0;");
  passed = 0;
  failures = 0;
  check(
    "反向：拿掉「我在忙」那道闸门之后，断言确实变红",
    !(broken.includes('kvNum("cfg_busy_until")') && /busyUntil > now[\s\S]{0,120}resolve\(\)/.test(broken)),
  );
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
