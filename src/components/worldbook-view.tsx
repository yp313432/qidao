import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { resolveAiName } from "@/lib/branding";
import { buildManual } from "@/lib/manual";
import { PERMISSIONS } from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { WorldEntry } from "@/lib/types";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

/**
 * 世界书 / 思考引导。
 *
 * 用户的想法："把思考链做一个注入信息，像世界书一样，引导修改他的思考方式"。
 * 两种注入方式，界面上分开摆：
 *   · 一直生效 → 进系统提示词（很少改动，前缀缓存不受影响）
 *   · 聊到才生效 → 挂在最后一条用户消息尾部（系统提示词不动）
 */
export function WorldbookView() {
  useActivity("在编世界书");
  const scrollRef = useScrollMemory("worldbook");
  const entries = useApp((s) => s.worldBook);
  const toggle = useApp((s) => s.toggleWorldEntry);
  const remove = useApp((s) => s.removeWorldEntry);
  const update = useApp((s) => s.updateWorldEntry);
  const add = useApp((s) => s.addWorldEntry);
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const displayName = useApp((s) => s.settings.displayName);
  const permissions = useApp((s) => s.settings.permissions);
  const navigate = useNavigate();
  /** 内置的「硬要求 + 说明书」正文（跟真正注入的**完全同一份**，所见即所发） */
  const builtinText = buildManual({
    permissions,
    titles: PERMISSIONS.map((p) => ({ id: p.id, title: p.title })),
    displayName,
    aiName,
  });

  const [adding, setAdding] = useState(false);
  const [showBuiltin, setShowBuiltin] = useState(false);
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [position, setPosition] = useState<"system" | "tail">("system");

  const always = entries.filter((e) => e.position === "system" || e.keywords.length === 0);
  const triggered = entries.filter((e) => e.position === "tail" && e.keywords.length > 0);
  const onCount = entries.filter((e) => e.enabled).length;

  function submit() {
    const text = content.trim();
    if (!text) return;
    const keys = keywords
      .split(/[\s,，、]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    add({
      title: undefined,
      keywords: position === "tail" ? keys : [],
      content: text,
      position: position === "tail" && keys.length > 0 ? "tail" : "system",
    });
    setContent("");
    setKeywords("");
    setAdding(false);
  }

  function Row({ e }: { e: WorldEntry }) {
    return (
      <article className="rounded-3xl border border-line bg-surface px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={() => toggle(e.id)}
            aria-label={e.enabled ? "关掉" : "打开"}
            className={cn(
              "mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
              e.enabled ? "bg-accent" : "bg-chip",
            )}
          >
            <span
              className={cn(
                "block size-4 rounded-full bg-white shadow-sm transition-transform",
                e.enabled && "translate-x-4",
              )}
            />
          </button>
          <div className="min-w-0 flex-1">
            {e.title && <p className="text-[13px] font-medium text-fg">{e.title}</p>}
            <p className={cn("text-[13px] leading-5", e.enabled ? "text-fg" : "text-muted")}>
              {e.content}
            </p>
            {e.keywords.length > 0 ? (
              <p className="mt-1 text-[11px] text-subtle">
                聊到 {e.keywords.map((k) => `「${k}」`).join(" ")} 时才注入
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-subtle">一直生效</p>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const next = window.prompt("改这条（留空 = 删掉）", e.content);
                  if (next === null) return;
                  if (!next.trim()) remove(e.id);
                  else update(e.id, { content: next.trim() });
                }}
                className="rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
              >
                改内容
              </button>
              {e.position === "tail" && (
                <button
                  type="button"
                  onClick={() => {
                    const next = window.prompt("关键词（空格分开）", e.keywords.join(" "));
                    if (next === null) return;
                    update(e.id, {
                      keywords: next.split(/[\s,，、]+/).map((k) => k.trim()).filter(Boolean),
                    });
                  }}
                  className="rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
                >
                  改关键词
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(e.id)}
                className="ml-auto flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
              >
                <Trash2 className="size-3" />
                删除
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">世界书</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-label="加一条"
          className="mr-1 flex size-11 items-center justify-center rounded-full"
        >
          <Plus className={cn("size-5 transition-transform", adding && "rotate-45")} strokeWidth={1.7} />
        </button>
      </header>

      <section className="px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[13px] leading-5">
            这里是给{aiName}的<span className="text-fg">规矩</span>：他每次开口前都会读到。
          </p>
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            现在开着 {onCount} 条（共 {entries.length} 条）。
            想让回复短一点、别想太久 → 开「别想太久」和「先给结论」那两条；
            思考链太长时，经过代理的流式连接容易被掐断，最后只剩一条空回复。
          </p>
        </div>
      </section>

      {/* 硬要求 + 说明书：这是**内置**的，每轮都强制注入，用户改不了（故意的） */}
      <section className="mt-3 px-4">
        <div className="rounded-3xl border border-accent/35 bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">硬要求 · 说明书（内置）</p>
              <p className="mt-0.5 text-[11px] text-muted">
                诚实第一 · 让你做事就先做再说 · 做完如实汇报 · 不许猜 · 主动用权限
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBuiltin((v) => !v)}
              className="shrink-0 rounded-full bg-chip px-3 py-1.5 text-[12px] text-fg"
            >
              {showBuiltin ? "收起" : "看全文"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            这份东西**每轮都塞在系统提示词最前面** —— 换模型、换上游都一样读得到。
            你在下面「一直生效」里加的条目会接在它后面。
          </p>
          {showBuiltin && (
            <pre className="mt-2.5 max-h-80 overflow-y-auto rounded-2xl bg-chip px-3 py-2.5 text-[11px] leading-5 whitespace-pre-wrap text-muted">
              {builtinText}
            </pre>
          )}
          <button
            type="button"
            onClick={() => {
              // 把"检验他有没有真读"的问句塞进输入框（不自动发，你自己按发送）
              useApp
                .getState()
                .setChatDraft(
                  "composer",
                  "请把你必须遵守的硬要求逐条复述一遍，再把你现在被允许使用的权限列出来。",
                );
              void navigate({ to: "/" });
            }}
            className="mt-2.5 h-10 w-full rounded-2xl bg-ink text-[13px] font-medium text-ink-fg"
          >
            换过模型后点这里 → 让他复述一遍要求
          </button>
        </div>
      </section>

      {adding && (
        <section className="mt-3 px-4">
          <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              placeholder="写给他的话，例如：思考别超过十步，先给结论"
              className="w-full resize-none rounded-2xl bg-chip px-3 py-2.5 text-[13px] leading-5 outline-none"
            />
            <div className="mt-2 flex items-center gap-1.5">
              {(["system", "tail"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(p)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px]",
                    position === p ? "bg-accent text-accent-fg" : "bg-chip text-muted",
                  )}
                >
                  {p === "system" ? "一直生效" : "聊到才生效"}
                </button>
              ))}
            </div>
            {position === "tail" && (
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="关键词（空格分开），例如：论文 导师"
                className="mt-2 h-10 w-full rounded-2xl bg-chip px-3 text-[13px] outline-none"
              />
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!content.trim()}
              className="mt-2 h-10 w-full rounded-2xl bg-ink text-[13px] font-medium text-ink-fg disabled:opacity-40"
            >
              加进世界书
            </button>
          </div>
        </section>
      )}

      <section className="mt-4 px-4">
        <p className="mb-2 px-1 text-[12px] font-medium text-muted">一直生效（{always.length}）</p>
        <div className="space-y-2.5">
          {always.length === 0 ? (
            <p className="rounded-3xl border border-line bg-surface px-4 py-5 text-center text-[12px] text-muted">
              还没有常驻条目。
            </p>
          ) : (
            always.map((e) => <Row key={e.id} e={e} />)
          )}
        </div>
      </section>

      <section className="mt-4 px-4">
        <p className="mb-2 px-1 text-[12px] font-medium text-muted">聊到才生效（{triggered.length}）</p>
        <div className="space-y-2.5">
          {triggered.length === 0 ? (
            <p className="rounded-3xl border border-line bg-surface px-4 py-5 text-center text-[12px] text-muted">
              还没有触发条目。
            </p>
          ) : (
            triggered.map((e) => <Row key={e.id} e={e} />)
          )}
        </div>
      </section>

      <p className="mt-4 px-5 text-[11px] leading-5 text-subtle">
        「一直生效」的会进系统提示词（很少改动，所以不影响前缀缓存）；
        「聊到才生效」的挂在你说那句话的后面 —— 系统提示词一个字不动。
      </p>
    </div>
  );
}
