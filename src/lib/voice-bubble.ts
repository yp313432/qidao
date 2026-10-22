/**
 * 语音气泡（用户 m11285 / m11313：像微信那样发语音、他也能用语音回）。
 *
 * 设计上的几件事，写在这里免得以后又踩：
 *
 *   1. **附件早就支持 audio** —— `Attachment.kind` 里一直有 `"audio"` + `durationMs`，
 *      `VoiceBubble` 也早就能播。所以这里不是新造通道，只是"把合成结果留下来存进消息里"。
 *   2. **什么时候他用语音回** 由 `settings.voiceBubbleReply` 决定：
 *      `whenVoice`（默认）= 你先发了语音他才用语音回（像微信对讲，省）；
 *      `always` = 每条都语音；`off` = 只发文字。
 *   3. **只留最近 200 条音频**（用户 m11313 定的数）。再往前的只留时长/名字，
 *      点播放会看到"音频已经清掉了"——否则 IndexedDB 会被几十 MB 的音频撑爆。
 */
import { useApp } from "@/lib/store";
import { synthesizeVoiceBubble } from "@/lib/tts";
import type { Attachment, ChatMessage } from "@/lib/types";

/** 本地最多保留多少条语音的**音频数据**（不含时长/名字这些元信息） */
export const VOICE_KEEP = 200;

export type VoiceReplyMode = "off" | "whenVoice" | "always";

export function isVoiceAttachment(a: Attachment): boolean {
  return a.kind === "audio";
}

/** 最近一条"我"发的消息里有没有语音 */
export function lastUserWasVoice(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    return (m.attachments ?? []).some((a) => isVoiceAttachment(a) && !!a.dataUrl);
  }
  return false;
}

export function voiceReplyMode(): VoiceReplyMode {
  const mode = useApp.getState().settings.voiceBubbleReply;
  if (mode === "off" || mode === "always") return mode;
  return "whenVoice";
}

/** 这一轮该不该用语音气泡回 */
export function shouldVoiceReply(messages: ChatMessage[]): boolean {
  const mode = voiceReplyMode();
  if (mode === "off") return false;
  if (mode === "always") return true;
  return lastUserWasVoice(messages);
}

/**
 * 合成一段语音附件（失败返回 null，并带上原因由调用方记日志）。
 */
export async function buildVoiceAttachment(text: string): Promise<Attachment | null> {
  const out = await synthesizeVoiceBubble(text);
  if (!out.ok) return null;
  const secs = Math.max(1, Math.round(out.durationMs / 1000));
  return {
    id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "audio",
    name: `语音 ${secs}秒`,
    mime: "audio/mpeg",
    size: Math.round((out.dataUrl.length * 3) / 4),
    dataUrl: out.dataUrl,
    durationMs: out.durationMs,
    // 气泡下面那行转写（也是长按「转成文字」时直接显示的东西）
    text,
  };
}

/**
 * 清掉太老的语音**音频数据**（保留时长与名字，气泡还在、点播会说清掉了）。
 *
 * 返回清掉的条数。只在"消息变多"的时机跑一次，别放进渲染路径。
 */
export function sweepVoiceAudio(keep = VOICE_KEEP): number {
  const st = useApp.getState();
  const rows: { at: number; msgId: string; attId: string }[] = [];
  for (const c of st.conversations) {
    for (const m of c.messages) {
      for (const a of m.attachments ?? []) {
        if (a.kind === "audio" && a.dataUrl) {
          rows.push({ at: m.createdAt || c.updatedAt || 0, msgId: m.id, attId: a.id });
        }
      }
    }
  }
  if (rows.length <= keep) return 0;
  rows.sort((x, y) => y.at - x.at);
  const drop = new Set(rows.slice(keep).map((r) => `${r.msgId}:${r.attId}`));
  useApp.setState((s) => ({
    conversations: s.conversations.map((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        const atts = m.attachments ?? [];
        if (!atts.some((a) => drop.has(`${m.id}:${a.id}`))) return m;
        return {
          ...m,
          attachments: atts.map((a) =>
            drop.has(`${m.id}:${a.id}`) ? { ...a, dataUrl: undefined } : a,
          ),
        };
      }),
    })),
  }));
  return drop.size;
}
