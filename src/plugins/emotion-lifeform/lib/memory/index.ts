export type { MemoryAdapter, MemoryLink, MemoryQuery, MemoryRecord, MemorySearchResult } from "./adapter";
export { mockMemoryAdapter } from "./mock";

import { mockMemoryAdapter } from "./mock";
import type { MemoryAdapter } from "./adapter";

/** Swap this binding when a real QIDAO memory plugin adapter exists. */
export const memoryAdapter: MemoryAdapter = mockMemoryAdapter;
