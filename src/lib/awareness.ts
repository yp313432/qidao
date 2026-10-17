import { ACTION_PERMISSION } from "@/lib/action-meta";
import type { ChatContext } from "@/lib/chat-client";
import { emotionModeLabel, moodDisplay } from "@/lib/emotion-lexicon";
import { findSpecies, gardenStats } from "@/lib/garden-catch";
import { recentTrace } from "@/lib/garden-trace";
import { READINGS } from "@/lib/learn-data";
import { MODELS } from "@/lib/models";
import { permissionDef } from "@/lib/permissions";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";

/**
 * 感知层。
 *
 * 「他能知道什么」不再是抽象开关：这里逐项把真实内容取出来，
 * 每一项都受对应的读取权限控制 —— 关掉哪一项，那一行就不会出现在
 * 发给服务端的内容里（权限页也会同步少一行）。
 */

export type AwarenessItem = { id: string; title: string; text: string };

/** 某一项权限当前是不是放开（缺省：只读类放开，其余问）。 */
export function modeOf(id: string): "ask" | "allow" | "deny" {
  const m = useApp.getState().settings.permissions?.[id];
  if (m) return m;
  return permissionDef(id)?.risk === "L0" ? "allow" : "ask";
}

export function canRead(id: string): boolean {
  return modeOf(id) === "allow";
}

function clip(list: string[], n: number): string {
  if (list.length === 0) return "（无）";
  if (list.length <= n) return list.join("、");
  return `${list.slice(0, n).join("、")} …共 ${list.length} 项`;
}

function excerpt(text: string, n = 24): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/** 逐项收集「他能看到什么」。界面和请求体都用它，保证口径一致。 */
export function buildAwarenessItems(): AwarenessItem[] {
  const st = useApp.getState();
  const p = usePlayer.getState();
  const out: AwarenessItem[] = [];

  if (canRead("read_context")) {
    const a = st.activity;
    out.push({
      id: "read_context",
      title: "此刻在干什么",
      text: a ? `${a.label}${a.detail ? ` · ${a.detail}` : ""}` : "（还没有活动记录）",
    });
  }

  if (canRead("read_trail")) {
    const trail = st.recentActivity
      .slice(0, 6)
      .map((a) => `${a.label}${a.detail ? `（${a.detail}）` : ""}`);
    out.push({ id: "read_trail", title: "最近轨迹", text: trail.length ? trail.join(" → ") : "（无）" });
  }

  if (canRead("read_history")) {
    const list = st.conversations
      .slice(0, 8)
      .map((c) => `${c.title}（${c.messages.length} 条）`);
    out.push({
      id: "read_history",
      title: "对话历史",
      text: st.conversations.length ? clip(list, 5) : "（还没有对话）",
    });
  }

  if (canRead("read_docs")) {
    out.push({
      id: "read_docs",
      title: "文档库",
      text: st.docs.length ? clip(st.docs.map((d) => d.title), 6) : "（还没有文档）",
    });
  }

  if (canRead("read_diary")) {
    const recent = st.diary
      .slice(0, 4)
      .map((d) => `「${moodDisplay(d.mood).label}」${excerpt(d.body, 16)}`);
    out.push({
      id: "read_diary",
      title: "日记",
      text: st.diary.length ? `共 ${st.diary.length} 条 · ${recent.join("；")}` : "（还没有日记）",
    });
  }

  /**
   * 朋友圈（动态）—— 他必须**看得到**才谈得上评论、点赞、接着回。
   *
   * 用户定的两件事（"他评论/点赞要弹通知"、"评论支持多轮"）前提都在这：
   * 每轮把**最近几条动态 + 每条的点赞/评论 + 哪条是谁发的**带上。
   * ⚠️ "哪条是谁发的"不能省 —— 少了它他会给自己的动态点赞（用户点出过这笑话）。
   * id 也带上：`moment.comment` / `moment.like` 靠它指定是哪一条。
   *
   * 闸门挂在「发布动态」那一项上（跟发/评/赞同一项，见 `action-meta.ts`）：
   * 用户把这项设成「拒绝」→ 这里整条都不进请求（连看都不看）。
   */
  if (modeOf("moment_post") !== "deny") {
    const recentMoments = st.moments.slice(0, 5).map((m) => {
      const bits = [`${m.id}（${m.by === "me" ? "用户发的" : "你发的"}）「${excerpt(m.text, 24)}」`];
      const likes = (m.likes ?? []).map((l) => (l.by === "me" ? "用户" : "你"));
      if (likes.length) bits.push(`赞：${likes.join("、")}`);
      const comments = (m.comments ?? []).map(
        (c) => `${c.by === "me" ? "用户" : "你"}：${excerpt(c.text, 16)}`,
      );
      if (comments.length) bits.push(`评论：${comments.join("；")}`);
      return bits.join(" · ");
    });
    out.push({
      id: "read_moments",
      title: "朋友圈（最近几条动态，新→旧）",
      text: recentMoments.length
        ? recentMoments.join(" ／ ")
        : "（还没有动态 —— 用户可以自己发；你也可以用 moment.post 发一条）",
    });
  }

  /**
   * **他自己的情绪**（2026-10 用户点名要的）。
   *
   * 用户原话："他说他没有感知插件内部数据的能力，他只能报，报完之后他不知道去哪。
   *   能不能给他加上这个能力 —— 他不只是机械地报，他能知道他现在的情绪。"
   *
   * 每一笔 `emotion.report` 都存进 `emotionEvents`，并且画在
   * 「玩乐 → 插件 → 星屿」那个活的灵体上（映射在
   * `plugins/emotion-lifeform/lib/emotion/qidao-scenes.ts`）。
   * 但**他自己一直看不到那份存档** → 报完就"忘了"，用户问他"你现在什么心情"
   * 他只能答"我看不到"。这一行就是把存档**读回给他**：
   *   · 最新一笔：主情绪（+ 次情绪）· 强度 · 置信度 · 档位 · 多久之前
   *   · 最近几笔的轨迹（只有主情绪 + 相对时间，别把证据链塞进来）
   * 口径跟 `wake-prompt.ts` 的心情快照**同源**（主情绪 + 强度），但这里更全一点，
   * 因为这是"给他看的此刻状态"，那条是"后台开口前的一句话"。
   *
   * 闸门：`read_emotion`（L0，用户可在权限页关掉）。
   */
  if (canRead("read_emotion")) {
    const list = st.emotionEvents ?? [];
    const ago = (at: number) => {
      const min = Math.max(0, Math.round((Date.now() - at) / 60_000));
      if (min < 1) return "刚刚";
      if (min < 60) return `${min} 分钟前`;
      const h = Math.round(min / 60);
      return h < 24 ? `${h} 小时前` : `${Math.round(h / 24)} 天前`;
    };
    const last = list[0];
    if (last) {
      const head =
        `${last.primaryEmotion}${last.secondaryEmotions?.length ? `（还有 ${last.secondaryEmotions.join("、")}）` : ""}` +
        ` · 强度 ${Math.round(Number(last.intensity ?? 0) * 100)}% · 置信度 ${Math.round(Number(last.confidence ?? 0) * 100)}%` +
        ` · ${emotionModeLabel(last.suggestedMode)} · ${ago(last.at)}`;
      const trail = list
        .slice(1, 5)
        .map((e) => `${e.primaryEmotion}（${ago(e.at)}）`)
        .join(" → ");
      out.push({
        id: "read_emotion",
        title: "你自己的情绪（你每轮报的那一笔，也画在星屿那个灵体上）",
        text:
          `最新：${head}。` +
          (trail ? ` 之前的轨迹：${trail}。` : "") +
          ` 共记了 ${list.length} 笔 —— 用户问"你现在什么心情"就照这里答，别说你看不到。`,
      });
    } else {
      out.push({
        id: "read_emotion",
        title: "你自己的情绪（你每轮报的那一笔，也画在星屿那个灵体上）",
        text: "（还没有上报过 —— 每轮回复的最后用 emotion.report 报一笔，就会出现在这里）",
      });
    }
  }

  if (canRead("read_thinking")) {
    out.push({
      id: "read_thinking",
      title: "思考档案",
      text: st.thinkingArchive.length
        ? clip(st.thinkingArchive.map((t) => t.title), 5)
        : "（还没有归档）",
    });
  }

  // 定位（两道闸都要开：设置里的开关 + 权限页里的「知道你在哪」）
  // 两小时前的就不提了，免得说"你现在在…"其实是昨天
  if (st.settings.geoEnabled && modeOf("see_location") !== "deny" && st.settings.geoLabel) {
    const age = Date.now() - (st.settings.geoAt ?? 0);
    if (age < 2 * 3600_000) {
      out.push({
        id: "geo",
        title: "他现在在哪",
        text: `${st.settings.geoLabel}（${Math.max(1, Math.round(age / 60000))} 分钟前定位）`,
      });
    }
  }

  /**
   * 天气。
   *
   * 跟定位同一个开关（`geoEnabled`）—— 用户开这个开关要的就是
   * "他知道我在哪、外面什么样"，拆成两个开关反而要多想一次。
   *
   * 只认 **1 小时内**的天气：报"现在晴"其实是一早上的数据，比不报更糟。
   * 权限页那边的 see_location 闸同样管着它（天气也要靠地点才查得到）。
   */
  if (st.settings.geoEnabled && modeOf("see_location") !== "deny" && st.settings.weatherText) {
    const wAge = Date.now() - (st.settings.weatherAt ?? 0);
    if (wAge < 3600_000) {
      out.push({
        id: "weather",
        title: "他那边的天气",
        text: `${st.settings.weatherText}（${Math.max(1, Math.round(wAge / 60000))} 分钟前查的）`,
      });
    }
  }

  // 长期记忆是他自己写下的笔记：只要没被「直接拒绝」，就该能读到
  if (modeOf("memory") !== "deny") {
    out.push({
      id: "memory",
      title: "长期记忆",
      text: st.memories.length
        ? clip(
            st.memories.filter((m) => m.status === "active").map((m) => m.content),
            6,
          )
        : "（还没记过什么）",
    });
  }

  // 当前 / 最近一局游戏（由游戏页主动上报；太旧的就不提了）
  if (
    canRead("gobang_read") &&
    st.gameContext &&
    Date.now() - st.gameContext.at < 30 * 60 * 1000
  ) {
    out.push({
      id: "gobang_read",
      title: "棋局",
      text: `${st.gameContext.game}：${st.gameContext.detail}`,
    });
  }

  // 花园：他今天在池塘钓到什么（竹篮和踪迹读的是同一份记录，见 lib/garden-catch）
  if (canRead("read_garden")) {
    const g = gardenStats();
    if (g.fish + g.junk > 0) {
      const recent = recentTrace(3);
      const latestName =
        g.latest?.kind === "fish"
          ? findSpecies(g.latest.ref)?.zh
          : undefined;
      out.push({
        id: "read_garden",
        title: "花园里的事",
        text:
          `池塘里一共 ${g.fish} 条鱼、${g.junk} 样别的东西，钓到过 ${g.species} 个种类；今天钓到 ${g.todayFish} 条` +
          (latestName ? `；最近一条是${latestName}` : "") +
          (recent.length ? `；最近：${recent.map((r) => `${r.time} ${r.text}`).join("、")}` : ""),
      });
    }
  }

  // 他可以挑的阅读材料
  if (canRead("pick_reading")) {
    out.push({
      id: "pick_reading",
      title: "可挑的阅读材料",
      text: READINGS.map((r, i) => `${i + 1}. ${r.title}（${r.level}）`).join("；"),
    });
  }

  if (canRead("read_music")) {
    const t = p.tracks.find((x) => x.id === p.currentId);
    out.push({
      id: "read_music",
      title: "音乐库",
      text: p.tracks.length
        ? `${p.tracks.length} 首：${clip(p.tracks.map((x) => x.name), 6)}${
            t ? `；此刻：${t.name}（${p.playing ? "播放中" : "暂停"}）` : ""
          }`
        : "（音乐库是空的）",
    });
  }

  if (canRead("read_games")) {
    const g = st.gameStats.gobang;
    const total = g.win + g.loss + g.draw;
    out.push({
      id: "read_games",
      title: "游戏战绩",
      text: total ? `五子棋 共 ${total} 局：胜 ${g.win} 负 ${g.loss} 和 ${g.draw}` : "（还没玩过）",
    });
  }

  if (canRead("read_learn")) {
    const l = st.learnStats;
    out.push({
      id: "read_learn",
      title: "学习进度",
      text: l.seen ? `英语看过 ${l.seen} 次卡片；最近：${clip(l.recent, 6)}` : "（还没开始）",
    });
  }

  if (canRead("read_device")) {
    if (typeof window !== "undefined") {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      out.push({
        id: "read_device",
        title: "设备与环境",
        text: `${tz} · ${navigator.language} · ${window.innerWidth}×${window.innerHeight} · ${
          navigator.onLine ? "在线" : "离线"
        }`,
      });
    }
  }

  if (canRead("read_settings")) {
    const s = st.settings;
    const model = MODELS.find((m) => m.id === st.model)?.label ?? st.model;
    out.push({
      id: "read_settings",
      title: "当前设置",
      text: `主题 ${s.theme} · 模型 ${model} · 字体 ${s.font} · 回复风格 ${s.replyStyle} · 思考链${
        s.showThinking ? "显示" : "不显示"
      }`,
    });
  }

  return out;
}

/** 发给服务端的完整上下文。 */
export function buildContext(): ChatContext {
  const st = useApp.getState();
  const p = usePlayer.getState();
  const t = p.tracks.find((x) => x.id === p.currentId);

  // 「已授权」只列真正有动作可执行的那些，读权限不算。
  // ⚠️ 没有挂权限的动作（emotion.report 这种）不在里面 —— 它本来就不需要授权。
  const actionable = [
    ...new Set(Object.values(ACTION_PERMISSION).filter((id): id is string => Boolean(id))),
  ];

  return {
    now: new Date().toLocaleString("zh-CN", { hour12: false }),
    activity: st.activity
      ? `${st.activity.label}${st.activity.detail ? ` · ${st.activity.detail}` : ""}`
      : undefined,
    recent: st.recentActivity
      .slice(0, 6)
      .map((a) => `${a.label}${a.detail ? `（${a.detail}）` : ""}`),
    nowPlaying: t ? `${t.name}（${p.playing ? "播放中" : "暂停"}）` : undefined,
    /**
     * 天气**单独带一份**。
     *
     * 虽然 buildAwarenessItems 里也有它，但那是"允许你了解的事项"清单里的一条，
     * 语气像资料。天气该像"此刻"——跟时间、在做什么并列，
     * 他才会自然地说"你那边下雨了，带伞没"，而不是念一句资料。
     *
     * 权限跟定位同一条闸（see_location）：天气也要靠地点才查得到。
     */
    weather:
      st.settings.geoEnabled &&
      modeOf("see_location") !== "deny" &&
      st.settings.weatherText &&
      Date.now() - (st.settings.weatherAt ?? 0) < 3600_000
        ? st.settings.weatherText
        : undefined,
    granted: actionable
      .filter((id) => modeOf(id) === "allow")
      .map((id) => permissionDef(id)?.title ?? id),
    aware: buildAwarenessItems().map((i) => `${i.title}：${i.text}`),
  };
}
