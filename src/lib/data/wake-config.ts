/**
 * **唤醒用的上游配置** —— 抽屉（派生缓存）的写入口径（D8，用户 2026-10 提出）。
 *
 * 用户原话："自动唤醒我不是说他还在正常发消息吗，但我都没接 api 了，那以后我要换其他家的 api，
 * 唤醒的 ai 不还是现在设置的这个 ds 吗……万一以后我不往这里充钱了，改用其他的，
 * 那定时唤醒不就白做了吗，用不了了。"
 *
 * ── 已核实的两个问题（见 `qidao-docs/数据架构-①设计.md` D8）──────────
 *   W1：`syncWakeContext()` 在"设置里没有上游"时**直接跳过推送** →
 *       抽屉里那份旧配置**永远留着** → 后台照旧按旧那家发（用户遇到的就是这个）
 *   W2：`public/runners/wake.js` 自己拼 `baseUrl + "/chat/completions"` + `Bearer` →
 *       跟前台是**两套写法** → 换家上游可能"前台能用、唤醒不能用"
 *
 * ── 这个文件干两件事（都是纯函数，可单测）────────────────────────
 *   ① `wakeConfigPayload()`：**永远返回一份完整载荷** —— 没配上游时就是
 *      "空值 + enabled=0"（这就是修 W1：清空也要推）
 *   ② `upstreamFingerprint()`：给"复印件"打指纹，前台据此判断
 *      "抽屉里那份还是不是当前这家"
 */
import { checksum } from "./schema";

/** 抽屉里的键：指纹 + 同步时间 + "怎么问这家上游"（修 W2 的第一步） */
export const WAKE_META_KEYS = {
  fingerprint: "cfg_fingerprint",
  syncedAt: "cfg_synced_at",
  chatPath: "cfg_chat_path",
  authStyle: "cfg_auth_style",
} as const;

/** 鉴权方式：现在只有这三种（换家上游时前台决定用哪种） */
export type AuthStyle = "bearer" | "x-api-key" | "none";

/**
 * 上游指纹：`地址|模型|密钥` 的哈希。
 *
 * ⚠️ 只存哈希**不存原文** —— 它只是"是不是同一家"的比对标记，不该让别人从抽屉里读出密钥。
 */
export function upstreamFingerprint(baseUrl: string, model: string, apiKey: string): string {
  return checksum(`${(baseUrl ?? "").trim().replace(/\/+$/, "")}|${(model ?? "").trim()}|${(apiKey ?? "").trim()}`);
}

export type WakeConfigInput = {
  /** 设置里的自定义上游（唯一真源） */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 上游是不是 OpenAI 兼容（决定默认路径/鉴权；以后支持别家时由前台判定） */
  openAiCompatible?: boolean;
  /** 其它已经准备好的键（人格/闸门/心情/两段指令…）——原样合并，不做删减 */
  rest: Record<string, string>;
  now?: number;
};

/**
 * 组一份**完整的**抽屉载荷。
 *
 * 关键：`baseUrl` / `apiKey` / `model` 缺任何一项 → 上游相关的键**写成空串**、
 * `enabled` 写 `"0"`、指纹写空 —— 这样后台醒来会看到"没配置、别说话"，
 * 而不是继续用一份旧配置（W1 的修法）。
 */
/**
 * **上游到底能不能用** —— 全项目只认这一处（2026-10 用户点名要求）。
 *
 * 用户原话："记得和上游统一，不要出现我没填 api 还能做事这样的。"
 * 所以：地址 / key / 模型**三样齐**才算能用；不齐时：
 *   · 后台唤醒那条：`cfg_enabled = "0"`（运行器直接不动，不装样子）
 *   · 「他自己的日子」（自由活动/日记/回响）：**根本不排任务**（见 `wake-plan.tsx`）
 */
export function upstreamComplete(input: { baseUrl?: string; apiKey?: string; model?: string }): boolean {
  return Boolean(
    (input.baseUrl ?? "").trim() && (input.apiKey ?? "").trim() && (input.model ?? "").trim(),
  );
}

export function wakeConfigPayload(input: WakeConfigInput): Record<string, string> {
  const baseUrl = (input.baseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = (input.apiKey ?? "").trim();
  const model = (input.model ?? "").trim();
  const complete = upstreamComplete({ baseUrl, apiKey, model });

  const payload: Record<string, string> = { ...input.rest };
  payload.cfg_base_url = complete ? baseUrl : "";
  payload.cfg_api_key = complete ? apiKey : "";
  payload.cfg_model = complete ? model : "";
  payload[WAKE_META_KEYS.chatPath] = input.openAiCompatible === false ? "" : "/chat/completions";
  payload[WAKE_META_KEYS.authStyle] = "bearer" satisfies AuthStyle;
  payload[WAKE_META_KEYS.fingerprint] = complete ? upstreamFingerprint(baseUrl, model, apiKey) : "";
  payload[WAKE_META_KEYS.syncedAt] = String(input.now ?? Date.now());
  /** 上游不全 → 顺手把唤醒关掉（后台按这个数字判断，不会自己乱发） */
  payload.cfg_enabled = complete ? (payload.cfg_enabled === "0" ? "0" : "1") : "0";
  return payload;
}

export type WakeDrawerCheck = { ok: true } | { ok: false; why: string };

/**
 * 后台醒来时的**前置自检**（`public/runners/wake.js` 里有一份等价的实现，
 * 因为 runner 是独立 JS，不能 import 这个 TS 文件；两边规则必须一致，
 * `verify-data-layer.mjs` 会盯着）。
 *
 * 判据（宁可不说，也不能拿一份来路不明的旧配置乱说）：
 *   1. `enabled !== "1"` → 别说话（静默，用户主动关的）
 *   2. 有指纹 **且** 地址/密钥/模型都不空 → 可以说
 *   3. 否则 → **不说**，改为提示"打开一次栖岛同步配置"
 */
export function checkWakeDrawer(drawer: Record<string, string> | null | undefined): WakeDrawerCheck {
  const d = drawer ?? {};
  if (d.cfg_enabled !== "1") return { ok: false, why: "唤醒本来是关的" };
  const fp = (d[WAKE_META_KEYS.fingerprint] ?? "").trim();
  const complete = Boolean((d.cfg_base_url ?? "").trim() && (d.cfg_api_key ?? "").trim() && (d.cfg_model ?? "").trim());
  if (!complete) return { ok: false, why: "抽屉里没有完整的上游配置" };
  if (!fp) return { ok: false, why: "抽屉里的配置没有 fingerprint（旧版写的，无法确认跟 App 设置一致）" };
  const expect = upstreamFingerprint(d.cfg_base_url ?? "", d.cfg_model ?? "", d.cfg_api_key ?? "");
  if (expect !== fp) return { ok: false, why: "抽屉里的配置自身对不上（写入时被截断过）" };
  return { ok: true };
}

/** 抽屉里的指纹跟"当前设置"对不对得上（前台用来决定要不要重推） */
export function needsRepush(
  drawer: Record<string, string> | null | undefined,
  input: { baseUrl: string; apiKey: string; model: string },
): boolean {
  const d = drawer ?? {};
  const want = upstreamFingerprint(input.baseUrl, input.model, input.apiKey);
  const have = (d[WAKE_META_KEYS.fingerprint] ?? "").trim();
  return want !== have;
}
