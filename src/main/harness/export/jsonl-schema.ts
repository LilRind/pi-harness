import type { HarnessEvent, HarnessRunStatus } from '@shared/types/harness'

export const JSONL_SCHEMA_VERSION = 1

/** Enrichment fields added by the enricher before redaction. */
export interface ExportEnriched {
  text?: string
  toolArgs?: Record<string, unknown>
}

/** One exported line: event-native fields plus optional enriched fields. */
export interface ExportLine {
  schemaVersion: number
  sessionId: string
  event: HarnessEvent
  enriched?: ExportEnriched
}

/** Per-run footer line: runtime-level metrics only (no pass rate). */
export interface ExportFooterLine {
  schemaVersion: number
  footer: RunFooterMetrics
}

export interface RunFooterMetrics {
  runId: string
  status: HarnessRunStatus
  startedAt: number
  endedAt: number
  eventCount: number
  totalTokens: number | null
  durationMs: number | null
  toolCalls: number
  toolFailures: number
}

export type ExportRecord = ExportLine | ExportFooterLine

export function isFooterLine(record: ExportRecord): record is ExportFooterLine {
  return 'footer' in record
}

/** Deterministic, collision-safe file stem for a run id. */
export function safeExportStem(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'run'
}