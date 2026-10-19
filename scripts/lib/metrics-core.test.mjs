import { describe, expect, it } from 'vitest'
import {
  aggregateExtendedMetrics,
  aggregateRepeatMetrics,
  aggregateRepeatValues,
  createBaseline,
  analyzeEventCompleteness
} from './metrics-core.mjs'

function line(event) {
  return { schemaVersion: 1, sessionId: 's1', event }
}

function footerLine(footer) {
  return { schemaVersion: 1, footer }
}

const parsed = [
  line({ type: 'run.started', timestamp: 100, runId: 'r1' }),
  line({ type: 'message.started', timestamp: 110 }),
  line({ type: 'tool.started', timestamp: 120, toolCallId: 't1', toolName: 'bash' }),
  line({ type: 'tool.completed', timestamp: 140, toolCallId: 't1', toolName: 'bash', isError: false }),
  line({
    type: 'message.completed',
    timestamp: 150,
    usage: { total: 12, cost: 0.5 }
  }),
  line({ type: 'run.completed', timestamp: 160, runId: 'r1', status: 'success' }),
  footerLine({
    runId: 'r1',
    status: 'success',
    eventCount: 6,
    durationMs: 60,
    toolCalls: 1,
    toolFailures: 0
  }),
  line({ type: 'run.started', timestamp: 200, runId: 'r2' }),
  line({ type: 'message.started', timestamp: 210 }),
  line({
    type: 'message.completed',
    timestamp: 240,
    usage: { input: 3, output: 4, cacheRead: 5, total: 0, cost: null }
  }),
  line({ type: 'tool.started', timestamp: 250, toolCallId: 't2', toolName: 'bash' }),
  line({ type: 'tool.completed', timestamp: 280, toolCallId: 't2', toolName: 'bash', isError: true }),
  line({ type: 'run.failed', timestamp: 300, runId: 'r2', status: 'failed' }),
  footerLine({
    runId: 'r2',
    status: 'failed',
    eventCount: 6,
    durationMs: 100,
    toolCalls: 1,
    toolFailures: 1
  })
]

describe('extended metrics', () => {
  it('aggregates core and extended metrics from exported JSONL', () => {
    expect(
      aggregateExtendedMetrics(parsed, [
        { pass: true, failures: [] },
        { pass: false, failures: ['containsText (text contains missing)'] }
      ])
    ).toEqual({
      passRate: 0.5,
      totalTokens: 24,
      durationMs: 160,
      toolFailureRate: 0.5,
      assertionFailureCount: 1,
      firstEventLatencyMs: 10,
      toolExecutionDurationMs: [20, 30],
      toolErrorCount: 1,
      eventCompleteness: 'complete',
      cost: 0.5,
      modelResponseDurationMs: [40, 30],
      repeatVariability: null
    })
  })

  it('keeps unavailable provider metrics as stable null values', () => {
    const result = aggregateExtendedMetrics(
      [
        line({ type: 'run.started', timestamp: 0 }),
        line({ type: 'run.completed', timestamp: 10 }),
        footerLine({ durationMs: 10, toolCalls: 0, toolFailures: 0, eventCount: 2 })
      ],
      [{ pass: true, failures: [] }]
    )
    expect(result.cost).toBeNull()
    expect(result.modelResponseDurationMs).toBeNull()
    expect(result.firstEventLatencyMs).toBeNull()
  })

  it('classifies a complete lifecycle as complete', () => {
    expect(analyzeEventCompleteness(parsed)).toEqual({ status: 'complete', issues: [] })
  })

  it('reports a missing run terminal event', () => {
    const result = analyzeEventCompleteness(
      parsed.filter(
        (record) =>
          !['run.completed', 'run.failed', 'run.aborted'].includes(record.event?.type)
      )
    )
    expect(result.status).toBe('incomplete')
  })

  it('reports unpaired tool lifecycle events', () => {
    const result = analyzeEventCompleteness([
      line({ type: 'run.started', timestamp: 0 }),
      line({ type: 'tool.started', timestamp: 1, toolCallId: 'missing', toolName: 'bash' }),
      line({ type: 'run.completed', timestamp: 2 }),
      footerLine({ eventCount: 3 })
    ])
    expect(result).toEqual({
      status: 'incomplete',
      issues: ['unpaired tool.started: missing']
    })
  })

  it('reports footer event count mismatch', () => {
    const result = analyzeEventCompleteness([
      line({ type: 'run.started', timestamp: 0 }),
      line({ type: 'run.completed', timestamp: 1 }),
      footerLine({ eventCount: 3 })
    ])
    expect(result).toEqual({
      status: 'incomplete',
      issues: ['footer eventCount mismatch: expected 3, parsed 2']
    })
  })

  it('aggregates one sample without dispersion', () => {
    expect(aggregateRepeatValues([12])).toEqual({
      count: 1,
      values: [12],
      mean: 12,
      min: 12,
      max: 12,
      dispersion: null
    })
  })

  it('aggregates three samples with population dispersion', () => {
    const result = aggregateRepeatValues([1, 2, 3])
    expect(result).toEqual({
      count: 3,
      values: [1, 2, 3],
      mean: 2,
      min: 1,
      max: 3,
      dispersion: Math.sqrt(2 / 3)
    })
  })

  it('aggregates five samples and core repeat metrics', () => {
    const result = aggregateRepeatMetrics([
      { passRate: 1, totalTokens: 10, durationMs: 100, toolFailureRate: 0 },
      { passRate: 0.8, totalTokens: 12, durationMs: 120, toolFailureRate: 0.1 },
      { passRate: 0.9, totalTokens: 11, durationMs: 110, toolFailureRate: 0.2 },
      { passRate: 1, totalTokens: 13, durationMs: 130, toolFailureRate: 0.1 },
      { passRate: 0.9, totalTokens: 14, durationMs: 140, toolFailureRate: 0.3 }
    ])
    expect(result.totalTokens.mean).toBe(12)
    expect(result.totalTokens.min).toBe(10)
    expect(result.totalTokens.max).toBe(14)
    expect(result.totalTokens.count).toBe(5)
    expect(result.totalTokens.dispersion).toBeCloseTo(Math.sqrt(2), 10)
    expect(result.passRate.values).toEqual([1, 0.8, 0.9, 1, 0.9])
    expect(result.durationMs.mean).toBe(120)
    expect(result.toolFailureRate.mean).toBeCloseTo(0.14, 10)
  })

  it('creates a versioned baseline with samples and aggregate dispersion', () => {
    const baseline = createBaseline({
      suite: 'real-suite',
      mode: 'real-pi-suite',
      reason: 'accept model update',
      expectedChange: 'token usage should remain stable',
      sampleMetrics: [
        { passRate: 1, totalTokens: 10, durationMs: 100, toolFailureRate: 0 },
        { passRate: 0.9, totalTokens: 12, durationMs: 120, toolFailureRate: 0.1 },
        { passRate: 1, totalTokens: 14, durationMs: 140, toolFailureRate: 0.2 }
      ],
      expectedSampleCount: 3,
      existing: { version: 4 }
    })
    expect(baseline).toMatchObject({
      suite: 'real-suite',
      mode: 'real-pi-suite',
      version: 5,
      reason: 'accept model update',
      expectedChange: 'token usage should remain stable',
      sampleCount: 3,
      metrics: {
        passRate: 0.9666666666666667,
        totalTokens: 12,
        durationMs: 120
      }
    })
    expect(baseline.metrics.toolFailureRate).toBeCloseTo(0.1, 10)
    expect(baseline.samples).toHaveLength(3)
    expect(baseline.aggregates.totalTokens).toMatchObject({
      count: 3,
      mean: 12,
      min: 10,
      max: 14
    })
    expect(baseline.aggregates.totalTokens.dispersion).toBeCloseTo(
      Math.sqrt((4 + 0 + 4) / 3),
      10
    )
  })

  it('rejects invalid baseline updates', () => {
    expect(() =>
      createBaseline({
        suite: 'sample',
        reason: '',
        sampleMetrics: [{ passRate: 1, totalTokens: 1, durationMs: 1, toolFailureRate: 0 }]
      })
    ).toThrow('baseline reason is required')
    expect(() =>
      createBaseline({
        suite: 'sample',
        reason: 'demo',
        sampleMetrics: [],
        expectedSampleCount: 3
      })
    ).toThrow('baseline requires 3 samples, received 0')
  })
})
