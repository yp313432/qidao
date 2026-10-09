export type { MemoryAdapter, MemoryLink, MemoryQuery, MemoryRecord, MemorySearchResult } from "./adapter";
export { mockMemoryAdapter } from "./mock";
export {
  qidaoMemoryAdapter,
  hasRealMemories,
  notifyMemoryChange,
  setMemorySource,
  subscribeMemorySource,
} from "./qidao-adapter";

import { mockMemoryAdapter } from "./mock";
import { notifyMemoryChange, qidaoMemoryAdapter, setMemorySource } from "./qidao-adapter";
import { useApp } from "@/lib/store";
import type { MemoryAdapter, MemoryQuery, MemorySearchResult } from "./adapter";

/**
 * **绑定：有真记忆就用栖岛的，取不到才回落 mock**。
 *
 * 用户的要求："接上栖岛真记忆（现在还在用 MockMemoryAdapter）"，
 * 同时"不许白屏 / 报错"。
 *
 * 数据来源是宿主 store 的 `memories`（`@/lib/store.ts`，IndexedDB 持久化），
 * 跟记忆宇宙那一页同一个来源，所以不另开一条取数通道。
 *
 * 三种情况说清楚：
 *   ① **读得到宿主 store** → 全程走 QidaoMemoryAdapter。
 *      库是空的？那也是"真没命中"—— 适配器会诚实返回
 *      「暂无可关联的历史记忆。」（**不给**模拟数据，免得让人以为栖岛里有那些记忆）。
 *   ② **读不到宿主 store**（插件被单独跑 / `@/lib/store` 挂了）→ 回落 mock，
 *      面板照旧有东西看，不白屏。
 *   ③ 适配器自己出意外 → 也回落 mock（`guardedQidaoAdapter` 那张网）。
 *
 * ⚠️ `search()` 是**每次调用现读一次**（不是模块加载时拍快照），
 * 所以用户新记了一条记忆、回到这一页就能连上，不用刷新。
 */
function hostMemories() {
  const list = useApp.getState().memories;
  return Array.isArray(list) ? list : null;
}

/** 宿主 store 读得到吗（读不到 = 取不到 = 回落 mock 的那一种） */
function hostStoreReachable(): boolean {
  try {
    return hostMemories() !== null;
  } catch {
    return false;
  }
}

/**
 * 注册"怎么读栖岛的记忆" + **订阅它变了**。
 *
 * 订阅这条是必须的：检索在场景切换时跑一次，而宿主记忆可能是后来才 hydrate 好的。
 * 没有它，第一遍检索会拿着空库问，之后一直停在那个答案上 = "接了个假的"。
 */
setMemorySource(hostMemories);
useApp.subscribe(notifyMemoryChange);

/** 真适配器的安全网：它自己出意外时不能让界面停在"正在检索"上 */
const guardedQidaoAdapter: MemoryAdapter = {
  name: qidaoMemoryAdapter.name,
  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    try {
      return await qidaoMemoryAdapter.search(query);
    } catch {
      return mockMemoryAdapter.search(query);
    }
  },
};

export const memoryAdapter: MemoryAdapter = {
  name: "QidaoMemoryAdapter|MockMemoryAdapter",
  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    // 读不到宿主 store（插件独立跑等）→ 回落 mock，绝不给空面板
    if (!hostStoreReachable()) return mockMemoryAdapter.search(query);
    return guardedQidaoAdapter.search(query);
  },
};
