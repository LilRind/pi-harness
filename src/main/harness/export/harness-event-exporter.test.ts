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
        { type: 'message.completed', timestamp: 200, usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, total: 7, cost: 0 } },
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

import type { SessionEntry } from '@shared/types/workspace'

function sessionWithToolAndText(): SessionEntry[] {
  const ts = (n: number) => `2026-10-15T00:00:0${n}.000Z`
  return [
    {
      id: 'a1', parentId: null, timestamp: ts(1), type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', toolCallId: 'call-9', toolName: 'bash', input: { command: 'ls' } },
          { type: 'text', text: 'looked it up' }
        ],
        model: 'm', provider: 'p'
      }
    } as SessionEntry
  ]
}

describe('HarnessEventExporter with real session source', () => {
  it('enriches real export with text and toolArgs via async readRawEntries', async () => {
    const dir = tempDir()
    try {
      const exporter = new HarnessEventExporter({
        dir,
        registerExitHook: false,
        source: { readRawEntries: async () => sessionWithToolAndText() }
      })
      exporter.observe({ type: 'run.started', timestamp: 100, runId: 'run-real', prompt: 'p' }, 's9')
      exporter.observe({ type: 'tool.started', timestamp: 110, toolCallId: 'call-9', toolName: 'bash' }, 's9')
      exporter.observe({ type: 'message.completed', timestamp: 200, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2, cost: 0 }, model: 'm', provider: 'p' }, 's9')
      exporter.observe({ type: 'run.completed', timestamp: 210, runId: 'run-real', status: 'success' }, 's9')
      await exporter.shutdown()
      const raw = readFileSync(path.join(dir, 'run-real.jsonl'), 'utf8')
      const lines = raw.trim().split('\n').map((l) => JSON.parse(l))
      const tool = lines.find((l) => l.event?.type === 'tool.started')
      const msg = lines.find((l) => l.event?.type === 'message.completed')
      expect(tool?.enriched?.toolArgs).toEqual({ command: 'ls' })
      expect(msg?.enriched?.text).toBe('looked it up')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})