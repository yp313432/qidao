import { useCallback, useRef, useState } from "react";
import { buildContext } from "@/lib/awareness";
import { resolveAiName } from "@/lib/branding";
import { historyForApi, streamChat, type ApiMessage, type ChatDelta } from "@/lib/chat-client";
import { isOwnApi, QUOTA_LIMIT } from "@/lib/models";
import { actionFeedback, pickWorldEntries } from "@/lib/prompt";
import { useApp } from "@/lib/store";
import type { AppAction, Attachment, ChatMessage } from "@/lib/types";
import { resolveVoiceLang, speak } from "@/lib/voice";

/* --------------------------- 他的「动作块」协议 --------------------------- */

/**
 * 模型把「要做的动作」放在一个代码块里：
 *
 *   ```qidao
 *   {"kind":"navigate","path":"/play/listen"}
 *   ```
 *
 * ⚠️ 但**不能只认这一种写法**。用户实测报过："写动态和信不可以了，
 * 他说他执行了，但是是空的" —— 模型只是把格式写偏了一点（标记大小写、
 * 尾随逗号、中文引号、或者干脆没包代码块），旧解析器就整段丢掉，
 * 于是什么都没发生，而它自己以为做了。
 *
 * 所以这里分四层兜底：严格块 → 任意代码块 → 裸 JSON → 修一遍再试。
 */
const STRICT_BLOCK = /```[ \t]*qidao[ \t]*\r?\n?([\s\S]*?)```/gi;
/** 任意代码块（有些模型会写成 ```json 或干脆不写标记） */
const ANY_BLOCK = /```[ \t]*[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g;

/** 常见 JSON 走样修一遍（尾随逗号 / 中文引号 / 单引号 / 字符串里的裸换行） */
function repairJson(raw: string): string {
  let t = raw.trim();
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // 去掉尾随逗号
  t = t.replace(/,\s*([}\]])/g, "$1");
  // 单引号当引号用
  t = t.replace(/'([^'\\]*)'(\s*:)/g, '"$1"$2');
  t = t.replace(/:\s*'([^'\\]*)'/g, ': "$1"');
  // 字符串里的裸换行 → \n（模型经常在正文里换行）
  t = t.replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/\r?\n/g, "\\n"));
  return t;
}

/** 从一段文本里"扫出"所有看起来像动作的 JSON 对象（按括号配对，不靠正则贪心） */
function scanObjects(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    // 只看开头一小段里带 "kind" 的，避免把普通正文里的 {} 也拿来试
    const head = text.slice(i, i + 240);
    if (!/"kind"\s*:/.test(head)) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j]!;
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function collectFrom(chunk: string, out: AppAction[]) {
  const attempts = [chunk, repairJson(chunk)];
  for (const raw of attempts) {
    try {
      const parsed = JSON.parse(raw) as AppAction | AppAction[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === "object" && typeof (item as { kind?: unknown }).kind === "string") {
          out.push(item);
        }
      }
      return;
    } catch {
      /* 换下一种修法 */
    }
  }
}

/** 去掉动作块（含流式期间只收到一半的），让对话里只显示正文。 */
export function stripActions(text: string): string {
  return text
    .replace(STRICT_BLOCK, "")
    .replace(/```[ \t]*qidao[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 取出回复里的动作。四层兜底，尽量别把模型的动作丢掉。 */
export function takeActions(text: string): AppAction[] {
  const out: AppAction[] = [];

  // ① 严格的 ```qidao 块
  for (const m of text.matchAll(STRICT_BLOCK)) collectFrom((m[1] ?? "").trim(), out);
  if (out.length) return out;

  // ② 任意代码块里，只要能解析出 kind 就算
  for (const m of text.matchAll(ANY_BLOCK)) {
    const body = (m[1] ?? "").trim();
    if (!/"kind"\s*:/.test(body)) continue;
    collectFrom(body, out);
  }
  if (out.length) return out;

  // ③ 正文里直接写的裸 JSON（没包代码块）
  for (const obj of scanObjects(text)) collectFrom(obj, out);
  return out;
}

/** 他是不是"看起来想动手"（用来在解析失败时如实告诉用户，而不是装作没事） */
export function looksLikeAction(text: string): boolean {
  return /"kind"\s*:/.test(text);
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
      /** 这次流里**真的拿到过正文**吗（只有思考或只有报错都不算成功 → 会自动重试） */
      let hadContent = false;
      let hadError = false;
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
      // 他上一轮动手的结果（回执）—— 没有它他不知道自己到底做没做
      const st = useApp.getState();
      const recentActions = actionFeedback(st.actionLog, st.pendingActions.length);
      const req = {
        model,
        messages: history,
        style: settings.replyStyle,
        tools,
        customBaseUrl: settings.customBaseUrl || undefined,
        customApiKey: settings.customApiKey || undefined,
        upstreamModel: settings.upstreamModel || undefined,
        maxTokens: settings.maxTokens,
        name: settings.displayName,
        aiName,
        persona: settings.persona || undefined,
        context,
        worldAlways: world.always,
        worldHit: world.hit,
        recentActions,
        permissions: settings.permissions,
      };
      const onDelta = (d: ChatDelta) => {
        if (d.error) {
          hadError = true;
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
          hadContent = true;
          content += d.content;
          schedule();
        }
      };

      /**
       * 断线自动重试（最多两次）。
       *
       * 实测：思考链很长时，经过代理的流式连接容易被中途掐断，
       * 结果是一条**只有思考、没有正文**的空回复（用户报过两次）。
       * 与其让他手动点「重新生成」，不如自己再试一遍 ——
       * 重试时把上一次的思考和错误文本都丢掉，免得两次内容混在一起。
       */
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        hadContent = false;
        hadError = false;
        try {
          await streamChat(req, onDelta, ac.signal);
          lastErr = null;
        } catch (err) {
          lastErr = err;
        }
        if (ac.signal.aborted) break;
        // 判定标准是"**真的拿到了正文**"：只有思考、或者只是一个错误提示，
        // 都不算成功 —— 那种情况值得自动再来一次。
        if (hadContent) break;
        if (attempt === 2) break;
        content = "";
        thinking = "";
        usage = undefined;
        dirty = true;
        flush();
        await new Promise((r) => window.setTimeout(r, 350));
      }
      if (!hadContent && (lastErr || hadError) && (lastErr as { name?: string } | null)?.name !== "AbortError") {
        content =
          "没拿到正文。可能是：连接被掐断（思考链太长时容易这样），地址/密钥不对，或者网络不通。\n\n" +
          "已经自动重试过一次了。可以再点「重新生成」，或者跟他说「想短一点、先给结论」。";
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
      /**
       * 他说要动手、却一个动作都没解析出来 —— **如实告诉他**。
       * 用户实测报过："写动态和信不可以了，他说他执行了，但是是空的"：
       * 模型以为做了、用户那边什么都没发生，两边对不上。
       */
      if (actions.length === 0 && looksLikeAction(content)) {
        content +=
          "\n\n（他写了个动作，但格式我没看懂，所以没执行 —— 可以点「重新生成」，或者直接跟我说要做什么。）";
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
