export interface RealSessionEntry {
  timestamp?: string
  message?: {
    role?: string
    model?: string | null
    provider?: string | null
    usage?: Record<string, unknown>
    content?: Array<Record<string, unknown>>
  }
  [key: string]: unknown
}

export function readSessionEntries(sessionDir: string): RealSessionEntry[]

export function eventsFromEntries(
  entries: RealSessionEntry[],
  options?: { runId?: string; now?: number; prompt?: string }
): {
  runId: string
  events: Array<Record<string, unknown>>
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
}

export function assertExport(
  raw: string,
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  secretSeed?: string
): string[]
