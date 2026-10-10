import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { buildAwarenessItems } from "@/lib/awareness";
import { usePlayer } from "@/lib/player";
import {
  GROUPS,
  PERMISSIONS,
  RISK_LABEL,
  STATUS_LABEL,
  permissionsOf,
  type PermStatus,
  type RiskLevel,
} from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { PermissionMode } from "@/lib/types";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn, formatClock } from "@/lib/utils";

const MODES: { id: PermissionMode; label: string }[] = [
  { id: "ask", label: "每次问我" },
  { id: "allow", label: "直接允许" },
  { id: "deny", label: "直接拒绝" },
];

const RISK_CLASS: Record<RiskLevel, string> = {
  L0: "bg-ok/15 text-ok",
  L1: "bg-surface text-muted",
  L2: "bg-warn/15 text-warn",
  L3: "bg-warn/25 text-warn",
  L4: "bg-warn/25 text-warn",
};

const STATUS_CLASS: Record<PermStatus, string> = {
  ready: "bg-ok/15 text-ok",
  partial: "bg-surface text-muted",
  todo: "bg-surface text-subtle",
  system: "bg-surface text-subtle",
  forbidden: "bg-warn/20 text-warn",
  needs_ai: "bg-surface text-muted",
};

export function PermissionsView() {
  const permissions = useApp((s) => s.settings.permissions);
  const activity = useApp((s) => s.activity);
  const recentActivity = useApp((s) => s.recentActivity);
  const actionLog = useApp((s) => s.actionLog);
  const theme = useApp((s) => s.settings.theme);
  useActivity("在看权限设置");
  const scrollRef = useScrollMemory("permissions");

  // 预览必须和真实请求体一致：这些数据一变就重算
  const awareKey = useApp(
    (s) =>
      `${s.docs.length}|${s.diary.length}|${s.conversations.length}|${s.thinkingArchive.length}|${
        s.gameStats.gobang.win + s.gameStats.gobang.loss + s.gameStats.gobang.draw
      }|${s.learnStats.seen}|${s.memories.length}`,
  );
  const nowPlayingName = usePlayer((s) => s.tracks.find((t) => t.id === s.currentId)?.name ?? "");
  const memories = useApp((s) => s.memories);

  // 预览读的是本地数据，服务端渲染时拿不到 —— 必须等挂载后再算，否则会水合不一致
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const aware = useMemo(
    () => (mounted ? buildAwarenessItems() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, permissions, activity, recentActivity, awareKey, nowPlayingName],
  );

  const usable = PERMISSIONS.filter((p) => p.status === "ready" || p.status === "partial").length;

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader
        title="AI 权限"
        right={<span className="px-3 text-[11px] text-muted">{usable}/{PERMISSIONS.length} 可用</span>}
      />

      {/* 分级说明 */}
      <div className="mx-4 mt-2 rounded-3xl border border-line bg-surface px-4 py-3.5">
        <p className="text-[12px] leading-5 text-muted">
          接入 AI 之后，他可以<span className="font-medium text-fg">请求</span>
          做下面这些事。每一项都按你这里的选择处理：
          <span className="font-medium text-fg">每次问我</span>会先弹卡片等你点同意；
          所有动作都在<span className="font-medium text-fg">这台设备</span>上执行。
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(["L0", "L1", "L2", "L3", "L4"] as RiskLevel[]).map((r) => (
            <span key={r} className={cn("rounded-full px-2 py-0.5 text-[10px]", RISK_CLASS[r])}>
              {r} {RISK_LABEL[r]}
            </span>
          ))}
          <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] text-ok">已可用</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">接AI后</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-subtle">待实现</span>
        </div>
      </div>

      {/*
        感知：他实际能看到什么 —— **默认收起**。
        用户（2026-11）："同界面上面那个他现在知道的这个板块也改成可折叠的那种，
        不然一条条列着太多了，太占页面了"。
        折叠用原生 `<details>`：跟下面"按组收着的权限"一个写法，不引状态、不占内存。
      */}
      <section className="mt-4 px-4">
        <details>
          <summary className="mb-2 flex cursor-pointer list-none items-center px-1 text-[12px] tracking-wide text-muted">
            <span>他现在知道的</span>
            <span className="ml-2 text-subtle">{aware.length} 项</span>
            <span className="ml-auto text-[11px] text-subtle">点开 ▾</span>
          </summary>
          <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
            <p className="text-[11px] leading-4 text-subtle">
              这就是随每条消息发出去的内容。把下面任意一项设成「直接拒绝」，这里对应的一行
              <span className="font-medium text-fg">立刻消失</span>。
            </p>
            {!mounted ? (
              <p className="mt-2.5 text-[12px] text-subtle">读取中…</p>
            ) : aware.length === 0 ? (
              <p className="mt-2.5 text-[12px] text-warn">感知权限全关着 —— 他对你一无所知。</p>
            ) : (
              <ul className="mt-2.5 space-y-1.5">
                {aware.map((a) => (
                  <li key={a.id} className="text-[11px] leading-4 break-words">
                    <span className="text-muted">{a.title}：</span>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            )}
          {/*
            自检按钮 —— **默认折叠**。
            用户："那排试一试也没必要，我对着权限列表也能让他一个一个测"。
            直接删掉有点可惜（它们不经过模型、直接触发动作，是查权限闸门最快的办法），
            所以收进"开发者自检"里，平时不占地方 ✅
          */}
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-subtle">
              开发者自检（不走模型，直接触发动作 —— 想省事就对着权限列表让他自己做）
            </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction(
                    { kind: "appearance.theme", theme: theme === "ink" ? "dawn" : "ink" },
                    "试一试",
                  )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：请求换主题
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction({ kind: "navigate", path: "/play/listen" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：请求切到音乐页
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().requestAction({ kind: "media.next" }, "试一试")}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：请求下一首
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction({ kind: "ui.highlight", text: "内容写入" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：高亮「内容写入」
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction({ kind: "ui.panel", panel: "lyrics" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：打开歌词面板
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction({ kind: "ui.style", style: "concise" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：改成简洁风格
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction({ kind: "ui.toggle", feature: "thinking", on: false }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：关掉思考链显示
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction({ kind: "appearance.font", font: "kai" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：换成楷体
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction({ kind: "chat.rename", title: "玻璃质感笔记" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：把当前对话改名
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().requestAction({ kind: "docs.archive" }, "试一试")}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：把当前对话存档
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction(
                  {
                    kind: "learn.addCard",
                    word: "quixotic",
                    phonetic: "/kwɪkˈsɒtɪk/",
                    pos: "adj.",
                    meaning: "不切实际的；堂吉诃德式的",
                    example: "He had a quixotic plan to save the world.",
                    exampleZh: "他有个拯救世界的、不切实际的计划。",
                  },
                  "试一试",
                )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：加个生词
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction(
                    { kind: "memory.add", note: "喜欢奶油纸页的配色，讨厌吵闹的动效" },
                    "试一试",
                  )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：记住一件事
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction({ kind: "reminder.add", text: "起来走两步", time: "15:00" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：设个提醒
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction(
                    { kind: "persona.set", persona: "说话简短，喜欢用比喻，不奉承。" },
                    "试一试",
                  )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：改他自己的设定
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction({ kind: "learn.speak", text: "serendipity" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：朗读 serendipity
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction({ kind: "learn.openReading", index: 1 }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：挑第二篇阅读
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction({ kind: "play.recordResult", result: "win" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：记一笔胜局
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().requestAction({ kind: "play.truth" }, "试一试")}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：抽一个真心话
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().requestAction({ kind: "play.gobang" }, "试一试")}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：陪你下一局五子棋
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction({ kind: "diary.deleteLast" }, "试一试")
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-warn"
            >
              试一试：删掉最近一条日记（L3，会二次确认）
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().requestAction({ kind: "media.clear" }, "试一试")}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-warn"
            >
              试一试：清空音乐库（L3）
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().requestAction({ kind: "data.reset" }, "试一试")}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-warn"
            >
              试一试：重置全部数据（L3）
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction(
                    { kind: "settings.setUpstream", apiKey: "sk-should-never-apply" },
                    "试一试",
                  )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-warn"
            >
              试一试：改上游密钥（L4，应当被直接拒绝）
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().requestAction({ kind: "ambience.play" }, "试一试")}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：播一段氛围音
            </button>
            <button
              type="button"
              onClick={() =>
                useApp
                  .getState()
                  .requestAction(
                    { kind: "media.import", url: "http://127.0.0.1:8097/import-demo.wav" },
                    "试一试",
                  )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：从网址导入一首
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction(
                  {
                    kind: "moment.post",
                    mood: "share",
                    text: "试一试：他刚发了一条动态。",
                  },
                  "试一试",
                )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：发一条动态
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction(
                  {
                    kind: "letter.write",
                    title: "试一试：一封短信",
                    body: "这是「试一试」写的一封信，用来验证写信这条路通不通。\n\n关掉之后，下次打开前端应该会跳出拆信动画。",
                  },
                  "试一试",
                )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：写一封信
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction(
                  {
                    kind: "date.add",
                    title: "试一试：一个日子",
                    at: (() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 30);
                      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    })(),
                    yearly: false,
                    note: "由「试一试」加的，用来验证记日子这条路。",
                  },
                  "试一试",
                )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：记一个重要日子
            </button>
            <button
              type="button"
              onClick={() =>
                useApp.getState().requestAction(
                  {
                    kind: "todo.add",
                    text: "试一试：他帮我记的一件待办",
                  },
                  "试一试",
                )
              }
              className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
            >
              试一试：帮我记一件待办
            </button>
          </div>
          </details>
        </div>
        </details>
      </section>

      {/* 他记住的事 —— **已隐藏**：它和「记忆库」是同一份数据（就是长期记忆的最近几条），
          留着只会让人以为有两套。记忆库才是完整视图（能看、能改、能删）✅
          保留代码是为了万一以后想改回"这里显示最近几条"的形态。 */}
      <section className="mt-4 hidden px-4">
        <h2 className="mb-2 flex items-center justify-between px-1 text-[12px] tracking-wide text-muted">
          <span>他记住的事</span>
          <span className="text-subtle">{memories.length} 条</span>
        </h2>
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          {memories.length === 0 ? (
            <p className="text-[12px] leading-5 text-subtle">
              还没有。他「记住一件事」之后会出现在这里 —— 只存在这台设备，随时可以删。
            </p>
          ) : (
            <ul className="space-y-2">
              {memories.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1 text-[12px] leading-5">{m.content}</span>
                  <button
                    type="button"
                    aria-label="删除记忆"
                    onClick={() => useApp.getState().removeMemory(m.id)}
                    className="shrink-0 text-[11px] text-subtle"
                  >
                    删
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 分组清单 */}
      {GROUPS.map((g) => {
        const list = permissionsOf(g.id);
        if (list.length === 0) return null;
        return (
          // 每组做成**可折叠**的：默认收起，点开才看细项
          //（用户："分级权限做成折叠的，每一级展开看有啥的，单列着太长了"）
          <details key={g.id} className="mt-5 px-4">
            <summary className="mb-2 flex cursor-pointer list-none items-center px-1 text-[12px] tracking-wide text-muted">
              {g.title}
              <span className="ml-2 text-subtle">{list.length} 项</span>
              <span className="ml-auto text-[11px] text-subtle">点开 ▾</span>
            </summary>
            {g.note && <p className="mb-2 px-1 text-[11px] leading-4 text-subtle">{g.note}</p>}
            <div className="divide-y divide-line rounded-3xl border border-line bg-surface px-4">
              {list.map((p) => {
                const mode = permissions?.[p.id] ?? (p.risk === "L0" ? "allow" : "ask");
                return (
                  <div key={p.id} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium">{p.title}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-muted">{p.hint}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap",
                            RISK_CLASS[p.risk],
                          )}
                        >
                          {p.risk}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap",
                            STATUS_CLASS[p.status],
                          )}
                        >
                          {STATUS_LABEL[p.status]}
                        </span>
                      </div>
                    </div>

                    {p.status === "forbidden" ? (
                      <p className="mt-2 text-[11px] leading-4 text-warn">
                        这类永远不会交给模型，只能你自己在界面上操作。
                      </p>
                    ) : (
                      // 不再套「轨道 + 高亮」两层白：选中项用一点深色底，反而更清楚
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        {MODES.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => useApp.getState().setPermission(p.id, m.id)}
                            className={cn(
                              "rounded-full py-1.5 text-[11px]",
                              mode === m.id
                                ? "bg-fg/10 font-medium text-fg"
                                : "text-muted",
                            )}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}

      {/*
        动作记录 —— **默认收起**（用户 2026-11："动作记录这个改成可折叠的吧，
        然后点击展开，不然太多了"）。
        ⚠️ 「清空」是 summary 里的按钮：必须 preventDefault + stopPropagation，
        否则点它会**顺带把折叠展开/收起**（原生 <details> 的默认行为）。
      */}
      <section className="mt-5 px-4">
        <details>
          <summary className="mb-2 flex cursor-pointer list-none items-center px-1 text-[12px] tracking-wide text-muted">
            <span>动作记录</span>
            <span className="ml-2 text-subtle">{actionLog.length} 条</span>
            <span className="ml-auto flex items-center gap-3">
              {actionLog.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    useApp.getState().clearActionLog();
                  }}
                  className="text-[11px] text-subtle"
                >
                  清空
                </button>
              )}
              <span className="text-[11px] text-subtle">点开 ▾</span>
            </span>
          </summary>
          <div className="rounded-3xl border border-line bg-surface px-4 py-3">
            {actionLog.length === 0 ? (
              <p className="text-[12px] text-subtle">还没有记录。他每次请求都会留在这里。</p>
            ) : (
              <ul className="space-y-2">
                {actionLog.slice(0, 12).map((l) => (
                  <li key={l.id} className="text-[11px] leading-4 break-words">
                    <span
                      className={cn("font-medium", l.result === "denied" ? "text-warn" : "text-ok")}
                    >
                      {l.result === "denied" ? "已拒绝" : l.result === "auto" ? "已记住" : "已允许"}
                    </span>
                    <span className="text-muted">
                      {" "}
                      {l.title} · {l.message} · {formatClock(l.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </section>
    </div>
  );
}
