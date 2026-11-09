#!/usr/bin/env node
/**
 * 样式守卫 —— 让「样式分层」这条约定不能靠自觉维持。
 *
 * 为什么要它：纯色模式一开始就一层变量，后来为了改效果一条条加选择器覆盖，
 * 长到 `src/styles.css` 6090 行、`[data-material="solid"]` 177 条、硬编码色值
 * 266 处、`!important` 37 处。每加一条都很快，回头找一个"为什么这里多 2px"
 * 要读几千行 —— 这就是用户说的"修修补补，哪都是问题"。
 *
 * 分层之后（见 design/README.md）：
 *   src/styles/tokens.css       尺度 + 语义色 + 材质槽位（唯一写数字的地方）
 *   src/styles/base.css         骨架（无颜色/无圆角/无字号）
 *   src/styles/kit.css          组件（只读 var(--k-*)）
 *   src/styles/modes/*.css      三个模式各自的皮肤（**只有变量，没有选择器**）
 *   src/styles.css              旧的巨型文件，只许变小，不许变大
 *
 * 两类检查：
 *   1. 硬规则 —— 新模式文件写法错了，立刻失败。比如模式文件里冒出
 *      `.tool-card { padding: 6px }` 就是"补丁回潮"，直接拦下。
 *   2. 棘轮 —— 旧文件里的历史债不要求一次清完，但**只许降不许升**
 *      （基线存在 scripts/style-baseline.json，`--update` 收紧基线）。
 *   3. 文件规模 —— "一个文件 3000 行"和"根目录堆 44 个文件"是同一类病：
 *      改一处要在几千行里找、谁属于谁看不出来。最大部件文件行数与
 *      components 根上文件数同样只许降（拆完之后 `--update` 锁住）。
 *
 * 用法：
 *   node scripts/guard-styles.mjs            检查（npm run style:guard）
 *   node scripts/guard-styles.mjs --update   把当前计数记为新的基线
 *   node scripts/guard-styles.mjs --json     机器可读结果
 *
 * 退出码：0 通过 / 1 有违规 / 2 自身出错。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..");

/** 旧账台账：记录历史计数，之后只许降。 */
export const BASELINE_REL = "scripts/style-baseline.json";

const ENTRY_REL = "src/styles.css";
const LAYER_DIR = "src/styles";
const MODE_DIR = "src/styles/modes";
const MODE_NAMES = ["solid", "liquid"];

/** 允许写变量的模式文件必须是这几种材质之一。 */
const MODE_SELECTOR_RE = /^\[[a-zA-Z-]+="[^"]+"\](?:\[[a-zA-Z-]+="[^"]+"\])*$/;
const DATA_MATERIAL_RE = /\[data-material\s*[~|^$*]?=\s*"(\w+)"\]/g;

/** 色值字面量：hex、rgb()/hsl() 家族。分层后的新文件里一处都不许有。 */
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

/**
 * Tailwind 任意值：`p-[16px]` `text-[13px]` `bg-[#fff]` 这类「就地编个值」。
 * 只认**以数字或 # 开头**的方括号值 —— `data-[state=open]:` 这种变体是正常写法。
 */
const TAILWIND_ARBITRARY_RE = /-\[(?:[0-9]|#)[^\]\n]*\]/g;

function readText(abs) {
  return readFileSync(abs, "utf8");
}

function countMatches(text, re) {
  const local = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let n = 0;
  while (local.exec(text) !== null) n += 1;
  return n;
}

/** 递归列出目录下的指定扩展名文件（相对 root 的 posix 路径）。 */
export function listFiles(root, relDir, extensions) {
  const absDir = join(root, relDir);
  if (!existsSync(absDir)) return [];
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const child = join(abs, name);
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child);
      else if (extensions.some((ext) => name.endsWith(ext))) {
        out.push(relative(root, child).split(sep).join("/"));
      }
    }
  };
  walk(absDir);
  return out;
}

/** 去掉注释，避免注释里的示例代码/色值被当成真代码计数。 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function isModeFile(rel) {
  return rel.startsWith(MODE_DIR + "/");
}

/**
 * 模式文件只许是「[data-material=...] { --k-xxx: 值; }」。
 * 返回违规列表，每条 { file, line, message }。
 */
export function auditModeFile(rel, source) {
  const violations = [];
  const css = stripComments(source);
  const lines = source.split("\n");

  const lineOf = (index) => {
    let seen = 0;
    for (let i = 0; i < lines.length; i += 1) {
      seen += lines[i].length + 1;
      if (seen > index) return i + 1;
    }
    return lines.length;
  };

  if (/@(media|supports|container|layer)\b/.test(css)) {
    violations.push({
      file: rel,
      line: 1,
      message: "模式文件里不许出现 @media/@supports/@layer —— 条件样式属于 kit 层",
    });
  }

  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = blockRe.exec(css)) !== null) {
    const selectorText = match[1].replace(/\s+/g, " ").trim();
    const body = match[2];
    const at = lineOf(match.index);

    for (const selector of selectorText.split(",").map((s) => s.trim())) {
      if (!selector) continue;
      if (!MODE_SELECTOR_RE.test(selector)) {
        violations.push({
          file: rel,
          line: at,
          selector,
          message: `模式文件里只许用属性选择器（[data-material="solid"] 这种），这里是「${selector}」——类名/元素选择器就是补丁回潮`,
        });
        continue;
      }
      if (!/\[data-material\s*[~|^$*]?=/.test(selector)) {
        violations.push({
          file: rel,
          line: at,
          selector,
          message: "模式文件的每个选择器都必须带 data-material",
        });
      }
    }

    for (const decl of body.split(";")) {
      const text = decl.trim();
      if (!text) continue;
      const [prop, ...rest] = text.split(":");
      if (!prop || rest.length === 0) {
        violations.push({ file: rel, line: at, message: `这行不像声明：${text}` });
        continue;
      }
      if (!prop.trim().startsWith("--k-")) {
        violations.push({
          file: rel,
          line: at,
          message: `模式文件里只许写 --k-* 变量，不许写「${prop.trim()}」——尺寸/间距属于 tokens，样式属于 kit`,
        });
      }
    }
  }

  return violations;
}

/** 新的三层文件：不许出现模式选择器、色值、!important。 */
export function auditLayerFile(rel, source) {
  const violations = [];
  const css = stripComments(source);
  const flag = (re, message) => {
    const local = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = local.exec(css)) !== null) {
      const line = css.slice(0, m.index).split("\n").length;
      violations.push({ file: rel, line, message });
    }
  };

  flag(
    DATA_MATERIAL_RE,
    "分层文件（tokens/base/kit）里不许出现 [data-material=...] —— 模式差异只能通过 tokens 的槽位进来",
  );
  flag(COLOR_LITERAL_RE, "分层文件里不许出现色值字面量 —— 颜色只能从 --aster-*（tokens）派生");
  flag(/!important\b/g, "分层文件里不许用 !important");
  return violations;
}

/** 从 src/styles.css 出发，收集所有被 @import 到的 CSS 文件。 */
export function collectImported(root) {
  const seen = new Set();
  const queue = [];
  if (!existsSync(join(root, ENTRY_REL))) return seen;
  queue.push(ENTRY_REL);
  seen.add(ENTRY_REL);
  while (queue.length > 0) {
    const rel = queue.pop();
    const css = stripComments(readText(join(root, rel)));
    const importRe = /@import\s+(?:url\()?\s*["']([^"']+)["']/g;
    let m;
    while ((m = importRe.exec(css)) !== null) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // tailwindcss 之类的裸模块名交给打包器
      const base = rel.split("/").slice(0, -1).join("/");
      const target = join(base, spec).split(sep).join("/");
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/**
 * 部件目录的规模统计：最胖的那个文件、以及直接堆在 `src/components/` 根上的文件数。
 * 报告里点名最胖文件 —— 只说"有个文件 3392 行"没用，得说清是哪个。
 */
export function componentSizeStats(root) {
  const files = listFiles(root, "src/components", [".tsx", ".ts"]).filter(
    (rel) => !/_probe|\.test\.|\.spec\./.test(rel),
  );
  const prefix = "src/components/";
  let largest = { rel: "", lines: 0 };
  let rootFiles = 0;
  for (const rel of files) {
    const lines = readText(join(root, rel)).split("\n").length;
    if (lines > largest.lines) largest = { rel, lines };
    if (!rel.slice(prefix.length).includes("/")) rootFiles += 1;
  }
  return { largest, rootFiles };
}

/** 统计所有棘轮指标。 */
export function collectCounts(root) {
  const cssFiles = ["src/styles.css", ...listFiles(root, LAYER_DIR, [".css"])].filter((rel) =>
    existsSync(join(root, rel)),
  );
  const tsxFiles = listFiles(root, "src", [".tsx", ".ts"]).filter(
    (rel) => !isModeFile(rel) && !rel.endsWith(".d.ts"),
  );

  const size = componentSizeStats(root);

  const counts = {
    colorLiterals: 0,
    materialRules: 0,
    important: 0,
    typescriptArbitraryClasses: 0,
    typescriptColorLiterals: 0,
    stylesCssLines: 0,
    largestComponentLines: size.largest.lines,
    componentsRootFiles: size.rootFiles,
  };

  for (const rel of cssFiles) {
    const css = stripComments(readText(join(root, rel)));
    if (rel === ENTRY_REL) counts.stylesCssLines = readText(join(root, rel)).split("\n").length;
    if (isModeFile(rel)) continue;
    counts.colorLiterals += countMatches(css, COLOR_LITERAL_RE);
    counts.materialRules += countMatches(css, DATA_MATERIAL_RE);
    counts.important += countMatches(css, /!important\b/g);
  }

  for (const rel of tsxFiles) {
    const text = readText(join(root, rel));
    if (/_probe|\.test\.|\.spec\./.test(rel)) continue;
    counts.typescriptArbitraryClasses += countMatches(text, TAILWIND_ARBITRARY_RE);
    counts.typescriptColorLiterals += countMatches(text, /#[0-9a-fA-F]{3,8}\b/g);
  }

  return counts;
}

export const RATCHET_META = {
  colorLiterals: { label: "色值字面量（旧 CSS）", target: 0 },
  materialRules: { label: "[data-material] 覆盖（旧 CSS）", target: 0 },
  important: { label: "!important（旧 CSS）", target: 0 },
  stylesCssLines: { label: "styles.css 行数", target: 1500 },
  typescriptArbitraryClasses: { label: "Tailwind 任意值（TSX）", target: 0 },
  typescriptColorLiterals: { label: "色值字面量（TSX）", target: 0 },
  largestComponentLines: { label: "最大部件文件行数", target: "≤400" },
  componentsRootFiles: { label: "components 根上文件数", target: 0 },
};

export function readBaseline(root) {
  const abs = join(root, BASELINE_REL);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readText(abs));
  } catch {
    return null;
  }
}

export function writeBaseline(root, counts) {
  const payload = {
    $comment:
      "样式守卫基线：这些计数只许降不许升。清掉一些旧账后运行 npm run style:guard:update 收紧基线。",
    updatedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(root, BASELINE_REL), JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

/**
 * 跑一次完整检查。
 * @returns {{ok: boolean, violations: Array, ratchet: Array, counts: object, orphans: string[]}}
 */
export function runGuard({ root = DEFAULT_ROOT, update = false } = {}) {
  const violations = [];

  // 1. 新模式文件写法
  for (const rel of listFiles(root, MODE_DIR, [".css"])) {
    violations.push(...auditModeFile(rel, readText(join(root, rel))));
  }
  const strayModeFiles = listFiles(root, MODE_DIR, [".css"])
    .map((rel) =>
      rel
        .split("/")
        .pop()
        .replace(/\.css$/, ""),
    )
    .filter((name) => !MODE_NAMES.includes(name));
  for (const name of strayModeFiles) {
    violations.push({
      file: `${MODE_DIR}/${name}.css`,
      line: 1,
      message: `只有 solid / liquid 两种材质（frost 2026-11 下线），不认识「${name}」`,
    });
  }

  /*
   * 1b. 模式之间不许串味：`modes/solid.css` 里只能出现 `[data-material="solid"]`。
   * 这是"两档互不干扰"的机械保证 —— 一旦有人在 solid 的皮肤里顺手照顾一下液态，
   * 以后改哪一档都会牵动另一档，那正是旧城长成 6090 行的方式。
   */
  for (const rel of listFiles(root, MODE_DIR, [".css"])) {
    const own = rel
      .split("/")
      .pop()
      .replace(/\.css$/, "");
    const css = stripComments(readText(join(root, rel)));
    const local = new RegExp(DATA_MATERIAL_RE.source, "g");
    let m;
    while ((m = local.exec(css)) !== null) {
      if (m[1] !== own) {
        violations.push({
          file: rel,
          line: css.slice(0, m.index).split("\n").length,
          message: `${own}.css 里出现了 [data-material="${m[1]}"] —— 每个材质只写自己那一档的变量，跨档就会互相干扰`,
        });
      }
    }
  }

  // 2. 新的分层文件写法
  for (const rel of listFiles(root, LAYER_DIR, [".css"])) {
    if (isModeFile(rel) || rel === "src/styles.css") continue;
    violations.push(...auditLayerFile(rel, readText(join(root, rel))));
  }

  // 3. 每个样式文件都必须被 src/styles.css 引到（防止写了没人用的死层）
  const imported = collectImported(root);
  const orphans = listFiles(root, LAYER_DIR, [".css"]).filter((rel) => !imported.has(rel));
  for (const rel of orphans) {
    violations.push({
      file: rel,
      line: 1,
      message: "这个样式文件没有被 src/styles.css @import 到 —— 写了不生效，要么引上，要么删掉",
    });
  }

  // 4. 棘轮
  const counts = collectCounts(root);
  const baseline = readBaseline(root);
  const ratchet = [];
  if (update) {
    writeBaseline(root, counts);
    for (const key of Object.keys(counts)) {
      ratchet.push({ key, value: counts[key], base: counts[key], ok: true, updated: true });
    }
  } else if (!baseline) {
    violations.push({
      file: BASELINE_REL,
      line: 1,
      message: "缺少基线文件，先运行 node scripts/guard-styles.mjs --update 生成一次",
    });
  } else {
    for (const key of Object.keys(counts)) {
      const base = baseline.counts?.[key];
      const value = counts[key];
      const ok = typeof base !== "number" ? true : value <= base;
      ratchet.push({ key, value, base, ok, tightened: typeof base === "number" && value < base });
      if (!ok) {
        violations.push({
          file: RATCHET_META[key]?.label ?? key,
          line: 0,
          message: `${RATCHET_META[key]?.label ?? key} 从 ${base} 涨到 ${value}（目标 ${RATCHET_META[key]?.target ?? 0}）—— 旧文件只许变小`,
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    ratchet,
    counts,
    orphans,
    largestComponent: componentSizeStats(root).largest,
    baselinePath: BASELINE_REL,
  };
}

function pad(text, width) {
  const textWidth = [...String(text)].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return String(text) + " ".repeat(Math.max(0, width - textWidth));
}

export function formatReport(result) {
  const lines = [];
  lines.push("样式守卫 · style guard");
  if (!result.ok) {
    lines.push("");
    lines.push(`✗ ${result.violations.length} 处违规：`);
    for (const v of result.violations) {
      const where = v.line ? `${v.file}:${v.line}` : v.file;
      lines.push(`  · ${where}  ${v.message}`);
    }
    lines.push("");
    lines.push("分层规则见 design/README.md（哪块出问题 → 只改那一层）。");
  } else {
    lines.push("");
    lines.push("✓ 硬规则全部通过");
  }
  if (result.ratchet.length > 0) {
    lines.push("");
    lines.push(`  ${pad("指标", 26)}${pad("当前", 8)}${pad("基线", 8)}目标`);
    for (const row of result.ratchet) {
      const meta = RATCHET_META[row.key] ?? { label: row.key, target: "-" };
      const mark = row.ok ? (row.tightened ? "↓" : " ") : "✗";
      lines.push(
        `  ${mark} ${pad(meta.label, 25)}${pad(row.value, 8)}${pad(row.base ?? "-", 8)}${meta.target}`,
      );
    }
    const tightened = result.ratchet.filter((row) => row.tightened);
    if (tightened.length > 0) {
      lines.push("");
      lines.push("  有指标下降了，收紧基线锁住战果：npm run style:guard:update");
    }
  }
  if (result.largestComponent?.rel) {
    lines.push("");
    lines.push(
      `  最胖部件：${result.largestComponent.rel}（${result.largestComponent.lines} 行）—— 只许拆小，不许再长`,
    );
  }
  return lines.join("\n");
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      [
        "用法: node scripts/guard-styles.mjs [--update] [--json] [--root <dir>]",
        "",
        "  --update  用当前计数覆盖基线（清完旧账后收紧）",
        "  --json    输出机器可读结果",
      ].join("\n"),
    );
    process.exit(0);
  }
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex >= 0 && argv[rootIndex + 1] ? resolve(argv[rootIndex + 1]) : DEFAULT_ROOT;
  try {
    const result = runGuard({ root, update: argv.includes("--update") });
    if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else console.log(formatReport(result));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error("样式守卫自身出错：", error);
    process.exit(2);
  }
}
