import type { HistoryRecord } from '@shared/types/eval-studio'

interface ConfigDiff {
  path: string
  left: unknown
  right: unknown
}

interface MetricComparison {
  key: 'passRate' | 'totalTokens' | 'durationMs' | 'toolFailureRate'
  unit: 'ratio' | 'tokens' | 'ms'
  left: number
  right: number
  absoluteChange: number
  direction: 'better' | 'worse' | 'same'
}

export interface RunComparison {
  configDiff: ConfigDiff[]
  metrics: MetricComparison[]
}

function roundNumber(value: number): number {
  return Number(value.toFixed(12))
}

function averageMetric(
  run: HistoryRecord,
  key: MetricComparison['key']
): number {
  const values = run.repeats.map((repeat) => repeat.metrics[key])
  return roundNumber(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function compareConfig(left: HistoryRecord, right: HistoryRecord): ConfigDiff[] {
  const diffs: ConfigDiff[] = []
  const append = (path: string, leftValue: unknown, rightValue: unknown) => {
    if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
      diffs.push({ path, left: leftValue, right: rightValue })
    }
  }
  append('mode', left.config.mode, right.config.mode)
  append('suiteId', left.config.suiteId, right.config.suiteId)
  append('provider', left.config.provider, right.config.provider)
  append('model', left.config.model, right.config.model)
  append('prompt', left.config.prompt, right.config.prompt)
  append('tools', left.config.tools, right.config.tools)
  append('repeatCount', left.config.repeatCount, right.config.repeatCount)
  append('timeoutMs', left.config.timeoutMs, right.config.timeoutMs)
  append('thresholds.maxTokens', left.config.thresholds.maxTokens, right.config.thresholds.maxTokens)
  append(
    'thresholds.maxDurationMs',
    left.config.thresholds.maxDurationMs,
    right.config.thresholds.maxDurationMs
  )
  append('thresholds.maxToolCalls', left.config.thresholds.maxToolCalls, right.config.thresholds.maxToolCalls)
  append(
    'thresholds.maxToolFailures',
    left.config.thresholds.maxToolFailures,
    right.config.thresholds.maxToolFailures
  )
  return diffs
}

export function compareRuns(left: HistoryRecord, right: HistoryRecord): RunComparison {
  const definitions: Array<{
    key: MetricComparison['key']
    unit: MetricComparison['unit']
    higherIsBetter: boolean
  }> = [
    { key: 'passRate', unit: 'ratio', higherIsBetter: true },
    { key: 'totalTokens', unit: 'tokens', higherIsBetter: false },
    { key: 'durationMs', unit: 'ms', higherIsBetter: false },
    { key: 'toolFailureRate', unit: 'ratio', higherIsBetter: false }
  ]
  const metrics = definitions.map(({ key, unit, higherIsBetter }) => {
    const leftValue = averageMetric(left, key)
    const rightValue = averageMetric(right, key)
    const absoluteChange = roundNumber(rightValue - leftValue)
    const direction: MetricComparison['direction'] =
      absoluteChange === 0
        ? 'same'
        : higherIsBetter === absoluteChange > 0
          ? 'better'
          : 'worse'
    return { key, unit, left: leftValue, right: rightValue, absoluteChange, direction }
  })
  return { configDiff: compareConfig(left, right), metrics }
}
