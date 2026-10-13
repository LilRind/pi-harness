import type { HarnessEvent } from '@shared/types/harness'
import type { ExportEnriched } from './jsonl-schema'

/** Optional source the exporter may use to enrich events with session data. */
export interface EnricherSource {
  getText?(event: HarnessEvent): string | undefined
  getToolArgs?(event: HarnessEvent): Record<string, unknown> | undefined
}

export interface Enricher {
  source: EnricherSource | null
  enrich(event: HarnessEvent): ExportEnriched | undefined
}

export function createEnricher(source: EnricherSource | null = null): Enricher {
  return {
    source,
    enrich(event: HarnessEvent): ExportEnriched | undefined {
      const enriched: ExportEnriched = {}
      const text = this.source?.getText?.(event)
      if (text !== undefined) enriched.text = text
      const toolArgs = this.source?.getToolArgs?.(event)
      if (toolArgs !== undefined) enriched.toolArgs = toolArgs
      return Object.keys(enriched).length > 0 ? enriched : undefined
    }
  }
}