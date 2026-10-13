import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HarnessEventExporter } from './harness-event-exporter'
import type { HarnessEvent } from '@shared/types/harness'

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'harness-export-'))
}

function envelope(event: HarnessEvent, sessionId = 's1'): void {
  void sessionId
}

describe('HarnessEventExporter', () => {
  it('writes a full run to a sanitized jsonl file with footer', () => {
    const dir = tempDir()
    try {
      const exporter = new HarnessEventExporter({ dir, registerExitHook: false })
      exporter.observe({ type: 'run.started', timestamp: 100, runId: 'run x', prompt: 'p' }, 's1')
      exporter.observe({ type: 'message.started', timestamp: 110 }, 's1')
      exporter.observe(
        { type: 'message.completed', timestamp: 200, usage: { total: 7 } },
        's1'
      )
      exporter.observe({ type: 'run.completed', timestamp: 210, runId: 'run x', status: 'success' }, 's1')
      const file = path.join(dir, 'run_x.jsonl')
      expect(existsSync(file)).toBe(true)
      const raw = readFileSync(file, 'utf8')
      const lines = raw.trim().split('\n').map((l) => JSON.parse(l))
      const footer = lines[lines.length - 1]
      expect(footer.footer).toBeDefined()
      expect(footer.footer.status).toBe('success')
      expect(footer.footer.eventCount).toBe(4)
      expect(lines[0].schemaVersion).toBe(1)
      exporter.shutdown()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flushes buffered events on abort before exit', () => {
    const dir = tempDir()
    try {
      const exporter = new HarnessEventExporter({ dir, registerExitHook: false })
      exporter.observe({ type: 'run.started', timestamp: 1, runId: 'r1', prompt: 'p' }, 's1')
      exporter.observe({ type: 'message.started', timestamp: 2 }, 's1')
      exporter.flushAllSync()
      const raw = readFileSync(path.join(dir, 'r1.jsonl'), 'utf8')
      expect(raw).toContain('run.started')
      exporter.shutdown()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
