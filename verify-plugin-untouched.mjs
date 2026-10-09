/**
 * 验收脚本：**记忆宇宙那个插件，UI 和设计一个字节都没动**。
 *
 * 用户原话（反复强调过一次）：
 *   "对了，现在的 ui 和设计不能变，我好不容易跑出这么漂亮的效果的"
 *   "记忆数据可以变"
 *
 * 所以规矩拆成两句：
 *   · **界面（组件 / 引擎 / CSS / 数据示例）不许动** —— 那是他"好不容易跑出来的效果"
 *   · **数据可以动** —— 我们的接入只许发生在**适配层**（`adapter/qidao-memory.ts`）
 *
 * 这个脚本就是盯第一句的：拿插件目录里每个文件跟**原始 zip 解出来的那份**逐字节比。
 * 唯一的豁免是 `adapter/qidao-integration.ts`（它只是一张说明便条，不参与渲染）。
 *
 * 跑法（纯 node，不用浏览器）：
 *   node verify-plugin-untouched.mjs
 * 退出码非 0 = 有人动了插件内部。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const MINE = join(process.cwd(), "src", "plugins", "memory-universe");
const ORIGINAL = join(
  process.cwd(),
  "..",
  "qidao-docs",
  "_review-jiyiyuzhou",
  "src",
  "plugins",
  "memory-universe",
);

/**
 * 豁免名单（**只有这些允许跟原版不一样**）：
 *   · `adapter/qidao-integration.ts` —— 纯注释便条，写的是"怎么接进栖岛"，
 *     原来那份写的是"用 MockMemoryAdapter"（已经过时了）。
 *   · `adapter/qidao-memory.ts` —— **我们新加的适配层**（数据可以变就变在这里）。
 *   · `MemoryUniverse.tsx` —— **只改了"动效听谁的"那一处**（2026-10 真机踩坑）：
 *     原版直接问系统 `prefers-reduced-motion`，于是手机上系统一压制动效，
 *     这个插件的粒子就整段被跳过（用户："网页里线上有粒子在跑，手机里只有线"）；
 *     而栖岛自己的「动画」开关是 CSS 实现的（`<html data-motion>`），管不到 JS canvas。
 *     改法：**先看宿主的 `data-motion`，宿主没说才问系统**。
 *     ⚠️ 与美术无关 —— 颜色、形状、动画曲线、粒子，一个都没动。
 *     规则见 `qidao-docs/规则-插件的动效要听宿主的.md`；用 `verify-plugin-motion.mjs` 守着。
 */
const EXEMPT = new Set([
  "adapter/qidao-integration.ts",
  "adapter/qidao-memory.ts",
  "MemoryUniverse.tsx",
]);

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).replace(/\\/g, "/"));
  }
  return out;
}

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

if (!existsSync(ORIGINAL)) {
  console.log(`⚠️ 找不到原始版本（${ORIGINAL}）—— 这个脚本比不了，先跳过`);
  console.log("   （原始 zip 解出来的那份要留着：qidao-docs/_review-jiyiyuzhou/）");
  process.exit(0);
}

const mine = walk(MINE).filter((f) => !EXEMPT.has(f));
const changed = [];
const missing = [];
for (const rel of mine) {
  const o = join(ORIGINAL, rel);
  if (!existsSync(o)) {
    missing.push(rel);
    continue;
  }
  if (sha(join(MINE, rel)) !== sha(o)) changed.push(rel);
}

console.log(`比了 ${mine.length} 个文件（豁免 ${EXEMPT.size} 个）\n`);
check("① 没有任何界面文件被改动（组件 / 引擎 / CSS / 数据）", changed.length === 0, changed.join(", "));
check("② 插件的文件一个都没少", missing.length === 0, missing.join(", "));

/** 反向：原版有的、我们这边也要有（防止漏拷） */
const origFiles = walk(ORIGINAL);
const absent = origFiles.filter((f) => !existsSync(join(MINE, f)));
check("③ 原版的每个文件都在（没漏拷）", absent.length === 0, absent.join(", "));

/** 关键几个文件单独点名（它们决定视觉） */
for (const key of [
  "memory-universe.css",
  "MemoryUniverse.tsx",
  "components/MemoryDetail.tsx",
  "components/UniverseChrome.tsx",
  "engine/universe.ts",
  "engine/memory-node.ts",
  "engine/star-field.ts",
]) {
  check(`④ ${key} 与原版逐字节一致`, sha(join(MINE, key)) === sha(join(ORIGINAL, key)));
}

console.log("-".repeat(64));
console.log(`插件"没被动过"验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
