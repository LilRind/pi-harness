import { describe, expect, it } from 'vitest'
import { historyRecordSchema } from '@shared/schemas/eval-studio'
import { compareRuns } from './run-comparison'

const metrics = {
  passRate: 1,
  totalTokens: 100,
  durationMs: 1000,
  toolFailureRate: 0,
  assertionFailureCount: 0,
  firstEventLatencyMs: 10,
  toolExecutionDurationMs: [20],
  toolErrorCount: 0,
  eventCompleteness: 'complete',
  cost: null,
  modelResponseDurationMs: [30],
  repeatVariability: null
}

const repeat = {
  id: 'repeat-1',
  index: 0,
  status: 'completed' as const,
  startedAt: 100,
  endedAt: 160,
  fixtureResults: [],
  metrics,
  exportPath: 'exports/run.jsonl',
  sessionDir: 'sessions/run',
  workingDir: 'work/run',
  error: null
}

function run(overrides: Record<string, unknown>) {
  return historyRecordSchema.parse({
    id: 'run',
    createdAt: 100,
    config: {
      mode: 'deterministic-suite',
      suiteId: 'sample',
      provider: 'zhipu',
      model: 'glm-5.2',
      prompt: null,
      tools: ['bash'],
      repeatCount: 1,
      timeoutMs: 180000,
      thresholds: {
        maxTokens: 20000,
        maxDurationMs: 180000,
        maxToolCalls: 10,
        maxToolFailures: 2
      }
    },
    status: 'completed',
    repeats: [repeat],
    artifacts: { reportPath: 'reports/run.json', exportPaths: ['exports/run.jsonl'] },
    sessionDir: 'sessions/run',
    workingDir: 'work/run',
    error: null,
    ...overrides
  })
}

describe('run comparison', () => {
  it('compares config and core metric differences', () => {
    const left = run({ id: 'left' })
    const right = run({
      id: 'right',
      config: {
        ...left.config,
        provider: 'openai',
        model: 'gpt-x'
      },
      repeats: [
        {
          ...repeat,
          metrics: {
            ...metrics,
            passRate: 0.8,
            totalTokens: 120,
            durationMs: 900,
            toolFailureRate: 0.1
          }
        }
      ]
    })
    const comparison = compareRuns(left, right)
    expect(comparison.configDiff).toEqual([
      { path: 'provider', left: 'zhipu', right: 'openai' },
      { path: 'model', left: 'glm-5.2', right: 'gpt-x' }
    ])
    expect(comparison.metrics).toEqual([
      { key: 'passRate', unit: 'ratio', left: 1, right: 0.8, absoluteChange: -0.2, direction: 'worse' },
      { key: 'totalTokens', unit: 'tokens', left: 100, right: 120, absoluteChange: 20, direction: 'worse' },
      { key: 'durationMs', unit: 'ms', left: 1000, right: 900, absoluteChange: -100, direction: 'better' },
      { key: 'toolFailureRate', unit: 'ratio', left: 0, right: 0.1, absoluteChange: 0.1, direction: 'worse' }
    ])
  })

  it('returns same directions and no config diff for equal runs', () => {
    const left = run({ id: 'left' })
    const right = run({ id: 'right' })
    const comparison = compareRuns(left, right)
    expect(comparison.configDiff).toEqual([])
    expect(comparison.metrics.map((metric) => metric.direction)).toEqual([
      'same',
      'same',
      'same',
      'same'
    ])
  })
})
