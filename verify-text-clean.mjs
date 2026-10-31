/**
 * 正文清洗与去重的断言脚本（task-2 验收用）
 *
 *   node verify-text-clean.mjs
 *
 * 它**不 import React 组件**（chat-view.tsx 一半是 JSX），而是把文件里
 * `// #region body-clean` ～ `// #endregion body-clean` 之间的纯函数原文抽出来，
 * 用 TypeScript 编译器把类型抹掉，再在当前进程里跑。所以断言的是**文件里真正在跑的那份代码**，
 * 不是抄过来的副本 —— 改了那个 region 忘了改这里，脚本不会骗你。
 *
 * 输出同时写进仓库根的 verify-text-clean.out.txt。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAT_VIEW = join(HERE, "src", "components", "chat", "chat-view.tsx");
const OUT_FILE = join(HERE, "verify-text-clean.out.txt");
const require = createRequire(import.meta.url);
const ts = require("typescript");

/** ── 1. 抽 region → 抹类型 → 取函数 ─────────────────────────────── */
const START = "// #region body-clean";
const END = "// #endregion body-clean";
const source = readFileSync(CHAT_VIEW, "utf8");
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
if (startAt < 0 || endAt < 0 || endAt < startAt) {
  throw new Error(`chat-view.tsx 里找不到 ${START} / ${END} 标记`);
}
const region = source.slice(startAt + START.length, endAt);
const compiled = ts.transpileModule(region, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const api = new Function(
  `"use strict";\n${compiled}\nreturn { stripInternalTags, dedupeNorm, dedupeByHead, dedupeParts, dedupeBody, sentenceTokens, cleanTextForRender, DEDUP_HEAD };`,
)();

/** ── 2. 极简断言 ──────────────────────────────────────────────── */
const log = [];
let pass = 0;
let fail = 0;
function record(line) {
  log.push(line);
  console.log(line);
}
function show(v) {
  return JSON.stringify(v);
}
function eq(name, actual, expected) {
  if (actual === expected) {
    pass += 1;
    record(`  ✅ ${name}`);
  } else {
    fail += 1;
    record(`  ❌ ${name}`);
    record(`       期望: ${show(expected)}`);
    record(`       实际: ${show(actual)}`);
  }
}
function ok(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    record(`  ✅ ${name}`);
  } else {
    fail += 1;
    record(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function group(title) {
  record(`\n▌ ${title}`);
}

const { stripInternalTags, dedupeBody, dedupeParts, cleanTextForRender, sentenceTokens } = api;

/** ── 3. bug 1：内部标签 ──────────────────────────────────────── */
group("bug 1 · 内部标签清洗（消掉露出来的 <thinking_mode> / <answer>，正文不许丢）");

// 用户 m02108 截图里那一整段：thinking_mode 必须**连内容一起**删掉
eq(
  "<thinking_mode>auto</thinking_mode> → 整段删干净（连内容）",
  cleanTextForRender("<thinking_mode>auto</thinking_mode>"),
  "",
);
eq(
  "夹在正文里的 thinking_mode 整段消失、前后正文都在",
  cleanTextForRender("他在听着。<thinking_mode>auto</thinking_mode>嗯，我在。"),
  "他在听着。嗯，我在。",
);
eq(
  "<thinking>…</thinking> 同理整段删（内容也不留）",
  cleanTextForRender("好的。<thinking>用户好像有点累，要温柔一点</thinking>先坐下歇会儿。"),
  "好的。先坐下歇会儿。",
);

// answer / tool_call / antml：只删标签，正文一个字都不能少
eq(
  "<answer> 只删标签、留正文",
  cleanTextForRender("<answer>我在听，你慢慢说。</answer>"),
  "我在听，你慢慢说。",
);
eq(
  "<tool_call> / <function_call> 只删标签",
  cleanTextForRender('<tool_call name="hug">抱一下</tool_call>'),
  "抱一下",
);
eq(
  "<antml:*> 只删标签（下一层 <antml:invoke> 也一起删）",
  cleanTextForRender(
    '<antml:function_calls><antml:invoke name="recall">想起你了</antml:invoke></antml:function_calls>',
  ),
  "想起你了",
);

// 没闭合的标签（流被截断）：只删标签本身，内容保留
eq(
  "未闭合 <thinking_mode 只删标签、留后面正文",
  cleanTextForRender("<thinking_mode>auto 我在呢"),
  "auto 我在呢",
);
eq(
  "未闭合 <tool_call 同上",
  cleanTextForRender("<tool_call>摸摸头"),
  "摸摸头",
);

// 老规则必须保留：||| 还是换行，空地址链接/图片还是清掉
group("回归 · 原有 `|||` 与空地址清理没被改坏");
eq("`|||` → 换行（一字不丢）", cleanTextForRender("第一段|||第二段"), "第一段\n\n第二段");
eq("带空格的 ` ||| ` 也认", cleanTextForRender("第一段 ||| 第二段"), "第一段\n\n第二段");
eq("空地址图片删掉", cleanTextForRender("看图![图]()"), "看图");
eq("空地址链接压成文字", cleanTextForRender("[点我]( )"), "点我");

// 不能误伤正常正文
group("安全 · 不许误删正常文字");
eq("带 <b> 的正文原样保留", stripInternalTags("用 <b>粗体</b> 写"), "用 <b>粗体</b> 写");
eq("数学比较符原样保留", stripInternalTags("3 < 4 是对的"), "3 < 4 是对的");
eq("普通正文清洗前后完全一样", cleanTextForRender("今天风很大，记得加衣服。"), "今天风很大，记得加衣服。");

/** ── 4. bug 2：重复正文去重 ──────────────────────────────────── */
group("bug 2 · 工具循环重复正文（模型每轮从头重说 → 只留一份）");

const s1 = "今天先好好抱一下你。";
const s2 = "是不是又被工作累到了？";
const s3 = "那就先坐下歇一会儿。";
const round1 = s1 + s2;
const round2 = s1 + s2 + s3;

eq(
  "两轮正文直接连在一起（无空行）→ 重复句只留一份，新句保留",
  dedupeBody(round1 + round2),
  s1 + s2 + s3,
);
eq(
  "同样的内容第二轮原样重复 → 整段只留第一份",
  dedupeBody(round1 + round1),
  round1,
);
eq(
  "重复的段（前后各出现一次）→ 只留前面那份，顺序不变",
  dedupeBody(`${round1}\n\n${s3}\n\n${round1}`),
  `${round1}\n\n${s3}`,
);
eq(
  "后面那一大块把前面全包住（整段重说）→ 只留最后那份完整正文",
  dedupeBody(`${s1}\n\n${s1}${s2}${s3}`),
  s1 + s2 + s3,
);
eq(
  "两轮各自成段、第二轮完整重说第一轮并接下去 → 只留第二轮",
  dedupeBody(`${round1}\n\n${round2}`),
  round2,
);
eq(
  "只有一轮、没有重复 → 一个字都不动",
  dedupeBody(round2),
  round2,
);
eq(
  "短口头语（“嗯。”“我在。”）本来就该反复出现 → 不去重",
  dedupeBody("嗯。我在。嗯。我在。"),
  "嗯。我在。嗯。我在。",
);
eq(
  "英文句点不切句（小数/网址不会被切坏）→ 原样返回",
  dedupeBody("版本是 1.2.3，别忘了。"),
  "版本是 1.2.3，别忘了。",
);

// 分段气泡：只过滤重复的段，结构/顺序不动
const a = "今天外面风好大，窗户都在响。";
const b = "你出门记得多加一件衣服。";
const c = "晚上回来我给你暖手。";
const partsIn = [a, b, a, b, c];
const partsOut = dedupeParts(partsIn);
eq("parts 去重后只剩各一份且顺序不变", JSON.stringify(partsOut), JSON.stringify([a, b, c]));
ok("parts 原数组没被就地改掉", JSON.stringify(partsIn) === JSON.stringify([a, b, a, b, c]));
eq("parts 只有一段时原样返回", JSON.stringify(dedupeParts([a])), JSON.stringify([a]));

// 切句口径：拼回去必须一字不差（空白也算块）
const messy = "第一句。\n第二句！  第三句？ 尾巴没有标点";
eq("切句→拼回＝原文（空白也没丢）", sentenceTokens(messy).join(""), messy);

/** ── 5. 汇总 ────────────────────────────────────────────────── */
const verdict = fail === 0 ? "全部通过 ✅" : `有 ${fail} 条没过 ❌`;
record(`\n${"-".repeat(64)}`);
record(`结论：${pass} 条通过，${fail} 条失败 —— ${verdict}`);
writeFileSync(OUT_FILE, `${log.join("\n")}\n`, "utf8");
record(`输出已写入 ${OUT_FILE}`);
process.exitCode = fail === 0 ? 0 : 1;
