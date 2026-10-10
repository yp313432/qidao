#!/usr/bin/env node
/**
 * 验收：**分段回复**（纯 node，不起浏览器、不连外网、不占端口）。
 *
 * 用户原话（2026-11）：
 *   "他这个回复只能我回一句，他回一句，就感觉不像真人；能不能他分段回呢？
 *    一句就跟发消息似的，可以发好几条那种。"
 *   "分段做成可调节的吧，就是我自己设置最多几句。"
 *
 * 这里钉的是**四条规矩**：
 *   ① 没有分隔符 → 就一条（**绝不硬切**：一句能说完的回复被切成两条会很怪）
 *   ② 切分**一个字都不许丢**（段数超上限时并进最后一段，不是截掉）
 *   ③ "每条最多几句" 是按**句末标点**切的，不许把句子拦腰截断
 *   ④ 提示词里那条规矩用的分隔符和数字，**跟代码是同一份**（不是各写一套）
 *
 * 跑法：node verify-segment.mjs
 * 反向验证（内存里造一个"朴素截断版"切分器，断言必须能认出它丢字）：
 *   QIDAO_MUTATE_REVERSE=1 node verify-segment.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import {
  SEGMENT_SEP,
  splitSegments,
  partsFor,
  firstSegment,
  isSegmented,
} from "./src/lib/segment.ts";

/**
 * `prompt.ts` 里用的是 `@/lib/…` 别名，node 裸 import 解析不了 ——
 * 注册一个 resolve 钩子把 `@/` 指到 `./src/`（只在本进程内，不改任何文件），
 * 这样"提示词里那条规矩"也能拿**真模块**来断言（同 `verify-tool-helpers.mjs` 的做法）。
 */
const base = new URL("./src/", import.meta.url).href;
const hook = [
  "export async function resolve(specifier, context, next) {",
  `  if (specifier.startsWith("@/")) return next(${JSON.stringify(base)} + specifier.slice(2) + ".ts", context);`,
  "  return next(specifier, context);",
  "}",
].join("\n");
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}
const j = (v) => JSON.stringify(v);

/** 去掉分隔符和空白之后的内容 —— 用来断言"一个字都没丢" */
const skeleton = (s) => s.split(SEGMENT_SEP).join("").replace(/\s+/g, "");

/* ── ① 没有分隔符就别切 ── */
const one = splitSegments("今天风挺大的，出门穿厚点。", { maxParts: 3, maxSentences: 2 });
check("① 一句能说完的回复**不切**（就是一条）", one.length === 1, j(one));

/* ── ② 有分隔符就按它切 ── */
const three = splitSegments("在忙吗？|||刚看到你那边降温了。|||记得加衣服。", {
  maxParts: 3,
  maxSentences: 2,
});
check("② 两个分隔符 → 三条", three.length === 3, j(three));
check("② 分隔符本身**不进正文**", !three.some((p) => p.includes(SEGMENT_SEP)), j(three));

const inline = splitSegments("先说我这边：搞定了。|||你呢", { maxParts: 3, maxSentences: 2 });
check("② 行内（不是单独一行）的分隔符也算", inline.length === 2, j(inline));

const withEmpty = splitSegments("甲|||   |||乙", { maxParts: 3, maxSentences: 2 });
check("② 空段被丢掉（`|||` 连着写不会产生空气泡）", withEmpty.length === 2, j(withEmpty));

/* ── ③ 超上限：并进最后一段，一个字都不丢 ── */
const src5 = "一。|||二。|||三。|||四。|||五。";
const capped = splitSegments(src5, { maxParts: 3, maxSentences: 1 });
check("③ 五条 + 上限三条 → 三条", capped.length === 3, j(capped));
check(
  "③ **一个字都不许丢**（去掉分隔符后跟原文完全一致）",
  skeleton(capped.join(SEGMENT_SEP)) === skeleton(src5),
  j({ got: capped.map(skeleton).join("|"), want: skeleton(src5) }),
);

/* ── ④ 每条最多几句：按句末标点切，不截断句子 ── */
const long = "第一句。第二句。第三句。第四句。";
const bySentence = splitSegments(long, { maxParts: 5, maxSentences: 2 });
check("④ 四句 + 每条最多两句 → 两条", bySentence.length === 2, j(bySentence));
check(
  "④ 切点在句号之后（没有半个句子）",
  bySentence.every((p) => p.trim().endsWith("。")),
  j(bySentence),
);
check("④ 这种细切也不丢字", skeleton(bySentence.join("")) === skeleton(long), j(bySentence));

/* ── ⑤ 边界：关掉 / 只留一条 ── */
check("⑤ maxParts=1 → 原样返回（等于没开分段）", splitSegments(long, { maxParts: 1 }).length === 1);
check(
  "⑤ 关掉时 `partsFor` 不写这一格（老消息没这格也照样显示）",
  partsFor("甲|||乙", { enabled: false }) === undefined,
);
check("⑤ 只有一条时也不写 `parts`", partsFor("就一句话", { enabled: true }) === undefined);
check("⑤ 真的切成两条才写", (partsFor("甲|||乙", { enabled: true }) ?? []).length === 2);

/* ── ⑥ 流式期间只显示第一段 ── */
check("⑥ `firstSegment` 只取第一段（后面等他写完再冒）", firstSegment("甲|||乙") === "甲");
check("⑥ 没分隔符时原样返回", firstSegment("甲") === "甲");
check("⑥ `isSegmented` 能认出来", isSegmented("甲|||乙") && !isSegmented("甲"));

/* ── ⑦ 提示词那条规矩：分隔符和数字必须跟代码同一份 ── */
function checkPromptRule() {
  const src = readFileSync(join(ROOT, "src", "lib", "prompt.ts"), "utf8");
  check(
    "⑦ 提示词里的分隔符是**代码里那个常量**（不是手打的三个竖线）",
    src.includes("${SEGMENT_SEP}") && !src.includes('写一行 `|||`'),
  );
  check("⑦ 提示词引的是 `lib/segment` 那一份", src.includes('from "@/lib/segment"'));
}
/** 数字来自设置：把它当纯函数跑一遍，看它认不认传进来的数 */
async function checkRuleNumbers() {
  const mod = await import("./src/lib/prompt.ts");
  const rule = mod.segmentRule({ maxParts: 5, maxSentences: 4 });
  check(
    "⑦ 「最多几条 / 每条最多几句」用的是**传进来的数字**（设置页改了提示词就跟着改）",
    rule.includes("最多 5 条") && rule.includes("每条最多 4 句"),
    j(rule.slice(0, 120)),
  );
  check("⑦ 规矩里写着「一句能说完的就别分段」", rule.includes("一句能说完的就别分段"));
}

/**
 * 反向验证：**朴素版**（超上限直接截掉）—— 我们的"不丢字"断言必须能认出它。
 * 只改内存，不碰磁盘。
 */
function naiveSplit(raw, maxParts) {
  return raw
    .split(SEGMENT_SEP)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxParts);
}

if (!REVERSE) {
  checkPromptRule();
  await checkRuleNumbers();
}

if (REVERSE) {
  const src5 = "一。|||二。|||三。|||四。|||五。";
  const naive = naiveSplit(src5, 3);
  passed = 0;
  failures = 0;
  check(
    "反向：朴素截断版**丢字**（所以那条断言真的在看内容）",
    skeleton(naive.join(SEGMENT_SEP)) !== skeleton(src5),
    j({ naive: naive.join("|"), want: skeleton(src5) }),
  );
  check(
    "反向：真实现**不丢字**（对照）",
    skeleton(splitSegments(src5, { maxParts: 3, maxSentences: 1 }).join(SEGMENT_SEP)) ===
      skeleton(src5),
  );
  const wentRed = failures === 0;
  console.log("");
  console.log(
    wentRed
      ? "✅ 反向验证通过：朴素截断确实丢字，而真实现不丢 —— 断言在看真值（退出码 0 = 反向成功）"
      : "❌ 反向验证失败：连朴素截断都没被认出丢字，说明断言没在看内容",
  );
  process.exit(wentRed ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
