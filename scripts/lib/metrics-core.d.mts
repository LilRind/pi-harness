export interface ExtendedMetrics {
  passRate: number
  totalTokens: number
  durationMs: number
  toolFailureRate: number
  assertionFailureCount: number
  firstEventLatencyMs: number | null
  toolExecutionDurationMs: number[]
  toolErrorCount: number
  eventCompleteness: 'complete' | 'incomplete' | 'unknown'
  cost: number | null
  modelResponseDurationMs: number[] | null
  repeatVariability: unknown
}

export function aggregateExtendedMetrics(
  parsedLines: Array<Record<string, unknown>>,
  fixtureResults: Array<{ pass: boolean; failures?: string[] }>
): ExtendedMetrics

export interface BaselineAggregates {
  passRate: { count: number; values: number[]; mean: number; min: number; max: number; dispersion: number | null }
  totalTokens: { count: number; values: number[]; mean: number; min: number; max: number; dispersion: number | null }
  durationMs: { count: number; values: number[]; mean: number; min: number; max: number; dispersion: number | null }
  toolFailureRate: { count: number; values: number[]; mean: number; min: number; max: number; dispersion: number | null }
}

export function createBaseline(options: {
  suite: string
  mode?: string
  reason: string
  expectedChange?: string | null
  sampleMetrics: Array<{
    passRate: number
    totalTokens: number
    durationMs: number
    toolFailureRate: number
  }>
  expectedSampleCount?: number
  existing?: { version?: number } | null
  updatedAt?: string
}): {
  suite: string
  mode: string
  version: number
  updatedAt: string
  reason: string
  expectedChange: string | null
  sampleCount: number
  samples: unknown[]
  aggregates: BaselineAggregates
  metrics: {
    passRate: number
    totalTokens: number
    durationMs: number
    toolFailureRate: number
  }
}
