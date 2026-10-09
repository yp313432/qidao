import type { MemoryAdapter, MemoryQuery, MemoryRecord, MemorySearchResult } from "./adapter";

const MEMORIES: MemoryRecord[] = [
  {
    id: "mem-rain",
    title: "雨夜",
    summary: "用户提起上周一起听雨的夜晚，说那晚没有被催促，所以很安心。",
    sourceLabel: "模拟对话记忆",
    createdAt: "2026-10-02T22:40:00+08:00",
    tags: ["安心", "信任", "感动"],
    isDemoData: true,
  },
  {
    id: "mem-habit",
    title: "小习惯",
    summary: "用户说过，被人记住一个很小的习惯时，会有一点说不清的心动。",
    sourceLabel: "模拟对话记忆",
    createdAt: "2026-09-28T21:05:00+08:00",
    tags: ["心动", "想被珍惜"],
    isDemoData: true,
  },
  {
    id: "mem-pause",
    title: "怕说太快",
    summary: "此前有一段对话：用户说想靠近，但又怕自己说得太快。",
    sourceLabel: "模拟对话记忆",
    createdAt: "2026-10-05T19:18:00+08:00",
    tags: ["克制", "羞涩", "犹豫"],
    isDemoData: true,
  },
  {
    id: "mem-afternoon",
    title: "空下来的下午",
    summary: "用户描述过一个忽然空下来的下午，低落里仍想被想起。",
    sourceLabel: "模拟对话记忆",
    createdAt: "2026-10-07T16:12:00+08:00",
    tags: ["失落", "思念", "期待"],
    isDemoData: true,
  },
  {
    id: "mem-stay",
    title: "再待一会儿",
    summary: "用户表达过想延长相处、想靠近，但没有把这件事说成已经答应的亲密。",
    sourceLabel: "模拟对话记忆",
    createdAt: "2026-10-08T23:02:00+08:00",
    tags: ["亲密渴望", "依恋", "想靠近"],
    isDemoData: true,
  },
  {
    id: "mem-unsaid",
    title: "未说完",
    summary: "有一次对话停在一句没说完的玩笑上，双方都没有把话点破。",
    sourceLabel: "模拟对话记忆",
    createdAt: "2026-10-06T20:33:00+08:00",
    tags: ["暧昧", "欲言又止", "试探"],
    isDemoData: true,
  },
];

function matches(memory: MemoryRecord, query: MemoryQuery) {
  const emotion = query.emotion?.trim();
  const topic = query.topic?.trim();
  if (!emotion && !topic) return false;
  const haystack = [memory.title, memory.summary, ...memory.tags].join(" ");
  const emotionHit = emotion ? memory.tags.includes(emotion) || haystack.includes(emotion) : false;
  const topicHit = topic ? haystack.includes(topic) : false;
  return emotionHit || topicHit;
}

export const mockMemoryAdapter: MemoryAdapter = {
  name: "MockMemoryAdapter",
  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    const memories = MEMORIES.filter((memory) => matches(memory, query)).slice(0, query.limit ?? 3);
    const links = memories.map((memory) => ({
      memoryId: memory.id,
      kind: "retrieved_for_query" as const,
      explanation: "这条线只表示本次检索命中，不是记忆库里保存的永久关系。",
    }));
    return {
      memories,
      links,
      relationNote: memories.length
        ? "光丝连接的是这次模拟检索的结果，不是数据库中既有的关系图谱。"
        : "暂无可关联的历史记忆。",
      isDemoData: true,
    };
  },
};
