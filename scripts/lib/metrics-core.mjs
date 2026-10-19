function usageTotal(event) {
  const usage = event.usage
  if (!usage) return 0
  const explicitTotal = usage.total ?? usage.totalTokens
  if (typeof explicitTotal === 'number' && explicitTotal > 0) return explicitTotal
  const componentSum = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0)
  return componentSum > 0 ? componentSum : (explicitTotal ?? 0)
}

function average(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function firstEventLatencies(events) {
  const latencies = []
  let currentRun = null
  for (const record of events) {
    const event = record.event
    if (event.type === 'run.started') {
      currentRun = event
      continue
    }
    if (!currentRun) continue
    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.aborted'
    ) {
      continue
    }
    latencies.push(event.timestamp - currentRun.timestamp)
    currentRun = null
  }
  return latencies
}

function toolDurations(events) {
  const started = new Map()
  const durations = []
  let fallbackIndex = 0
  for (const record of events) {
    const event = record.event
    if (event.type === 'tool.started') {
      const key = event.toolCallId ?? `#${fallbackIndex++}`
      started.set(key, event.timestamp)
    } else if (event.type === 'tool.completed') {
      const key = event.toolCallId ?? `#${Math.max(0, fallbackIndex - 1)}`
      const start = started.get(key)
      if (start != null) {
        durations.push(event.timestamp - start)
        started.delete(key)
      }
    }
  }
  return durations
}

function modelDurations(events) {
  const durations = []
  const stack = []
  for (const record of events) {
    const event = record.event
    if (event.type === 'message.started') {
      stack.push(event.timestamp)
    } else if (event.type === 'message.completed' && stack.length > 0) {
      const start = stack.pop()
      durations.push(event.timestamp - start)
    }
  }
  return durations
}

export function aggregateExtendedMetrics(parsedLines, fixtureResults = []) {
  const eventRecords = parsedLines.filter((line) => line.event)
  const events = eventRecords.map((line) => line.event)
  const footers = parsedLines.filter((line) => line.footer).map((line) => line.footer)
  const toolCompleted = events.filter((event) => event.type === 'tool.completed')
  const toolFailures = toolCompleted.filter((event) => event.isError === true)
  const costs = eventRecords
    .map((line) => line.event.usage?.cost)
    .filter((cost) => typeof cost === 'number' && Number.isFinite(cost))
  const responses = modelDurations(eventRecords)
  const latencies = firstEventLatencies(eventRecords)

  return {
    passRate:
      fixtureResults.length > 0
        ? fixtureResults.filter((result) => result.pass).length / fixtureResults.length
        : 0,
    totalTokens: eventRecords.reduce((sum, line) => sum + usageTotal(line.event), 0),
    durationMs: footers.reduce((sum, footer) => sum + (footer.durationMs ?? 0), 0),
    toolFailureRate:
      toolCompleted.length > 0 ? toolFailures.length / toolCompleted.length : 0,
    assertionFailureCount: fixtureResults.reduce(
      (sum, result) => sum + (result.failures?.length ?? 0),
      0
    ),
    firstEventLatencyMs: average(latencies),
    toolExecutionDurationMs: toolDurations(eventRecords),
    toolErrorCount: toolFailures.length,
    eventCompleteness: analyzeEventCompleteness(parsedLines).status,
    cost: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    modelResponseDurationMs: responses.length > 0 ? responses : null,
    repeatVariability: null
  }
}

export function analyzeEventCompleteness(parsedLines) {
  const eventRecords = parsedLines.filter((record) => record.event)
  const events = eventRecords.map((record) => record.event)
  const issues = []
  let runStartedCount = 0
  let runTerminalCount = 0
  const messageStack = []
  const startedTools = new Map()
  let fallbackToolIndex = 0

  for (const event of events) {
    if (event.type === 'run.started') {
      runStartedCount++
    } else if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.aborted'
    ) {
      runTerminalCount++
    } else if (event.type === 'message.started') {
      messageStack.push(event)
    } else if (event.type === 'message.completed') {
      const started = messageStack.pop()
      if (!started) issues.push('unpaired message.completed')
    } else if (event.type === 'tool.started') {
      const key = event.toolCallId ?? `#${fallbackToolIndex++}`
      startedTools.set(key, event)
    } else if (event.type === 'tool.completed') {
      const key = event.toolCallId ?? `#${Math.max(0, fallbackToolIndex - 1)}`
      if (!startedTools.has(key)) {
        issues.push(`unpaired tool.completed: ${key}`)
      } else {
        startedTools.delete(key)
      }
    }
  }

  if (runStartedCount === 0) issues.push('missing run.started')
  if (runTerminalCount === 0) issues.push('missing run terminal event')
  if (runStartedCount !== runTerminalCount) {
    issues.push(`run start/terminal mismatch: ${runStartedCount}/${runTerminalCount}`)
  }
  for (const key of startedTools.keys()) issues.push(`unpaired tool.started: ${key}`)
  if (messageStack.length > 0) issues.push(`unpaired message.started: ${messageStack.length}`)

  const footers = parsedLines.filter((record) => record.footer).map((record) => record.footer)
  if (footers.length > 0) {
    const expectedCount = footers.reduce((sum, footer) => sum + (footer.eventCount ?? 0), 0)
    if (expectedCount !== eventRecords.length) {
      issues.push(
        `footer eventCount mismatch: expected ${expectedCount}, parsed ${eventRecords.length}`
      )
    }
  }

  return {
    status: issues.length === 0 ? 'complete' : 'incomplete',
    issues
  }
}

export function aggregateRepeatValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('repeat aggregation requires at least one numeric value')
  }
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('repeat aggregation requires finite numeric values')
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const squaredDifferenceSum = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  return {
    count: values.length,
    values: [...values],
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    dispersion:
      values.length >= 2 ? Math.sqrt(squaredDifferenceSum / values.length) : null
  }
}

export function aggregateRepeatMetrics(repeatMetrics) {
  const metricNames = ['passRate', 'totalTokens', 'durationMs', 'toolFailureRate']
  const result = {}
  for (const name of metricNames) {
    result[name] = aggregateRepeatValues(repeatMetrics.map((metrics) => metrics[name]))
  }
  return result
}

export function createBaseline(options) {
  const {
    suite,
    mode = 'deterministic-suite',
    reason,
    expectedChange = null,
    sampleMetrics,
    expectedSampleCount,
    existing = null,
    updatedAt = new Date().toISOString()
  } = options
  if (!suite) throw new Error('baseline suite is required')
  if (!reason || !reason.trim()) throw new Error('baseline reason is required')
  if (!Array.isArray(sampleMetrics)) throw new Error('baseline samples must be an array')
  const requiredCount = expectedSampleCount ?? sampleMetrics.length
  if (requiredCount < 1) throw new Error('baseline requires at least one sample')
  if (sampleMetrics.length !== requiredCount) {
    throw new Error(`baseline requires ${requiredCount} samples, received ${sampleMetrics.length}`)
  }
  const aggregates = aggregateRepeatMetrics(sampleMetrics)
  return {
    suite,
    mode,
    version: (existing?.version ?? 0) + 1,
    updatedAt,
    reason,
    expectedChange,
    sampleCount: sampleMetrics.length,
    samples: [...sampleMetrics],
    aggregates,
    metrics: {
      passRate: aggregates.passRate.mean,
      totalTokens: aggregates.totalTokens.mean,
      durationMs: aggregates.durationMs.mean,
      toolFailureRate: aggregates.toolFailureRate.mean
    }
  }
}
