export type MemoryRecord = {
  id: string;
  title: string;
  summary: string;
  sourceLabel: string;
  createdAt: string;
  tags: string[];
  /**
   * 这条记录是不是**模拟数据**。
   *
   * 原来是写死的 `true`（因为当时只有 MockMemoryAdapter）；接上栖岛真记忆之后
   * 必须是 boolean —— 真适配器填 `false`，mock 填 `true`。
   */
  isDemoData: boolean;
  /** 被想起的次数（`Memory.recallCount`）。展开详情时才用到，平时只显示一行 */
  recallCount?: number;
  /** 记忆全文。展开详情时用；不展开就不渲染 */
  fullContent?: string;
};

export type MemoryLink = {
  memoryId: string;
  kind: "retrieved_for_query";
  explanation: string;
};

export type MemoryQuery = {
  emotion?: string;
  topic?: string;
  limit?: number;
};

export type MemorySearchResult = {
  memories: MemoryRecord[];
  links: MemoryLink[];
  relationNote: string;
  isDemoData: boolean;
};

/**
 * Boundary for QIDAO's existing memory plugin.
 * The UI only depends on this interface. Replace `mockMemoryAdapter`
 * without changing the lifeform or the panels.
 *
 * Rules for a real adapter:
 * - Return only records the real plugin actually returned.
 * - `links` may describe "retrieved for this query". Do not invent
 *   permanent graph edges the plugin did not store.
 * - Never write inferred emotions back into long-term memory here.
 */
export interface MemoryAdapter {
  readonly name: string;
  search(query: MemoryQuery): Promise<MemorySearchResult>;
}
