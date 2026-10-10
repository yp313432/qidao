#!/usr/bin/env node
/**
 * P0 验收脚本：内部动作的**唯一定义**（`src/lib/action-schema.ts`）。
 *
 * 只做纯逻辑断言 —— 用 node 读源码文本 + 正则解析，**不依赖浏览器**
 * （沙箱里命名管道被禁，起不了 Playwright）。断言：
 *
 *   1. `types.ts` 里 `AppAction` 的 kind 集合
 *      = `action-meta.ts` 里 `Record<AppAction["kind"], PermissionId>` 的键集合
 *      = 70 个（三边集合相等，不等就列出差异）
 *   2. `ACTION_SCHEMA` 的 kind 集合跟上面完全一致（一个不多一个不少）
 *   3. 每个 kind：`ACTION_SCHEMA` 声明的字段必须**覆盖** `actions.ts` 里那个 case
 *      实际读到的字段（少一个就 FAIL）；多了也列出来（不算致命）
 *   4. `actionTools()` 的输出形状合法：name 只含 [a-zA-Z0-9_-]、无重复、
 *      parameters.type === object、有 properties、required 都在 properties 里
 *   5. 打印一张表：kind | group | schema 字段 | actions.ts 读到的字段 | 一致?
 *
 * 退出码：有任何 FAIL 就是 1。
 */
import { readFileSync } from "node:fs";

const TYPES_SRC = readFileSync(new URL("./src/lib/types.ts", import.meta.url), "utf8");
const META_SRC = readFileSync(new URL("./src/lib/action-meta.ts", import.meta.url), "utf8");
const ACTIONS_SRC = readFileSync(new URL("./src/lib/actions.ts", import.meta.url), "utf8");
const SCHEMA_SRC = readFileSync(new URL("./src/lib/action-schema.ts", import.meta.url), "utf8");
const PROMPT_SRC = readFileSync(new URL("./src/lib/prompt.ts", import.meta.url), "utf8");

/**
 * 期望的 kind 总数。
 *
 * 61（P0 那次）→ 63（2026-10 加「情绪词表」那两个动作）→ 62：
 * 旧的 `state.report`（那朵花的 11 维花瓣）整条退场 ——
 * 用户原话："原来的那个情绪一项……就是那 11 个就不用了。"
 * → 68（2026-10 加「主动感知」那六个：`sense.time` / `sense.device` / `sense.place`
 * / `sense.notifications` / `sense.foreground` / `sense.screen`）——
 * 用户原话："我给开他那么多权限，其实是希望他**主动的去用**" / "主动的感知就是知道目前的一个状态。"
 * → **70**（2026-10 加**联网**两个：`web.search` / `web.fetch`）——
 * 手机版第一次能搜网页、能读网页正文（`CapacitorHttp` 原生发请求，绕开 WebView 跨域）。
 * → **71**（2026-11 加 `sticker.send`：他**自己发一张表情包**，用户原话
 * "他们自己就可以调用表情包，而且发的就是他的表情包格式"）。
 * 加/删动作就往这里 ±1 —— 三边（types.ts / action-meta.ts / ACTION_SCHEMA）不一致会直接 FAIL。
 */
const EXPECTED_KIND_COUNT = 71;

/**
 * **不挂权限**的动作（`ACTION_PERMISSION` 里故意没有它们的键）。
 *
 * 2026-10：用户要求删掉 AI 权限页那一项「情绪权限」（`state_report`）——
 * `emotion.report` 已经常驻、11 维花瓣早退场，`emotion.lexicon` 只是取一份词表，
 * 两个都是 L0 静默写本机的东西，给他看的那道闸没有意义。
 * ⚠️ 没有权限 = **闸门直接执行、不弹卡片**（见 `action-gate.tsx`）。
 * 所以这份名单是**白名单**：多一个少一个都必须在这里明说，不许悄悄变成"免确认直接执行"。
 *
 * 2026-11 加 `sticker.send`：他往**自己的聊天里**发一张表情 —— 没有任何对外效果，
 * 也不写任何别人的东西。用户明确要求"不新增一张卡片"（每次发表情都弹卡片会烦死），
 * 所以它跟情绪那两个一样归"不需要授权"。
 */
const NO_PERMISSION_KINDS = ["emotion.report", "emotion.lexicon", "sticker.send"];
const EXPECTED_PERMISSION_BOUND_COUNT = EXPECTED_KIND_COUNT - NO_PERMISSION_KINDS.length;

const fails = [];
const warns = [];
const notes = [];
const fail = (msg) => fails.push(msg);
const warn = (msg) => warns.push(msg);

// ---------------------------------------------------------------- 源码工具

/**
 * 把注释替换成空格，**字符串原样保留**（这样 `action.xxx` 即使写在模板串的
 * `${}` 里也照样能被找到）。顺手把正则字面量当整体跳过，免得 `\/\//` 被当成行注释。
 */
function maskComments(src) {
  let out = "";
  let i = 0;
  let state = "code";
  let prev = "";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += "\n";
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (state === "regex") {
      if (c === "\\") {
        out += c + (n ?? "");
        i += 2;
        continue;
      }
      if (c === "/") {
        state = "code";
        out += c;
        prev = "/";
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (state !== "code") {
      // 字符串 / 模板串：原样保留
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === state) state = "code";
      i += 1;
      continue;
    }
    // state === code
    if (c === "/" && n === "/") {
      state = "line";
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "/" && n === "*") {
      state = "block";
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      state = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && regexAllowed(prev)) {
      state = "regex";
      out += c;
      i += 1;
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out;
}

/** `/` 前面是这些字符时，它更可能是正则开头而不是除号。 */
function regexAllowed(prev) {
  if (prev === "") return true;
  return "([{,;:=!&|?+-*%~^<>".includes(prev);
}

/** 找到与 src[openIdx] 配对的括号（跳过字符串里的括号）。 */
function findMatch(src, openIdx) {
  const close = { "{": "}", "[": "]", "(": ")" }[src[openIdx]];
  if (!close) return -1;
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 从 from 开始找第一个处于括号平衡态的 target 字符（跳过字符串）。 */
function findTerminator(src, from, target) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") depth -= 1;
    else if (c === target && depth === 0) return i;
  }
  return -1;
}

/** 把 `[ ... ]` 区域里顶层的 `{ ... }` 都切出来。 */
function topLevelObjects(src, openIdx) {
  const end = findMatch(src, openIdx);
  if (end < 0) return [];
  const out = [];
  let i = openIdx + 1;
  while (i < end) {
    if (src[i] === "{") {
      const stop = findMatch(src, i);
      if (stop < 0) break;
      out.push(src.slice(i, stop + 1));
      i = stop + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

// ------------------------------------------------- 1. types.ts 的 AppAction

const typesMasked = maskComments(TYPES_SRC);
const unionStart = typesMasked.indexOf("export type AppAction =");
if (unionStart < 0) fail("types.ts 里找不到 `export type AppAction =`");
const unionEq = typesMasked.indexOf("=", unionStart);
const unionEnd = findTerminator(typesMasked, unionEq + 1, ";");
if (unionEnd < 0) fail("types.ts 的 AppAction 联合类型没有正常的结尾 `;`");
const unionBody = typesMasked.slice(unionEq + 1, unionEnd);

const typeVariants = [];
{
  let buf = "";
  let depth = 0;
  for (const ch of unionBody) {
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    if (ch === "|" && depth === 0) {
      typeVariants.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  typeVariants.push(buf);
}

const typeKinds = [];
const typeFields = {};
for (const variant of typeVariants) {
  const hit = /kind:\s*"([^"]+)"/.exec(variant);
  if (!hit) continue;
  const kind = hit[1];
  typeKinds.push(kind);
  const fields = [];
  for (const m of variant.matchAll(/([A-Za-z_][A-Za-z0-9_]*)(\?)?:\s*([^;{}]+)/g)) {
    if (m[1] === "kind") continue;
    fields.push({ name: m[1], optional: Boolean(m[2]) });
  }
  typeFields[kind] = fields;
}

// ------------------------------------- 2. action-meta.ts 的权限表键集合

const metaMasked = maskComments(META_SRC);
const metaMarker = metaMasked.indexOf("export const ACTION_PERMISSION");
const metaOpen = metaMasked.indexOf("{", metaMarker);
const metaClose = findMatch(metaMasked, metaOpen);
const metaBody = metaMasked.slice(metaOpen + 1, metaClose);
const metaKinds = [];
for (const m of metaBody.matchAll(/(?:^|\n)\s*(?:"([A-Za-z][A-Za-z0-9_.]*)"|([A-Za-z][A-Za-z0-9_.]*))\s*:/g)) {
  metaKinds.push(m[1] ?? m[2]);
}

// ------------------------------------------- 3. action-schema.ts（唯一来源）

const schemaMasked = maskComments(SCHEMA_SRC);
const schemaMarker = schemaMasked.indexOf("export const ACTION_SCHEMA");
if (schemaMarker < 0) fail("action-schema.ts 里找不到 `export const ACTION_SCHEMA`");
const schemaArrOpen = schemaMasked.indexOf("[", schemaMarker);
const schemaEntries = topLevelObjects(schemaMasked, schemaArrOpen).map((entry) => {
  const kind = (/kind:\s*"([^"]+)"/.exec(entry) ?? [])[1] ?? null;
  const group = (/group:\s*"([^"]+)"/.exec(entry) ?? [])[1] ?? null;
  const summary = (/summary:\s*"([^"]+)"/.exec(entry) ?? [])[1] ?? null;
  const fieldsAt = entry.indexOf("fields:");
  const fields = [];
  if (fieldsAt >= 0) {
    const arrAt = entry.indexOf("[", fieldsAt);
    for (const obj of topLevelObjects(entry, arrAt)) {
      fields.push({
        name: (/name:\s*"([^"]+)"/.exec(obj) ?? [])[1] ?? null,
        type: (/type:\s*"([^"]+)"/.exec(obj) ?? [])[1] ?? null,
        required: (/required:\s*(true|false)/.exec(obj) ?? [])[1] === "true",
      });
    }
  }
  return { kind, group, summary, fields };
});

const schemaKinds = schemaEntries.map((e) => e.kind);
const schemaByKind = new Map(schemaEntries.map((e) => [e.kind, e]));

// ------------------------------- 4. actions.ts 里每个 case 实际读到的字段

const actionsMasked = maskComments(ACTIONS_SRC);
const switchAt = actionsMasked.indexOf("switch (action.kind) {");
if (switchAt < 0) fail("actions.ts 里找不到 `switch (action.kind) {`");
const switchOpen = actionsMasked.indexOf("{", switchAt);
const switchClose = findMatch(actionsMasked, switchOpen);
const switchBody = actionsMasked.slice(switchOpen + 1, switchClose);

const parts = switchBody.split(/case\s+"([^"]+)"\s*:/);
const rawItems = [];
for (let i = 1; i < parts.length; i += 2) rawItems.push({ kind: parts[i], body: parts[i + 1] ?? "" });

// `case "a": case "b": { ... }` 这种叠加写法：空 body 并入下一个真正有 body 的 case
const caseItems = [];
const pendingKinds = [];
for (const item of rawItems) {
  if (!item.body.trim()) {
    pendingKinds.push(item.kind);
    continue;
  }
  caseItems.push({ kinds: [...pendingKinds, item.kind], body: item.body });
  pendingKinds.length = 0;
}
if (pendingKinds.length) caseItems.push({ kinds: [...pendingKinds], body: "" });

const codeFields = {};
for (const item of caseItems) {
  const found = new Set();
  for (const m of item.body.matchAll(/action\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(m[1]);
  for (const m of item.body.matchAll(/\(action as [^)]*\)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    found.add(m[1]);
  }
  // (action as Record<string, unknown>)[k] 这种动态读法：字段名在 for 的列表里
  if (/\(action as Record<string, unknown>\)\s*\[/.test(item.body)) {
    for (const m of item.body.matchAll(/for \(const \w+ of \[([^\]]+)\] as const\)/g)) {
      for (const k of m[1].split(",")) found.add(k.trim().replace(/["']/g, ""));
    }
  }
  found.delete("kind");
  for (const k of item.kinds) codeFields[k] = [...found];
}

const codeKinds = Object.keys(codeFields);
if (codeKinds.length !== EXPECTED_KIND_COUNT) {
  fail(`actions.ts 的 switch 只覆盖了 ${codeKinds.length} 个 kind，期望 ${EXPECTED_KIND_COUNT} 个`);
}
const codeOnly = codeKinds.filter((k) => !typeKinds.includes(k));
if (codeOnly.length) fail(`actions.ts 有 case、types.ts 里却没有的 kind: ${codeOnly.join(", ")}`);

// ---------------------------------------------------- 运行时导出（可选）

let runtime = null;
let runtimeError = "";
try {
  runtime = await import("./src/lib/action-schema.ts");
} catch (err) {
  runtimeError = err && err.message ? err.message : String(err);
}

const tools = runtime
  ? runtime.actionTools()
  : schemaEntries.map((e) => ({
      type: "function",
      function: {
        name: String(e.kind).replace(/\./g, "_"),
        description: e.summary,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            e.fields.map((f) => [f.name, f.type === "string[]" ? { type: "array" } : { type: f.type }]),
          ),
          ...(e.fields.some((f) => f.required)
            ? { required: e.fields.filter((f) => f.required).map((f) => f.name) }
            : {}),
        },
      },
    }));

// ------------------------------------------------------------ 断言 1：三边

const uniq = (arr) => [...new Set(arr)];
const dups = (arr) => arr.filter((k, i) => arr.indexOf(k) !== i);

console.log("=== 1) 三边 kind 集合（types.ts / action-meta.ts / 70）===");
const dupTypes = uniq(dups(typeKinds));
const dupMeta = uniq(dups(metaKinds));
if (dupTypes.length) fail(`types.ts 里 kind 有重复: ${dupTypes.join(", ")}`);
if (dupMeta.length) fail(`action-meta.ts 里键有重复: ${dupMeta.join(", ")}`);
if (typeKinds.length !== EXPECTED_KIND_COUNT) {
  fail(`types.ts 的 AppAction kind 是 ${typeKinds.length} 个，期望 ${EXPECTED_KIND_COUNT} 个`);
}
if (metaKinds.length !== EXPECTED_PERMISSION_BOUND_COUNT) {
  fail(
    `action-meta.ts 的 ACTION_PERMISSION 是 ${metaKinds.length} 个键，期望 ${EXPECTED_PERMISSION_BOUND_COUNT} 个` +
      `（= ${EXPECTED_KIND_COUNT} 个 kind 减去不挂权限的 ${NO_PERMISSION_KINDS.join("、")}）`,
  );
}
const typesOnly = typeKinds.filter((k) => !metaKinds.includes(k));
const metaOnly = metaKinds.filter((k) => !typeKinds.includes(k));
/** 没挂权限的必须**只在白名单里**：否则就是"忘了挂权限 → 变成免确认直接执行" */
const unboundNotWhitelisted = typesOnly.filter((k) => !NO_PERMISSION_KINDS.includes(k));
if (unboundNotWhitelisted.length) {
  fail(`这些 kind 没有挂权限、也不在"不需要授权"白名单里: ${unboundNotWhitelisted.join(", ")}`);
}
if (metaOnly.length) fail(`只有 action-meta.ts 有、types.ts 没有: ${metaOnly.join(", ")}`);
if (!fails.length) {
  console.log(
    `✅ types.ts = action-meta.ts + ${NO_PERMISSION_KINDS.length} 个不挂权限的动作，` +
      `两边都是 ${typeKinds.length} 个 kind（挂权限 ${metaKinds.length} 个）`,
  );
}

// ------------------------------------------------------ 断言 2：schema 集合

console.log("");
console.log("=== 2) ACTION_SCHEMA 的 kind 集合 ===");
const dupSchema = uniq(dups(schemaKinds));
if (dupSchema.length) fail(`ACTION_SCHEMA 里 kind 有重复: ${dupSchema.join(", ")}`);
if (schemaKinds.length !== EXPECTED_KIND_COUNT) {
  fail(`ACTION_SCHEMA 有 ${schemaKinds.length} 个 kind，期望 ${EXPECTED_KIND_COUNT} 个`);
}
const schemaMissing = typeKinds.filter((k) => !schemaKinds.includes(k));
const schemaExtra = schemaKinds.filter((k) => !typeKinds.includes(k));
if (schemaMissing.length) fail(`ACTION_SCHEMA 少了这些 kind: ${schemaMissing.join(", ")}`);
if (schemaExtra.length) {
  fail(`ACTION_SCHEMA 多了这些 type 里没有的 kind: ${schemaExtra.join(", ")}`);
}
if (!schemaMissing.length && !schemaExtra.length) {
  console.log(`✅ 与 types.ts 完全一致：${schemaKinds.length} 个`);
}
const orderMismatch = typeKinds.filter((k, i) => schemaKinds[i] !== k);
if (orderMismatch.length) {
  warn(`ACTION_SCHEMA 的顺序跟 types.ts 声明顺序不一致（${orderMismatch.length} 处）`);
} else {
  console.log("✅ 声明顺序也和 types.ts 一致");
}

// 运行时导出 vs 源码文本：两边必须一样（多一道保险）
if (runtime) {
  const runtimeKinds = runtime.ACTION_SCHEMA.map((a) => a.kind);
  if (runtimeKinds.join("|") !== schemaKinds.join("|")) {
    fail("运行时 ACTION_SCHEMA 与源码文本解析出来的 kind 顺序/集合不一致（解析器或文件有问题）");
  }
  if (runtime.ACTION_SCHEMA.length !== schemaEntries.length) {
    fail(`运行时 ACTION_SCHEMA 有 ${runtime.ACTION_SCHEMA.length} 项，文本解析出 ${schemaEntries.length} 项`);
  }
} else {
  notes.push(`无法动态 import action-schema.ts（${runtimeError}）→ 断言 4 退化成「按源码文本推算」，形状检查偏弱`);
}

// ------------------------------------------------------- 断言 3：字段覆盖

console.log("");
console.log("=== 3) 字段覆盖（schema 必须覆盖 actions.ts 实际读到的）+ 表格 ===");
console.log(
  `actions.ts 的 switch 解析出 ${codeKinds.length} 个 kind / ${caseItems.length} 个 case 分支（case 叠加写法已合并）`,
);
const header = [
  pad("kind", 22),
  pad("group", 6),
  pad("ACTION_SCHEMA 字段", 40),
  pad("actions.ts 读到的字段", 36),
  "一致?",
].join(" | ");
console.log(header);
console.log("-".repeat(header.length + 8));

let coveredCount = 0;
const allMissingFields = [];
const allExtraFields = [];
for (const kind of typeKinds) {
  const entry = schemaByKind.get(kind);
  const declared = entry ? entry.fields.map((f) => f.name) : [];
  const readByCode = codeFields[kind] ?? [];
  const missing = readByCode.filter((f) => !declared.includes(f));
  const extra = declared.filter((f) => !readByCode.includes(f));
  if (!missing.length) coveredCount += 1;
  if (missing.length) allMissingFields.push(`${kind} → 少 ${missing.join(", ")}`);
  if (extra.length) allExtraFields.push(`${kind} → 多 ${extra.join(", ")}`);
  const mark = missing.length ? "❌ 少了" : extra.length ? "⚠️ 多了" : "✅";
  console.log(
    [
      pad(kind, 22),
      pad(entry ? entry.group : "-", 6),
      pad(declared.join(",") || "(无)", 40),
      pad(readByCode.join(",") || "(无)", 36),
      mark,
    ].join(" | "),
  );
}
if (allMissingFields.length) {
  fail(`有 ${allMissingFields.length} 个 kind 的字段没被 schema 覆盖: ${allMissingFields.join("；")}`);
} else {
  console.log(`✅ 字段覆盖 ${coveredCount}/${typeKinds.length}（没有 case 读到 schema 里没写的字段）`);
}
if (allExtraFields.length) {
  warn(`schema 里多出来的字段（代码没读，列出来供对照）: ${allExtraFields.join("；")}`);
}

// 额外：代码读了、但 types.ts 类型里没声明的字段（历史兼容写法）
const undocumented = [];
for (const kind of typeKinds) {
  const declaredByType = (typeFields[kind] ?? []).map((f) => f.name);
  for (const f of codeFields[kind] ?? []) {
    if (!declaredByType.includes(f)) undocumented.push(`${kind}.${f}`);
  }
}
if (undocumented.length) {
  notes.push(`actions.ts 读了、但 types.ts 没声明的兼容字段: ${undocumented.join("、")}`);
}

// 每个 kind 都得有 summary / group
const noSummary = schemaEntries.filter((e) => !e.summary).map((e) => e.kind);
const noGroup = schemaEntries.filter((e) => !e.group).map((e) => e.kind);
if (noSummary.length) fail(`这些 kind 没有 summary: ${noSummary.join(", ")}`);
if (noGroup.length) fail(`这些 kind 没有 group: ${noGroup.join(", ")}`);
const longSummary = schemaEntries.filter((e) => e.summary && e.summary.length > 20);
if (longSummary.length) warn(`summary 超过 20 字: ${longSummary.map((e) => e.kind).join(", ")}`);

// ------------------------------------------------------- 断言 4：tools 形状

console.log("");
console.log("=== 4) actionTools() 的输出形状 ===");
if (tools.length !== EXPECTED_KIND_COUNT) {
  fail(`actionTools() 给了 ${tools.length} 个工具，期望 ${EXPECTED_KIND_COUNT} 个`);
}
const badName = [];
const badParams = [];
const nameSeen = new Map();
for (const tool of tools) {
  const fn = tool && tool.function ? tool.function : {};
  const name = String(fn.name ?? "");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) badName.push(`${name || "(空)"}`);
  if (nameSeen.has(name)) badName.push(`${name}（重复，另一处是 ${nameSeen.get(name)}）`);
  nameSeen.set(name, fn.description ?? "");
  const params = fn.parameters;
  const props = params && params.properties;
  if (!params || params.type !== "object" || !props || typeof props !== "object") {
    badParams.push(`${name}: parameters 不是 { type: object, properties }`);
    continue;
  }
  const keys = Object.keys(props);
  if (Array.isArray(params.required)) {
    for (const r of params.required) {
      if (!keys.includes(r)) badParams.push(`${name}: required 里的 ${r} 不在 properties 里`);
    }
  }
  if (typeof fn.description !== "string" || !fn.description.trim()) {
    badParams.push(`${name}: 没有 description`);
  }
  const entry = schemaByKind.get(
    [...schemaByKind.keys()].find((k) => k.replace(/\./g, "_") === name) ?? "",
  );
  if (entry) {
    const declared = entry.fields.map((f) => f.name);
    const missingProp = declared.filter((f) => !keys.includes(f));
    if (missingProp.length) badParams.push(`${name}: properties 少了 ${missingProp.join(", ")}`);
    const extraProp = keys.filter((k) => !declared.includes(k));
    if (extraProp.length) badParams.push(`${name}: properties 多了 ${extraProp.join(", ")}`);
    const requiredNames = Array.isArray(params.required) ? params.required : [];
    const expectRequired = entry.fields.filter((f) => f.required).map((f) => f.name);
    if (requiredNames.slice().sort().join(",") !== expectRequired.slice().sort().join(",")) {
      badParams.push(
        `${name}: required 是 [${requiredNames.join(",")}]，定义里是 [${expectRequired.join(",")}]`,
      );
    }
  }
}
if (badName.length) fail(`tools 的 function name 不合法: ${badName.join("；")}`);
if (badParams.length) fail(`tools 的参数形状不合法: ${badParams.join("；")}`);
if (!badName.length && !badParams.length) {
  console.log(`✅ ${tools.length} 个工具：name 全是 [a-zA-Z0-9_-]、无重复、parameters 都是 object + properties`);
}

if (runtime) {
  // kind ↔ function name 的对应关系能双向回填
  const mapProblems = [];
  for (const entry of runtime.ACTION_SCHEMA) {
    const name = runtime.ACTION_TOOL_NAMES[entry.kind];
    if (!name) mapProblems.push(`${entry.kind} 没有对应的 function name`);
    else if (runtime.kindOfToolName(name) !== entry.kind) {
      mapProblems.push(`${name} 回填不出 ${entry.kind}`);
    }
  }
  if (mapProblems.length) fail(`kind ↔ tool name 映射有问题: ${mapProblems.join("；")}`);
  else console.log("✅ kind ↔ function name 可以双向回填（ACTION_TOOL_NAMES / kindOfToolName）");

  // renderActionCatalog：一行一个动作
  const catalog = runtime.renderActionCatalog().split("\n");
  const catalogProblems = [];
  if (catalog.length !== runtime.ACTION_SCHEMA.length) {
    catalogProblems.push(`渲染出 ${catalog.length} 行，动作有 ${runtime.ACTION_SCHEMA.length} 个`);
  }
  for (const entry of runtime.ACTION_SCHEMA) {
    // 后面必须是 `(` 或空格 —— 否则 media.play 会被 media.playTrack 误命中
    const escaped = entry.kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\] ${escaped}(?=[\\s(])`);
    const hit = catalog.filter((line) => re.test(line)).length;
    if (hit !== 1) catalogProblems.push(`${entry.kind} 在清单里出现 ${hit} 次`);
  }
  if (catalogProblems.length) fail(`renderActionCatalog() 有问题: ${catalogProblems.join("；")}`);
  else console.log(`✅ renderActionCatalog() 一行一个动作，${catalog.length} 行`);
} else {
  console.log("⚠️ 跳过 actionTools()/renderActionCatalog() 的运行时检查（动态 import 不可用）");
}

// --------------------------------- 附：提示词原文覆盖了多少（只作交接信息）

const promptKinds = [];
const promptMissing = [];
for (const kind of typeKinds) {
  const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`);
  if (re.test(PROMPT_SRC)) promptKinds.push(kind);
  else promptMissing.push(kind);
}

// ---------------------------------------------------------------- 汇总

console.log("");
console.log("=== 5) 提示词原文覆盖（只是交接信息，**不是本步门禁**）===");
console.log(
  `prompt.ts 提到 ${promptKinds.length}/${typeKinds.length} 个 kind，` +
    `没提到 ${promptMissing.length} 个（P4 切到 renderActionCatalog() 后应为 62）：`,
);
console.log(`  ${promptMissing.join(" ")}`);

console.log("");
console.log("=== 汇总 ===");
for (const n of notes) console.log(`ℹ️ ${n}`);
for (const w of warns) console.log(`⚠️ ${w}`);
for (const f of fails) console.log(`❌ ${f}`);
console.log(
  fails.length === 0
    ? `✅ 全部通过：三边 ${typeKinds.length} 个 kind 一致 / 字段覆盖 ${coveredCount}/${typeKinds.length} / tools 形状合法`
    : `❌ ${fails.length} 项不通过`,
);
process.exitCode = fails.length === 0 ? 0 : 1;

/** 中文按两格算，表格才对得齐。 */
function pad(text, width) {
  const s = String(text);
  let w = 0;
  for (const ch of s) {
    w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(
      ch,
    )
      ? 2
      : 1;
  }
  return s + " ".repeat(Math.max(0, width - w));
}
