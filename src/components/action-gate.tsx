import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { permissionDef } from "@/lib/permissions";
import type { PermissionMode } from "@/lib/types";
import { runAction } from "@/lib/actions";
import { runGuarded } from "@/lib/gate-run";
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
 *  - **没有挂权限的动作（`permission` 是 undefined，如 `emotion.report`）→ 直接执行**，
 *    既不弹卡片也没有权限可记（2026-10 删掉「情绪权限」那一项之后就是这条路）
 *
 * L4（密钥、数据外传、上传文件）根本不会到达这里，在入队前就被拒了。
 */
export function ActionGate() {
  const pending = useApp((s) => s.pendingActions);
  const permissions = useApp((s) => s.settings.permissions);
  const navigate = useNavigate();

  const current = pending[0] ?? null;
  const def = current?.permission ? permissionDef(current.permission) : undefined;
  const critical = def?.risk === "L3";
  /**
   * ⚠️ 这里**不能**写成 `permissions[current.permission] ?? "ask"`：没有权限的动作
   * 会掉进"询问"那条路、弹出一张"某项权限"的卡片，等于把已经删掉的情绪权限
   * 变相塞回来（情绪上报会被卡住等人点）。没有权限 = **不需要授权 = 直接放行**。
   */
  const mode: PermissionMode = !current
    ? "ask"
    : !current.permission
      ? "allow"
      : (permissions[current.permission] ?? "ask");

  const go = (p: string) => void navigate({ to: p as unknown as "/" });

  /**
   * 「自动执行（不弹卡片）这条路要慢到值得说一声」才显示提示条。
   *
   * 为什么需要它：这条路人眼原本什么都看不到 —— 真机踩过"发出去的动作全挂着、
   * 连卡片都没有"。快了（几百毫秒内）就别闪一下，免得每次导航都冒个条。
   */
  const [slowRun, setSlowRun] = useState(false);
  useEffect(() => {
    setSlowRun(false);
    if (!current || critical || mode === "ask") return;
    const t = setTimeout(() => setSlowRun(true), 400);
    return () => clearTimeout(t);
  }, [current, critical, mode]);

  /**
   * ⚠️ **必须走 `runGuarded`**（见 `lib/gate-run.ts` 的文件头）：
   * 原来这里是裸的 `await runAction(...)`，一旦它抛错或卡住，`resolveAction` 就
   * 永远不会被调用 → 这笔动作一直占着队头 → **后面所有动作既没有卡片也不动**。
   * 用户真机原话："明明我已经允许的权限他也卡住了，发出去的动作全挂着。"
   */
  useEffect(() => {
    if (!current || critical || mode === "ask") return;
    const action = current.action;
    const id = current.id;
    const permission = current.permission;
    if (mode === "allow") {
      void (async () => {
        const r = await runGuarded(() => runAction(action, { navigate: go }));
        /** 失败/超时那两句自己就是完整的人话，**不加**"按你的授权直接执行"这个前缀（会自相矛盾） */
        const msg = r.ok
          ? permission
            ? `按你的授权直接执行：${r.message}`
            : `这个动作不用授权，直接执行：${r.message}`
          : r.message;
        useApp.getState().resolveAction(id, true, false, msg);
      })();
    } else {
      useApp.getState().resolveAction(id, false, false, "你之前把这项设为「拒绝」");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, critical, mode]);

  if (!current) return null;
  if (!critical && mode !== "ask") {
    /** 自动执行中：不挡操作，只让用户知道"正在跑哪一个"（见上面 slowRun 的说明） */
    if (!slowRun) return null;
    return (
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-6">
        <div className="glass-menu pointer-events-auto rounded-full px-3.5 py-1.5 text-[11px] text-muted shadow-lg">
          ⏳ 正在执行：{current.title}
        </div>
      </div>
    );
  }

  async function approve(remember: boolean) {
    if (!current) return;
    const id = current.id;
    const r = await runGuarded(() => runAction(current.action, { navigate: go }));
    useApp.getState().resolveAction(id, true, remember, r.message);
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
          <p className="text-[12px] font-medium">{def?.title ?? current.permission ?? ""}</p>
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
