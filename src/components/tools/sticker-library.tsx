import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { stickerFromFile } from "@/lib/attachments";
import {
  DEFAULT_STICKER_GROUP,
  stickerGroupList,
  type Sticker,
} from "@/lib/stickers";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { stripWhiteBackground } from "@/lib/white-removal";

/**
 * **表情库**（工具 → 表情）。
 *
 * 用户原话（2026-11）：
 *   "表情包能不能做成一个库，我传到库里，他从我传的库里挑，并且库里带分组，
 *    我自己分，然后他就可以用了，这个库放在工具区吧……把库放文档那里吧。"
 *
 * ── 这里做三件事 ──────────────────────────────────────────────
 *   1. **传**：选一批图 → 自动去白底（可关）→ 进**当前分组**
 *      （动图/透明格式不会被重画，见 `stickerFromFile`）
 *   2. **分组**：新建 / 改名 / 删除（**删组不删图**，组里的图回到「未分组」）
 *      分组名就是他发的时候点名用的那串字（`sticker.send` 的 `feel`）
 *   3. **挪/删**：每张下面能选"移到哪个组"，右上角 ✕ 是删
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
    setMsg(`加进「${active}」了 ${added} 张${removeWhite ? "（已去白底）" : ""}`);
  }

  return (
    <div className="space-y-4">
      {/* ── 传 ── */}
      <div className="rounded-2xl bg-chip px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] leading-5">
            传到「<span className="text-fg">{active}</span>」
            <br />
            <span className="text-subtle">
              现在传：{active === DEFAULT_STICKER_GROUP ? "没选分组，先进未分组" : active}
            </span>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex shrink-0 items-center gap-1.5 rounded-2xl border border-line px-3 py-2 text-[12px]"
          >
            <Upload className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            {busy ? "处理中…" : "选图"}
          </button>
        </div>
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
        <p className="mt-2 text-[11px] leading-4 text-subtle">
          {removeWhite
            ? "白底会自动变透明（图内部的白留住）。动图/透明图不会被重画 —— 动画保留。"
            : "去白底是关着的（我的 → 系统 → 表情包）—— 白底照片会带着白边进库。"}
        </p>
        {msg && <p className="mt-2 text-[11px] leading-4 text-ok">{msg}</p>}
      </div>

      {/* ── 分组 ── */}
      <div>
        <p className="mb-2 text-[12px] text-muted">分组（他发的时候按这个名字点名）</p>
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
          <div className="mt-2 flex items-center gap-2">
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
            <button
              type="button"
              onClick={() => setRenaming(null)}
              className="text-[12px] text-subtle"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
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
        <p className="mt-1.5 text-[11px] leading-4 text-subtle">
          删分组**不会删图** —— 组里的表情会回到「未分组」。分组名就是他点名用的词，
          所以取「无语」「抱抱」这种他好理解的词最有用。
        </p>
      </div>

      {/* ── 图 ── */}
      <div>
        <p className="mb-2 text-[12px] text-muted">
          「{active}」里的表情（{list.length} 张）
        </p>
        {list.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-subtle">这个分组还是空的</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {list.map((s) => (
              <div key={s.id} className="relative rounded-xl bg-chip p-1">
                <img
                  src={s.url}
                  alt={`表情 ${s.group}`}
                  className="mx-auto max-h-20 max-w-full object-contain"
                />
                <button
                  type="button"
                  aria-label="删除这张表情"
                  onClick={() => useApp.getState().removeSticker(s.id)}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-ink-fg"
                >
                  <Trash2 className="size-2.5" strokeWidth={2} aria-hidden="true" />
                </button>
                <select
                  value={s.group || DEFAULT_STICKER_GROUP}
                  onChange={(e) => useApp.getState().moveSticker(s.id, e.target.value)}
                  aria-label="移到别的分组"
                  className="mt-1 w-full rounded-lg bg-elevated px-1 py-0.5 text-[10px]"
                >
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
