import type { HarnessEvent } from '@shared/types/harness'
import type { SessionEntry, ToolCallContent } from '@shared/types/workspace'
import type { ExportEnriched } from './jsonl-schema'

/** Real session source the exporter may use to enrich events with session data. */
export interface EnricherSource {
  getText?(event: HarnessEvent): string | undefined
  getToolArgs?(event: HarnessEvent): Record<string, unknown> | undefined
  /** Real session entries for the given session (readRawEntries equivalent). */
  readRawEntries?(sessionId: string): Promise<SessionEntry[]> | SessionEntry[]
}

export interface Enricher {
  source: EnricherSource | null
  enrich(event: HarnessEvent, sessionId?: string): ExportEnriched | undefined
}

/** Tracks which assistant text index the next message.completed maps to. */
export interface AssistantMatchState {
  assistantIndex: number
}

function assistantTexts(entries: SessionEntry[]): string[] {
  const texts: string[] = []
  for (const entry of entries) {
    const message = (entry as { message?: { role?: string; content?: unknown } }).message
    if (!message || message.role !== 'assistant') continue
    const content = message.content
    if (typeof content === 'string') {
      texts.push(content)
      continue
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as { type?: string; text?: string }
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
      }
    }
  }
  return texts
}

function toolCallBy(entries: SessionEntry[], toolCallId: string): ToolCallContent | null {
  for (const entry of entries) {
    const message = (entry as { message?: { content?: unknown } }).message
    const content = message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const b = block as ToolCallContent
      if (b.type === 'toolCall' && b.toolCallId === toolCallId) return b
    }
  }
  return null
}

/**
 * Enrichment backed by real session entries. Assistant text is matched by
 * order (the Nth assistant text corresponds to the Nth message.completed);
 * tool args are matched by `toolCallId`. Missing entries are left out, never
 * throws.
 */
export function enrichFromEntries(
  event: HarnessEvent,
  entries: SessionEntry[],
  state: AssistantMatchState
): ExportEnriched | undefined {
  const enriched: ExportEnriched = {}
  if (event.type === 'message.completed') {
    const texts = assistantTexts(entries)
    const text = texts[state.assistantIndex]
    if (text !== undefined) {
      enriched.text = text
      state.assistantIndex++
    }
    return Object.keys(enriched).length > 0 ? enriched : undefined
  }
  if (event.type === 'tool.started' || event.type === 'tool.completed') {
    if (event.toolCallId === undefined) return undefined
    const call = toolCallBy(entries, event.toolCallId)
    if (call) enriched.toolArgs = call.input
    return Object.keys(enriched).length > 0 ? enriched : undefined
  }
  return undefined
}

export function createEnricher(source: EnricherSource | null = null): Enricher {
  return {
    source,
    enrich(event: HarnessEvent, sessionId?: string): ExportEnriched | undefined {
      const enriched: ExportEnriched = {}
      const text = this.source?.getText?.(event)
      if (text !== undefined) enriched.text = text
      const toolArgs = this.source?.getToolArgs?.(event)
      if (toolArgs !== undefined) enriched.toolArgs = toolArgs
      if (Object.keys(enriched).length > 0) return enriched
      if (!this.source?.readRawEntries || sessionId === undefined) return undefined
      const entries = this.source.readRawEntries(sessionId)
      if (!entries || !Array.isArray(entries)) return undefined
      return enrichFromEntries(event, entries, { assistantIndex: 0 })
    }
  }
}