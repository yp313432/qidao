import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PromptDialog } from "@/components/shared/prompt-dialog";
import { KButton, KEmpty, KFold, KOpt, KOpts, KSwitch } from "@/components/ui-kit";
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
 *
 * 2026-11-07 用户点过一遍之后的改动：
 *  · 顶上那张"这里是给他的规矩…"说明卡 → 删（解释话不用写，页面自己会说话）；
 *  · 全部换成标准件（`.k-card` / `KFold` / `KSwitch` / `KOpt` / `KButton`），不再自绘圆角卡；
 *  · 「硬要求 · 说明书（内置）」→ 改名**内置系统提示词**，只留标题 + 一个"开"的开关 +
 *    点开看全文（正文折在 `KFold` 里，平时不占地方）。那个开关是**只读指示**：
 *    这份内置文本每轮强制注入，没有"关掉"这回事，所以是 disabled 的。
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
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [position, setPosition] = useState<"system" | "tail">("system");

  /**
   * ⚠️ 一律 `(e.keywords ?? [])`：老档/搬坏过的档里**可能没有这个键**，
   * 直接 `.length` 就是整页红屏（2026-10 真机截图抓到的就是这个）。
   * 进 store 的那道口（`normalizeWorldBook`）会补，这里再兜一层 ——
   * 页面宁可显示成"一直生效"，也绝不能崩。
   */
  const always = entries.filter((e) => e.position === "system" || (e.keywords ?? []).length === 0);
  const triggered = entries.filter((e) => e.position === "tail" && (e.keywords ?? []).length > 0);
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

  function EntryCard({ e }: { e: WorldEntry }) {
    /**
     * 编辑弹层的状态（用户 m11475：原来的 `window.prompt` 是安卓原生白卡片，
     * 而且**原文没带进去**，想加一句话也得整段重打）。
     */
    const [edit, setEdit] = useState<null | "content" | "keywords">(null);
    const keys = e.keywords ?? [];

    return (
      <div className="k-card">
        <div className="k-card__head">
          <div className="k-row__body">
            <span className="k-row__title">
              {e.title ?? (keys.length ? "聊到才生效" : "一直生效")}
            </span>
            <span className="k-row__meta">
              {keys.length > 0 ? keys.map((k) => `「${k}」`).join(" ") : "每次都会读到"}
            </span>
          </div>
          <KSwitch
            checked={e.enabled}
            onChange={() => toggle(e.id)}
            label={`${e.enabled ? "关掉" : "打开"}这条世界书`}
          />
        </div>

        <p className={cn("mt-3 whitespace-pre-wrap", e.enabled ? "k-long" : "k-long opacity-60")}>
          {e.content}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <KButton onClick={() => setEdit("content")}>改内容</KButton>
          {e.position === "tail" && <KButton onClick={() => setEdit("keywords")}>改关键词</KButton>}
          <KButton
            variant="icon"
            className="ml-auto"
            aria-label="删除这条"
            onClick={() => remove(e.id)}
          >
            <Trash2 />
          </KButton>
        </div>

        <PromptDialog
          open={edit === "content"}
          title="改这条"
          hint="原文已经填好，接着改就行。清空并保存 = 删掉这条。"
          defaultValue={e.content}
          multiline
          placeholder="写给他看的规矩…"
          confirmText="保存"
          onCancel={() => setEdit(null)}
          onConfirm={(next) => {
            setEdit(null);
            if (!next.trim()) remove(e.id);
            else update(e.id, { content: next.trim() });
          }}
        />
        <PromptDialog
          open={edit === "keywords"}
          title="改关键词"
          hint="用空格分开，比如：塔罗 抽卡 牌"
          defaultValue={keys.join(" ")}
          onCancel={() => setEdit(null)}
          onConfirm={(next) => {
            setEdit(null);
            update(e.id, {
              keywords: next
                .split(/[\s,，、]+/)
                .map((k) => k.trim())
                .filter(Boolean),
            });
          }}
        />
      </div>
    );
  }

  return (
    <div className="k-page">
      <PageHeader
        title="世界书"
        right={
          <span className="mr-1 flex items-center gap-2">
            <span className="k-stat">开着 {onCount}</span>
            <KButton
              variant="icon"
              aria-label={adding ? "收起" : "加一条"}
              onClick={() => setAdding((v) => !v)}
            >
              <Plus
                className={cn("transition-transform", adding && "rotate-45")}
                strokeWidth={1.7}
              />
            </KButton>
          </span>
        }
      />

      <div ref={scrollRef} className="k-scroll k-list k-nav-space mt-2 min-h-0 flex-1">
        {/* 内置系统提示词：每轮强制注入、用户改不了（故意的），所以只给一个"开"的只读指示 */}
        <KFold
          title="内置系统提示词"
          meta="每轮强制注入"
          trailing={
            <KSwitch
              checked
              disabled
              onChange={() => {}}
              label="内置系统提示词 · 一直开启，改不了"
            />
          }
        >
          <pre className="k-long">{builtinText}</pre>
          <KButton
            variant="dashed"
            block
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
          >
            换过模型后，让他复述一遍
          </KButton>
        </KFold>

        {adding && (
          <div className="k-card">
            <div className="flex flex-col gap-3">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                placeholder="写给他的话，例如：思考别超过十步，先给结论"
                className="k-input k-long--input"
              />
              <KOpts cols={2}>
                {(["system", "tail"] as const).map((p) => (
                  <KOpt key={p} active={position === p} onClick={() => setPosition(p)}>
                    {p === "system" ? "一直生效" : "聊到才生效"}
                  </KOpt>
                ))}
              </KOpts>
              {position === "tail" && (
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="关键词（空格分开），例如：论文 导师"
                  className="k-input"
                />
              )}
              <KButton variant="primary" block onClick={submit} disabled={!content.trim()}>
                加进世界书
              </KButton>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="k-sect">
            <span className="k-sect__title">一直生效</span>
            <span className="k-sect__act">{always.length}</span>
          </div>
          {always.length === 0 ? (
            <KEmpty title="还没有常驻条目" hint="他每次开口前都会读到的规矩放这里。" />
          ) : (
            always.map((e) => <EntryCard key={e.id} e={e} />)
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="k-sect">
            <span className="k-sect__title">聊到才生效</span>
            <span className="k-sect__act">{triggered.length}</span>
          </div>
          {triggered.length === 0 ? (
            <KEmpty title="还没有触发条目" hint="聊到某些词才注入的规矩放这里。" />
          ) : (
            triggered.map((e) => <EntryCard key={e.id} e={e} />)
          )}
        </div>
      </div>
    </div>
  );
}
