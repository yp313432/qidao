import type { Memory, MemoryRelationship } from "../types"

/**
 * Host-facing data port.
 *
 * Visual layer never talks to Memory MCP (or any store) directly.
 * Swap the adapter implementation — keep StarField / MemoryGraph / Detail.
 */
export interface MemoryAdapter {
  listMemories(): Promise<Memory[]>
  listRelationships(): Promise<MemoryRelationship[]>
  getMemory(id: string): Promise<Memory | null>
}

export interface MemoryUniverseSnapshot {
  memories: Memory[]
  relationships: MemoryRelationship[]
}

export async function loadSnapshot(
  adapter: MemoryAdapter,
): Promise<MemoryUniverseSnapshot> {
  const [memories, relationships] = await Promise.all([
    adapter.listMemories(),
    adapter.listRelationships(),
  ])
  return { memories, relationships }
}
