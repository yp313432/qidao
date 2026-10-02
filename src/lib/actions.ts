import { toggleAmbience } from "@/lib/ambience";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { countdown } from "@/lib/days";
import { guessKind } from "@/lib/memory";
import { speakTextAsync } from "@/lib/tts";
import type { AppAction, FeatureId, MoodId, Settings } from "@/lib/types";

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
      if (!action.text.trim()) return "提醒内容不能空着";
      st.addReminder({ text: action.text, time: action.time });
      return `提醒已设好${action.time ? `（每天 ${action.time}）` : "（App 开着时提醒）"}`;
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

    case "workspace.note": {
      const title = action.title.trim();
      if (!title) return "记录得有标题";
      try {
        const res = await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            detail: action.detail ?? "",
            files: action.files ?? [],
          }),
        });
        const out = (await res.json()) as { ok?: boolean; message?: string; total?: number };
        if (!out.ok) return out.message ?? "写记录失败";
        return `已记下「${title}」${typeof out.total === "number" ? `（现在共 ${out.total} 条）` : ""}`;
      } catch (err) {
        return `写记录失败：${(err as Error).message || "网络错误"}`;
      }
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
