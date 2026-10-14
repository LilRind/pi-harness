import { writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { redactSecrets } from '../../services/logger'
import type { HarnessEvent, HarnessRunStatus } from '@shared/types/harness'
import type { SessionEntry } from '@shared/types/workspace'
import {
  JSONL_SCHEMA_VERSION,
  safeExportStem,
  type ExportFooterLine,
  type ExportLine
} from './jsonl-schema'
import {
  createEnricher,
  enrichFromEntries,
  type AssistantMatchState,
  type Enricher,
  type EnricherSource
} from './enricher'

export interface HarnessEventExporterOptions {
  /** Output directory. Created on demand. */
  dir: string
  /** Disable export entirely (default: false). */
  enabled?: boolean
  /** Optional session enrichment source. */
  source?: EnricherSource | null
  /** Flush hook invoked on process exit (e.g. register process.on('exit')). */
  registerExitHook?: boolean
}

interface QueuedEvent {
  event: HarnessEvent
  sessionId: string
}

interface RunAccumulator {
  runId: string
  sessionId: string
  startedAt: number
  endedAt: number | null
  status: HarnessRunStatus | null
  events: QueuedEvent[]
  totalTokens: number
  toolCalls: number
  toolFailures: number
  eventCount: number
}

/**
 * Subscribes to HarnessRuntime.onEvent and writes a per-run JSONL file.
 * Events buffer in memory; run termination (completed/failed/aborted) flushes
 * the file, appends a footer with runtime-level metrics and closes the handle.
 * All writes pass through redactSecrets before touching disk.
 *
 * When a `source.readRawEntries` is provided, events are re-enriched from the
 * real session entries during async flush: assistant text by order and tool
 * args by `toolCallId`. The sync path stays for no-source setups.
 */
export class HarnessEventExporter {
  private readonly runBySession = new Map<string, string>()
  private readonly accumulators = new Map<string, RunAccumulator>()
  private readonly enricher: Enricher
  private readonly dir: string

  constructor(private readonly options: HarnessEventExporterOptions) {
    this.dir = options.dir
    this.enricher = createEnricher(options.source ?? null)
    if (options.registerExitHook !== false) {
      process.once('exit', () => this.flushAllSync())
    }
  }

  get enabled(): boolean {
    return this.options.enabled !== false
  }

  observe(event: HarnessEvent, sessionId: string): void {
    if (!this.enabled) return
    if (event.type === 'run.started') {
      this.runBySession.set(sessionId, event.runId)
      this.accumulators.set(event.runId, {
        runId: event.runId,
        sessionId,
        startedAt: event.timestamp,
        endedAt: null,
        status: null,
        events: [],
        totalTokens: 0,
        toolCalls: 0,
        toolFailures: 0,
        eventCount: 0
      })
    }
    const runId =
      event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted'
        ? (event.runId ?? this.runBySession.get(sessionId))
        : this.runBySession.get(sessionId)
    const acc = runId ? this.accumulators.get(runId) : undefined
    if (!acc) return

    acc.eventCount++
    if (event.type === 'message.completed' && typeof event.usage?.total === 'number') {
      acc.totalTokens += event.usage.total
    }
    if (event.type === 'tool.completed') {
      acc.toolCalls++
      if (event.isError === true) acc.toolFailures++
    }
    acc.events.push({ event, sessionId })

    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.aborted'
    ) {
      acc.endedAt = event.timestamp
      acc.status =
        event.type === 'run.completed' ? 'success' : event.type === 'run.failed' ? 'failed' : 'aborted'
      void this.flush(runId!)
      this.runBySession.delete(sessionId)
    }
  }

  /** Flush a single run. Prefers real session entries when a source is present. */
  async flush(runId: string): Promise<void> {
    const acc = this.accumulators.get(runId)
    if (!acc || acc.events.length === 0) return
    let entries: SessionEntry[] | null = null
    const read = this.options.source?.readRawEntries
    if (read) {
      try {
        const result = read(acc.sessionId)
        entries = Array.isArray(result) ? result : await result
      } catch {
        entries = null
      }
    }
    this.writeAccumulator(runId, entries)
  }

  /** Flush a single run from memory to disk (sync, no session enrichment). */
  flushSync(runId: string): void {
    const acc = this.accumulators.get(runId)
    if (!acc || acc.events.length === 0) return
    this.writeAccumulator(runId, null)
  }

  private writeAccumulator(runId: string, entries: SessionEntry[] | null): void {
    const acc = this.accumulators.get(runId)
    if (!acc || acc.events.length === 0) return
    const assistantState: AssistantMatchState = { assistantIndex: 0 }
    const lines: string[] = []
    for (const queued of acc.events) {
      const enriched = this.enricher.enrich(queued.event, queued.sessionId)
      const fromEntries = entries
        ? enrichFromEntries(queued.event, entries, assistantState)
        : undefined
      const line: ExportLine = {
        schemaVersion: JSONL_SCHEMA_VERSION,
        sessionId: queued.sessionId,
        event: queued.event,
        ...(enriched || fromEntries ? { enriched: enriched ?? fromEntries } : {})
      }
      lines.push(JSON.stringify(redactSecrets(line)))
    }
    const footer: ExportFooterLine = {
      schemaVersion: JSONL_SCHEMA_VERSION,
      footer: {
        runId,
        status: acc.status ?? 'aborted',
        startedAt: acc.startedAt,
        endedAt: acc.endedAt ?? acc.startedAt,
        eventCount: acc.eventCount,
        totalTokens: acc.totalTokens,
        durationMs: acc.endedAt ? acc.endedAt - acc.startedAt : null,
        toolCalls: acc.toolCalls,
        toolFailures: acc.toolFailures
      }
    }
    const body = [...lines, JSON.stringify(redactSecrets(footer))].join('\n') + '\n'
    mkdirSync(this.dir, { recursive: true })
    const file = path.join(this.dir, `${safeExportStem(runId)}.jsonl`)
    writeFileSync(file, body, 'utf8')
    this.accumulators.delete(runId)
  }

  /** Flush every open run (process exit / shutdown). */
  flushAllSync(): void {
    for (const runId of [...this.accumulators.keys()]) this.flushSync(runId)
  }

  async flushAll(): Promise<void> {
    for (const runId of [...this.accumulators.keys()]) await this.flush(runId)
  }

  async shutdown(): Promise<void> {
    await this.flushAll()
  }
}