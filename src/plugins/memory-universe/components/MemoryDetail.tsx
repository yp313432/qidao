import type { Memory } from "../types"

/**
 * 底部记忆区（用户 2026-10 定的形态）：
 *
 * 不做卡片、不弹窗 —— 文字直接铺在星空底层，占屏高 33%、贴着屏幕最下面，
 * 上沿 78px 渐隐进星空（跟朋友圈那套一个手感）。内容往上翻，越过上界就被渐隐吃掉。
 *
 * 显示四样：两字标签 / 记下的日期 / 正文前两行 / 想起过几次 + 来源。
 */
function formatDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    return iso.slice(0, 10).replaceAll("-", ".")
  }
  return iso
}

function sourceLabel(memory: Memory): string {
  const at = memory.source?.at ?? formatDate(memory.createdAt)
  const label = memory.source?.label?.trim() || "对话"
  return `${label}里记下的 · ${at}`
}

export function MemoryDetail({
  memory,
  related,
  onSelectRelated,
}: {
  memory: Memory
  related: Memory[]
  onSelectRelated: (id: string) => void
}) {
  /** 两字标签：标题截前两个字（标题本身已经是「第一句、最长 14 字」） */
  const tag = (memory.title || memory.content || "").replace(/\s+/g, "").slice(0, 2) || "记忆"
  const kindLabel = KIND_LABEL[memory.category ?? ""] ?? "记忆"

  return (
    <aside className="mu-dock" aria-label={`${memory.title} 记忆`}>
      <div className="mu-dock-inner">
        <div className="mu-dock-tag">
          <span className="mu-dock-k">{tag}</span>
          <span className="mu-dock-d">
            {formatDate(memory.createdAt)} · {kindLabel}
          </span>
        </div>
        <p className="mu-dock-body">{memory.content}</p>
        <p className="mu-dock-foot">
          想起过 {memory.recallCount ?? 0} 次 · {sourceLabel(memory)}
        </p>
        {related.length ? (
          <div className="mu-dock-related">
            {related.map((r) => (
              <button key={r.id} type="button" onClick={() => onSelectRelated(r.id)}>
                {(r.title || "").replace(/\s+/g, "").slice(0, 4)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

/** 记忆分类 → 中文（与记忆库那边一致） */
const KIND_LABEL: Record<string, string> = {
  profile: "关于你",
  preference: "偏好",
  project: "项目",
  relationship: "关系",
  timeline: "日子",
  identity: "关于你",
  time: "日子",
  person: "关系",
  place: "地方",
  motif: "念想",
  quality: "性子",
}
