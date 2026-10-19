import { describe, expect, it } from 'vitest'
import './viewer-core.js'

const { buildSpanTree, parseJsonl, summarizeEvents } = globalThis.ViewerCore

const raw = [
  JSON.stringify({
    schemaVersion: 1,
    sessionId: 's1',
    event: { type: 'run.started', timestamp: 100, runId: 'r1' }
  }),
  '{malformed',
  JSON.stringify({
    schemaVersion: 1,
    sessionId: 's1',
    event: { type: 'message.started', timestamp: 105 }
  }),
  JSON.stringify({
    schemaVersion: 1,
    sessionId: 's1',
    event: { type: 'tool.started', timestamp: 110, toolCallId: 't1', toolName: 'bash' }
  }),
  JSON.stringify({
    schemaVersion: 1,
    sessionId: 's1',
    event: { type: 'tool.completed', timestamp: 130, toolCallId: 't1', toolName: 'bash', isError: true }
  }),
  JSON.stringify({
    schemaVersion: 1,
    sessionId: 's1',
    event: { type: 'message.completed', timestamp: 170, usage: { input: 3, output: 4, cacheRead: 5, total: 0 } },
    enriched: { text: 'ok' }
  }),
  JSON.stringify({
    schemaVersion: 1,
    footer: {
      runId: 'r1',
      status: 'failed',
      eventCount: 5,
      durationMs: 70,
      totalTokens: 0
    }
  })
].join('\n')

describe('viewer core', () => {
  it('parses events and footer while counting malformed lines', () => {
    const parsed = parseJsonl(raw)
    expect(parsed.malformedLines).toBe(1)
    expect(parsed.events).toHaveLength(5)
    expect(parsed.events[0]._enriched).toBeUndefined()
    expect(parsed.footer).toMatchObject({ runId: 'r1', status: 'failed', eventCount: 5 })
  })

  it('reconstructs a nested span tree with errors and timing', () => {
    const { events } = parseJsonl(raw)
    const roots = buildSpanTree(events)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ kind: 'model', name: 'model turn', t: 105, end: 170, tokens: 12 })
    expect(roots[0].children).toHaveLength(1)
    expect(roots[0].children[0]).toMatchObject({ kind: 'tool', name: 'bash', t: 110, end: 130, error: true })
  })

  it('summarizes events and applies token fallback', () => {
    const { events, footer } = parseJsonl(raw)
    const summary = summarizeEvents(events, footer)
    expect(summary.rows).toEqual([
      ['runId', 'r1'],
      ['状态', 'failed'],
      ['事件数', '5'],
      ['明细 token', '12'],
      ['耗时', '70ms'],
      ['工具调用 / 失败', '1 / 1'],
      ['assistant 消息', '1']
    ])
    expect(summary.bars).toEqual([{ value: 12, title: '12 tokens' }])
  })
})
