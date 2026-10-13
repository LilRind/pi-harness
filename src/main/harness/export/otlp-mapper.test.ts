import { describe, expect, it } from 'vitest'
import { eventsToSpans } from './otlp-mapper'
import type { HarnessEvent } from '@shared/types/harness'

describe('eventsToSpans', () => {
  it('merges paired message events into one span with start/end', () => {
    const events: HarnessEvent[] = [
      { type: 'message.started', timestamp: 100 },
      { type: 'message.completed', timestamp: 500, usage: { total: 42 } }
    ]
    const spans = eventsToSpans(events, 'run-1')
    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('model turn')
    expect(spans[0].startTimeUnixNano).toBe('100000000')
    expect(spans[0].endTimeUnixNano).toBe('500000000')
    expect(spans[0].attributes.totalTokens).toBe(42)
  })

  it('nests tool spans under the open model span', () => {
    const events: HarnessEvent[] = [
      { type: 'message.started', timestamp: 100 },
      { type: 'tool.started', timestamp: 200, toolName: 'bash' },
      { type: 'tool.completed', timestamp: 300, toolName: 'bash' },
      { type: 'message.completed', timestamp: 400 }
    ]
    const spans = eventsToSpans(events, 'run-2')
    const tool = spans.find((s) => s.name === 'bash')
    const model = spans.find((s) => s.name === 'model turn')
    expect(tool?.parentSpanId).toBe(model?.spanId)
  })

  it('closes an unterminated trailing span deterministically', () => {
    const spans = eventsToSpans([{ type: 'message.started', timestamp: 100 }], 'run-3')
    expect(spans[0].endTimeUnixNano).not.toBeNull()
  })

  it('is pure: same input yields identical output', () => {
    const events: HarnessEvent[] = [
      { type: 'tool.started', timestamp: 1, toolName: 'x' },
      { type: 'tool.completed', timestamp: 2, toolName: 'x' }
    ]
    expect(eventsToSpans(events, 'r')).toEqual(eventsToSpans(events, 'r'))
  })
})
