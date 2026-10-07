/**
 * 接进栖岛的说明（**这份文件只是便条，真代码在隔壁**）。
 *
 * ── 2026-10 实际是怎么接的（改这一版时看这段）────────────────────
 *
 * 走的是**原生**那条路（不是 iframe）：插件代码就在 `src/plugins/memory-universe/`，
 * 直接读栖岛本地 store 里的记忆 —— 除了"加"，没动栖岛别的东西。
 *
 *   · **映射层**：`./qidao-memory.ts`（`toUniverse()`）
 *     把 `lib/types.ts` 里那个 `Memory` 映射成星图要的形状：
 *     大小 = strength + confidence、连线 = links + 共同标签、
 *     记忆形成 = createdAt / recallCount / lastRecalledAt / lastConfirmedAt
 *   · **页面**：`src/components/play/memory-universe-view.tsx`
 *     （整页铺满 + 返回钮，跟时感同一套写法）
 *   · **入口**：玩乐 → 插件（`/play/plugins`）
 *
 * ⚠️ 三条当初定下的规矩仍然有效：
 *   ① **不要为此重构栖岛已有的页面 / store / 路由** —— 只加，不改
 *   ② 视觉层**永远不直接读 store**，一律经过适配层（以后换数据源不动画面）
 *   ③ 拿不到的数据**不许编**（星图对缺字段有兜底）
 */

export const QIDAO_INTEGRATION_NOTES = {
  mount: "Render <MemoryUniverse /> on a dedicated route or overlay only.",
  data: "Use ./qidao-memory.ts (toUniverse) — real memories from the qidao store.",
  doNot: "Do not refactor existing QIDAO pages, stores, or routers for this plugin.",
} as const;
