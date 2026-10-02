import { useCallback, useRef, useState } from "react";
import { buildContext } from "@/lib/awareness";
import { resolveAiName } from "@/lib/branding";
import { historyForApi, streamChat, type ApiMessage } from "@/lib/chat-client";
import { isOwnApi, QUOTA_LIMIT } from "@/lib/models";
import { pickWorldEntries } from "@/lib/prompt";
import { useApp } from "@/lib/store";
import type { AppAction, Attachment, ChatMessage } from "@/lib/types";
import { resolveVoiceLang, speak } from "@/lib/voice";

/* --------------------------- 他的「动作块」协议 --------------------------- */

/**
 * 模型把「要做的动作」放在一个语言标记为 qidao 的代码块里：
 *
 *   ```qidao
 *   {"kind":"navigate","path":"/play/listen"}
 *   ```
 *
 * 为什么要这样接：栖岛的动作执行（actions.ts）、权限门（ACTION_PERMISSION）、
 * 动作记录（actionLog）早就写好了，唯独「让模型发起动作」这条线没接 ——
 * 于是他只能说"系统未配置额外工具"。这里把线接上。
 */
const ACTION_BLOCK = /```qidao\s*([\s\S]*?)```/g;

/** 去掉动作块（含流式期间只收到一半的），让对话里只显示正文。 */
export function stripActions(text: string): string {
  return text
    .replace(ACTION_BLOCK, "")
    .replace(/```qidao[\s\S]*$/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 取出回复里的动作（一个块里可以是单个对象，也可以是数组）。 */
export function takeActions(text: string): AppAction[] {
  const out: AppAction[] = [];
  for (const m of text.matchAll(ACTION_BLOCK)) {
    try {
      const parsed = JSON.parse((m[1] ?? "").trim()) as AppAction | AppAction[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === "object" && typeof (item as { kind?: unknown }).kind === "string") {
          out.push(item);
        }
      }
    } catch {
      /* 坏块就跳过，别因为一个格式错误把整条回复毁掉 */
    }
  }
  return out;
}


/**
 * 对话发送逻辑（对话页与语音页共用）。
 *
 * 从 chat-view 里抽出来的原因很直接：语音模式改成独立页面之后，
 * 它也要能「发一条、等回复、念出来」，这两页必须走同一套逻辑，
 * 否则预算控制、用量统计、权限感知很快会两套走偏。
 */

function notifyQuota(aiName: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(`${aiName}额度提醒`, { body: "本窗口额度即将用尽。" });
    } else if (Notification.permission !== "denied") {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

export function useChatStream() {
  const settings = useApp((s) => s.settings);
  const model = useApp((s) => s.model);
  const aiName = resolveAiName(settings.aiName);
  const [busy, setBusy] = useState(false);
  const [liveId, setLiveId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const histOpts = {
    budget: settings.contextBudget,
    keepRecent: settings.keepRecent,
    autoCompact: settings.autoCompact,
    compactAt: settings.compactAt,
  };

  /** 把一段历史丢给模型，边流边写回指定的那一条助手消息。 */
  const runStream = useCallback(
    async (conversationId: string, messageId: string, history: ApiMessage[]) => {
      setBusy(true);
      setLiveId(messageId);
      const started = Date.now();
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      let thinking = "";
      let content = "";
      let usage: ChatMessage["usage"];
      let meta: { promptHash?: string; systemTokens?: number; model?: string } | undefined;

      /**
       * 流式写入**节流**。
       *
       * 原来模型每吐一个字就 patchMessage 一次 —— 而这一页是整块毛玻璃，
       * 于是每吐一个字就把整页重绘一遍。手机上表现就是"卡死、像重启了一样"。
       * 改成攒起来，最多每 100ms 写一次；结束时补最后一次。
       */
      let flushTimer = 0;
      let dirty = false;
      const flush = () => {
        if (flushTimer) {
          window.clearTimeout(flushTimer);
          flushTimer = 0;
        }
        if (!dirty) return;
        dirty = false;
        // 写进消息里的是**去掉动作块**的正文 —— 否则那截 JSON 会一直显示在对话里
        useApp.getState().patchMessage(conversationId, messageId, {
          content: stripActions(content),
          thinking,
        });
      };
      const schedule = () => {
        dirty = true;
        if (!flushTimer) flushTimer = window.setTimeout(flush, 100);
      };

      const tools = useApp.getState().enabledTools().map((t) => ({ name: t.name, tools: t.tools }));
      const context = buildContext();
      // 世界书：常驻的进系统提示词，命中关键词的挂在最后一条用户消息尾部。
      // 这里没有直接的 text 变量，就从历史里找最后一条用户消息来判断关键词。
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const world = pickWorldEntries(
        useApp.getState().worldBook,
        typeof lastUser?.content === "string" ? lastUser.content : "",
      );
      try {
        await streamChat(
          {
            model,
            messages: history,
            style: settings.replyStyle,
            tools,
            customBaseUrl: settings.customBaseUrl || undefined,
            customApiKey: settings.customApiKey || undefined,
            upstreamModel: settings.upstreamModel || undefined,
            name: settings.displayName,
            aiName,
            persona: settings.persona || undefined,
            context,
            worldAlways: world.always,
            worldHit: world.hit,
            permissions: settings.permissions,
          },
          (d) => {
            if (d.error) {
              content = content || d.error;
              schedule();
              flush();
              return;
            }
            if (d.meta) meta = d.meta;
            if (d.usage) usage = d.usage;
            if (d.thinking) {
              thinking += d.thinking;
              schedule();
            }
            if (d.content) {
              content += d.content;
              schedule();
            }
          },
          ac.signal,
        );
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          content =
            content ||
            "没拿到回复。可能原因：还没接入 AI 后端、地址或密钥不对、或者网络不通。接上之后这里就会有内容。";
        }
      }
      // 收尾：把最后攒着的那一点写进去，并停掉定时器
      if (flushTimer) {
        window.clearTimeout(flushTimer);
        flushTimer = 0;
      }
      dirty = true;
      flush();

      // 「他真的动手」这一步：解析回复里的 qidao 动作块并执行。
      // 权限、确认弹窗、动作记录都由 store 那一侧负责（没授权的会被拦下来问用户）。
      const actions = takeActions(content);
      for (const action of actions) {
        useApp.getState().requestAction(action, "AI");
      }

      useApp.getState().finalizeAssistant(conversationId, messageId, {
        content:
          stripActions(content) ||
          // 空的正文分两种：一种是他真的没说话，一种是**被掐断了**。
          // 后者如果显示成"（空回复）"，用户只会以为坏了 —— 得说清是什么情况。
          (thinking.trim().length > 0
            ? "他想了很久，正文却一个字都没写出来 —— 多半是连接被中途掐断了（思考链越长，经过代理时越容易被掐）。\n\n可以试试：下面的「重新生成」，或者直接跟他说「想短一点、先给结论」。"
            : "（空回复）"),
        thinking,
        thinkingDurationMs: Date.now() - started,
        usage,
      });
      if (meta) {
        useApp.getState().logRequest({
          promptHash: meta.promptHash ?? "",
          systemTokens: meta.systemTokens ?? 0,
          model: meta.model ?? model,
          prompt: usage?.prompt,
          completion: usage?.completion,
          cached: usage?.cached,
        });
      }
      // 「本机计数快满了」只在**走服务端**时提醒（那时花的才是服务端那把 key）；
      // 自己带 key 的用户不该被打扰 —— 他花自己的钱，本机不限制。
      if (!isOwnApi(settings) && settings.notifications && settings.quotaAlerts) {
        const q = useApp.getState().quota;
        if (q.used / QUOTA_LIMIT >= 0.9) notifyQuota(aiName);
      }
      if (settings.voiceReplies && content) {
        speak(content, { lang: resolveVoiceLang(settings.voiceLang) });
      }
      setBusy(false);
      setLiveId(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, aiName, settings],
  );

  const send = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      /**
       * 按模式决定拦不拦（bumpQuota 里判断）：
       *   自己带 key → 永远返回 true（花你的钱，本机不管）✅
       *   走服务端   → 超了窗口上限才返回 false ✅
       */
      const ok = useApp.getState().bumpQuota();
      if (!ok) {
        window.alert(
          "本窗口额度用尽了（你现在走的是内置服务端，花的是服务端那把 key）。\n" +
            "想不受限：去「我的 → 自定义上游」填你自己的地址和密钥。",
        );
        return;
      }
      const { conversationId, assistant, user } = useApp
        .getState()
        .addUserMessage(text, attachments);
      const prior = useApp.getState().conversations.find((c) => c.id === conversationId);
      const history = historyForApi(
        prior?.messages.filter((m) => m.id !== assistant.id) ?? [user],
        histOpts,
      );
      await runStream(conversationId, assistant.id, history);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStream, settings],
  );

  /** 重新生成某一条助手回复：保留它之前的历史，清空本条再跑一次。 */
  const regenerate = useCallback(
    async (messageId: string) => {
      const st = useApp.getState();
      const conversationId = st.activeId;
      if (!conversationId) return;
      const target = st.conversations.find((c) => c.id === conversationId);
      if (!target) return;
      const idx = target.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      st.patchMessage(conversationId, messageId, {
        content: "",
        thinking: "",
        thinkingDurationMs: 0,
        feedback: undefined,
      });
      await runStream(conversationId, messageId, historyForApi(target.messages.slice(0, idx), histOpts));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStream, settings],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { busy, liveId, send, regenerate, stop, aiName };
}
