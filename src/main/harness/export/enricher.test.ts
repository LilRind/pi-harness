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
