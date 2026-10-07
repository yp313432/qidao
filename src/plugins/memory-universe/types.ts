export interface Memory {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt?: string
  importance?: number
  category?: string
  tags?: string[]
  relatedMemoryIds?: string[]
  source?: MemorySource
  formation?: MemoryFormationStage[]
}

export interface MemorySource {
  type: "conversation" | "note" | "system"
  label: string
  at?: string
}

export type FormationKind =
  | "first_mention"
  | "remention"
  | "strengthened"
  | "long_term"

export interface MemoryFormationStage {
  kind: FormationKind
  at: string
  note?: string
}

export interface MemoryRelationship {
  sourceId: string
  targetId: string
  strength: number
}

export type RelationStrength = "strong" | "medium" | "weak"

export function relationBand(strength: number): RelationStrength {
  if (strength >= 0.72) return "strong"
  if (strength >= 0.4) return "medium"
  return "weak"
}

export interface MemoryUniverseProps {
  memories?: Memory[]
  relationships?: MemoryRelationship[]
  onMemorySelect?: (memory: Memory | null) => void
  className?: string
}
