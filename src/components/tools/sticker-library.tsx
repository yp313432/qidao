import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { stickerFromFile } from "@/lib/attachments";
import { DEFAULT_STICKER_GROUP, stickerGroupList, type Sticker } from "@/lib/stickers";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { stripWhiteBackground } from "@/lib/white-removal";

/**
 * **表情库**（工具 → 表情）。
 *
 * 用户原话（2026-11）：
 *   "表情包能不能做成一个库，我传到库里，他从我传的库里挑，并且库里带分组，我自己分……"
 *   然后看了微信的表情管理页之后：
 *   "你看你那个表情包是不是贴在一个小组件里面，能不能把它就变成微信这样一个个排列下来
 *    就行了。然后点击可以放大，也可以删除。不要后面还留着一个组件的，直接放在底层那种。"
 *
 * ── 所以布局照微信来 ────────────────────────────────────────
 *   · 图**直接铺在网格里**（没有卡片底、每张后面**不挂下拉框**）
 *   · **点一下放大**；放大那一层里才放「移到分组」「删除」（重活收进二级）
 *   · 网格**最后一个格子是「＋」**，跟微信一样用来加图
 *   · 分组条留在最上面（他按分组名点名，所以要能建/改/删）
 */
export function StickerLibrary() {
  const lib = useApp((s) => s.stickerLib);
  const savedGroups = useApp((s) => s.stickerGroups);
  const removeWhite = useApp((s) => s.settings.stickerRemoveWhite !== false);
  const [active, setActive] = useState<string>(DEFAULT_STICKER_GROUP);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  /** 放大看的那一张（null = 没开） */
  const [preview, setPreview] = useState<Sticker | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = stickerGroupList(lib, savedGroups);
  const list: Sticker[] = lib.filter((s) => (s.group || DEFAULT_STICKER_GROUP) === active);

  async function upload(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setBusy(true);
    setMsg("");
    let added = 0;
    for (const f of imgs) {
      let url = await stickerFromFile(f);
      if (removeWhite) {
        const transparent = await stripWhiteBackground(url);
        if (transparent) url = transparent;
      }
      useApp.getState().addSticker(url, active);
      added += 1;
    }
    setBusy(false);
    setMsg(`加进「${active}」了 ${added} 张`);
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* ── 分组条（他点名用的就是这些名字） ── */}
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <span key={g} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActive(g)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12px]",
                active === g ? "bg-ink text-ink-fg" : "bg-chip text-muted",
              )}
            >
              {g}
              <span className="ml-1 text-[10px] opacity-70">
                {lib.filter((s) => (s.group || DEFAULT_STICKER_GROUP) === g).length}
              </span>
            </button>
            {g !== DEFAULT_STICKER_GROUP && (
              <>
                <button
                  type="button"
                  aria-label={`重命名分组 ${g}`}
                  onClick={() => {
                    setRenaming(g);
                    setRenameTo(g);
                  }}
                  className="text-[11px] text-subtle"
                >
                  改
                </button>
                <button
                  type="button"
                  aria-label={`删除分组 ${g}`}
                  onClick={() => {
                    useApp.getState().removeStickerGroup(g);
                    if (active === g) setActive(DEFAULT_STICKER_GROUP);
                  }}
                  className="text-[11px] text-subtle"
                >
                  删
                </button>
              </>
            )}
          </span>
        ))}
      </div>

      {renaming ? (
        <div className="flex items-center gap-2">
          <input
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            className="min-w-0 flex-1 rounded-full bg-elevated px-3 py-1.5 text-[12px]"
            aria-label="新的分组名"
          />
          <button
            type="button"
            onClick={() => {
              useApp.getState().renameStickerGroup(renaming, renameTo);
              if (active === renaming) setActive(renameTo.trim() || DEFAULT_STICKER_GROUP);
              setRenaming(null);
            }}
            className="rounded-full bg-ink px-3 py-1.5 text-[12px] text-ink-fg"
          >
            存
          </button>
          <button type="button" onClick={() => setRenaming(null)} className="text-[12px] text-subtle">
            取消
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            placeholder="新分组名，比如 无语 / 抱抱"
            className="min-w-0 flex-1 rounded-full bg-elevated px-3 py-1.5 text-[12px]"
            aria-label="新分组名"
          />
          <button
            type="button"
            onClick={() => {
              const g = newGroup.trim();
              if (!g) return;
              useApp.getState().addStickerGroup(g);
              setActive(g);
              setNewGroup("");
            }}
            className="rounded-full border border-line px-3 py-1.5 text-[12px]"
          >
            新建
          </button>
        </div>
      )}

      {/* ── 图：直接铺开，一张挨一张（微信那样） ── */}
      <div className="grid grid-cols-4 gap-2">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-label={`放大这张表情（${s.group}）`}
            onClick={() => setPreview(s)}
            className="block"
          >
            <img
              src={s.url}
              alt={`表情 ${s.group}`}
              className="aspect-square w-full object-contain"
            />
          </button>
        ))}
        {/* 最后一个格子永远是「＋」（跟微信一样） */}
        <button
          type="button"
          aria-label="加表情"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex aspect-square w-full items-center justify-center rounded-xl border border-dashed border-line text-muted"
        >
          {busy ? (
            <span className="text-[10px]">处理中…</span>
          ) : (
            <Plus className="size-5" strokeWidth={1.6} aria-hidden="true" />
          )}
        </button>
      </div>

      <p className="text-[11px] leading-4 text-subtle">
        {list.length === 0 ? "这个分组还是空的 —— " : ""}
        点一下图可以放大；放大那一层里能**删除**或**移到别的分组**。新加的图进「{active}」
        {removeWhite ? "，白底会自动变透明" : "（去白底现在关着）"}。
      </p>
      {msg && <p className="text-[11px] leading-4 text-ok">{msg}</p>}

      {/* ── 放大那一层 ── */}
      {preview && (
        <div
          role="dialog"
          aria-label="表情预览"
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-6"
        >
          <img
            src={preview.url}
            alt="表情预览"
            className="max-h-[58vh] max-w-full object-contain"
          />
          <div className="flex flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
            <select
              value={preview.group || DEFAULT_STICKER_GROUP}
              onChange={(e) => {
                useApp.getState().moveSticker(preview.id, e.target.value);
                setPreview({ ...preview, group: e.target.value });
              }}
              aria-label="移到别的分组"
              className="rounded-full bg-elevated px-3 py-2 text-[12px] text-fg"
            >
              {groups.map((g) => (
                <option key={g} value={g}>
                  移到：{g}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                useApp.getState().removeSticker(preview.id);
                setPreview(null);
              }}
              className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12px] text-warn"
            >
              <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              删除
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-full bg-ink px-4 py-2 text-[12px] text-ink-fg"
            >
              关闭
            </button>
          </div>
          <p className="text-[11px] text-white/50">点空白处也能关</p>
        </div>
      )}
    </div>
  );
}
