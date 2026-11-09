import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bug, Flower2, Music, NotebookPen, Orbit, Plus, Puzzle, Wrench, X } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { useLiquidShell } from "@/liquid/lib/drawer-state";
import { useApp } from "@/lib/store";

/**
 * 抽屉 = 玻璃面板，分三块（照用户 m08052/m08112 的定案与 v2 样张）：
 *
 *   栖岛                                    ← 品牌行
 *   对话  ┌ 可滑动的会话块列表 ┐            ← 框内滚动 + 上下渐隐（"对话多了不能翻不了"）
 *   功能  ┌ MCP 工具 / 动态空间 / 小日子 /   ← 比对话再糊一层（--frost）区分开
 *         花园 / 插件 / 音乐 / 桌宠（待定）┐
 *   我的头像（点了进设置）      ＋ 新建会话   ← 玻璃描边胶囊（用户 m08139 定的）
 *
 * 这一版全部接真（用户 m08214"就把之前那些东西放到现在该放的位置" +
 * m08387"功能里面点开要真的点进去…重命名删除就在对话列表后面三个点，点开出现一个弹层"）：
 *   · 会话列表 / 新建 / 切换走 store
 *   · ⋯ 弹层里的 重命名 / 置顶 / 删除 调 `renameChat` / `pinChat` / `deleteChat`
 *   · 六个功能块真跳转（抽屉先关，再跳）
 */

const ENTRIES = [
  { icon: Wrench, label: "MCP 工具", to: "/tools" },
  { icon: Orbit, label: "动态空间", to: "/play/space" },
  { icon: NotebookPen, label: "小日子", to: "/play/days" },
  { icon: Flower2, label: "花园", to: "/play/garden" },
  { icon: Puzzle, label: "插件", to: "/play/plugins" },
  { icon: Music, label: "音乐", to: "/play/listen" },
] as const;

function stampOf(ts: number) {
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export function LiquidDrawer() {
  const { open, setOpen, setSettings } = useLiquidShell();
  const nav = useNavigate();
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const newChat = useApp((s) => s.newChat);
  const displayName = useApp((s) => s.settings.displayName);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setRowMenu(null);
      setRenameFor(null);
    }
  }, [open]);

  /** 抽屉里的跳转：先把抽屉收掉再走，免得返回时还停在打开态 */
  function go(to: string) {
    setOpen(false);
    void nav({ to });
  }

  return (
    <>
      <button
        type="button"
        className="lq-scrim"
        aria-label="收起侧边栏"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <aside className="lq-drawer lq-glass lq-glass--pane" aria-hidden={!open}>
        <div className="lq-drawer__head">
          <p className="lq-drawer__brand">栖 岛</p>
          <button
            type="button"
            className="lq-drawer__close"
            aria-label="关闭"
            onClick={() => setOpen(false)}
          >
            <X />
          </button>
        </div>

        <section className="lq-block">
          <p className="lq-block__cap">对话</p>
          <ul className="lq-convs">
            {conversations.length === 0 ? (
              <li className="lq-convs__empty">还没有保存的对话</li>
            ) : null}
            {conversations.map((conv) => (
              <li key={conv.id}>
                <div className="lq-conv" data-on={conv.id === activeId}>
                  <button
                    type="button"
                    className="lq-conv__row"
                    onClick={() => {
                      setActive(conv.id);
                      setOpen(false);
                    }}
                  >
                    {conv.title || "新对话"}
                  </button>
                  <span className="lq-conv__time">{stampOf(conv.updatedAt)}</span>
                  <button
                    type="button"
                    className="lq-conv__more"
                    aria-label="更多"
                    onClick={() => setRowMenu(rowMenu === conv.id ? null : conv.id)}
                  >
                    ⋯
                  </button>
                </div>
                {rowMenu === conv.id ? (
                  <div className="lq-conv__menu">
                    <button
                      type="button"
                      className="lq-conv__act"
                      onClick={() => {
                        setRenameFor({ id: conv.id, text: conv.title || "" });
                        setRowMenu(null);
                      }}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      className="lq-conv__act"
                      onClick={() => {
                        useApp.getState().pinChat(conv.id);
                        setRowMenu(null);
                      }}
                    >
                      {conv.pinned ? "取消置顶" : "置顶"}
                    </button>
                    <button
                      type="button"
                      className="lq-conv__act"
                      onClick={() => {
                        useApp.getState().deleteChat(conv.id);
                        setRowMenu(null);
                      }}
                    >
                      删除
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="lq-block lq-block--frost">
          <p className="lq-block__cap">功能</p>
          <div className="lq-tiles">
            {ENTRIES.map((entry) => (
              <button
                key={entry.label}
                type="button"
                className="lq-tile"
                onClick={() => go(entry.to)}
              >
                <entry.icon />
                <span>{entry.label}</span>
              </button>
            ))}
            <button type="button" className="lq-tile" data-todo="true">
              <Bug />
              <span>桌宠</span>
              <span className="lq-tile__soon">待定</span>
            </button>
          </div>
        </section>

        <div className="lq-foot">
          <button
            type="button"
            className="lq-me"
            aria-label="设置"
            onClick={() => {
              setOpen(false);
              setSettings(true);
            }}
          >
            <span className="lq-me__ava">
              <Avatar role="user" size={30} />
            </span>
            <span className="lq-me__meta">
              <span className="lq-me__name">{displayName || "我"}</span>
              <span className="lq-me__hint">点头像进设置</span>
            </span>
          </button>
          <button
            type="button"
            className="lq-newchat"
            onClick={() => {
              newChat();
              setOpen(false);
            }}
          >
            <Plus />
            <span>新建会话</span>
          </button>
        </div>
      </aside>

      {renameFor ? (
        <div className="lq-rename" role="dialog" aria-modal="true">
          <form
            className="lq-rename__box lq-glass lq-glass--float"
            onSubmit={(event) => {
              event.preventDefault();
              const name = renameFor.text.trim();
              if (name) useApp.getState().renameChat(renameFor.id, name);
              setRenameFor(null);
            }}
          >
            <p className="lq-rename__title">这一页叫什么</p>
            <input
              className="lq-rename__input"
              value={renameFor.text}
              autoFocus
              maxLength={40}
              onChange={(event) => setRenameFor({ id: renameFor.id, text: event.target.value })}
            />
            <div className="lq-rename__row">
              <button type="button" className="lq-rename__btn" onClick={() => setRenameFor(null)}>
                取消
              </button>
              <button type="submit" className="lq-rename__btn lq-rename__btn--go">
                改好
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
