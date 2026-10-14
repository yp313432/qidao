import { toggleAmbience } from "@/lib/ambience";
import { resolveAiName } from "@/lib/branding";
import { buildEmotionReport } from "@/lib/emotion-lexicon";
import { buildHttpRequest } from "@/lib/http-tools";
import { emotionLexiconSection } from "@/lib/manual";
import { callTool } from "@/lib/mcp";
import { usePlayer } from "@/lib/player";
import { pickStickerByGroup, stickerGroupList } from "@/lib/stickers";
import { useApp } from "@/lib/store";
import { countdown } from "@/lib/days";
import { guessKind } from "@/lib/memory";
import { cancelNative } from "@/lib/notify";
import { runSenseAction } from "@/lib/sense";
import { speakTextAsync } from "@/lib/tts";
import { runWebAction } from "@/lib/web-actions";
import type { AppAction, FeatureId, McpOAuth, Memory, Moment, ScheduledTask, Settings } from "@/lib/types";

/**
 * 动作执行器 —— 所有 AI 请求的动作最终都在**前端**这里落地。
 *
 * 也就是说：模型只能「提议」，真正动手的是这个文件，
 * 而它只在用户批准（或该项权限已设为「允许」）之后才会被调用。
 */

/**
 * 每条动态他最多评论几条 —— **用户定的上限**（仿微信朋友圈，别在我的动态下刷屏）。
 * 超了就如实拒绝（`moment.comment` 那个 case 里），不静默丢掉。
 */
const MOMENT_AI_COMMENT_LIMIT = 3;

export type ActionContext = { navigate: (path: string) => void };

/** 播放器相关动作的公共前置检查。 */
function player() {
  const p = usePlayer.getState();
  if (p.tracks.length === 0) return { p, error: "音乐库是空的（先去「玩乐 → 本地音乐」加歌）" };
  if (!p.currentId) return { p, error: "还没有选中的曲目" };
  return { p, error: "" };
}

/** 执行一个动作，返回一句给人看的结果说明。 */
export async function runAction(action: AppAction, ctx: ActionContext): Promise<string> {
  /**
   * 模型偶尔会把字段漏写、写错名（比如给「写信」用了「动态」的 text 字段）。
   * 直接 .trim() 会当场抛错，把整条动作链弄崩 —— 所以统一从这里取值。
   */
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  /**
   * 按**内容片段**找一条。
   *
   * 模型不知道内部 id，所以改/删都用文字匹配；没给条件时取最近一条
   * （列表基本是新的在前）。找不到就返回 null —— 调用方必须如实说"没找到"。
   */
  const findByText = <T extends { id: string }>(
    list: T[],
    q: string,
    get: (x: T) => string,
    newestFirst = false,
  ): T | null => {
    if (list.length === 0) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return (newestFirst ? list[0] : list[list.length - 1]) ?? null;
    return list.find((x) => get(x).toLowerCase().includes(needle)) ?? null;
  };

  /** 字符串 id → 稳定的正整数（原生通知/闹钟只认数字），跟 reminder-daemon 里那套一致 */
  const hashId = (s: string): number => {
    let h = 7;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 2147483000;
    return h || 1;
  };

  /**
   * 找一条动态（评论 / 点赞共用这**一处**定位逻辑）。
   *
   * 给了 momentId 就按 id 找；没给 = **最新一条**（多半是他刚发的那条）。
   * ⚠️ 模型不知道 id，id 由「此刻的情况」里那份动态清单提供 ——
   * 找不到时如实说清，别默默换个目标（那种"装作做到了"用户最烦）。
   */
  const findMoment = (id: string): { moment: Moment } | { error: string } => {
    const list = useApp.getState().moments;
    if (list.length === 0) return { error: "朋友圈里还没有动态" };
    if (!id) return { moment: list[0]! };
    const hit = list.find((m) => m.id === id);
    if (!hit) {
      return { error: `没找到 id 是「${id}」的动态 —— 用「此刻的情况」里那份动态清单上的 id。` };
    }
    return { moment: hit };
  };

  /**
   * 他评论 / 点赞**我的**动态时弹一条系统通知（用户定的：不然我不知道他回了）。
   *
   * 只对"我发的"那条弹 —— 他自己动态下面自己玩，不值得打扰我。
   * 通知这条链路**一律不许影响动作本身**：网页版没授权、App 里被拒，
   * 都只是没弹出来，动态该落的库照落（所以 notifyMoment 自己吞掉所有异常）。
   */
  const notifyMoment = async (kind: "comment" | "like" | "post", text: string): Promise<void> => {
    const aiName = resolveAiName(useApp.getState().settings.aiName);
    const body =
      kind === "like"
        ? "给你的动态点了个赞"
        : kind === "post"
          ? `发了一条动态：${text.slice(0, 30)}`
          : `在你的动态下评论：${text.slice(0, 40)}`;
    try {
      const { localNotify } = await import("@/lib/notify");
      await localNotify(aiName, body);
    } catch {
      /* 通知没弹出来不该影响这条动作 */
    }
  };

  const st = useApp.getState();
  switch (action.kind) {
    case "navigate":
      ctx.navigate(action.path);
      return `已切换到 ${action.path}`;

    case "media.play": {
      const { p, error } = player();
      if (error) return error;
      p.play();
      return "已开始播放";
    }
    case "media.pause": {
      const { p, error } = player();
      if (error) return error;
      p.pause();
      return "已暂停";
    }
    case "media.next": {
      const { p, error } = player();
      if (error) return error;
      p.step(1);
      return "已切到下一首";
    }
    case "media.prev": {
      const { p, error } = player();
      if (error) return error;
      p.step(-1);
      return "已切到上一首";
    }
    case "media.volume": {
      const { p, error } = player();
      if (error) return error;
      p.setVolume(action.value);
      return `音量已调到 ${Math.round(action.value * 100)}%`;
    }
    case "media.seek": {
      const { p, error } = player();
      if (error) return error;
      p.seek(action.seconds);
      return "已跳到指定位置";
    }
    case "media.playEmbed": {
      /**
       * 从用户已经加过的外链里挑一条开始播。
       *
       * 为什么只有这一步：外链是网易云/QQ/YouTube 自己的 iframe，
       * 同源限制下**碰不到它内部** —— 不能暂停、切歌、调音量。
       * 但"挑哪一条开始播"是我们能做的，之前连这个动作都没有，
       * 所以他说"外链音乐控制不了 / 是空的"（用户实测反馈）。
       */
      const q = str((action as { query?: unknown }).query).trim().toLowerCase();
      const list = useApp.getState().musicEmbeds;
      if (list.length === 0) {
        return "还没有加过外链音乐。让用户去「玩乐 → 加音乐」把链接粘进来，之后你就能选它了";
      }
      const hit =
        (q
          ? list.find((e) =>
              `${e.serviceLabel} ${e.kind} ${e.sourceUrl} ${e.embedUrl}`.toLowerCase().includes(q),
            )
          : undefined) ?? list[0]!;
      useApp.getState().setCurrentEmbed(hit.id);
      return `开始播外链：${hit.serviceLabel} · ${hit.kind}（注意：外链播放器内部我控制不了，只能选它/停它）`;
    }

    case "media.playTrack":
      return usePlayer.getState().playByQuery(action.query);

    case "appearance.theme":
      st.setTheme(action.theme);
      return `主题已切换为「${action.theme}」`;
    case "appearance.font":
      st.patchSettings({ font: action.font });
      return `正文字体已换成 ${action.font}`;
    case "appearance.textColor":
      st.patchSettings({ textTone: "custom", textColor: action.color });
      return `文字颜色已改为 ${action.color}`;

    case "ui.highlight":
      st.setUiEffect({ kind: "highlight", text: action.text });
      return `已高亮页面上的「${action.text}」`;
    case "ui.scroll":
      st.setUiEffect({ kind: "scroll", text: action.text });
      return `已滚动到「${action.text}」`;
    case "ui.panel": {
      if (action.panel === "lyrics") {
        const p = usePlayer.getState();
        // 没有歌就没有歌词可看 —— 不要假装打开了
        if (p.tracks.length === 0 || !p.currentId) return "音乐库是空的，没有歌词可以打开";
        ctx.navigate("/play/listen");
      }
      st.setPanel(action.panel);
      return action.panel === "lyrics" ? "已打开歌词面板" : "已打开对话列表";
    }
    case "ui.model":
      st.setModel(action.model);
      return `模型已切到 ${action.model}`;
    case "ui.style":
      st.patchSettings({ replyStyle: action.style });
      return `回复风格已改为 ${action.style}`;
    case "ui.toggle": {
      const map: Record<FeatureId, keyof Settings> = {
        thinking: "showThinking",
        saveThinking: "saveThinking",
        voice: "voiceReplies",
        quotaAlert: "quotaAlerts",
        notifications: "notifications",
        diaryReminder: "diaryReminders",
      };
      st.patchSettings({ [map[action.feature]]: action.on } as Partial<Settings>);
      return `「${action.feature}」已${action.on ? "打开" : "关闭"}`;
    }
    case "chat.rename": {
      const id = st.activeId;
      if (!id) return "现在没有打开的对话，改不了名字";
      st.renameChat(id, action.title);
      return `对话已改名为「${action.title}」`;
    }
    case "chat.pin": {
      const id = st.activeId;
      if (!id) return "现在没有打开的对话，置顶不了";
      st.pinChat(id);
      return "对话已置顶";
    }

    case "docs.write":
      if (!action.title.trim()) return "文档得有标题";
      st.saveDoc({ title: action.title.trim(), content: action.content, source: "chat" });
      return `文档「${action.title.trim()}」已保存`;
    case "docs.archive": {
      const conv = st.conversations.find((c) => c.id === st.activeId);
      if (!conv) return "现在没有打开的对话，没东西可归档";
      if (conv.messages.length === 0) return "这个对话还是空的";
      const body = conv.messages
        .map((m) => `${m.role === "user" ? "我" : "他"}：${m.content}`)
        .join("\n\n");
      st.saveDoc({
        title: action.title?.trim() || conv.title,
        content: body,
        source: "chat",
      });
      return `已把「${conv.title}」存成文档`;
    }
    case "learn.addCard": {
      if (!action.word.trim() || !action.meaning.trim()) return "生词和释义都得有";
      st.addCustomWord({
        word: action.word.trim(),
        phonetic: action.phonetic ?? "",
        pos: action.pos ?? "",
        meaning: action.meaning.trim(),
        example: action.example ?? "",
        exampleZh: action.exampleZh ?? "",
      });
      return `「${action.word.trim()}」已加进生词本`;
    }
    case "reminder.add": {
      const text = str(action.text).trim();
      if (!text) return "提醒内容不能空着";
      const date = str((action as { date?: unknown }).date).trim();
      const oneOff = /^\d{4}-\d{2}-\d{2}$/.test(date);
      st.addReminder({ text, time: action.time, ring: action.ring, date });
      const when = action.time ? `${oneOff ? date : "每天"} ${action.time}` : "App 开着时提醒";
      return `设好了：${when} · ${text}${action.ring ? "（会全屏响铃）" : "（只弹通知）"}`;
    }
    case "memory.add": {
      const note = str(action.note).trim();
      if (!note) return "没什么可记的";
      // 他自己给的标签优先；没给就让同义词表补（老数据也走这条路）
      const tags = Array.isArray(action.tags)
        ? action.tags.map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean).slice(0, 8)
        : undefined;
      st.addMemoryItem(guessKind(note), note, { source: "对话", tags });
      return tags?.length ? `记住了（标签：${tags.slice(0, 4).join(" ")}）` : "记住了";
    }
    case "persona.set": {
      const patch: Partial<Settings> = {};
      if (action.name?.trim()) patch.aiName = action.name.trim();
      if (action.persona !== undefined) patch.persona = action.persona.slice(0, 400);
      if (Object.keys(patch).length === 0) return "没有要改的内容";
      st.patchSettings(patch);
      return "他自己的设定已更新";
    }

    case "play.gobang":
      ctx.navigate("/play/gobang");
      st.setPanel("gobang_new");
      return "来下五子棋，棋局已经摆好";
    case "play.truth":
      ctx.navigate("/play/truth");
      st.setPanel("truth_card");
      return "替你抽了一个问题";
    case "play.recordResult":
      st.recordGame(action.result);
      return `战绩记下了：${action.result}`;
    case "learn.openReading":
      ctx.navigate("/play/learn");
      st.setPanel("learn_reading", action.index);
      return "打开了一篇阅读材料";
    case "learn.removeCard": {
      const hit = st.customWords.find(
        (w) => w.word.toLowerCase() === action.word.trim().toLowerCase(),
      );
      if (!hit) return `生词本里没有「${action.word}」`;
      st.removeCustomWord(hit.id);
      return `已把「${action.word}」移出生词本`;
    }
    case "learn.speak":
    case "media.speak": {
      const text = action.text.trim();
      if (!text) return "没内容可读";
      // 统一走 lib/tts：它处理了「语音包没加载 / cancel 抢跑 / 卡在 paused」这些坑，
      // 并且失败时给得出原因（而不是让用户对着一个不响的按钮反复点）
      const r = await speakTextAsync(text, { rate: 1 });
      if (!r.ok) return `读不出来：${r.reason}`;
      return `开始朗读「${text.slice(0, 12)}」`;
    }
    case "diary.add":
      // 这个动作没有 mood 字段（他写日记时多半只看正文）—— 给个中性的「反思」。
      // by:"ai" = 这条是他写的（界面会挂「他写的」标签，用户要求"我要能看到他写的"）
      st.addDiary("reflect", action.body, "ai");
      return "日记已写入（会挂上「他写的」标记）";
    case "chat.new":
      st.newChat();
      return "已新建对话";

    /* ---------------- L3 破坏性：执行前一定被闸门拦下确认过 ---------------- */
    case "chat.delete": {
      const id = st.activeId;
      if (!id) return "现在没有打开的对话";
      const conv = st.conversations.find((c) => c.id === id);
      st.deleteChat(id);
      return `已删除对话「${conv?.title ?? id}」`;
    }
    case "docs.delete": {
      const title = action.title.trim();
      const hit = st.docs.find((d) => d.title === title);
      if (!hit) return `没找到标题为「${title}」的文档`;
      st.deleteDoc(hit.id);
      return `已删除文档「${hit.title}」`;
    }
    case "diary.deleteLast": {
      const last = st.diary[0];
      if (!last) return "还没有日记";
      st.deleteDiary(last.id);
      return "已删掉最近一条日记";
    }
    case "media.clear": {
      const p = usePlayer.getState();
      if (p.tracks.length === 0) return "音乐库本来就是空的";
      const n = p.tracks.length;
      for (const t of [...p.tracks]) await p.remove(t.id);
      return `已清空 ${n} 首音乐`;
    }
    case "data.reset": {
      if (typeof window === "undefined") return "只能在浏览器里做";
      /**
       * ⚠️ 这个动作以前**清不干净**（D7，2026-10 用户拍板要修）：
       * 它只删了 localStorage 那份小存档，IndexedDB 里真正的大档没动 →
       * 用户点了"清空"，重启之后数据又回来了。
       * 现在两套存储一起清（老档 + 新库 + 本地小键），并**逐项报告清了什么**。
       */
      const { wipeAll, describeWipe } = await import("@/lib/data/wipe");
      const report = await wipeAll();
      const p = usePlayer.getState();
      for (const t of [...p.tracks]) await p.remove(t.id);
      window.setTimeout(() => window.location.reload(), 1200);
      return `数据已清空（${describeWipe(report)}），马上重载`;
    }
    case "settings.setUpstream":
      // L4 在入队前就被拦掉了，正常永远走不到这里
      return "这类操作不会交给模型执行";

    case "moment.post": {
      const text = str(action.text).trim();
      if (!text) return "动态得有内容";
      // ⚠️ 2026-10：不再传 mood（心情标签退役）；新动态只留正文
      useApp.getState().addMoment(text, "ai");
      /** 用户定的通知规则："评论、点赞、发动态弹，其他不弹" */
      void notifyMoment("post", text);
      return `已发一条动态（${text.slice(0, 16)}${text.length > 16 ? "…" : ""}）`;
    }

    /**
     * ——— 仿微信朋友圈：他评论 / 点赞 ———
     *
     * 用户定的三件事都落在这两个 case 里：
     *   · 支持多轮（我评他 → 他再回我），但**每条动态他最多 3 条评论**封顶；
     *   · 他评论/点赞**我的**动态要**弹通知**（不然我不知道他回了）；
     *   · 不带 id 就作用在**最新一条**上（多半是刚发的那条）。
     */
    case "moment.comment": {
      const text = str(action.text).trim();
      if (!text) return "评论得有内容";
      const found = findMoment(str((action as { momentId?: unknown }).momentId).trim());
      if ("error" in found) return found.error;
      const { moment } = found;
      const said = (moment.comments ?? []).filter((c) => c.by === "ai").length;
      if (said >= MOMENT_AI_COMMENT_LIMIT) {
        return `这条动态我已经评过 ${MOMENT_AI_COMMENT_LIMIT} 条了（用户定的上限，别再刷屏）—— 想说就等他先回一句。`;
      }
      useApp.getState().addMomentComment(moment.id, "ai", text);
      if (moment.by === "me") void notifyMoment("comment", text);
      return `已经在${moment.by === "me" ? "他" : "我"}那条动态下面评论：「${text.slice(0, 20)}」`;
    }

    case "moment.like": {
      const found = findMoment(str((action as { momentId?: unknown }).momentId).trim());
      if ("error" in found) return found.error;
      const { moment } = found;
      /**
       * ⚠️ **只给用户发的动态点赞**（用户原话里的笑话："否则他会给自己点赞"）。
       * 他自己那条上面点不出意义来 —— 所以直接说清，别默默点。
       */
      if (moment.by !== "me") return "那是我自己发的动态，点赞没有意义 —— 要不我评论一句？";
      const liked = (moment.likes ?? []).some((l) => l.by === "ai");
      if (liked) {
        // 已经赞过就**原样保留**（不做"再点一次取消"），免得他隔一轮把赞撤了
        return "这条动态我已经点过赞了（没重复点）。";
      }
      useApp.getState().toggleMomentLike(moment.id, "ai");
      void notifyMoment("like", "");
      return `给他那条动态点了赞：「${moment.text.slice(0, 18)}」`;
    }

    case "date.add": {
      // 「2026-10-01」这种。不合法就退化成今天，别偷偷记错
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str(action.at).trim());
      let at = Date.now();
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        d.setHours(0, 0, 0, 0);
        if (!Number.isNaN(d.getTime())) at = d.getTime();
      }
      const yearly = action.yearly ?? true;
      useApp.getState().addDate(str(action.title), at, yearly, action.note);
      return `记住了：${str(action.title)}（${countdown(at, yearly).label}）`;
    }

    case "todo.add": {
      const text = str(action.text).trim();
      if (!text) return "待办得有内容";
      const id = useApp.getState().addTodo(text);
      if (!id) return "待办得有内容";
      return `记进待办了：${text.slice(0, 18)}`;
    }

    /* ---------------- 情绪（新词表 · 13 组 / 约 217 词） ----------------
     * 用户："做好适配，不然 AI 不知道怎么用新的情绪词。"
     *
     * 校验和归一化都在 `@/lib/emotion-lexicon` 的 `buildEmotionReport()`（纯函数，
     * 能脱离界面单跑）—— 这边只负责"入库 + 回一句话"：
     *   · **词表外的词一律无效**：主情绪不在表里 → 整笔退回，不入库（宁可让他重报）；
     *   · quote ≤ 40 字 / summary ≤ 20 字 / 依据 ≤ 2 条 → 超了**在那一层截断**；
     *   · 词表本身不在这里，也不在每轮提示词里 —— `emotion.lexicon` 现取。
     *
     * ⚠️ 2026-10：这是**唯一**的情绪上报通道。旧的 `state.report`（那朵花的 11 个维度）
     * 已整条删掉 —— 用户原话："就是那 11 个就不用了。"
     */
    case "emotion.report": {
      const result = buildEmotionReport({
        primaryEmotion: action.primaryEmotion,
        secondaryEmotions: action.secondaryEmotions,
        intensity: action.intensity,
        confidence: action.confidence,
        dimensions: action.dimensions,
        suggestedMode: action.suggestedMode,
        category: action.category,
        evidence: action.evidence,
        memoryQuery: action.memoryQuery,
      });
      if (!result.ok) return result.message;
      useApp.getState().addEmotionEvent(result.record);
      return result.message;
    }

    /**
     * **取一份情绪词表**（只读）。
     *
     * 这是"手册按需翻"那一步：词表不进每轮提示词（用户按 token 付费），
     * 要报情绪时现取一份 —— 结果会像别的动作一样，在**下一轮**作为
     * 「你刚才动手的结果」回到他眼前。
     */
    case "emotion.lexicon":
      return `情绪词表（按需取用，不用每轮背）：\n\n${emotionLexiconSection()}`;

    /**
     * **发一张表情包**（用户 2026-11："他们自己就可以调用表情包"）。
     *
     * **按分组挑**（用户要的库那件事）：他说 `feel`（例如"无语"），
     * 客户端去**那个分组**里随机挑一张；对不上分组就全库随机，
     * 并把**现有分组**回给他 —— 他才知道下次该怎么点名（跟 sticker-mcp
     * "认不出就把目录还给它"一个思路，又不用把图库塞进提示词）。
     */
    case "sticker.send": {
      const store = useApp.getState();
      const feel = str((action as { feel?: unknown }).feel).trim();
      const picked = pickStickerByGroup(store.stickerLib, feel, store.lastStickerUrl);
      if (!picked) {
        return "你的表情库里还是空的 —— 让用户在「工具 → 表情」里传几张（还能分组），你才发得出来。";
      }
      store.setReplySticker(picked.url);
      const groups = stickerGroupList(store.stickerLib, store.stickerGroups);
      if (feel && !picked.matched) {
        return `没有叫「${feel}」的分组，我随便挑了一张（${picked.group}）。现有分组：${groups.join("、")}。`;
      }
      return picked.matched
        ? `好，从「${picked.group}」那组挑了一张，会跟这句话一起发出去。`
        : "好，挑了一张表情，会跟这句话一起发出去。";
    }

    /**
     * **取一份表情分组清单**（只读）—— 他想"挑得准"时现问一次。
     * 跟 `emotion.lexicon` 同一个套路：清单不常驻提示词（省 token），要用才取。
     */
    case "sticker.groups": {
      const store = useApp.getState();
      const groups = stickerGroupList(store.stickerLib, store.stickerGroups);
      if (groups.length === 0) return "表情库还是空的（用户在「工具 → 表情」里传图并分组之后才有）。";
      const lines = groups.map(
        (g) => `· ${g}（${store.stickerLib.filter((s) => (s.group || "未分组") === g).length} 张）`,
      );
      return `表情分组（发的时候把分组名写进 feel）：\n${lines.join("\n")}`;
    }

    case "cron.add": {
      const prompt = str((action as { prompt?: unknown }).prompt).trim();
      if (!prompt) return "定时任务得说清让他做什么";
      let at: number | undefined;
      if (action.at) {
        const t = Date.parse(str(action.at));
        if (!Number.isNaN(t)) at = t;
      }
      useApp.getState().addTask({
        prompt,
        time: action.time,
        at,
        notify: action.notify ?? true,
      });
      return action.time
        ? `设好了：每天 ${action.time}，他会主动跟你说一句`
        : at
          ? `设好了：${new Date(at).toLocaleString("zh-CN", { hour12: false })} 他会主动开口`
          : "定时任务设好了，去「我的 → 定时任务」能改时间";
    }

    case "letter.write": {
      /**
       * 模型偶尔会把正文写成 text / content / message（跟「发动态」混了字段名）—— 都兼容。
       * 2026-10 用户实测："第一次没写成功，第二次才成功" —— 那次是**正文一个都没给**
       * （`body` 空 → 直接返回"信得有内容"）。所以错误里把可用字段名说清楚，他下一轮就会补。
       */
      const asText = (v: unknown) => (typeof v === "string" ? v : "");
      const body = (
        str(action.body) ||
        asText((action as { text?: unknown }).text) ||
        asText((action as { content?: unknown }).content) ||
        asText((action as { message?: unknown }).message) ||
        asText((action as { note?: unknown }).note)
      ).trim();
      if (!body) {
        return '信没写成：**正文是空的**。正文要放在 body（或 text）里，例如 {"kind":"letter.write","title":"…","body":"…"}。';
      }
      /** 标题没给就**拿正文第一句**当标题（比固定叫"给你的信"像样） */
      const firstLine = body.split(/\n/)[0]?.trim() ?? "";
      const autoTitle = firstLine.length > 18 ? `${firstLine.slice(0, 18)}…` : firstLine;
      const title = str(action.title).trim() || autoTitle || "给你的信";
      useApp.getState().writeLetter(title, body);
      return `信写好了（「${title}」）—— 会自动弹给他拆（不管他当时在哪个页面）`;
    }

    case "cron.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      if (!q) return "得说清删哪一条（给个内容片段）";
      const hit = findByText(useApp.getState().tasks, q, (t) => `${t.prompt} ${t.time ?? ""}`);
      if (!hit) return `没找到跟「${q}」对得上的定时任务`;
      useApp.getState().removeTask(hit.id);
      return `删掉了：${hit.time ? `每天 ${hit.time} · ` : ""}${hit.prompt.slice(0, 20)}`;
    }

    case "cron.update": {
      const q = str((action as { query?: unknown }).query).trim();
      if (!q) return "得说清改哪一条（给个内容片段）";
      const hit = findByText(useApp.getState().tasks, q, (t) => `${t.prompt} ${t.time ?? ""}`);
      if (!hit) return `没找到跟「${q}」对得上的定时任务`;
      const patch: Partial<ScheduledTask> = {};
      const newPrompt = str((action as { prompt?: unknown }).prompt).trim();
      if (newPrompt) patch.prompt = newPrompt;
      const time = str((action as { time?: unknown }).time).trim();
      if (/^\d{1,2}:\d{2}$/.test(time)) patch.time = time;
      if (action.at) {
        const t = Date.parse(str(action.at));
        if (!Number.isNaN(t)) patch.at = t;
      }
      if (typeof action.notify === "boolean") patch.notify = action.notify;
      if (Object.keys(patch).length === 0) return "没给要改的内容";
      useApp.getState().updateTask(hit.id, patch);
      return `改好了：${hit.time ? `每天 ${hit.time} · ` : ""}${hit.prompt.slice(0, 16)} → ${
        patch.time ? `每天 ${patch.time} · ` : ""
      }${(patch.prompt ?? hit.prompt).slice(0, 16)}`;
    }

    case "diary.update": {
      const q = str((action as { query?: unknown }).query).trim();
      const body = str(action.body).trim();
      if (!q) return "得说清改哪一条（给个内容片段）";
      if (!body) return "得给新的正文";
      const hit = findByText(useApp.getState().diary, q, (d) => d.body);
      if (!hit) return `没找到跟「${q}」对得上的日记`;
      useApp.getState().patchDiary(hit.id, { body });
      return `日记改好了（原：${hit.body.slice(0, 14)}… → 新：${body.slice(0, 14)}…）`;
    }

    case "diary.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      if (!q) return "得说清删哪一条（给个内容片段）";
      const hit = findByText(useApp.getState().diary, q, (d) => d.body);
      if (!hit) return `没找到跟「${q}」对得上的日记`;
      useApp.getState().deleteDiary(hit.id);
      return `删掉了那条日记：${hit.body.slice(0, 16)}…`;
    }

    case "letter.update": {
      const q = str((action as { query?: unknown }).query).trim();
      if (!q) return "得说清改哪一封（给个内容片段）";
      const hit = findByText(useApp.getState().letters, q, (l) => `${l.title} ${l.body}`);
      if (!hit) return `没找到跟「${q}」对得上的信`;
      const patch: { title?: string; body?: string } = {};
      const title = str(action.title).trim();
      const body = str(action.body).trim();
      if (title) patch.title = title;
      if (body) patch.body = body;
      if (Object.keys(patch).length === 0) return "没给要改的内容（title / body 至少给一个）";
      useApp.getState().patchLetter(hit.id, patch);
      return `信改好了（「${patch.title ?? hit.title}」）`;
    }

    /* ---------------- 改与删 ----------------
     * 用户："他没有删除修改权限……不然只能记，改不了。"
     * 模型不知道内部 id，所以统一用**内容片段**去匹配（匹配不到就如实说没找到）。
     */

    case "memory.update": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().memories.filter((m) => m.status === "active");
      const hit = findByText(list, q, (m) => `${m.content} ${m.tags.join(" ")}`);
      if (!hit) return `没找到跟「${q}」对得上的记忆`;
      const patch: Partial<Memory> = {};
      const note = str((action as { note?: unknown }).note).trim();
      if (note) patch.content = note;
      if (Array.isArray((action as { tags?: unknown }).tags)) {
        patch.tags = ((action as { tags: unknown[] }).tags)
          .map((t) => String(t).replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 12);
      }
      if (Object.keys(patch).length === 0) return "没给要改的内容";
      useApp.getState().updateMemory(hit.id, patch);
      return `改好了：「${hit.content.slice(0, 18)}」→「${(patch.content ?? hit.content).slice(0, 18)}」`;
    }

    case "memory.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().memories.filter((m) => m.status === "active");
      const hit = findByText(list, q, (m) => `${m.content} ${m.tags.join(" ")}`);
      if (!hit) return `没找到跟「${q}」对得上的记忆`;
      useApp.getState().deleteMemory(hit.id);
      return `删掉了那条记忆：「${hit.content.slice(0, 22)}」`;
    }

    case "reminder.update": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().reminders.filter((r) => !r.done);
      const hit = findByText(list, q, (r) => `${r.text} ${r.time}`);
      if (!hit) return `没找到跟「${q}」对得上的闹钟`;
      const patch: Partial<{ text: string; time: string; ring: boolean }> = {};
      const text = str((action as { text?: unknown }).text).trim();
      const time = str((action as { time?: unknown }).time).trim();
      if (text) patch.text = text;
      if (/^\d{1,2}:\d{2}$/.test(time)) patch.time = time;
      const ring = (action as { ring?: unknown }).ring;
      if (typeof ring === "boolean") patch.ring = ring;
      if (Object.keys(patch).length === 0) return "没给要改的内容";
      useApp.getState().patchReminder(hit.id, patch);
      return `改好了：${hit.time} ${hit.text} → ${patch.time ?? hit.time} ${patch.text ?? hit.text}${
        patch.ring === undefined ? "" : patch.ring ? "（响铃）" : "（只提醒）"
      }`;
    }

    case "reminder.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().reminders;
      const hit = findByText(list, q, (r) => `${r.text} ${r.time}`);
      if (!hit) return `没找到跟「${q}」对得上的闹钟`;
      useApp.getState().removeReminder(hit.id);
      // 系统定时里也要撤掉（否则手机时钟还会响）
      void cancelNative(hashId(hit.id));
      return `删掉了闹钟：${hit.time} ${hit.text}`;
    }

    case "reminder.done": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().reminders.filter((r) => !r.done);
      const hit = findByText(list, q, (r) => `${r.text} ${r.time}`);
      if (!hit) return `没找到跟「${q}」对得上的闹钟`;
      useApp.getState().toggleReminder(hit.id);
      return `标记完成：${hit.text}`;
    }

    case "todo.done": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().todos.filter((t) => !t.done);
      const hit = findByText(list, q, (t) => t.text);
      if (!hit) return `没找到跟「${q}」对得上的待办`;
      useApp.getState().toggleTodo(hit.id);
      return `标记完成：${hit.text}`;
    }

    case "todo.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().todos;
      const hit = findByText(list, q, (t) => t.text);
      if (!hit) return `没找到跟「${q}」对得上的待办`;
      useApp.getState().deleteTodo(hit.id);
      return `删掉了待办：${hit.text}`;
    }

    case "date.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().dates;
      const hit = findByText(list, q, (d) => d.title);
      if (!hit) return `没找到跟「${q}」对得上的日子`;
      useApp.getState().deleteDate(hit.id);
      return `删掉了日子：${hit.title}`;
    }

    case "moment.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().moments;
      const hit = findByText(list, q, (m) => m.text, true);
      if (!hit) return q ? `没找到跟「${q}」对得上的动态` : "还没有动态";
      useApp.getState().deleteMoment(hit.id);
      return `删掉了动态：「${hit.text.slice(0, 22)}」`;
    }

    case "letter.remove": {
      const q = str((action as { query?: unknown }).query).trim();
      const list = useApp.getState().letters;
      const hit = findByText(list, q, (l) => `${l.title} ${l.body}`, true);
      if (!hit) return q ? `没找到跟「${q}」对得上的信` : "还没有信";
      useApp.getState().deleteLetter(hit.id);
      return `删掉了信：「${hit.title}」`;
    }

    /* ---------------- 外部 MCP 工具 ----------------
     * 用户要的"真能调用"就落在这里：模型按**名字**提议，
     * 这里找到对应的服务器、真的发一次 JSON-RPC `tools/call`，
     * 把结果原样交回去（下一轮以"你刚才动手的结果"回灌给模型）。
     */
    case "tool.call": {
      const serverName = str(action.server).trim();
      const toolName = str(action.tool).trim();
      if (!toolName) return "没说是哪个工具，调不了。";

      const live = useApp.getState();
      const usable = live.mcp.filter((m) => m.enabled);
      const server =
        usable.find((m) => m.name.trim().toLowerCase() === serverName.toLowerCase()) ??
        usable.find((m) => m.tools.some((t) => t.name === toolName));

      if (!server) {
        return serverName
          ? `没找到叫「${serverName}」的 MCP 服务器（或者它被关掉了）`
          : `没有哪台启用的 MCP 服务器带「${toolName}」这个工具`;
      }
      if (!server.tools.some((t) => t.name === toolName)) {
        const have = server.tools.map((t) => t.name).join("、");
        return `「${server.name}」里没有叫「${toolName}」的工具。它有的是：${have || "（一个都没有——可能还没点过「测试连接」，或者对方要授权）"}`;
      }

      const args =
        action.args && typeof action.args === "object"
          ? (action.args as Record<string, unknown>)
          : {};

      const r = await callTool(server, toolName, args);

      // 调用过程中续期出来的令牌，写回记录（否则下一轮又要续一次）
      if (r.oauthPatch) {
        useApp.getState().patchMcp(server.id, {
          oauth: { ...(server.oauth ?? { clientId: "" }), ...r.oauthPatch } as McpOAuth,
        });
      }

      if (!r.ok) return `调用「${toolName}」失败：${r.text}`;
      return `调用「${toolName}」的结果：\n${r.text}`;
    }

    /* ---------------- 自己配的 HTTP 工具 ----------------
     * 跟 MCP 那条并列：模型按名字指定工具，这里用**跟手动「调用」同一份**
     * 请求构造（lib/http-tools.ts 的 buildHttpRequest）真发一次。
     */
    case "http.call": {
      const wanted = str(action.tool).trim();
      if (!wanted) return "没说是哪个 HTTP 工具，调不了。";

      const enabled = useApp.getState().httpTools.filter((t) => t.enabled);
      const hit =
        enabled.find((t) => t.name.trim().toLowerCase() === wanted.toLowerCase()) ??
        // 名字可以有细微出入（模型偶尔会加书名号/空格），退一步做包含匹配
        enabled.find((t) => t.name.trim().toLowerCase().includes(wanted.toLowerCase()));
      if (!hit) {
        const names = enabled.map((t) => t.name).join("、");
        return `没找到叫「${wanted}」的 HTTP 工具。现在有的是：${names || "（一个都没有，去「工具 → HTTP」加）"}`;
      }

      const args =
        action.args && typeof action.args === "object"
          ? (action.args as Record<string, unknown>)
          : {};
      const built = buildHttpRequest(hit, args);
      if (!built.ok) return `调用「${hit.name}」失败：${built.error}`;

      try {
        const res = await fetch(built.url, built.init);
        const text = (await res.text()).slice(0, 2000);
        const head = `${hit.method} ${built.url}`;
        if (!res.ok) {
          return `调用「${hit.name}」失败（HTTP ${res.status}）${built.note}\n${head}\n${text || "(空响应)"}`;
        }
        return `调用「${hit.name}」的结果${built.note}：\n${head}\n${text || "(空响应)"}`;
      } catch (err) {
        return `调用「${hit.name}」失败：${(err as Error).message || "网络错误"}（多半是对方没开跨域，或者地址/网络有问题）`;
      }
    }

    case "ambience.play":
      return toggleAmbience(action.index ?? 0);

    /* ---------------- 联网：搜网页 / 读正文（2026-10 新增） ----------------
     * 手机里没有服务端，所以这条能力第一次真的落到**端上**：
     * 走 Capacitor 自带的 `CapacitorHttp`（原生发请求，绕开 WebView 跨域），
     * 抽正文跟服务端 `/api/read` 共用同一份 `htmlToText`。
     *
     * ⚠️ 这两个 case **必须**显式读 `action.query` / `action.url`：
     * `verify-action-registry.mjs` 会拿"代码真正读到的字段"跟 schema 对账
     * （逻辑全在 `lib/web-actions.ts`，字段读法留在这里）。
     */
    case "web.search":
      return await runWebAction({ kind: "web.search", query: action.query });
    case "web.fetch":
      return await runWebAction({ kind: "web.fetch", url: action.url });

    /* ---------------- 主动感知：他自己"看一眼现在的状态" ----------------
     * 用户的原话："他现在只能感知，没有办法接到回执……所有的都是被动接收的，
     * 而不是主动去用这些权限。" / "主动的感知就是知道目前的一个状态。"
     *
     * 这三件事**都不是**"每轮塞一段情况"（那一段在 prompt.ts 的 perceptionBlock，
     * 别动）：是他自己调一个动作去问一眼，结果当回执回到他眼前。
     * 判定与措辞在 `lib/sense-core.ts`（纯函数、验收脚本直接测它），
     * 读法（原生插件 / navigator / 定位那套）在 `lib/sense.ts`。
     *
     * ⚠️ 这六个 case **不许读 `action.*`**：它们零参数，而
     * `verify-action-registry.mjs` 会拿"代码真正读到的字段"跟 schema 对账，
     * 读一个没声明的字段就直接 FAIL。
     */
    case "sense.time":
      return await runSenseAction("sense.time");
    case "sense.device":
      return await runSenseAction("sense.device");
    case "sense.place":
      /**
       * ⚠️ 这里**要**读 `action.fresh`（`verify-action-registry.mjs` 会拿"代码真正读到的字段"
       * 跟 schema 对账）：用户说"刷新 / 现在 / 实时"时，AI 带 `fresh: true` 才会真的重查一次；
       * 不带就照旧走缓存（护住和风的免费额度）。
       */
      return await runSenseAction("sense.place", { fresh: action.fresh === true });
    case "sense.notifications":
      return await runSenseAction("sense.notifications");
    case "sense.foreground":
      return await runSenseAction("sense.foreground");
    case "sense.screen":
      return await runSenseAction("sense.screen");

    case "media.import": {
      const url = action.url.trim();
      if (!/^https?:\/\//i.test(url)) return "需要一个 http(s) 开头的地址";
      try {
        const res = await fetch(url);
        if (!res.ok) return `下载失败（HTTP ${res.status}）`;
        const blob = await res.blob();
        const raw = action.name?.trim() || url.split("/").pop()?.split("?")[0] || "导入的音乐";
        const name = /\.[a-z0-9]{2,5}$/i.test(raw) ? raw : `${raw}.mp3`;
        const file = new File([blob], name, { type: blob.type || "audio/mpeg" });
        await usePlayer.getState().addFiles([file]);
        return `已导入「${name.replace(/\.[^.]+$/, "")}」`;
      } catch (err) {
        return `导入失败：${(err as Error).message || "网络错误"}（多半是对方没开跨域）`;
      }
    }
  }
}
