import { PageHeader } from "@/components/shared/page-header";
import { KFold, KOpt, KOpts } from "@/components/ui-kit";
import {
  GROUPS,
  PERMISSIONS,
  RISK_LABEL,
  STATUS_LABEL,
  permissionsOf,
  type PermStatus,
  type PermissionDef,
  type RiskLevel,
} from "@/lib/permissions";
import { useApp } from "@/lib/store";
import type { PermissionMode } from "@/lib/types";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { formatClock } from "@/lib/utils";

/**
 * AI 权限。
 *
 * 2026-11-07 用户点过一遍之后砍掉两块：
 *  · 顶上那个"分级说明"圆角框（L0–L4 图例 + 三句解释）—— 解释话太多，删。风险档位改成
 *    直接写在每条权限的标签里（`L2 写入` 一眼就懂），图例就不需要了；
 *  · 「他现在知道的」整块（感知预览 + 开发者自检，原 400 行）—— "我都能找到，又总结一遍，
 *    很占地方"，删。
 *
 * 现在整页只有两样东西：**按组分开的权限卡**（卡片式，展开看细项）+ 动作记录。
 */

const MODES: { id: PermissionMode; label: string }[] = [
  { id: "ask", label: "每次问我" },
  { id: "allow", label: "直接允许" },
  { id: "deny", label: "直接拒绝" },
];

/** 高危档位单独上警示色，其余用普通标签 —— 一页里只有真正要紧的那几条会跳出来。 */
function riskTone(risk: RiskLevel): "warn" | undefined {
  return risk === "L3" || risk === "L4" ? "warn" : undefined;
}

function statusTone(status: PermStatus): "warn" | undefined {
  return status === "forbidden" ? "warn" : undefined;
}

function PermissionBlock({ p }: { p: PermissionDef }) {
  const permissions = useApp((s) => s.settings.permissions);
  const mode = permissions?.[p.id] ?? (p.risk === "L0" ? "allow" : "ask");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="k-row__body">
          <span className="k-row__title">{p.title}</span>
          <span className="k-row__meta">{p.hint}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <span className="k-stat" data-tone={riskTone(p.risk)}>
            {p.risk} {RISK_LABEL[p.risk]}
          </span>
          <span className="k-stat" data-tone={statusTone(p.status)}>
            {STATUS_LABEL[p.status]}
          </span>
        </div>
      </div>

      {p.status === "forbidden" ? (
        <p className="k-hint">这类永远不交给模型，只能你自己在界面上操作。</p>
      ) : (
        <KOpts cols={3}>
          {MODES.map((m) => (
            <KOpt
              key={m.id}
              active={mode === m.id}
              onClick={() => useApp.getState().setPermission(p.id, m.id)}
            >
              {m.label}
            </KOpt>
          ))}
        </KOpts>
      )}
    </div>
  );
}

export function PermissionsView() {
  useActivity("在看权限设置");
  const scrollRef = useScrollMemory("permissions");
  const actionLog = useApp((s) => s.actionLog);

  const usable = PERMISSIONS.filter((p) => p.status === "ready" || p.status === "partial").length;

  return (
    <div className="k-page">
      <PageHeader
        title="AI 权限"
        right={
          <span className="px-3">
            <span className="k-stat">
              {usable}/{PERMISSIONS.length} 可用
            </span>
          </span>
        }
      />

      <div ref={scrollRef} className="k-scroll k-list k-nav-space mt-2 min-h-0 flex-1">
        {GROUPS.map((g) => {
          const list = permissionsOf(g.id);
          if (list.length === 0) return null;
          return (
            <KFold key={g.id} title={g.title} meta={g.note}>
              {list.map((p) => (
                <PermissionBlock key={p.id} p={p} />
              ))}
            </KFold>
          );
        })}

        {/*
          动作记录 —— 默认收起。
          ⚠️ 「清空」是卡片头里的按钮：必须 preventDefault + stopPropagation，
          否则点它会顺带把卡片展开/收起。
        */}
        <KFold
          title="动作记录"
          meta={`${actionLog.length} 条`}
          trailing={
            actionLog.length > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  useApp.getState().clearActionLog();
                }}
                className="k-btn"
              >
                清空
              </button>
            ) : undefined
          }
        >
          {actionLog.length === 0 ? (
            <p className="k-hint">还没有记录。他每次请求都会留在这里。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {actionLog.slice(0, 12).map((l) => (
                <li key={l.id} className="text-[length:var(--k-t-2)] leading-[var(--k-lh-2)]">
                  <span className="k-stat" data-tone={l.result === "denied" ? "warn" : "ok"}>
                    {l.result === "denied" ? "已拒绝" : l.result === "auto" ? "已记住" : "已允许"}
                  </span>
                  <span className="k-hint">
                    {" "}
                    {l.title} · {l.message} · {formatClock(l.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </KFold>
      </div>
    </div>
  );
}
