import { describe, expect, it } from 'vitest'
import { isFooterLine, safeExportStem, type ExportFooterLine, type ExportLine } from './jsonl-schema'

describe('jsonl-schema', () => {
  it('stamps schemaVersion on every export line', () => {
    const line: ExportLine = {
      schemaVersion: 1,
      sessionId: 's1',
      event: { type: 'message.started', timestamp: 100 }
    }
    expect(line.schemaVersion).toBe(1)
  })

  it('distinguishes footer lines from event lines', () => {
    const footer: ExportFooterLine = {
      schemaVersion: 1,
      footer: {
        runId: 'r1',
        status: 'success',
        startedAt: 0,
        endedAt: 10,
        eventCount: 2,
        totalTokens: 5,
        durationMs: 10,
        toolCalls: 0,
        toolFailures: 0
      }
    }
    expect(isFooterLine(footer)).toBe(true)
    expect(isFooterLine({ schemaVersion: 1, sessionId: 's', event: { type: 'run.started', timestamp: 1 } })).toBe(false)
  })

  it('sanitizes run ids for file stems', () => {
    expect(safeExportStem('abc-123')).toBe('abc-123')
    expect(safeExportStem('a/b\\c')).toBe('a_b_c')
    expect(safeExportStem('')).toBe('run')
  })
})
