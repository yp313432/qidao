import { MOCK_MEMORIES, MOCK_RELATIONSHIPS } from "../data/mock-memories"
import type { Memory, MemoryRelationship } from "../types"
import type { MemoryAdapter } from "./MemoryAdapter"

export class MockMemoryAdapter implements MemoryAdapter {
  constructor(
    private readonly memories: Memory[] = MOCK_MEMORIES,
    private readonly relationships: MemoryRelationship[] = MOCK_RELATIONSHIPS,
  ) {}

  async listMemories(): Promise<Memory[]> {
    return this.memories.map((m) => ({ ...m }))
  }

  async listRelationships(): Promise<MemoryRelationship[]> {
    return this.relationships.map((r) => ({ ...r }))
  }

  async getMemory(id: string): Promise<Memory | null> {
    return this.memories.find((m) => m.id === id) ?? null
  }
}

export const mockMemoryAdapter = new MockMemoryAdapter()
