import { describe, expect, it } from 'vitest'
import { createEnricher } from './enricher'
import type { HarnessEvent } from '@shared/types/harness'

describe('enricher', () => {
  it('adds text for assistant messages from the source', () => {
    const source = { getText: (e: HarnessEvent) => (e.type === 'message.completed' ? '让 me' : undefined) }
    const enricher = createEnricher(source)
    const enriched = enricher.enrich({ type: 'message.completed', timestamp: 1 })
    expect(enriched?.text).toBe('让 me')
  })

  it('returns undefined when nothing is enriched (source limited)', () => {
    const enricher = createEnricher(null)
    expect(enricher.enrich({ type: 'tool.started', timestamp: 1, toolName: 'x' })).toBeUndefined()
  })
})

import type { SessionEntry } from '@shared/types/workspace'
import { enrichFromEntries } from './enricher'

function assistantEntry(text: string, ts: string): SessionEntry {
  return {
    id: `e-${ts}`,
    parentId: null,
    timestamp: ts,
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'text', text }], model: 'm', provider: 'p' }
  } as SessionEntry
}

function toolEntry(toolCallId: string, input: Record<string, unknown>, ts: string): SessionEntry {
  return {
    id: `t-${ts}`,
    parentId: null,
    timestamp: ts,
    type: 'message',
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', toolCallId, toolName: 'test_tool', input }]
    }
  } as SessionEntry
}

describe('enricher with real session entries', () => {
  it('matches assistant text by order of message.completed events', () => {
    const entries = [assistantEntry('first answer', '1'), assistantEntry('second answer', '2')]
    const state = { assistantIndex: 0 }
    expect(
      enrichFromEntries({ type: 'message.completed', timestamp: 100 }, entries, state)?.text
    ).toBe('first answer')
    expect(
      enrichFromEntries({ type: 'message.completed', timestamp: 200 }, entries, state)?.text
    ).toBe('second answer')
  })

  it('matches tool args by toolCallId', () => {
    const entries = [toolEntry('call-1', { path: 'a.txt' }, '1')]
    const state = { assistantIndex: 0 }
    const enriched = enrichFromEntries(
      { type: 'tool.completed', timestamp: 300, toolCallId: 'call-1', toolName: 'test_tool' },
      entries,
      state
    )
    expect(enriched?.toolArgs).toEqual({ path: 'a.txt' })
  })

  it('returns undefined when entries are missing', () => {
    const state = { assistantIndex: 0 }
    expect(
      enrichFromEntries({ type: 'message.completed', timestamp: 100 }, [], state)
    ).toBeUndefined()
    expect(
      enrichFromEntries(
        { type: 'tool.completed', timestamp: 300, toolCallId: 'nope', toolName: 't' },
        [],
        state
      )
    ).toBeUndefined()
  })

  it('does not throw for non-matching events', () => {
    const state = { assistantIndex: 0 }
    expect(
      enrichFromEntries({ type: 'run.started', timestamp: 1, runId: 'r', prompt: 'p' }, [], state)
    ).toBeUndefined()
  })
})