import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SCHEMA_VERSION = 1
export const MASK = '******'

export function loadSuite(name, fixturesDir = path.resolve(__dirname, '..', 'fixtures')) {
  const file = path.join(fixturesDir, `${name}.mjs`)
  if (!existsSync(file)) {
    throw new Error(`Suite '${name}' not found at ${file}`)
  }
  return import(pathToFileURL(file).href)
}

export function maskSecret(text, seed) {
  if (!seed || typeof text !== 'string') return text
  return text.split(seed).join(MASK)
}

export function renderJsonl(fixture) {
  const lines = []
  const events = fixture.events ?? []
  for (const event of events) {
    const { text: rawText, ...eventRest } = event
    let text
    let toolArgs
    if (event.type === 'message.completed' && typeof rawText === 'string') {
      text = maskSecret(rawText, fixture.secretSeed)
    }
    if (event.toolName && !rawText) {
      toolArgs = { toolCallId: event.toolCallId ?? null }
    }
    const line = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: fixture.id,
      event: { type: event.type, timestamp: event.timestamp, ...eventRest },
      ...(text !== undefined || toolArgs !== undefined
        ? { enriched: { ...(text !== undefined ? { text } : {}), ...(toolArgs ? { toolArgs } : {}) } }
        : {})
    }
    lines.push(JSON.stringify(line))
  }
  const started = events.find((e) => e.type === 'run.started')?.timestamp ?? null
  const terminal = events.find((e) =>
    ['run.completed', 'run.failed', 'run.aborted'].includes(e.type)
  )
  const ended = terminal?.timestamp ?? null
  const status =
    terminal?.status ??
    (events.find((e) => e.type === 'run.aborted')
      ? 'aborted'
      : events.find((e) => e.type === 'run.failed')
        ? 'failed'
        : 'success')
  const footer = {
    schemaVersion: SCHEMA_VERSION,
    footer: {
      runId: fixture.id,
      status,
      startedAt: started ?? 0,
      endedAt: ended ?? started ?? 0,
      eventCount: events.length,
      totalTokens: null,
      durationMs: started != null && ended != null ? ended - started : null,
      toolCalls: events.filter((e) => e.type === 'tool.completed').length,
      toolFailures: events.filter((e) => e.type === 'tool.completed' && e.isError === true).length
    }
  }
  lines.push(JSON.stringify(footer))
  return lines.join('\n') + '\n'
}

export function aggregateMetrics(parsed, fixtureResults) {
  const totalTokens = parsed.reduce((sum, line) => {
    const ev = line.event
    if (!ev) return sum
    return ev.type === 'message.completed' && typeof ev.usage?.total === 'number'
      ? sum + ev.usage.total
      : sum
  }, 0)
  const totalDurationMs = fixtureResults.reduce((sum, r) => sum + (r.footer.durationMs ?? 0), 0)
  const toolCalls = parsed.filter((l) => l.event?.type === 'tool.completed').length
  const toolFailures = parsed.filter(
    (l) => l.event?.type === 'tool.completed' && l.event.isError === true
  ).length
  return {
    passRate: (fixtureResults.filter((r) => r.pass).length / fixtureResults.length) * 100,
    totalTokens,
    totalDurationMs,
    toolFailureRate: toolCalls > 0 ? (toolFailures / toolCalls) * 100 : 0
  }
}

export function evaluateAssertion(assertion, parsedLines, fixture, rawExport) {
  const texts = parsedLines
    .map((l) => l.enriched?.text)
    .filter((t) => typeof t === 'string')
    .join('\n')
  const toolEvents = parsedLines.filter((l) => l.event?.type?.startsWith('tool.'))
  const toolFailures = toolEvents.filter(
    (l) => l.event?.type === 'tool.completed' && l.event.isError === true
  ).length
  const durationMs =
    (fixture.events.find((e) => ['run.completed', 'run.failed', 'run.aborted'].includes(e.type))
      ?.timestamp ?? 0) -
    (fixture.events.find((e) => e.type === 'run.started')?.timestamp ?? 0)
  const actualTokens = parsedLines.reduce((sum, l) => {
    const ev = l.event
    if (!ev) return sum
    return ev.type === 'message.completed' && typeof ev.usage?.total === 'number'
      ? sum + ev.usage.total
      : sum
  }, 0)

  switch (assertion.kind) {
    case 'containsText':
      return { ok: texts.includes(assertion.text), detail: `text contains '${assertion.text}'` }
    case 'toolCalled':
      return {
        ok: parsedLines.some(
          (l) => l.event?.type === 'tool.started' && l.event.toolName === assertion.toolName
        ),
        detail: `tool '${assertion.toolName}' called`
      }
    case 'toolNotCalled':
      return {
        ok: !parsedLines.some(
          (l) => l.event?.type === 'tool.started' && l.event.toolName === assertion.toolName
        ),
        detail: `tool '${assertion.toolName}' not called`
      }
    case 'maxToolFailures':
      return {
        ok: toolFailures <= assertion.max,
        detail: `tool failures ${toolFailures} <= ${assertion.max}`
      }
    case 'maxTokens':
      return { ok: actualTokens <= assertion.max, detail: `tokens ${actualTokens} <= ${assertion.max}` }
    case 'maxDurationMs':
      return {
        ok: durationMs <= assertion.max,
        detail: `duration ${durationMs}ms <= ${assertion.max}ms`
      }
    case 'noUnredactedSecret':
      return {
        ok: !rawExport.includes(assertion.secretSeed),
        detail: 'no unredacted secret in export'
      }
    case 'failed':
      return {
        ok: fixture.events.some((e) => e.type === 'run.failed'),
        detail: 'run failed as expected'
      }
    case 'aborted':
      return {
        ok: fixture.events.some((e) => e.type === 'run.aborted'),
        detail: 'run aborted as expected'
      }
    default:
      return { ok: false, detail: `unknown assertion kind '${assertion.kind}'` }
  }
}

function actualForAssertion(assertion, parsedLines, fixture, rawExport) {
  const texts = parsedLines
    .map((line) => line.enriched?.text)
    .filter((text) => typeof text === 'string')
    .join('\n')
  const toolNames = parsedLines
    .filter((line) => line.event?.type === 'tool.started')
    .map((line) => line.event.toolName)
  const toolFailures = parsedLines.filter(
    (line) => line.event?.type === 'tool.completed' && line.event.isError === true
  ).length
  const actualTokens = parsedLines.reduce((sum, line) => {
    const event = line.event
    if (!event) return sum
    return event.type === 'message.completed' && typeof event.usage?.total === 'number'
      ? sum + event.usage.total
      : sum
  }, 0)
  const durationMs =
    (fixture.events.find((event) =>
      ['run.completed', 'run.failed', 'run.aborted'].includes(event.type)
    )?.timestamp ?? 0) -
    (fixture.events.find((event) => event.type === 'run.started')?.timestamp ?? 0)

  switch (assertion.kind) {
    case 'containsText':
      return texts
    case 'toolCalled':
    case 'toolNotCalled':
      return toolNames.join(',')
    case 'maxToolFailures':
      return String(toolFailures)
    case 'maxTokens':
      return String(actualTokens)
    case 'maxDurationMs':
      return String(durationMs)
    case 'noUnredactedSecret':
      return String(rawExport.includes(assertion.secretSeed))
    case 'failed':
      return String(fixture.events.some((event) => event.type === 'run.failed'))
    case 'aborted':
      return String(fixture.events.some((event) => event.type === 'run.aborted'))
    default:
      return null
  }
}

function expectedForAssertion(assertion) {
  switch (assertion.kind) {
    case 'containsText':
      return assertion.text
    case 'toolCalled':
    case 'toolNotCalled':
      return assertion.toolName
    case 'maxToolFailures':
    case 'maxTokens':
    case 'maxDurationMs':
      return String(assertion.max)
    case 'noUnredactedSecret':
      return 'false'
    case 'failed':
    case 'aborted':
      return 'true'
    default:
      return null
  }
}

export function evaluateAssertionDetailed(assertion, parsedLines, fixture, rawExport) {
  const result = evaluateAssertion(assertion, parsedLines, fixture, rawExport)
  return {
    ...result,
    failure: result.ok
      ? null
      : {
          fixtureId: fixture.id,
          assertionType: assertion.kind,
          expected: expectedForAssertion(assertion),
          actual: actualForAssertion(assertion, parsedLines, fixture, rawExport),
          message: result.detail
        }
  }
}

export function evaluateFixture(fixture, parsedLines, rawExport) {
  const failures = []
  const failureDetails = []
  for (const assertion of fixture.assertions ?? []) {
    const result = evaluateAssertionDetailed(assertion, parsedLines, fixture, rawExport)
    if (!result.ok) {
      failures.push(`${assertion.kind} (${result.detail})`)
      failureDetails.push(result.failure)
    }
  }
  return {
    id: fixture.id,
    scenario: fixture.scenario,
    pass: failures.length === 0,
    failures,
    failureDetails,
    footer: parsedLines.find((line) => line.footer)?.footer ?? null
  }
}

export function compareToBaseline(metrics, baseline) {
  if (!baseline) {
    return { verdict: 'same', reason: 'no baseline yet', version: null }
  }
  const b = baseline.metrics
  const issues = []
  let verdict = 'same'
  if (metrics.passRate < b.passRate - 5) {
    issues.push(`pass rate declined ${(b.passRate - metrics.passRate).toFixed(1)}pp`)
    verdict = 'regression'
  } else if (metrics.passRate < b.passRate - 2) {
    issues.push(`pass rate declined ${(b.passRate - metrics.passRate).toFixed(1)}pp`)
    verdict = 'warning'
  } else if (metrics.passRate > b.passRate + 2) {
    verdict = 'improvement'
  }
  if (b.totalTokens > 0 && metrics.totalTokens > b.totalTokens * 1.1) {
    issues.push(
      `tokens up ${Math.round(((metrics.totalTokens - b.totalTokens) / b.totalTokens) * 100)}%`
    )
    if (verdict === 'same' || verdict === 'warning') verdict = 'regression'
  } else if (b.totalTokens > 0 && metrics.totalTokens > b.totalTokens * 1.05 && verdict === 'same') {
    issues.push(
      `tokens up ${Math.round(((metrics.totalTokens - b.totalTokens) / b.totalTokens) * 100)}%`
    )
    verdict = 'warning'
  }
  if (b.totalDurationMs > 0 && metrics.totalDurationMs > b.totalDurationMs * 1.1) {
    issues.push(
      `duration up ${Math.round(((metrics.totalDurationMs - b.totalDurationMs) / b.totalDurationMs) * 100)}%`
    )
    if (verdict === 'same' || verdict === 'warning') verdict = 'regression'
  } else if (
    b.totalDurationMs > 0 &&
    metrics.totalDurationMs > b.totalDurationMs * 1.05 &&
    verdict === 'same'
  ) {
    issues.push(
      `duration up ${Math.round(((metrics.totalDurationMs - b.totalDurationMs) / b.totalDurationMs) * 100)}%`
    )
    verdict = 'warning'
  }
  return { verdict, reason: issues.join('; ') || 'within tolerance', version: baseline.version ?? null }
}

export function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

export function renderMarkdown(suiteId, results, metrics, comparison) {
  const lines = []
  lines.push(`# Eval Report — ${suiteId}`)
  lines.push('')
  lines.push(`- Date: ${new Date().toISOString()}`)
  lines.push(`- Verdict vs baseline: **${comparison.verdict}** (${comparison.reason})`)
  lines.push(`- Baseline version: ${comparison.version ?? 'none'}`)
  lines.push('')
  lines.push('## Metrics')
  lines.push('')
  lines.push('| Metric | Value | Note |')
  lines.push('| --- | --- | --- |')
  lines.push(`| Pass rate | ${metrics.passRate.toFixed(2)}% | passed/total fixtures |`)
  lines.push(`| Total tokens | ${metrics.totalTokens} | sum of message usage.total |`)
  lines.push(`| Total duration | ${metrics.totalDurationMs}ms | sum of run durations |`)
  lines.push(`| Tool failure rate | ${metrics.toolFailureRate.toFixed(2)}% | failed tool.completed / total |`)
  lines.push('')
  lines.push('## Fixtures')
  lines.push('')
  for (const r of results) {
    lines.push(`- [${r.pass ? 'x' : ' '}] ${r.id} — ${r.failures.length > 0 ? r.failures.join('; ') : 'ok'}`)
  }
  return lines.join('\n') + '\n'
}
