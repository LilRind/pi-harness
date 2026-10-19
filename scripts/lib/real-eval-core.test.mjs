import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertExport,
  createExecutionSessionDir,
  eventsFromEntries,
  readSessionEntries
} from './real-eval-core.mjs'

const entries = [
  {
    timestamp: '2026-10-16T04:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'glm-5.2',
      provider: 'zhipu',
      usage: { input: 10, output: 5, cacheRead: 7, totalTokens: 22 },
      content: [
        { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'echo ok' } },
        { type: 'text', text: 'ok' }
      ]
    }
  },
  {
    timestamp: '2026-10-16T04:00:02.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
  }
]

describe('real eval core', () => {
  it('reads JSON and JSONL session entries and skips malformed lines', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'real-eval-core-'))
    try {
      mkdirSync(path.join(dir, 'nested'), { recursive: true })
      writeFileSync(
        path.join(dir, 'nested', 'session.jsonl'),
        [JSON.stringify(entries[0]), '{bad json', '', JSON.stringify(entries[1])].join('\n')
      )
      writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ ignored: true }))
      const actual = readSessionEntries(dir)
      expect(actual).toHaveLength(3)
      expect(actual).toEqual(expect.arrayContaining([entries[0], entries[1], { ignored: true }]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates an isolated session directory for each execution', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'real-eval-sessions-'))
    try {
      const first = createExecutionSessionDir(base)
      const second = createExecutionSessionDir(base)
      expect(path.dirname(first)).toBe(base)
      expect(path.dirname(second)).toBe(base)
      expect(first).not.toBe(second)
      expect(existsSync(first)).toBe(true)
      expect(existsSync(second)).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('converts Pi session entries into deterministic harness events', () => {
    const result = eventsFromEntries(entries, {
      runId: 'real-test',
      now: 100,
      prompt: 'real test'
    })
    expect(result.runId).toBe('real-test')
    expect(result.toolCalls).toEqual([
      { id: 'call-1', name: 'bash', input: { command: 'echo ok' } }
    ])
    expect(result.events).toEqual([
      {
        type: 'run.started',
        timestamp: Date.parse('2026-10-16T04:00:00.000Z'),
        runId: 'real-test',
        prompt: 'real test'
      },
      { type: 'tool.started', timestamp: Date.parse('2026-10-16T04:00:00.000Z'), toolCallId: 'call-1', toolName: 'bash' },
      {
        type: 'tool.completed',
        timestamp: Date.parse('2026-10-16T04:00:00.000Z') + 1,
        toolCallId: 'call-1',
        toolName: 'bash',
        isError: false
      },
      {
        type: 'message.started',
        timestamp: Date.parse('2026-10-16T04:00:00.000Z')
      },
      {
        type: 'message.completed',
        type: 'message.completed',
        timestamp: Date.parse('2026-10-16T04:00:00.000Z'),
        seq: 0,
        model: 'glm-5.2',
        provider: 'zhipu',
        usage: { input: 10, output: 5, cacheRead: 7, cacheWrite: 0, total: 22, cost: null }
      },
      {
        type: 'message.started',
        timestamp: Date.parse('2026-10-16T04:00:02.000Z')
      },
      {
        type: 'message.completed',
        timestamp: Date.parse('2026-10-16T04:00:02.000Z'),
        seq: 1,
        model: null,
        provider: null,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null }
      },
      {
        type: 'run.completed',
        timestamp: Date.parse('2026-10-16T04:00:02.000Z'),
        runId: 'real-test',
        status: 'success'
      }
    ])
  })

  it('asserts required real export content without accepting a fixed secret', () => {
    const good = [
      JSON.stringify({ event: { type: 'tool.started', toolName: 'bash' } }),
      JSON.stringify({
        event: { type: 'message.completed' },
        enriched: { text: 'masked', toolArgs: { command: 'echo ok' } }
      })
    ].join('\n')
    expect(assertExport(good, [{ id: 'x', name: 'bash', input: {} }], 'sk-SECRET')).toEqual([])
    expect(assertExport('{}', [], 'sk-SECRET')).toEqual(['missing message.completed line', 'missing enriched fields'])
    expect(assertExport(good.replace('masked', 'sk-SECRET'), [], 'sk-SECRET')).toEqual([
      'unredacted secret seed found in export'
    ])
  })
})
