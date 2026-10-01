import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { permissionDef } from "@/lib/permissions";
import { runAction } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 动作闸门 —— 最后一道关。
 *
 *  - 该项权限是「允许」→ 直接执行，只在日志里留痕
 *  - 「拒绝」→ 直接驳回
 *  - 「询问」→ 弹这张卡片，你点同意才执行
 *  - **L3 破坏性动作（删除、清空、重置）→ 无论你设成什么，都要再确认一次**，
 *    而且不给「以后都允许」—— 破坏性操作不该被记住
 *
 * L4（密钥、数据外传、上传文件）根本不会到达这里，在入队前就被拒了。
 */
export function ActionGate() {
  const pending = useApp((s) => s.pendingActions);
  const permissions = useApp((s) => s.settings.permissions);
  const navigate = useNavigate();

  const current = pending[0] ?? null;
  const def = current ? permissionDef(current.permission) : undefined;
  const critical = def?.risk === "L3";
  const mode = current ? (permissions[current.permission] ?? "ask") : "ask";

  const go = (p: string) => void navigate({ to: p as unknown as "/" });

  // 已授权允许 / 拒绝的，不打扰用户。但 L3 必须每次都问。
  useEffect(() => {
    if (!current || critical || mode === "ask") return;
    const action = current.action;
    const id = current.id;
    if (mode === "allow") {
      void (async () => {
        const msg = await runAction(action, { navigate: go });
        useApp.getState().resolveAction(id, true, false, `按你的授权直接执行：${msg}`);
      })();
    } else {
      useApp.getState().resolveAction(id, false, false, "你之前把这项设为「拒绝」");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, critical, mode]);

  if (!current) return null;
  if (!critical && mode !== "ask") return null;

  async function approve(remember: boolean) {
    if (!current) return;
    const id = current.id;
    const msg = await runAction(current.action, { navigate: go });
    useApp.getState().resolveAction(id, true, remember, msg);
  }

  function deny(remember: boolean) {
    if (!current) return;
    useApp.getState().resolveAction(current.id, false, remember, "你拒绝了这次请求");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-fg/25" />
      <div
        className={cn(
          "glass-menu relative z-10 w-full max-w-sm rounded-[2rem] px-5 py-5",
          critical && "ring-2 ring-warn/50",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 text-[12px]",
            critical ? "text-warn" : "text-muted",
          )}
        >
          {critical ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
          {critical ? `${current.from} 要做一件破坏性的事` : `${current.from} 想做一个操作`}
        </div>

        <p className="mt-3 text-[17px] leading-7 font-medium">{current.title}</p>

        <div className="mt-3 rounded-2xl bg-chip px-3.5 py-3">
          <p className="text-[12px] font-medium">{def?.title ?? current.permission}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">{def?.hint ?? ""}</p>
          {critical && (
            <p className="mt-1.5 text-[11px] leading-4 text-warn">
              这类操作删掉就找不回来了，所以不会记住你的授权 —— 每次都会问你。
            </p>
          )}
        </div>

        {critical ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void approve(false)}
              className="rounded-full bg-warn px-4 py-3 text-sm font-medium text-ink-fg"
            >
              确认执行
            </button>
            <button
              type="button"
              onClick={() => deny(false)}
              className="rounded-full bg-chip px-4 py-3 text-sm font-medium"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void approve(false)}
              className="rounded-full bg-ink px-4 py-3 text-sm font-medium text-ink-fg"
            >
              允许一次
            </button>
            <button
              type="button"
              onClick={() => void approve(true)}
              className="rounded-full bg-chip px-4 py-3 text-sm font-medium"
            >
              以后都允许
            </button>
            <button
              type="button"
              onClick={() => deny(false)}
              className="rounded-full bg-chip px-4 py-3 text-sm"
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() => deny(true)}
              className="rounded-full bg-chip px-4 py-3 text-sm text-muted"
            >
              以后都拒绝
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
