import { describe, expect, it } from 'vitest'
import {
  fixtureResultSchema,
  historyRecordSchema,
  metricsReportSchema,
  runConfigOverrideSchema,
  suiteCatalogEntrySchema,
  studioRepeatSchema,
  studioRunSchema
} from './eval-studio'

const baseMetrics = {
  passRate: 1,
  totalTokens: 1234,
  durationMs: 5678,
  toolFailureRate: 0,
  assertionFailureCount: 0,
  firstEventLatencyMs: 12,
  toolExecutionDurationMs: [34, 56],
  toolErrorCount: 0,
  eventCompleteness: 'complete',
  cost: null,
  modelResponseDurationMs: null,
  repeatVariability: null
}

const baseFixtureResult = {
  fixtureId: 'qa-basic',
  scenario: 'simple-qa',
  status: 'passed',
  failureReasons: []
}

const baseRepeat = {
  id: 'repeat-1',
  index: 0,
  status: 'completed',
  startedAt: 100,
  endedAt: 200,
  fixtureResults: [baseFixtureResult],
  metrics: baseMetrics,
  exportPath: 'exports/qa-basic.jsonl',
  sessionDir: 'sessions/run-1',
  workingDir: 'work/run-1',
  error: null
}

const baseRunConfig = {
  mode: 'deterministic-suite',
  suiteId: 'sample',
  provider: 'zhipu',
  model: 'glm-5.2',
  prompt: null,
  tools: ['bash'],
  repeatCount: 3,
  timeoutMs: 180000,
  thresholds: {
    maxTokens: 20000,
    maxDurationMs: 180000,
    maxToolCalls: 10,
    maxToolFailures: 2
  }
}

describe('eval studio schemas', () => {
  it('accepts a complete suite catalog entry', () => {
    const entry = suiteCatalogEntrySchema.parse({
      suiteId: 'sample',
      name: 'sample',
      description: 'Deterministic sample suite',
      fixtureCount: 12
    })
    expect(entry.fixtureCount).toBe(12)
  })

  it('requires run override fields that govern execution', () => {
    expect(() => runConfigOverrideSchema.parse({ ...baseRunConfig, suiteId: '' })).toThrow()
    expect(() => runConfigOverrideSchema.parse({ ...baseRunConfig, repeatCount: 0 })).toThrow()
    expect(() => runConfigOverrideSchema.parse({ ...baseRunConfig, timeoutMs: 0 })).toThrow()
    expect(runConfigOverrideSchema.parse(baseRunConfig).repeatCount).toBe(3)
  })

  it('keeps unavailable metric values as explicit nulls', () => {
    const metrics = metricsReportSchema.parse(baseMetrics)
    expect(metrics.cost).toBeNull()
    expect(metrics.modelResponseDurationMs).toBeNull()
    expect(() => metricsReportSchema.parse({ ...baseMetrics, cost: undefined })).toThrow()
  })

  it('validates fixture results and studio repeats', () => {
    expect(() => fixtureResultSchema.parse({ ...baseFixtureResult, fixtureId: '' })).toThrow()
    const repeat = studioRepeatSchema.parse(baseRepeat)
    expect(repeat.index).toBe(0)
    expect(repeat.metrics.eventCompleteness).toBe('complete')
  })

  it('validates a complete studio run and history record', () => {
    const run = studioRunSchema.parse({
      id: 'run-1',
      createdAt: 100,
      config: baseRunConfig,
      status: 'completed',
      repeats: [baseRepeat],
      artifacts: { reportPath: 'reports/run-1.json', exportPaths: ['exports/run-1.jsonl'] },
      sessionDir: 'sessions/run-1',
      workingDir: 'work/run-1',
      error: null
    })
    expect(historyRecordSchema.parse(run).id).toBe('run-1')
    expect(() => studioRunSchema.parse({ ...run, status: 'unknown' })).toThrow()
  })
})
