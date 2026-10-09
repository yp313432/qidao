export type MemoryRecord = {
  id: string;
  title: string;
  summary: string;
  sourceLabel: string;
  createdAt: string;
  tags: string[];
  isDemoData: true;
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
  isDemoData: true;
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
