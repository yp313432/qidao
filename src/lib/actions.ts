import { toggleAmbience } from "@/lib/ambience";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { countdown } from "@/lib/days";
import { guessKind } from "@/lib/memory";
import { cancelNative } from "@/lib/notify";
import { speakTextAsync } from "@/lib/tts";
import type { AppAction, FeatureId, Memory, MoodId, Settings } from "@/lib/types";

/**
 * 动作执行器 —— 所有 AI 请求的动作最终都在**前端**这里落地。
 *
 * 也就是说：模型只能「提议」，真正动手的是这个文件，
 * 而它只在用户批准（或该项权限已设为「允许」）之后才会被调用。
 */

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
      st.addDiary("calm", action.body);
      return "日记已写入";
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
      // 只清栖岛自己的东西，不动别的站点数据
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("qidao:")) localStorage.removeItem(k);
      }
      localStorage.removeItem("aster-app");
      const p = usePlayer.getState();
      for (const t of [...p.tracks]) await p.remove(t.id);
      window.setTimeout(() => window.location.reload(), 900);
      return "数据已清空，马上重载";
    }
    case "settings.setUpstream":
      // L4 在入队前就被拦掉了，正常永远走不到这里
      return "这类操作不会交给模型执行";

    case "moment.post": {
      const text = str(action.text).trim();
      if (!text) return "动态得有内容";
      useApp.getState().addMoment(action.mood, text, "ai");
      return `已发一条动态（${text.slice(0, 16)}${text.length > 16 ? "…" : ""}）`;
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

    case "state.report": {
      // 静默执行（权限是 L0）：这是他给自己记的一笔，没有任何副作用
      const clamp = (v: unknown) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
      };
      const MOODS = ["calm", "joy", "focus", "low", "miss"];
      const mood = MOODS.includes(str((action as { mood?: unknown }).mood))
        ? ((action as { mood: MoodId }).mood)
        : "calm";
      useApp.getState().addStateSample({
        mood,
        energy: clamp(action.energy),
        missing: clamp(action.missing),
        curious: clamp(action.curious),
        note: str((action as { note?: unknown }).note).trim().slice(0, 60) || undefined,
      });
      return "记下了此刻的状态";
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
      // 模型偶尔会把正文写成 text（跟「发动态」同一个字段名）——
      // 兼容一下。否则这里 action.body.trim() 会直接抛错，信就没了。
      const body = (str(action.body) || str((action as { text?: unknown }).text)).trim();
      const title = str(action.title).trim() || "给你的信";
      if (!body) return "信得有内容";
      useApp.getState().writeLetter(title, body);
      return `信写好了（「${title}」）—— 去「玩乐 → 动态空间 → 信」，会看到一封没拆的信`;
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

    case "ambience.play":
      return toggleAmbience(action.index ?? 0);
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
