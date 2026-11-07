/**
 * **认"别人的工具调用"** —— 把漏在正文里的原生 tool-call JSON 收回来、并从正文里抹掉。
 *
 * 为什么存在（2026-11-07 用户 m05479："接 Gemini 还是会出现这种情况"）：
 * 实机截图里气泡正文变成了
 *   `[{"name":"default_api:emotion_report","arguments":{"confidence":"0.95",…}}]`
 * —— 那是 **Gemini 自己那套 functionCall 的 JSON 形态**，不是我们的 `qidao` 动作块，
 * 所以 `takeActions()` 认不出来（它只认 `"kind"`）、`stripActions()` 也砍不掉
 * （`ACTION_FIELDS` 里没有 `name`/`arguments`），于是原样漏给用户看。
 *
 * 三条判据（都不猜、只认结构）：
 *   1. 一个 JSON 数组/对象，元素里**同时**有 `name` 和 `arguments`（或 `parameters`）字段；
 *   2. `name` 能换成我们的动作 kind（`default_api:emotion_report` → `emotion_report` → `emotion.report`）；
 *   3. 换不出来的（比如 `default_api:web_search` 这种外部工具）也算"该抹掉"，
 *      只是没法执行 —— 由调用方决定要不要如实告诉用户。
 *
 * ⚠️ 这个模块要能在纯 node 里跑（`foreign-calls.test.ts` 直接 `--experimental-strip-types`），
 * 所以只 import 纯类型/纯常量（`action-schema` 里没有 DOM 依赖）。
 */
/**
 * 用**相对路径 + 显式 `.ts`**（跟 `lib/manual.ts` 一样）：这样 `foreign-calls.test.ts`
 * 能被 `node --experimental-strip-types` 直接跑 —— 裸 node 不认识 `@/…` 别名。
 * 旁边 `action-schema.ts` 只 import 类型，strip-types 会把那行擦掉，不会连带炸。
 */
import { ACTION_KIND_BY_TOOL_NAME } from "./action-schema.ts";

/** 可能是工具调用的一段 JSON（名字已尽量换成我们的 kind） */
export type ForeignCall = {
  /** 原文里的名字（`default_api:emotion_report`）—— 诊断/兜底提示用 */
  raw: string;
  /** 换成我们的动作 kind（能换才给） */
  kind: string | null;
  /** 已经规整成 JSON 文本的参数（可以空串 = 无参） */
  args: string;
};

export type ForeignScan = {
  calls: ForeignCall[];
  /** 抹掉这些 JSON 之后的正文（其余文字一个字不动） */
  text: string;
};

/** 我们的全部 kind（`memory.add` / `web.search` …）—— 有的中转直接给原样的 kind */
const KIND_SET = new Set<string>(Object.values(ACTION_KIND_BY_TOOL_NAME));

/**
 * 把"别人的工具名"换成我们的 kind。
 *
 * 见过的四种写法：
 *   · `emotion_report` —— OpenAI 兼容（我们把 `emotion.report` 压成下划线）
 *   · `default_api:emotion_report` —— Gemini / 某些中转前缀了函数命名空间
 *   · `emotion.report` —— 有的中转直接给 original 名字
 *   · `functions.garden.walk` —— 有些 SDK 用 `.` 当命名空间分隔
 */
export function toActionKind(raw: string): string | null {
  const name = String(raw ?? "").trim();
  if (!name) return null;
  /** 候选顺序：原样 → 去掉 `ns:` 前缀 → 去掉 `ns.` 前缀 → 下划线换点 → 小写 */
  const bare = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
  const dash = bare.includes("/") ? bare.slice(bare.lastIndexOf("/") + 1) : bare;
  /** `functions.garden.walk` → 逐段前缀剥掉，直到命中 */
  const peels: string[] = [];
  let rest = dash;
  for (let i = 0; i < 3 && rest.includes("."); i += 1) {
    rest = rest.slice(rest.indexOf(".") + 1);
    peels.push(rest);
  }
  const candidates = [
    name,
    bare,
    dash,
    ...peels,
    dash.replace(/_/g, "."),
    name.replace(/_/g, "."),
    dash.toLowerCase(),
    dash.replace(/_/g, ".").toLowerCase(),
  ];
  for (const c of candidates) {
    if (!c) continue;
    /** ① 已经是我们的 kind（`memory.add`） */
    if (KIND_SET.has(c)) return c;
    /** ② 是我们的工具名（`memory_add`） */
    const kind = ACTION_KIND_BY_TOOL_NAME[c];
    if (kind) return kind;
  }
  return null;
}

/** 参数可能被上游"字符串化"（Gemini 特别爱把嵌套对象变成 `"{\"a\":1}"`），这里拆一层 */
function normalizeArgs(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed && typeof parsed === "object") return JSON.stringify(parsed);
    } catch {
      /* 不是 JSON 字符串，原样当空参 */
    }
    return "";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    /** 逐字段再拆一层字符串化（`dimensions: "{\"attraction\":0.9}"`） */
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && /^\s*[[{]/.test(v)) {
        try {
          out[k] = JSON.parse(v);
          continue;
        } catch {
          /* 保持原样 */
        }
      }
      out[k] = v;
    }
    return JSON.stringify(out);
  }
  return "";
}

/** 一个 JSON 值对象算不算"工具调用"（有 name + 参数容器） */
function asCall(value: unknown): { raw: string; args: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  /** Gemini 另一种形态：`{functionCall:{name,args}}` */
  const fnCall = (o.functionCall ?? o.function_call) as Record<string, unknown> | undefined;
  if (fnCall && typeof fnCall === "object") {
    const name = String((fnCall.name ?? "") as string).trim();
    if (name) return { raw: name, args: normalizeArgs(fnCall.args ?? fnCall.arguments) };
  }
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;
  const hasArgsKey = "arguments" in o || "args" in o || "parameters" in o || "input" in o;
  if (!hasArgsKey) return null;
  const args = normalizeArgs(o.arguments ?? o.args ?? o.parameters ?? o.input);
  return { raw: name, args };
}

/**
 * 从 `start`（指向 `[` 或 `{`）开始配平到对应的收尾括号，返回收尾下标；配不平返回 -1。
 * 只处理引号转义，够看懂 LLM 输出的 JSON（不需要完整 JS 词法器）。
 */
function matchBracket(text: string, start: number): number {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 扫正文，把工具调用 JSON 摘出来，并给出"抹掉它们之后"的正文。
 *
 * 只处理**能配平**的 JSON：流式截断留下的半截片段不在这儿处理（那条路径已经被
 * `stripActionLines()` 的尾巴规则兜住），这里宁可少删也别把正文切坏。
 */
export function scanForeignCalls(text: string): ForeignScan {
  const src = typeof text === "string" ? text : "";
  if (!/"name"\s*:/.test(src) && !/"functionCall"/.test(src) && !/"function_call"/.test(src)) {
    return { calls: [], text: src };
  }

  const calls: ForeignCall[] = [];
  /** 要删掉的区间（最后统一按倒序删，下标不会漂） */
  const cuts: { from: number; to: number }[] = [];

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch !== "[" && ch !== "{") continue;
    /** 便宜的前置过滤：紧跟着的 200 字里没有 `"name"` 就别费劲配平 */
    if (
      !/"name"\s*:/.test(src.slice(i, i + 200)) &&
      !/"functionCall"/.test(src.slice(i, i + 200))
    ) {
      continue;
    }
    const end = matchBracket(src, i);
    if (end < 0) {
      /**
       * 配不平 = 正在流式到达（或者被步数上限截断）。
       * 这时**从开头一路砍到结尾**：用户在流式过程中看到"半截 JSON 慢慢长出来"最伤，
       * 宁可先藏起来，等它配平了再由上面的逻辑判断是不是真调用。
       * 判据刻意收窄（同一段里既要有 `"name"` 又要有参数键），别误伤正常正文里的 JSON 示例。
       */
      const ahead = src.slice(i, i + 240);
      const looksLikeCall =
        /"name"\s*:/.test(ahead) && /"(?:arguments|args|parameters|functionCall)"\s*:/.test(ahead);
      if (looksLikeCall) {
        cuts.push({ from: i, to: src.length });
        break;
      }
      continue;
    }
    const chunk = src.slice(i, end + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      continue;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const found: { raw: string; args: string }[] = [];
    for (const item of items) {
      const c = asCall(item);
      if (c) found.push(c);
    }
    if (found.length === 0) continue;
    for (const c of found) calls.push({ ...c, kind: toActionKind(c.raw) });
    cuts.push({ from: i, to: end + 1 });
    i = end; // 跳过这一段，避免同一坨被重复解析
  }

  let out = src;
  for (const cut of cuts.reverse()) out = out.slice(0, cut.from) + out.slice(cut.to);
  /** 只剩空白的行、三连空行都收一下（别在气泡里留一片空洞） */
  out = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { calls, text: out };
}

/** 只要"抹干净后的正文"（显示层用） */
export function stripForeignCalls(text: string): string {
  return scanForeignCalls(text).text;
}
