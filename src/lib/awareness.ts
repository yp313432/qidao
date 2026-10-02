import { ACTION_PERMISSION } from "@/lib/action-meta";
import type { ChatContext } from "@/lib/chat-client";
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

const MOOD: Record<string, string> = {
  calm: "平静",
  happy: "开心",
  tired: "疲惫",
  down: "低落",
  excited: "兴奋",
};

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
      .map((d) => `「${MOOD[d.mood] ?? d.mood}」${excerpt(d.body, 16)}`);
    out.push({
      id: "read_diary",
      title: "日记",
      text: st.diary.length ? `共 ${st.diary.length} 条 · ${recent.join("；")}` : "（还没有日记）",
    });
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

  // 定位（用户手动开的才进这里；两小时前的就不提了，免得说"你现在在…"其实是昨天）
  if (st.settings.geoEnabled && st.settings.geoLabel) {
    const age = Date.now() - (st.settings.geoAt ?? 0);
    if (age < 2 * 3600_000) {
      out.push({
        id: "geo",
        title: "他现在在哪",
        text: `${st.settings.geoLabel}（${Math.max(1, Math.round(age / 60000))} 分钟前定位）`,
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

  // 「已授权」只列真正有动作可执行的那些，读权限不算
  const actionable = [...new Set(Object.values(ACTION_PERMISSION))];

  return {
    now: new Date().toLocaleString("zh-CN", { hour12: false }),
    activity: st.activity
      ? `${st.activity.label}${st.activity.detail ? ` · ${st.activity.detail}` : ""}`
      : undefined,
    recent: st.recentActivity
      .slice(0, 6)
      .map((a) => `${a.label}${a.detail ? `（${a.detail}）` : ""}`),
    nowPlaying: t ? `${t.name}（${p.playing ? "播放中" : "暂停"}）` : undefined,
    granted: actionable
      .filter((id) => modeOf(id) === "allow")
      .map((id) => permissionDef(id)?.title ?? id),
    aware: buildAwarenessItems().map((i) => `${i.title}：${i.text}`),
  };
}
