/**
 * 验收脚本：P2 原生 `tools` 的**纯函数边界** ——
 *   · `src/lib/tool-wire.ts`     —— 参数解析 / 降级信号 / 空轮判断
 *   · `src/lib/tool-protocol.ts` —— 走不走原生 tools / 界面上那句话
 *   · `src/lib/tool-title.ts`    —— 工具调用的一句话标题（附赠组 F）
 *
 * ── 这一轮要证明什么 ────────────────────────────────────────────
 *
 * P2 把内部动作接到了原生 `tools`（function calling）。端到端脚本（`verify-tool-native.mjs`）
 * 只在有浏览器 / 真上游时才跑得起来，**边界输入**根本覆盖不到；而主链路里这几个纯函数
 * 判错的代价很大（工具轮被无限重发、该降级的不降级、不该降级的被降级）。
 * 所以这一轮把它们逐条钉死：
 *
 *   A. `parseToolArgs`：无参调用合法（空串 / 空白 / `{}` 都不是错）；半截 JSON、纯文字
 *      如实失败；数组 / 数字 / `null` / `true` **都算失败**（内部动作的参数永远是对象）；
 *      尾随逗号、全角引号**不许被悄悄"修"成成功**（失败要回灌给模型让它重写）
 *   B. `looksLikeToolsUnsupported`：只有「400 系 + 提到工具 + 不支持/无法识别」才是降级信号；
 *      401 / 403 / 429 / 5xx 一律不降级；`tool_choice is not supported` **必须**认
 *   C. `isEmptyRound`：⭐ **只有工具调用、没有正文不算空**（写错了工具轮会被无限重发）
 *   D. `shouldUseNativeTools`：默认保守（false）；显式 native / text 最高优先；
 *      auto 必须「探测过 + 说支持 + 自定义上游地址密钥都填了」才走原生（空白字符串算没填）
 *   E. `toolProtocolLabel`：界面显示的 `native` 必须和实际判断**逐例一致**，文案不许漏出 undefined
 *   F. （附赠）`toolCallTitle`：参数读不懂要退成「参数没读懂」，不能把 undefined 拼进标题
 *
 * ── 怎么做到"真的" ──────────────────────────────────────────────
 *
 * 纯 node、**不起浏览器、不连外网**：`tool-wire.ts` / `tool-protocol.ts` 都是**零 import**，
 * 用 `node --experimental-strip-types` 直接 import 真模块来测（顺带断言"它们确实零 import"）。
 * `tool-title.ts` 里是 `@/lib/…` 路径别名，node 裸 import 解析不了；这里**不改任何源文件、
 * 也不动 tsconfig / package.json**，而是在脚本内注册一个 resolve 钩子把 `@/` 映射到 `./src/`；
 * 钩子起不来就**明说跳过**（⚠️ 观察项），绝不静默当成功。
 *
 * 跑法：
 *   node --experimental-strip-types verify-tool-helpers.mjs
 * 退出码 0 = 全过；非 0 = 有断言失败。
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { shouldUseNativeTools, toolProtocolLabel } from "./src/lib/tool-protocol.ts";
import {
  isEmptyRound,
  looksLikeJsonArgs,
  looksLikeToolsUnsupported,
  parseToolArgs,
} from "./src/lib/tool-wire.ts";

/* ──────────────────────────── 断言小工具 ──────────────────────────── */

let passed = 0;
/** @type {string[]} */
const failures = [];
/** 非计分观察项：契约之外的行为，只记录、不算失败（报告里会点名） */
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
const same = (a, b) => j(a) === j(b);
const hasError = (r) => typeof r?.error === "string" && r.error.length > 0;
const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * `tool-title.ts` 用的是 `@/lib/…` 别名，node 里裸 import 解析不了。
 * 这里注册一个 resolve 钩子把 `@/` 指到 `./src/`（**只在本进程内、不改任何文件**），
 * 于是"标题拼装"这条也能拿真模块来断言，而不是靠抄一遍逻辑自说自话。
 * 钩子起不来就返回 null —— 调用方会打印 ⚠️ 说明跳过，不当成功。
 */
async function tryLoadToolCallTitle() {
  try {
    const base = new URL("./src/", import.meta.url).href;
    const hook = [
      "export async function resolve(specifier, context, next) {",
      `  if (specifier.startsWith("@/")) return next(${JSON.stringify(base)} + specifier.slice(2) + ".ts", context);`,
      "  return next(specifier, context);",
      "}",
    ].join("\n");
    register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);
    const mod = await import("./src/lib/tool-title.ts");
    return typeof mod.toolCallTitle === "function" ? mod.toolCallTitle : null;
  } catch {
    return null;
  }
}

async function main() {
  /* ═════════ 【0】模块自检：这两个文件必须"零 import"才可能在纯 node 里跑 ═════════ */

  console.log("【0】模块自检：导出齐全、零 import（纯 node 能直接跑的前提）");
  check(
    "tool-wire.ts 四个函数都导出了（looksLikeJsonArgs / parseToolArgs / looksLikeToolsUnsupported / isEmptyRound）",
    [looksLikeJsonArgs, parseToolArgs, looksLikeToolsUnsupported, isEmptyRound].every(
      (f) => typeof f === "function",
    ),
  );
  check(
    "tool-protocol.ts 两个函数都导出了（shouldUseNativeTools / toolProtocolLabel）",
    [shouldUseNativeTools, toolProtocolLabel].every((f) => typeof f === "function"),
  );

  const wireSrc = source("./src/lib/tool-wire.ts");
  const protocolSrc = source("./src/lib/tool-protocol.ts");
  const titleSrc = source("./src/lib/tool-title.ts");
  const firstImport = (src) => (src.match(/^\s*import\s.*$/m) ?? [""])[0].trim();
  check(
    "tool-wire.ts 源码里没有任何 import（否则纯 node / 浏览器两边都跑不了）",
    !/^\s*import\s/m.test(wireSrc),
    firstImport(wireSrc),
  );
  check(
    "tool-protocol.ts 源码里没有任何 import",
    !/^\s*import\s/m.test(protocolSrc),
    firstImport(protocolSrc),
  );
  check(
    "tool-title.ts 源码里确实是 @/ 别名 import（所以它需要 F 组那个钩子才能测）",
    /from\s+["']@\//.test(titleSrc),
    firstImport(titleSrc),
  );

  /* ═════════ A. parseToolArgs：参数解析 ═════════ */

  console.log("\n【A】parseToolArgs —— 无参合法、坏参数如实失败、非对象一律失败");
  const Q = "\u0022"; // 半角双引号；写成转义免得脚本自己的字符串被引号搅乱

  const emptyRaw = parseToolArgs("");
  check("A1 空串 → args 是空对象（无参调用合法，不是错）", same(emptyRaw.args, {}), j(emptyRaw));
  check("A1 空串 → **没有** error", emptyRaw.error === undefined, j(emptyRaw));
  const blankRaw = parseToolArgs("   \n\t  ");
  check(
    "A1 只有空白/换行 → args 空对象且没有 error",
    same(blankRaw.args, {}) && blankRaw.error === undefined,
    j(blankRaw),
  );
  check(
    "A1 空串在 looksLikeJsonArgs 眼里也算「像 JSON 参数」（同一套约定）",
    looksLikeJsonArgs("") === true,
    j(looksLikeJsonArgs("")),
  );

  const emptyObj = parseToolArgs("{}");
  check('A2 "{}" → 空对象（不是失败）', same(emptyObj.args, {}), j(emptyObj));
  check('A2 "{}" → 没有 error', emptyObj.error === undefined, j(emptyObj));

  const rich = `{${Q}city${Q}:${Q}杭州${Q},${Q}nested${Q}:{${Q}a${Q}:[1,2,{${Q}b${Q}:true}]},${Q}list${Q}:[${Q}一${Q},${Q}二${Q}],${Q}num${Q}:3.5,${Q}flag${Q}:true,${Q}nul${Q}:null}`;
  const richRaw = parseToolArgs(rich);
  check(
    "A3 合法对象（中文 + 嵌套 + 数组 + 各类型）→ 逐字原样解析",
    same(richRaw.args, JSON.parse(rich)),
    j(richRaw),
  );
  check("A3 中文字段保真（city === 杭州）", richRaw.args.city === "杭州", j(richRaw.args.city));
  check(
    "A3 嵌套数组里的对象也对（nested.a 是数组、a[2].b === true）",
    Array.isArray(richRaw.args.nested?.a) &&
      richRaw.args.nested.a.length === 3 &&
      richRaw.args.nested.a[2]?.b === true,
    j(richRaw.args.nested),
  );
  check(
    "A3 数组顺序与元素保真（list 是 [一, 二]）",
    same(richRaw.args.list, ["一", "二"]),
    j(richRaw.args.list),
  );
  check(
    "A3 数字 / 布尔 / null 的类型都保真（3.5 / true / null）",
    richRaw.args.num === 3.5 && richRaw.args.flag === true && richRaw.args.nul === null,
    j([richRaw.args.num, richRaw.args.flag, richRaw.args.nul]),
  );
  check("A3 合法对象 → 没有 error", richRaw.error === undefined, j(richRaw.error));

  const half = parseToolArgs(`{${Q}a${Q}:`);
  check("A4 半截 JSON → **有** error", hasError(half), j(half));
  check("A4 半截 JSON → args 是空对象（不许留半截数据）", same(half.args, {}), j(half));

  const prose = parseToolArgs("hello");
  check("A5 纯文字 → 有 error", hasError(prose), j(prose));
  check("A5 纯文字 → args 是空对象", same(prose.args, {}), j(prose));

  const notObjects = [
    ["[1,2]", "JSON 数组"],
    ["42", "JSON 数字"],
    ["null", "JSON null"],
    ["true", "JSON true"],
  ];
  for (const [raw, label] of notObjects) {
    const r = parseToolArgs(raw);
    check(
      `A6 ${label}（${raw}）→ 有 error（内部动作的参数永远是对象）`,
      hasError(r),
      j(r),
    );
  }
  check(
    "A6 四个非对象输入的 args 全是 {}（不许把数组当参数对象用）",
    notObjects.every(([raw]) => same(parseToolArgs(raw).args, {})),
    j(notObjects.map(([raw]) => parseToolArgs(raw).args)),
  );
  check(
    "A6 非对象的失败原因说明了「不是一个 JSON 对象」",
    notObjects.every(([raw]) => /不是一个 JSON 对象/.test(parseToolArgs(raw).error ?? "")),
    j(notObjects.map(([raw]) => parseToolArgs(raw).error)),
  );

  const trailing = parseToolArgs(`{${Q}a${Q}:1,}`);
  check(
    "A7 尾随逗号 → 如实失败，**不许悄悄修成成功**（主链路约定：失败要回灌给模型重写）",
    hasError(trailing),
    j(trailing),
  );
  check("A7 尾随逗号 → args 是空对象", same(trailing.args, {}), j(trailing));
  const curlyDelim = parseToolArgs(`{“a”:1}`);
  check("A7 全角引号当 JSON 分隔符 → 如实失败", hasError(curlyDelim), j(curlyDelim));
  const curlyInside = parseToolArgs(`{${Q}text${Q}:${Q}他说“你好”${Q}}`);
  check(
    "A7 但**字符串内容**里的中文引号是合法的 → 必须成功且原样保留（别矫枉过正）",
    curlyInside.error === undefined && curlyInside.args.text === "他说“你好”",
    j(curlyInside),
  );
  check(
    "A7 失败时给的那句话够长、能照着改（error.length > 5）",
    hasError(trailing) && trailing.error.length > 5,
    j(trailing.error),
  );
  check(
    "A7 looksLikeJsonArgs 对半截 JSON 说不（false）",
    looksLikeJsonArgs(`{${Q}a${Q}:`) === false,
    j(looksLikeJsonArgs(`{${Q}a${Q}:`)),
  );
  check(
    "A7 looksLikeJsonArgs 对纯文字说不（false）",
    looksLikeJsonArgs("hello") === false,
    j(looksLikeJsonArgs("hello")),
  );
  check(
    "A7 looksLikeJsonArgs 认合法对象与数组（true —— 它只管「像 JSON」，对象性由 parseToolArgs 管）",
    looksLikeJsonArgs(`{${Q}a${Q}:1}`) === true && looksLikeJsonArgs("[1,2]") === true,
    j([looksLikeJsonArgs(`{${Q}a${Q}:1}`), looksLikeJsonArgs("[1,2]")]),
  );

  /* ═════════ B. looksLikeToolsUnsupported：降级信号 ═════════ */

  console.log("\n【B】looksLikeToolsUnsupported —— 只在 400 系 + 提到工具 + 「不支持」时才降级");
  const degradeBody = `{${Q}error${Q}:{${Q}message${Q}:${Q}tools is not supported by this model${Q}}}`;
  check(
    "B8 400 + 「tools is not supported by this model」→ true（这是降级的唯一触发信号）",
    looksLikeToolsUnsupported(400, degradeBody) === true,
    j(looksLikeToolsUnsupported(400, degradeBody)),
  );
  check(
    "B9 400 + 中文「不支持 tools」→ true",
    looksLikeToolsUnsupported(400, "不支持 tools") === true,
    j(looksLikeToolsUnsupported(400, "不支持 tools")),
  );
  check(
    "B9 400 + 中文「无法识别 tools 参数」→ true（走中文分支也要认）",
    looksLikeToolsUnsupported(400, "无法识别 tools 参数") === true,
    j(looksLikeToolsUnsupported(400, "无法识别 tools 参数")),
  );
  check(
    "B9 400 + 「不支持的参数：tools」→ true",
    looksLikeToolsUnsupported(400, "不支持的参数：tools") === true,
    j(looksLikeToolsUnsupported(400, "不支持的参数：tools")),
  );
  check(
    "B10 400 + 「tool_choice is not supported」→ **true**（它就是工具相关的拒绝，别写成 false）",
    looksLikeToolsUnsupported(400, "tool_choice is not supported") === true,
    j(looksLikeToolsUnsupported(400, "tool_choice is not supported")),
  );
  for (const status of [401, 403, 429, 500]) {
    check(
      `B10 ${status} + 同样提到 tools → false（密钥 / 限流 / 对方挂了，跟 tools 无关）`,
      looksLikeToolsUnsupported(status, "tools is not supported by this model") === false,
      j(looksLikeToolsUnsupported(status, "tools is not supported by this model")),
    );
  }
  check(
    "B10 400 + 「invalid api key」（一个字没提工具）→ false",
    looksLikeToolsUnsupported(400, "invalid api key") === false,
    j(looksLikeToolsUnsupported(400, "invalid api key")),
  );
  check(
    "B10 200 + 提到 tools → false（只有 400 系才算 400 系）",
    looksLikeToolsUnsupported(200, "tools is not supported") === false,
    j(looksLikeToolsUnsupported(200, "tools is not supported")),
  );
  check(
    "B10 400 + 「unsupported」（没提工具）→ false",
    looksLikeToolsUnsupported(400, "unsupported") === false,
    j(looksLikeToolsUnsupported(400, "unsupported")),
  );
  check(
    "B10 400 + 空 body → false（不许凭状态码就降级）",
    looksLikeToolsUnsupported(400, "") === false,
    j(looksLikeToolsUnsupported(400, "")),
  );
  check(
    "B11 404 + 「unknown tools parameter」→ true",
    looksLikeToolsUnsupported(404, "unknown tools parameter") === true,
    j(looksLikeToolsUnsupported(404, "unknown tools parameter")),
  );
  check(
    "B11 422 + 「unknown tools parameter」→ true（代码注释说 422 也算 400 系）",
    looksLikeToolsUnsupported(422, "unknown tools parameter") === true,
    j(looksLikeToolsUnsupported(422, "unknown tools parameter")),
  );
  check(
    "B11 大小写不敏感：400 + 「TOOLS IS NOT SUPPORTED」→ true",
    looksLikeToolsUnsupported(400, "TOOLS IS NOT SUPPORTED") === true,
    j(looksLikeToolsUnsupported(400, "TOOLS IS NOT SUPPORTED")),
  );
  note(
    "B-观察 纯中文 body（不含 ASCII 的 tool 字样）时的判定：400 +「不支持工具调用」",
    j(looksLikeToolsUnsupported(400, "不支持工具调用")),
  );
  note(
    "B-观察 同上：400 +「无法识别工具参数」",
    j(looksLikeToolsUnsupported(400, "无法识别工具参数")),
  );

  /* ═════════ C. isEmptyRound：空轮判断 ═════════ */

  console.log("\n【C】isEmptyRound —— 只有工具调用不算空（⭐ 写错会无限重发工具轮）");
  check(
    "C12 正文 / 思考 / 工具调用三个都空 → true",
    isEmptyRound({ content: "", thinking: "", toolCalls: [] }) === true,
    j(isEmptyRound({ content: "", thinking: "", toolCalls: [] })),
  );
  check(
    "C12 只有空白和换行 → true（trim 后再判）",
    isEmptyRound({ content: "  ", thinking: "\n\t ", toolCalls: [] }) === true,
    j(isEmptyRound({ content: "  ", thinking: "\n\t ", toolCalls: [] })),
  );
  check(
    "C13 ⭐ 只有工具调用、没正文没思考 → **false**（按老规矩判就会被无限重发）",
    isEmptyRound({ content: "", thinking: "", toolCalls: [{ name: "get_time" }] }) === false,
    j(isEmptyRound({ content: "", thinking: "", toolCalls: [{ name: "get_time" }] })),
  );
  check(
    "C13 一次两个工具调用 → 也是 false",
    isEmptyRound({
      content: "",
      thinking: "",
      toolCalls: [{ name: "get_time" }, { name: "get_temperature" }],
    }) === false,
  );
  check(
    "C13 正文/思考只有空白、但有工具调用 → false",
    isEmptyRound({ content: "   ", thinking: "\n", toolCalls: [{ name: "get_time" }] }) === false,
  );
  check(
    "C13 空壳工具调用 [{}] 在这里也算「有调用」→ false（丢空壳是 tool-calls 层的职责）",
    isEmptyRound({ content: "", thinking: "", toolCalls: [{}] }) === false,
  );
  check(
    "C14 只有思考 → false（思考也是内容）",
    isEmptyRound({ content: "", thinking: "想了想", toolCalls: [] }) === false,
  );
  check(
    "C14 只有正文 → false",
    isEmptyRound({ content: "你好", thinking: "", toolCalls: [] }) === false,
  );
  check(
    "C14 正文 + 思考都有、没工具调用 → false",
    isEmptyRound({ content: "你好", thinking: "想了", toolCalls: [] }) === false,
  );

  /* ═════════ D. shouldUseNativeTools：协议选择 ═════════ */

  console.log("\n【D】shouldUseNativeTools —— 默认保守；显式优先；auto 要三项齐全");
  const URL_OK = "https://upstream.example.com/v1"; // 只是示例地址，脚本不连网
  const KEY_OK = "sk-verify-only";
  const allOn = {
    toolProtocol: "auto",
    toolProbeOk: true,
    customBaseUrl: URL_OK,
    customApiKey: KEY_OK,
  };

  check(
    "D15 什么都不填 → false（没测过就走保底）",
    shouldUseNativeTools({}) === false,
    j(shouldUseNativeTools({})),
  );
  check(
    "D15 字段都显式 undefined → false",
    shouldUseNativeTools({
      toolProtocol: undefined,
      toolProbeOk: undefined,
      customBaseUrl: undefined,
      customApiKey: undefined,
    }) === false,
  );
  check(
    'D16 toolProtocol:"native" → true（哪怕没填地址密钥）',
    shouldUseNativeTools({ toolProtocol: "native" }) === true,
    j(shouldUseNativeTools({ toolProtocol: "native" })),
  );
  check(
    'D16 native + 地址密钥都是空串 → 仍然 true（用户显式选了就听他的）',
    shouldUseNativeTools({ toolProtocol: "native", customBaseUrl: "", customApiKey: "" }) === true,
  );
  check(
    'D17 toolProtocol:"text" → false（哪怕探测过 + 地址密钥都填了）',
    shouldUseNativeTools({ ...allOn, toolProtocol: "text" }) === false,
    j(shouldUseNativeTools({ ...allOn, toolProtocol: "text" })),
  );
  check(
    "D18 auto + 探测过 + 地址密钥都有 → true",
    shouldUseNativeTools(allOn) === true,
    j(shouldUseNativeTools(allOn)),
  );
  check(
    "D18 不填 toolProtocol（默认 auto）+ 三项齐全 → true",
    shouldUseNativeTools({ toolProbeOk: true, customBaseUrl: URL_OK, customApiKey: KEY_OK }) === true,
  );
  check(
    "D19 auto + 探测过 + **没填地址** → false",
    shouldUseNativeTools({ toolProtocol: "auto", toolProbeOk: true, customApiKey: KEY_OK }) === false,
  );
  check(
    "D19 auto + 探测过 + **没填密钥** → false",
    shouldUseNativeTools({ toolProtocol: "auto", toolProbeOk: true, customBaseUrl: URL_OK }) === false,
  );
  check(
    "D20 auto + 地址密钥都有但 toolProbeOk === false → false",
    shouldUseNativeTools({ ...allOn, toolProbeOk: false }) === false,
    j(shouldUseNativeTools({ ...allOn, toolProbeOk: false })),
  );
  check(
    "D20 auto + 地址密钥都有但 toolProbeOk 是 undefined → false",
    shouldUseNativeTools({ toolProtocol: "auto", customBaseUrl: URL_OK, customApiKey: KEY_OK }) === false,
  );
  check(
    "D21 地址是空白字符串（\"   \"）→ 算没填 → false",
    shouldUseNativeTools({ ...allOn, customBaseUrl: "   " }) === false,
    j(shouldUseNativeTools({ ...allOn, customBaseUrl: "   " })),
  );
  check(
    "D21 密钥是空白字符串 → 算没填 → false",
    shouldUseNativeTools({ ...allOn, customApiKey: "  \t " }) === false,
  );
  check(
    "D21 地址密钥两侧有空格但内容有效 → 算填了 → true（trim 后非空即可）",
    shouldUseNativeTools({ ...allOn, customBaseUrl: `  ${URL_OK}  `, customApiKey: `  ${KEY_OK}  ` }) ===
      true,
    j(shouldUseNativeTools({ ...allOn, customBaseUrl: `  ${URL_OK}  `, customApiKey: `  ${KEY_OK}  ` })),
  );
  check(
    'D20 toolProbeOk 是字符串 "true"（不是布尔）→ 不算探测过 → false（必须严格 === true）',
    shouldUseNativeTools({ ...allOn, toolProbeOk: "true" }) === false,
    j(shouldUseNativeTools({ ...allOn, toolProbeOk: "true" })),
  );

  /* ═════════ E. toolProtocolLabel：界面那句"现在走的是哪条" ═════════ */

  console.log("\n【E】toolProtocolLabel —— 界面显示的 native 必须和实际判断逐例一致");
  const nativeLabel = toolProtocolLabel({ toolProtocol: "native" });
  check("E22 native 情况下 native === true", nativeLabel.native === true, j(nativeLabel));
  check(
    "E22 native 那句话里带「tools」（用户能看懂走的是原生工具）",
    /tools/i.test(nativeLabel.text),
    j(nativeLabel.text),
  );

  const untestedLabel = toolProtocolLabel({ toolProtocol: "auto" });
  check("E23 auto 没测过 → native === false", untestedLabel.native === false, j(untestedLabel));
  check(
    "E23 auto 没测过 → 文案说明「还没测过」且提「保底」",
    /还没测过/.test(untestedLabel.text) && /保底/.test(untestedLabel.text),
    j(untestedLabel.text),
  );

  const battery = [
    {},
    { toolProtocol: "auto" },
    { toolProtocol: "native" },
    { toolProtocol: "text" },
    { toolProtocol: "native", customBaseUrl: "", customApiKey: "" },
    allOn,
    { toolProtocol: "auto", toolProbeOk: true, customApiKey: KEY_OK },
    { toolProtocol: "auto", toolProbeOk: true, customBaseUrl: URL_OK },
    { toolProtocol: "auto", toolProbeOk: true, customBaseUrl: "   ", customApiKey: KEY_OK },
    { toolProtocol: "auto", toolProbeOk: true, customBaseUrl: URL_OK, customApiKey: "  " },
    { toolProtocol: "auto", toolProbeOk: false, customBaseUrl: URL_OK, customApiKey: KEY_OK },
    { toolProtocol: "auto", customBaseUrl: URL_OK, customApiKey: KEY_OK },
    { toolProtocol: "text", toolProbeOk: true, customBaseUrl: URL_OK, customApiKey: KEY_OK },
  ];
  const mismatched = battery.filter((s) => toolProtocolLabel(s).native !== shouldUseNativeTools(s));
  check(
    `E24 ${battery.length} 组设置里 label.native 与 shouldUseNativeTools 逐例一致（同一份判断）`,
    mismatched.length === 0,
    j(mismatched),
  );
  check(
    "E24 所有情况下 text 都是非空字符串（界面不会出现空白说明）",
    battery.every((s) => typeof toolProtocolLabel(s).text === "string" && toolProtocolLabel(s).text.length > 0),
  );
  check(
    "E24 文案里不会漏出 undefined / NaN（原样显示给用户）",
    battery.every((s) => !/undefined|NaN/.test(toolProtocolLabel(s).text)),
    j(battery.map((s) => toolProtocolLabel(s).text).filter((t) => /undefined|NaN/.test(t))),
  );
  check(
    "E24 探测过说支持、但没地址 → 文案点出「测过是支持的」",
    /测过是支持的/.test(
      toolProtocolLabel({ toolProtocol: "auto", toolProbeOk: true, customApiKey: KEY_OK }).text,
    ),
  );
  check(
    "E24 上次测出不支持 → 文案点出「不支持」",
    /不支持/.test(
      toolProtocolLabel({ toolProtocol: "auto", toolProbeOk: false, customBaseUrl: URL_OK, customApiKey: KEY_OK })
        .text,
    ),
  );
  check(
    "E24 text 模式（探测过 + 地址密钥都有）→ label.native 也是 false，不许界面说一套实际走一套",
    toolProtocolLabel({ toolProtocol: "text", toolProbeOk: true, customBaseUrl: URL_OK, customApiKey: KEY_OK })
      .native === false,
  );
  note(
    "E-观察 auto + 探测过 + 有密钥但**缺地址** 时的文案",
    j(toolProtocolLabel({ toolProtocol: "auto", toolProbeOk: true, customApiKey: KEY_OK }).text),
  );

  /* ═════════ F. toolCallTitle（附赠）：标题拼装 ═════════ */

  console.log("\n【F】toolCallTitle（附赠）—— 参数读不懂要退成「参数没读懂」，别把 undefined 拼进标题");
  const toolCallTitle = await tryLoadToolCallTitle();
  if (!toolCallTitle) {
    note(
      "F 组整体跳过",
      "resolve 钩子没起来（node 版本 / 沙箱限制），tool-title.ts 的 @/ 别名 import 在纯 node 里解析不了",
    );
  } else {
    check("F0 用 @/ 别名钩子真的 import 到了 tool-title.ts（没改任何源文件）", true);
    check(
      "F1 kind 为 null → 「不认识的工具 <name>」",
      toolCallTitle(null, "get_time", "{}") === "不认识的工具 get_time",
      j(toolCallTitle(null, "get_time", "{}")),
    );
    const navArgs = `{${Q}path${Q}:${Q}/settings${Q}}`;
    check(
      'F2 navigate + {"path":"/settings"} → 「切换到页面 /settings」（读的是解析出来的参数）',
      toolCallTitle("navigate", "navigate", navArgs) === "切换到页面 /settings",
      j(toolCallTitle("navigate", "navigate", navArgs)),
    );
    check(
      "F2 这条标题里没有 undefined（参数被读对了，不是空 kind 对象）",
      !/undefined/.test(toolCallTitle("navigate", "navigate", navArgs)),
      j(toolCallTitle("navigate", "navigate", navArgs)),
    );
    check(
      "F3 半截 JSON 参数 → 退成「做了「navigate」（参数没读懂）」",
      toolCallTitle("navigate", "navigate", `{${Q}path${Q}:`) === "做了「navigate」（参数没读懂）",
      j(toolCallTitle("navigate", "navigate", `{${Q}path${Q}:`)),
    );
    check(
      "F3 纯文字参数 → 同样退成「参数没读懂」（不抛异常、不留半截话）",
      toolCallTitle("navigate", "navigate", "oops") === "做了「navigate」（参数没读懂）",
      j(toolCallTitle("navigate", "navigate", "oops")),
    );
    check(
      'F4 learn.addCard + {"word":"abandon"} → 「把「abandon」加进生词本」',
      toolCallTitle("learn.addCard", "learn_add_card", `{${Q}word${Q}:${Q}abandon${Q}}`) ===
        "把「abandon」加进生词本",
      j(toolCallTitle("learn.addCard", "learn_add_card", `{${Q}word${Q}:${Q}abandon${Q}}`)),
    );
    check(
      'F5 media.volume + {"value":0.5} → 数值被真的用上了（「把音量调到 50%」）',
      toolCallTitle("media.volume", "media_volume", `{${Q}value${Q}:0.5}`) === "把音量调到 50%",
      j(toolCallTitle("media.volume", "media_volume", `{${Q}value${Q}:0.5}`)),
    );
    note(
      "F-观察 合法的空参数调用（无参）走 navigate 时的标题",
      j(toolCallTitle("navigate", "navigate", "")),
    );
    note(
      "F-观察 参数是 {} 时 media.volume 的标题（字段缺失）",
      j(toolCallTitle("media.volume", "media_volume", "{}")),
    );
    note(
      "F-观察 参数是 JSON 数组 [1,2] 时的标题（parseToolArgs 会拒，这里没拒）",
      j(toolCallTitle("navigate", "navigate", "[1,2]")),
    );
    note("F-观察 参数是 'null' 时的标题", j(toolCallTitle("navigate", "navigate", "null")));
  }

  /* ═════════ 收尾：纯函数、可重复 ═════════ */

  console.log("\n【收尾】汇总与可重复性");
  check(
    "同一份输入连算两次结果完全一致（纯函数、没有隐藏状态）",
    same(parseToolArgs(rich), parseToolArgs(rich)) &&
      shouldUseNativeTools(allOn) === shouldUseNativeTools(allOn) &&
      isEmptyRound({ content: "", thinking: "", toolCalls: [] }) === true,
  );
  check("断言项数 ≥ 40（任务要求的下限）", passed >= 40, `实际 ${passed}`);
  check("所有断言汇总后没有失败项", failures.length === 0, failures.slice(0, 3).join(" / "));
}

/* ──────────────────────────────── 开跑 ──────────────────────────────── */

try {
  await main();
} catch (err) {
  console.error("验收脚本自己崩了：", err);
  failures.push(`脚本异常：${err?.message ?? err}`);
}

console.log(`\n${"─".repeat(72)}`);
if (notes.length > 0) {
  console.log(`⚠️ ${notes.length} 条非计分观察（不算失败，报告里会点名）：`);
  for (const n of notes) console.log(`  · ${n}`);
}
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项断言 ✅（纯 node，未起浏览器、未连外网）`);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌`);
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
