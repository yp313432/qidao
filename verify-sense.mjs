/**
 * 验收脚本：**主动感知那六个动作**（`sense.*`）—— 纯 node，不起浏览器、不连外网。
 *
 * 用户的原话（这一轮要兑现的东西）：
 *   "他现在只能感知，没有办法接到回执……所有的都是被动接收的，而不是主动去用这些权限。"
 *   "我给开他那么多权限，其实是希望他**主动的去用**。"
 *   "主动的感知就是知道目前的一个状态。"
 *
 * ── 为什么这个脚本能纯 node 跑 ────────────────────────────────
 * 判定与措辞全在 `src/lib/sense-core.ts`（**零 import**），事实是**注入**进去的
 * （`Reading<T>`：要么有值，要么说清为什么没有）。所以这里能在
 * **没有原生插件（= 网页版）** 的情况下把每条路都走一遍 —— 而这正是真机验不到的
 * 那一半（真机那半边见报告里的「必须装机才能验」清单）。
 *
 * 断言分七组：
 *   【A】结构：六个 kind 齐全、跟 `action-schema.ts` 一致、注册策略（A 组常驻 / B 组按需）
 *   【B】每个动作的结果里都有 `summary`（成功、失败**都要有**），且渲染成合法的一行 JSON
 *   【C】网页版（没有原生插件）：**如实失败或如实跳过**，绝不编数据、绝不崩
 *   【D】B 组权限没给时：提示里必须有「设置」（而且要指到那一个具体页面）
 *   【E】照实：字段跟喂进去的事实一致（电量/网络/地点/来源/通知/屏幕）
 *   【F】「没读到」和「读到了」不许长得一样（ok / reason 分得开）
 *   【G】提示词与手册里各加了一句「你可以主动看这些」，而且**没**把状态塞进每轮上下文
 *
 * 跑法：
 *   node --experimental-strip-types verify-sense.mjs
 * 退出码 0 = 全过。
 */
import { readFileSync } from "node:fs";

import * as core from "./src/lib/sense-core.ts";
import { ACTION_SCHEMA } from "./src/lib/action-schema.ts";
import { toQWeatherFix, wgs84ToGcj02, outOfChina } from "./src/lib/coord.ts";

const {
  SENSE_KINDS,
  SENSE_KINDS_CHEAP,
  SENSE_KINDS_SYSTEM,
  SENSE_SETTINGS_FIX,
  SENSE_SUMMARY_FIELD,
  senseTime,
  senseDevice,
  sensePlace,
  senseNotifications,
  senseForeground,
  senseScreen,
  renderSense,
  notificationsReading,
  foregroundReading,
} = core;

let passed = 0;
/** @type {string[]} */
const failures = [];
/** 非计分观察（报告里点名） */
const notes = [];

function check(name, cond, detail) {
  const ok = !!cond;
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(detail ? `${name} —— ${detail}` : name);
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}
function note(label, value) {
  const line = `${label} → ${value}`;
  notes.push(line);
  console.log(`  ⚠️ ${line}`);
}
const j = (v) => JSON.stringify(v);

const read = (rel) => {
  try {
    return readFileSync(new URL(rel, import.meta.url), "utf8");
  } catch {
    return "";
  }
};

const CORE_SRC = read("./src/lib/sense-core.ts");
const SCHEMA_SRC = read("./src/lib/action-schema.ts");
const SELECT_SRC = read("./src/lib/tool-select.ts");
const TYPES_SRC = read("./src/lib/types.ts");
const META_SRC = read("./src/lib/action-meta.ts");
const ACTIONS_SRC = read("./src/lib/actions.ts");
const BRIDGE_SRC = read("./src/lib/sense-bridge.ts");
const WIRING_SRC = read("./src/lib/sense.ts");
const MANUAL_SRC = read("./src/lib/manual.ts");
const PROMPT_SRC = read("./src/lib/prompt.ts");

/** 结果里不许出现这些东西（出现了就是「半截话」或「编的」） */
const JUNK = /undefined|NaN|\[object|null/;

/** 跑一次，保证**不抛**（「不许崩」是用户点名的那条） */
function safe(fn, label) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: `${label}: ${err?.message ?? err}` };
  }
}

/** 一次结果的基本体检：有 summary、是一句人话、ok 与 reason 不自相矛盾 */
function checkOutcome(label, outcome) {
  check(`${label}：结果是对象`, outcome && typeof outcome === "object", j(outcome));
  if (!outcome || typeof outcome !== "object") return;
  check(
    `${label}：有 ${SENSE_SUMMARY_FIELD} 而且是句非空的人话`,
    typeof outcome.summary === "string" && outcome.summary.trim().length > 0,
    j(outcome.summary),
  );
  check(`${label}：summary 里没有 undefined/NaN/[object`, !JUNK.test(String(outcome.summary)));
  check(`${label}：ok 是布尔`, typeof outcome.ok === "boolean", String(outcome.ok));
  check(
    `${label}：ok=false 时必须有 reason；ok=true 时不许带 reason`,
    outcome.ok ? outcome.reason === undefined : typeof outcome.reason === "string",
    j({ ok: outcome.ok, reason: outcome.reason }),
  );
  const line = renderSense(outcome);
  check(
    `${label}：renderSense 是一行（没有换行）`,
    !/[\r\n]/.test(line),
    JSON.stringify(line).slice(0, 80),
  );
  const back = safe(() => JSON.parse(line), `${label} parse`);
  check(
    `${label}：renderSense 是合法 JSON，且 summary/ok 原样保留`,
    back.ok && back.value?.summary === outcome.summary && back.value?.ok === outcome.ok,
    back.ok ? j(back.value?.summary) : back.error,
  );
}

/* ══════════════════════ 【A】结构 + 注册策略 ══════════════════════ */

console.log("【A】结构：六个 kind / 跟动作注册表一致 / 谁常驻谁按需");
check(
  "sense-core.ts 依然是**零 import**（纯 node 直接 import 的前提）",
  !/^\s*import\s/m.test(CORE_SRC),
  (CORE_SRC.match(/^\s*import\s.*$/m) ?? [""])[0].trim(),
);
check(
  `SENSE_KINDS 恰好六个、无重复：${SENSE_KINDS.length} 个`,
  Array.isArray(SENSE_KINDS) && SENSE_KINDS.length === 6 && new Set(SENSE_KINDS).size === 6,
  j(SENSE_KINDS),
);
check(
  "A 组（零权限）= time/device/place；B 组（要系统权限）= notifications/foreground/screen",
  SENSE_KINDS_CHEAP.length === 3 &&
    SENSE_KINDS_SYSTEM.length === 3 &&
    SENSE_KINDS_CHEAP.every((k) => !SENSE_KINDS_SYSTEM.includes(k)) &&
    [...SENSE_KINDS_CHEAP, ...SENSE_KINDS_SYSTEM].join("|") === [...SENSE_KINDS].join("|"),
  j({ cheap: SENSE_KINDS_CHEAP, system: SENSE_KINDS_SYSTEM }),
);

/** 从 `action-schema.ts` 源码抽 sense.*（跟 SENSE_KINDS 逐项对） */
const schemaSense = [...SCHEMA_SRC.matchAll(/kind:\s*"(sense\.[a-z]+)"/g)].map((m) => m[1]);
check(
  `跟 action-schema.ts 逐项一致（顺序也一样）：源码 ${schemaSense.length} 个`,
  j(schemaSense) === j([...SENSE_KINDS]),
  `源码 ${j(schemaSense)} vs core ${j([...SENSE_KINDS])}`,
);
check(
  "六个都注册进了三边（types.ts / action-meta.ts 的权限表 / actions.ts 的 case）",
  [...SENSE_KINDS].every(
    (k) =>
      TYPES_SRC.includes(`kind: "${k}"`) &&
      META_SRC.includes(`"${k}":`) &&
      ACTIONS_SRC.includes(`case "${k}"`),
  ),
  j(
    [...SENSE_KINDS].filter(
      (k) =>
        !TYPES_SRC.includes(`kind: "${k}"`) ||
        !META_SRC.includes(`"${k}":`) ||
        !ACTIONS_SRC.includes(`case "${k}"`),
    ),
  ),
);
/**
 * 取 `actions.ts` 里某个 case 的**完整分支体**（从 `case "x":` 到下一个 `case "` 为止）。
 *
 * ⚠️ 以前这里是**硬切 120 个字符** —— `sense.place` 后来多了一段注释就切不全了，
 * 于是"每个 case 都转给了 runSenseAction"这条**假红**了（代码没问题）。
 * 按"下一个 case"来切才稳。
 */
const caseBody = (src, kind) => {
  const at = src.indexOf(`case "${kind}"`);
  if (at < 0) return "";
  const rest = src.slice(at + 1);
  const next = rest.search(/\n\s*case "/);
  return next < 0 ? rest : rest.slice(0, next);
};
const senseCaseBlocks = [...SENSE_KINDS].map((k) => ({ kind: k, body: caseBody(ACTIONS_SRC, k) }));

/** 某个 kind 在 schema 里声明过的字段名 */
const declaredFields = (kind) =>
  (ACTION_SCHEMA.find((d) => d.kind === kind)?.fields ?? []).map((f) => f.name);

/*
  ⚠️ 2026-11 改了这条断言（原来是"六个 case 一律不许出现 action.xxx"）：
  `sense.place` 现在**合法地**读 `action.fresh`（用户要"刷新一下"，见 action-schema 里的 note）。
  所以真正要保的规矩是「**读的字段必须在 schema 里声明过**」——
  直接对着真 schema 查，而不是拿源码文本猜；这样以后再加合法参数也不会假红。
*/
check(
  "sense.* 里读到的每个 action.xxx 都在 schema 里声明过（合法参数才允许读）",
  senseCaseBlocks.every((b) =>
    [...b.body.matchAll(/action\.([A-Za-z_][A-Za-z0-9_]*)/g)].every((m) =>
      declaredFields(b.kind).includes(m[1]),
    ),
  ),
  j(
    senseCaseBlocks.map((b) => ({
      kind: b.kind,
      fields: [...b.body.matchAll(/action\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
      declared: declaredFields(b.kind),
    })),
  ),
);
check(
  "每个 sense case 都真的转给了 runSenseAction（不是空壳）",
  senseCaseBlocks.every((b) => b.body.includes("runSenseAction")),
  j(senseCaseBlocks.filter((b) => !b.body.includes("runSenseAction")).map((b) => b.kind)),
);

/** 注册策略：A 组常驻、B 组按需（用户点名要的省 token 方式） */
const alwaysBlock =
  (/export const ALWAYS_KINDS = \[([\s\S]*?)\] as const;/.exec(SELECT_SRC) ?? [])[1] ?? "";
const alwaysKinds = [...alwaysBlock.matchAll(/"([a-z][a-z0-9_.]*)"/g)].map((m) => m[1]);
check(
  `A 组三个都在 ALWAYS_KINDS 里（常驻）：${j(SENSE_KINDS_CHEAP)}`,
  SENSE_KINDS_CHEAP.every((k) => alwaysKinds.includes(k)),
  j(alwaysKinds),
);
check(
  "B 组三个**不在** ALWAYS_KINDS（按需注册：没提到相关话就不带它们的定义）",
  SENSE_KINDS_SYSTEM.every((k) => !alwaysKinds.includes(k)),
  j(alwaysKinds),
);
const senseKeywords = (/\n {2}感知: \[([\s\S]*?)\]/.exec(SELECT_SRC) ?? [])[1] ?? "";
const senseWordList = [...senseKeywords.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
check(
  "tool-select.ts 里有「感知」这一组的关键词（B 组靠它按需发）",
  senseWordList.length >= 2,
  j(senseWordList),
);
check(
  "「感知」组的词都是**具体说法**（规则要求 ≥2 字，不许放「看/状态」这种通用词）",
  senseWordList.every((w) => w.length >= 2) && !senseWordList.includes("状态") && !senseWordList.includes("看"),
  j(senseWordList.filter((w) => w.length < 2 || w === "状态" || w === "看")),
);
check(
  "sense-bridge.ts 有网页版护栏（先 isNativeApp，网页版不许去调原生）",
  BRIDGE_SRC.includes("isNativeApp") && BRIDGE_SRC.includes("return null"),
);
/*
  ⚠️ 原来这条是查 `WIRING_SRC.includes('gap: "permission"')` —— 同上，文本断言。
  改测行为：没授权时 gap 必须是 permission 且开口就是"没有这个系统权限"；
  而"授权是好的、系统没给答案"必须是 error（两者分得开才是这条断言真正要保的东西）。
*/
check(
  "没授权 = permission、没答案 = error（两者不串味，用户不会去开一个已经开着的开关）",
  (() => {
    const perm = notificationsReading({ granted: false });
    const noAnswer = foregroundReading({ granted: true });
    const permOut = senseNotifications(perm);
    return (
      perm.gap === "permission" &&
      noAnswer.gap === "error" &&
      permOut.reason === "permission" &&
      String(permOut.summary).includes("没有这个系统权限") &&
      senseForeground(noAnswer).reason === "error"
    );
  })(),
);

/* ═══════════════ 【B】每个动作都有 summary（成功/失败都要） ═══════════════ */

console.log("\n【B】六个动作：成功与失败的结果里都必须有 summary");

const NOW = 1_765_000_000_000; // 固定时刻：只用来算「多久以前」，跟时区无关

const CASES = [
  ["sense.time", () => senseTime({ now: NOW, tz: "Asia/Shanghai", lastUserAt: NOW - 12 * 60_000 })],
  ["sense.time", () => senseTime({ now: NOW })],
  [
    "sense.device",
    () =>
      senseDevice({
        ok: true,
        value: { battery: 62, charging: true, network: "wifi", online: true },
      }),
  ],
  ["sense.device", () => senseDevice({ ok: false, gap: "web", detail: "网页版读不到电量" })],
  ["sense.device", () => senseDevice({ ok: false, gap: "error", detail: "原生报错了" })],
  [
    "sense.place",
    () =>
      sensePlace(
        {
          ok: true,
          value: { label: "北京市朝阳区", weather: "晴 26°C", source: "system", at: NOW - 60_000 },
        },
        NOW,
      ),
  ],
  ["sense.place", () => sensePlace({ ok: false, gap: "web", detail: "网页版没有定位" }, NOW)],
  [
    "sense.place",
    () =>
      sensePlace(
        { ok: false, gap: "off", detail: "定位开关关着", fix: core.SENSE_PLACE_SWITCH_FIX },
        NOW,
      ),
  ],
  ["sense.place", () => sensePlace({ ok: false, gap: "error", detail: "和风连不上" }, NOW)],
  [
    "sense.notifications",
    () =>
      senseNotifications({
        ok: true,
        value: { items: [{ app: "微信", title: "在吗", text: "晚上一起吃饭？", minutesAgo: 2 }] },
      }),
  ],
  ["sense.notifications", () => senseNotifications({ ok: true, value: { items: [] } })],
  [
    "sense.notifications",
    () => senseNotifications({ ok: false, gap: "web", detail: "网页版拿不到系统通知" }),
  ],
  [
    "sense.notifications",
    () => senseNotifications({ ok: false, gap: "permission", detail: "还没打开「通知使用权」" }),
  ],
  [
    "sense.foreground",
    () => senseForeground({ ok: true, value: { app: "微信", package: "com.tencent.mm" } }),
  ],
  ["sense.foreground", () => senseForeground({ ok: false, gap: "web", detail: "网页版看不到前台" })],
  [
    "sense.foreground",
    () => senseForeground({ ok: false, gap: "permission", detail: "还没打开「使用情况访问」" }),
  ],
  ["sense.screen", () => senseScreen({ ok: true, value: { interactive: true, locked: false } })],
  ["sense.screen", () => senseScreen({ ok: false, gap: "permission", detail: "系统不给读" })],
  ["sense.screen", () => senseScreen({ ok: false, gap: "web", detail: "网页版读不到屏幕" })],
];

let notThrown = 0;
const badSummaries = [];
for (const [kind, fn] of CASES) {
  const r = safe(fn, kind);
  if (!r.ok) {
    badSummaries.push(r.error);
    continue;
  }
  notThrown += 1;
  if (typeof r.value?.summary !== "string" || !r.value.summary.trim()) {
    badSummaries.push(`${kind} 没有 summary`);
  }
}
check(
  `${CASES.length} 种输入（A/B 两组、成功/失败）一次都没抛，且都带 summary`,
  badSummaries.length === 0 && notThrown === CASES.length,
  badSummaries.slice(0, 3).join(" ｜ "),
);
check(
  "六个 kind 每一个都有自己的 result 函数（没有漏写）",
  [
    "senseTime",
    "senseDevice",
    "sensePlace",
    "senseNotifications",
    "senseForeground",
    "senseScreen",
  ].every((f) => typeof core[f] === "function"),
);
// 抽几条真的走一遍「体检」（保证 summary/ok/reason 的口径一致）
checkOutcome("sense.device(成功)", senseDevice({ ok: true, value: { battery: 62, charging: true, network: "wifi", online: true } }));
checkOutcome("sense.device(网页版失败)", senseDevice({ ok: false, gap: "web", detail: "网页版读不到电量" }));
checkOutcome("sense.place(成功)", sensePlace({ ok: true, value: { label: "北京", weather: null, source: "manual", at: NOW } }, NOW));
checkOutcome("sense.notifications(权限缺失)", senseNotifications({ ok: false, gap: "permission", detail: "还没打开「通知使用权」" }));
checkOutcome("sense.screen(成功)", senseScreen({ ok: true, value: { interactive: false, locked: true } }));
checkOutcome("sense.time(成功)", senseTime({ now: NOW, lastUserAt: NOW - 3 * 3600_000 }));

/* ═══════════════ 【C】网页版（没有原生插件）：如实失败/跳过 ═══════════════ */

console.log("\n【C】网页版（没有原生插件）：如实失败或如实跳过，绝不编数据、绝不崩");

/**
 * ⚠️ 这一组就是「网页版该有的样子」：`sense.ts` 在 `nativeSense()` 拿到 null 时
 * 走的就是这些分支（B 组整组 = web gap；A 组只有 device 少一半事实）。
 */
for (const kind of SENSE_KINDS_SYSTEM) {
  const reading = { ok: false, gap: "web", detail: "网页版没有这个能力" };
  const outcome =
    kind === "sense.notifications"
      ? senseNotifications(reading)
      : kind === "sense.foreground"
        ? senseForeground(reading)
        : senseScreen(reading);
  check(
    `${kind}：网页版 → ok:false + 明说网页版没有这个能力`,
    outcome.ok === false && outcome.reason === "web" && outcome.summary.includes("网页版"),
    j(outcome),
  );
}

const webDevice = senseDevice({
  ok: true,
  value: {
    battery: null,
    charging: null,
    network: "unknown",
    online: true,
    missing: "网页版读不到电量和充电，装成 App 才能看",
  },
});
check(
  "sense.device 网页版：**不编电量**（battery/charging = null）+ 说清缺什么",
  webDevice.battery === null && webDevice.charging === null && /网页版|App/.test(webDevice.summary),
  j(webDevice),
);
check(
  "sense.device 网页版：网页真的知道的（在不在线）照实报",
  webDevice.online === true,
  j(webDevice),
);
const webDeviceNone = senseDevice({ ok: false, gap: "web", detail: "这个环境读不到设备状态" });
check(
  "sense.device 网页版（连 navigator 都没有）：如实失败而不是崩",
  webDeviceNone.ok === false &&
    webDeviceNone.reason === "web" &&
    webDeviceNone.summary.includes("网页版"),
  j(webDeviceNone),
);
check(
  "sense.time 不需要任何插件/权限（纯 JS 就能算，网页版也有）",
  senseTime({ now: NOW }).ok === true,
);
check(
  "sense.place 走的是现成那套（接线层复用 refreshPlaceAndWeather，没另写一份定位）",
  WIRING_SRC.includes("refreshPlaceAndWeather") &&
    !WIRING_SRC.includes("navigator.geolocation") &&
    !WIRING_SRC.includes("qweather.com"),
  "接线层自己写了一套定位？",
);

/* ═════════════════ 【D】B 组权限缺失：必须指到「设置」 ═════════════════ */

console.log("\n【D】B 组权限没给时：提示里必须有「设置」，而且要指到那一个具体页面");

const permNotifications = senseNotifications({
  ok: false,
  gap: "permission",
  detail: "还没打开「通知使用权」",
});
const permForeground = senseForeground({
  ok: false,
  gap: "permission",
  detail: "还没打开「使用情况访问」",
});
for (const [label, outcome, needle] of [
  ["sense.notifications", permNotifications, "通知使用权"],
  ["sense.foreground", permForeground, "使用情况访问"],
]) {
  check(
    `${label}：权限缺失 → ok:false`,
    outcome.ok === false && outcome.reason === "permission",
    j(outcome),
  );
  check(`${label}：提示里含「设置」字样（引导用户去开）`, outcome.summary.includes("设置"), j(outcome.summary));
  check(
    `${label}：说清了是哪个页面（${needle}）+ 特殊应用权限这条路`,
    outcome.summary.includes(needle) && outcome.summary.includes("特殊应用权限"),
    j(outcome.summary),
  );
  check(
    `${label}：fix 字段也带着那条路径（界面要做一键跳转时有东西可用）`,
    typeof outcome.fix === "string" && outcome.fix.includes("设置"),
    j(outcome.fix),
  );
}
/*
  ⚠️ 这两条原来是**查源码文本**（`WIRING_SRC.includes('gap: "permission"')`、
  `WIRING_SRC.includes("SENSE_SETTINGS_FIX.notifications")`）—— 判定一挪进 sense-core，
  它们就误报了（明明行为没变）。文本断言还会在重构时给假红、在真出问题时给假绿，
  所以改成**测行为**：同一个 `SENSE_SETTINGS_FIX` 常量、两条路都指得到。
*/
check(
  "「权限没给」两条路都带上同一个 fix，而且跟 sense-core 那份文案一字不差（两处口径不打架）",
  notificationsReading({ granted: false }).fix === SENSE_SETTINGS_FIX.notifications &&
    foregroundReading({ granted: false }).fix === SENSE_SETTINGS_FIX.foreground,
);
check(
  "接线层没有自己另写一套判定（真的用了 sense-core 那两个纯函数）",
  WIRING_SRC.includes("notificationsReading(") && WIRING_SRC.includes("foregroundReading("),
);
check(
  "「设置」那条文案只有一处定义（sense-core 的 SENSE_SETTINGS_FIX）",
  Object.keys(SENSE_SETTINGS_FIX).length === 2 &&
    SENSE_SETTINGS_FIX.notifications.includes("通知使用权") &&
    SENSE_SETTINGS_FIX.foreground.includes("使用情况访问"),
  j(SENSE_SETTINGS_FIX),
);
check(
  "网页版那一句**不含**「设置」（网页里没有那个开关，指过去等于骗人）",
  !core.webGapOutcome("x").summary.includes("设置"),
  core.webGapOutcome("x").summary,
);

/* ═══════════════ 【E】照实：字段跟喂进去的事实一致 ═══════════════ */

console.log("\n【E】照实：字段与一句话都跟喂进去的事实对得上");

const t = senseTime({ now: NOW, tz: "Asia/Shanghai", lastUserAt: NOW - 12 * 60_000 });
check(
  "sense.time：time 是 YYYY-MM-DD HH:MM（本地时间，不是 ISO 的 UTC）",
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(t.time)),
  String(t.time),
);
check(
  "sense.time：weekday 是七个里的一个",
  ["周日", "周一", "周二", "周三", "周四", "周五", "周六"].includes(String(t.weekday)),
  String(t.weekday),
);
check(
  "sense.time：partOfDay 跟 hour 对得上（同一个时刻不许自相矛盾）",
  core.partOfDay(Number(t.hour)) === t.partOfDay &&
    t.hour === Number(String(t.time).slice(11, 13)),
  j({ hour: t.hour, partOfDay: t.partOfDay, time: t.time }),
);
check(
  "sense.time：距上次说话 12 分钟 → 算出来就是 12（不是「刚刚」）",
  t.sinceLastUserMinutes === 12 && t.summary.includes("12 分钟"),
  j({ since: t.sinceLastUserMinutes, summary: t.summary }),
);
check(
  "sense.time：没说过的会话里不编（sinceLastUserMinutes = null + 如实说）",
  senseTime({ now: NOW }).sinceLastUserMinutes === null &&
    senseTime({ now: NOW }).summary.includes("还没有"),
  j(senseTime({ now: NOW })),
);
check(
  "partOfDay 的分段是对的（凌晨/早上/上午/中午/下午/晚上/深夜）",
  [3, 7, 10, 13, 15, 20, 23].map((h) => core.partOfDay(h)).join("/") ===
    "凌晨/早上/上午/中午/下午/晚上/深夜",
  [3, 7, 10, 13, 15, 20, 23].map((h) => core.partOfDay(h)).join("/"),
);

const d = senseDevice({
  ok: true,
  value: { battery: 62, charging: true, network: "wifi", online: true },
});
check(
  "sense.device：字段照实（62 / true / wifi）+ 一句话读得通",
  d.battery === 62 &&
    d.charging === true &&
    d.network === "wifi" &&
    d.summary.includes("62%") &&
    d.summary.includes("正在充电") &&
    d.summary.includes("WiFi"),
  j(d),
);
const dOff = senseDevice({
  ok: true,
  value: { battery: 8, charging: false, network: "none", online: false },
});
check(
  "sense.device：没网时明说「没有网」（不是含糊的「离线」或空白）",
  dOff.summary.includes("没有网") && dOff.summary.includes("8%"),
  j(dOff),
);
const dUnknown = senseDevice({
  ok: true,
  value: {
    battery: null,
    charging: null,
    network: "unknown",
    online: null,
    missing: "这台机器没给电量",
  },
});
check(
  "sense.device：读不到的字段明说读不到（missing 会进 summary）",
  dUnknown.battery === null &&
    dUnknown.summary.includes("电量读不到") &&
    dUnknown.summary.includes("这台机器没给电量"),
  j(dUnknown),
);

const place = sensePlace(
  {
    ok: true,
    value: { label: "海南省三沙市", weather: "多云 30°C", source: "ip", at: NOW - 90 * 60_000 },
  },
  NOW,
);
check(
  "sense.place：地名 + 天气 + **来源**都在（定位飘的时候用户能判断该信几分）",
  place.place === "海南省三沙市" &&
    place.weather === "多云 30°C" &&
    place.source === "ip" &&
    place.sourceLabel.length > 0 &&
    place.summary.includes(place.sourceLabel),
  j(place),
);
/**
 * ⚠️ 2026-11 新规矩：**IP 那条来源必须自带"不可靠"**。
 *
 * 起因（真机自检）：三家 IP 库分别把他认成 海南儋州 / 河北石家庄 / 河南郑州 —— 没有一家可信。
 * 所以这里**不钉死文案**（那种断言会因为改一个字就红，还会掩盖真正的问题），
 * 只钉"必须提到是猜的/不可靠"这件事本身。
 */
check(
  "sense.place：IP 来源必须标明**不可靠**（不许把猜的城市当事实讲）",
  /不可靠|猜/.test(place.sourceLabel) && /不可靠|猜/.test(place.summary),
  j({ sourceLabel: place.sourceLabel }),
);
check(
  "sense.place：来源翻译成人话（手填 / 系统定位 / 缓存）",
  sensePlace(
    { ok: true, value: { label: "北京", weather: null, source: "manual", at: NOW } },
    NOW,
  ).summary.includes("你手填的地方") &&
    sensePlace(
      { ok: true, value: { label: "北京", weather: null, source: "system", at: NOW } },
      NOW,
    ).summary.includes("系统定位") &&
    sensePlace(
      { ok: true, value: { label: "北京", weather: null, source: "cache", at: NOW } },
      NOW,
    ).summary.includes("上次定位的缓存"),
);
check(
  "sense.place：没天气就不装（summary 说「天气没拿到」）",
  sensePlace(
    { ok: true, value: { label: "北京", weather: null, source: "manual", at: NOW } },
    NOW,
  ).summary.includes("天气没拿到"),
);

const notifNone = senseNotifications({ ok: true, value: { items: [] } });
check(
  "sense.notifications：没有通知就直说（不是空数组糊过去）",
  notifNone.count === 0 && notifNone.summary.includes("没有"),
  j(notifNone),
);
const notifMany = senseNotifications({
  ok: true,
  value: {
    items: [
      { app: "微信", title: "在吗", text: "", minutesAgo: 1 },
      { app: "短信", title: "验证码是 8848，这条特别长特别长特别长特别长", text: "", minutesAgo: 3 },
      { app: "日历", title: "15:00 开会", text: "", minutesAgo: 9 },
      { app: "淘宝", title: "快递到了", text: "", minutesAgo: 20 },
    ],
  },
});
check(
  "sense.notifications：最多 5 条、一句话只点前三 + 等、长标题被截断",
  notifMany.count === 4 &&
    notifMany.items.length === 4 &&
    notifMany.summary.includes("最近 4 条") &&
    notifMany.summary.includes("微信「在吗」") &&
    notifMany.summary.includes("等") &&
    notifMany.summary.includes("…") &&
    !notifMany.summary.includes("这条特别长特别长特别长特别长"),
  j(notifMany.summary),
);

const fg = senseForeground({ ok: true, value: { app: "微信", package: "com.tencent.mm" } });
check(
  "sense.foreground：应用名进 summary，包名留在字段里",
  fg.app === "微信" && fg.package === "com.tencent.mm" && fg.summary.includes("微信"),
  j(fg),
);

/* ═════════ 真机撞到过的那个 bug：没答案 ≠ 没权限（2026-11 用户实测） ═════════
 * 用户原话："我权限都打开了，这个通知和前台app还是不行" ——
 * 根因是接线层把 `granted:true 但系统没给答案` 也当成了"权限没给"，
 * 于是他去设置里翻一个已经开着的开关。这三种回执必须走三条路，谁都不许串。 */
check(
  "foregroundReading：真没授权 → permission + 明确给设置页路径",
  (() => {
    const r = foregroundReading({ granted: false, reason: "还没打开「使用情况访问」" });
    return r.ok === false && r.gap === "permission" && r.fix === SENSE_SETTINGS_FIX.foreground;
  })(),
);
check(
  "foregroundReading：**授权是好的、系统这次没给答案 → error，且不许带设置页路径**",
  (() => {
    const r = foregroundReading({ granted: true, reason: "系统这次没给出当前应用" });
    return (
      r.ok === false &&
      r.gap === "error" &&
      r.fix === undefined &&
      !senseForeground(r).summary.includes("使用情况访问")
    );
  })(),
);
check(
  "foregroundReading：拿到了（含「你在栖岛里」这一种）→ ok，字段照实",
  (() => {
    const other = foregroundReading({ granted: true, app: "微信", package: "com.tencent.mm" });
    const self = foregroundReading({
      granted: true,
      app: "栖岛",
      package: "com.yanping.qidao",
      self: true,
    });
    return (
      other.ok === true &&
      other.value.app === "微信" &&
      self.ok === true &&
      self.value.self === true &&
      senseForeground(self).summary.includes("就在栖岛里")
    );
  })(),
);
check(
  "notificationsReading：没授权 → permission；授权好但没通知 → **ok:true**（不许说成权限问题）",
  (() => {
    const denied = notificationsReading({ granted: false });
    const empty = notificationsReading({ granted: true, items: [] });
    const deniedOut = senseNotifications(denied);
    const emptyOut = senseNotifications(empty);
    return (
      denied.ok === false &&
      denied.gap === "permission" &&
      denied.fix === SENSE_SETTINGS_FIX.notifications &&
      empty.ok === true &&
      emptyOut.ok === true &&
      emptyOut.summary.includes("通知使用权") &&
      deniedOut.reason === "permission" &&
      emptyOut.reason !== "permission"
    );
  })(),
);
check(
  "notificationsReading：空标题空正文的条目被丢掉（别拿空壳凑数）",
  (() => {
    const r = notificationsReading({
      granted: true,
      items: [
        { app: "微信", title: "在吗" },
        { app: "某应用", title: "", text: "" },
      ],
    });
    return r.ok === true && r.value.items.length === 1 && r.value.items[0].app === "微信";
  })(),
);

const sc = [
  [{ interactive: true, locked: false }, "屏幕亮着，已解锁"],
  [{ interactive: true, locked: true }, "屏幕亮着，还锁着"],
  [{ interactive: false, locked: true }, "屏幕黑着"],
  [{ interactive: false, locked: false }, "屏幕黑着"],
];
check(
  "sense.screen：四种组合都说得出人话",
  sc.every(([v, want]) => senseScreen({ ok: true, value: v }).summary === want),
  j(sc.map(([v]) => senseScreen({ ok: true, value: v }).summary)),
);

/* ═════════════ 【F】「读到了」和「没读到」不许长得一样 ═════════════ */

console.log("\n【F】读到了 / 没读到：ok 与 reason 分得清（不会把失败说成成功）");

const pairs = [
  [
    "sense.device",
    senseDevice({ ok: true, value: { battery: 50, charging: false, network: "wifi", online: true } }),
    senseDevice({ ok: false, gap: "web", detail: "网页版读不到" }),
  ],
  [
    "sense.notifications",
    senseNotifications({ ok: true, value: { items: [] } }),
    senseNotifications({ ok: false, gap: "permission", detail: "还没打开「通知使用权」" }),
  ],
  [
    "sense.foreground",
    senseForeground({ ok: true, value: { app: "微信", package: "p" } }),
    senseForeground({ ok: false, gap: "permission", detail: "还没打开「使用情况访问」" }),
  ],
  [
    "sense.screen",
    senseScreen({ ok: true, value: { interactive: true, locked: false } }),
    senseScreen({ ok: false, gap: "web", detail: "网页版读不到" }),
  ],
];
for (const [label, good, bad] of pairs) {
  check(
    `${label}：成功(true, 无 reason) 与 失败(false, 有 reason) 分得清`,
    good.ok === true && good.reason === undefined && bad.ok === false && typeof bad.reason === "string",
    j({ good: { ok: good.ok, reason: good.reason }, bad: { ok: bad.ok, reason: bad.reason } }),
  );
  check(
    `${label}：失败那句里说了为什么（不是一句干巴巴的失败）`,
    String(bad.summary).length >= 10,
    j(bad.summary),
  );
}
const gaps = ["web", "permission", "off", "error"];
const gapTexts = gaps.map((g) => core.gapOutcome(g, "细节", "去某个设置页开").summary);
check(
  "gapOutcome 四种 gap 各有各的说法（web / permission / off / error 不串味）",
  new Set(gapTexts).size === 4 && gapTexts.every((s) => typeof s === "string" && s.length > 5),
  j(gapTexts),
);
check(
  "脏输入也不崩（NaN 时间 / 空通知项 / 空地点 + NaN 时间）",
  safe(() => senseTime({ now: Number.NaN }), "NaN 时间").ok &&
    safe(() => senseNotifications({ ok: true, value: { items: [{}] } }), "空通知项").ok &&
    safe(
      () => sensePlace({ ok: true, value: { label: "", weather: "", source: "nope", at: 0 } }, Number.NaN),
      "脏地点",
    ).ok,
  "有输入把感知弄崩了",
);
check(
  "每个 ok=false 的结果都有 reason（界面和模型都能一眼看出是哪种没读到）",
  gaps.every((g) => {
    const o = core.gapOutcome(g, "x");
    return o.ok === false && typeof o.reason === "string" && o.reason.length > 0;
  }),
);

/* ═════════════════ 【G】提示词与手册里那一句「你可以主动看」 ═════════════════ */

console.log("\n【G】系统提示与手册里各加了一句「你可以主动看这些」（别改既有条款）");

check(
  "手册（manual.ts）里有主动感知那一节，而且真的拼进了 buildManual",
  MANUAL_SRC.includes("SENSE_POINTER") && /SENSE_POINTER,/.test(MANUAL_SRC),
);
check(
  "手册那一节点了六个动作名（他要照着调）",
  ["sense.time", "sense.device", "sense.place", "sense.notifications", "sense.foreground", "sense.screen"].every(
    (k) => MANUAL_SRC.includes(k),
  ),
);
check(
  "系统提示（prompt.ts，原生那条路）里也有一句（连动作名一起给）",
  PROMPT_SRC.includes("sense.time") && PROMPT_SRC.includes("sense.notifications"),
);
check(
  "那一句里明确说了「没权限会回 ok:false 并写清去哪个系统设置页」",
  MANUAL_SRC.includes("ok:false") && MANUAL_SRC.includes("系统设置页"),
);
check(
  "只加不改：既有的条款还在（硬要求十条 / 权限那节 / 情绪词表那节）",
  MANUAL_SRC.includes("【硬要求 · 不可协商") &&
    MANUAL_SRC.includes("你现在的权限") &&
    MANUAL_SRC.includes("情绪（新词表）"),
);
const perceptionBlockSrc =
  (/export function perceptionBlock[\s\S]*?\n}/.exec(PROMPT_SRC) ?? [""])[0];
check(
  "感知**没有**被塞进「此刻的情况」（那段是被动接收，用户要的是主动：不许动它）",
  !/sense\.(time|device|place|notifications|foreground|screen)/.test(perceptionBlockSrc),
  "perceptionBlock 里出现了 sense.* —— 那就变成每轮自动塞了",
);

/* ═══════════════ 【H】坐标系：境内 WGS-84 → GCJ-02，境外不动 ═══════════════ */

console.log(
  "\n【H】坐标系：和风文档说大陆用 GCJ-02，而系统定位/IP 给的是 WGS-84 —— 交出去之前必须转",
);

{
  // 天安门附近的 WGS-84（GPS 原始值）
  const bj = wgs84ToGcj02(39.908722, 116.397499);
  const dLat = bj.lat - 39.908722;
  const dLon = bj.lon - 116.397499;
  check(
    "北京：会转换，且偏移量落在合理区间（纬度 +0.0005~0.004，经度 +0.003~0.010）",
    bj.converted && dLat > 0.0005 && dLat < 0.004 && dLon > 0.003 && dLon < 0.01,
    `偏移 Δlat=${dLat.toFixed(6)} Δlon=${dLon.toFixed(6)}`,
  );

  // 东京：境外，必须原样返回（文档说境外用 WGS-84）
  const tk = wgs84ToGcj02(35.6812, 139.7671);
  check(
    "境外（东京）：原样返回、不转换（转了就是往错误方向修）",
    tk.converted === false && tk.lat === 35.6812 && tk.lon === 139.7671,
    j(tk),
  );

  check(
    "outOfChina 判据跟转换一致（境内 false / 境外 true）",
    outOfChina(39.9, 116.4) === false && outOfChina(35.68, 139.76) === true,
  );

  check(
    "脏数据不崩（NaN / 越界值都原样返回）",
    (() => {
      const a = wgs84ToGcj02(Number.NaN, 1);
      const b = wgs84ToGcj02(999, 999);
      return a.converted === false && b.converted === false;
    })(),
  );

  check(
    "交给和风用的是同一个函数（toQWeatherFix）—— 免得有人绕过转换直接查",
    (() => {
      const a = toQWeatherFix(39.908722, 116.397499);
      return a.converted === true && Math.abs(a.lat - bj.lat) < 1e-12;
    })(),
  );
}

/* ══════════════════════════ 收尾 ══════════════════════════ */

console.log("\n【收尾】");
check("断言项数 ≥ 40（任务要求的下限）", passed >= 40, `实际 ${passed}`);
check("所有断言汇总后没有失败项", failures.length === 0, failures.slice(0, 3).join(" / "));

note(
  "本脚本没有覆盖的（必须装机才能验）",
  "原生插件真能读到电量/通知/前台 App、系统权限与设置页路径是否真长那样 —— 见报告里的清单",
);
note(
  "网页版降级策略（用户给的两条路里选了哪条）",
  "照旧注册这六个；调用时 B 组返回 ok:false + 网页版没有这个能力，A 组的 device 只报网页真知道的那半（电量绝不编）",
);

console.log(`\n${"─".repeat(72)}`);
if (notes.length > 0) {
  console.log(`⚠️ ${notes.length} 条非计分观察：`);
  for (const n of notes) console.log(`  · ${n}`);
}
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项断言 ✅（纯 node：没起浏览器、没连外网、没动真机）`);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌`);
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
