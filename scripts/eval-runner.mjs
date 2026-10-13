#!/usr/bin/env node
/**
 * eval-runner.mjs — deterministic batch eval loop (zero dependencies).
 *
 * Usage:
 *   node scripts/eval-runner.mjs --suite sample
 *   node scripts/eval-runner.mjs --suite sample --update-baseline --reason "rebaseline after prompt v2"
 *
 * Flow: load fixture suite -> for each fixture render its HarnessEvent sequence
 * into a JSONL export (schema v1, secret seeds masked) -> evaluate assertions
 * against the exported JSONL -> aggregate the four metrics (pass rate, total
 * tokens, total duration, tool failure rate) -> compare against a versioned
 * baseline -> write JSON + Markdown reports + <suite>-latest.json.
 *
 * Exit codes (priority): 3 runtime error > 1 fixture failure > 2 regression
 * > 0 all pass without regression.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(ROOT, 'harness-obs-output')
const EXPORTS_DIR = path.join(OUT_ROOT, 'exports')
const REPORTS_DIR = path.join(OUT_ROOT, 'reports')
const BASELINES_DIR = path.join(OUT_ROOT, 'baselines')
const SCHEMA_VERSION = 1

const MASK = '******'

function parseArgs(argv) {
  const args = { suite: null, updateBaseline: false, reason: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--suite') args.suite = argv[++i]
    else if (argv[i] === '--update-baseline') args.updateBaseline = true
    else if (argv[i] === '--reason') args.reason = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/eval-runner.mjs --suite <name> [--update-baseline --reason "..."]')
      process.exit(0)
    }
  }
  return args
}

function loadSuite(name) {
  const file = path.join(__dirname, 'fixtures', `${name}.mjs`)
  if (!existsSync(file)) {
    throw new Error(`Suite '${name}' not found at ${file}`)
  }
  return import(pathToFileURL(file).href)
}

function maskSecret(text, seed) {
  if (!seed || typeof text !== 'string') return text
  return text.split(seed).join(MASK)
}

function renderJsonl(fixture) {
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
  const ended =
    events.find((e) => ['run.completed', 'run.failed', 'run.aborted'].includes(e.type))?.timestamp ??
    null
  const status =
    events.find((e) => ['run.completed', 'run.failed', 'run.aborted'].includes(e.type))?.status ??
    (events.find((e) => e.type === 'run.aborted') ? 'aborted' : events.find((e) => e.type === 'run.failed') ? 'failed' : 'success')
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

function exportFixture(fixture) {
  mkdirSync(EXPORTS_DIR, { recursive: true })
  const file = path.join(EXPORTS_DIR, `${fixture.id}.jsonl`)
  writeFileSync(file, renderJsonl(fixture), 'utf8')
  return file
}

function aggregateMetrics(parsed, fixtureResults) {
  const totalTokens = parsed.reduce((sum, line) => {
    const ev = line.event
    if (!ev) return sum
    return ev.type === 'message.completed' && typeof ev.usage?.total === 'number'
      ? sum + ev.usage.total
      : sum
  }, 0)
  const totalDurationMs = fixtureResults.reduce(
    (sum, r) => sum + (r.footer.durationMs ?? 0),
    0
  )
  const toolCalls = parsed.filter((l) => l.event?.type === 'tool.completed').length
  const toolFailures = parsed.filter((l) => l.event?.type === 'tool.completed' && l.event.isError === true).length
  return {
    passRate: (fixtureResults.filter((r) => r.pass).length / fixtureResults.length) * 100,
    totalTokens,
    totalDurationMs,
    toolFailureRate: toolCalls > 0 ? (toolFailures / toolCalls) * 100 : 0
  }
}

function evaluateAssertion(assertion, parsedLines, fixture, rawExport) {
  const texts = parsedLines
    .map((l) => l.enriched?.text)
    .filter((t) => typeof t === 'string')
    .join('\n')
  const toolEvents = parsedLines.filter((l) => l.event?.type?.startsWith('tool.'))
  const toolCalls = toolEvents.filter((l) => l.event?.type === 'tool.completed').length
  const toolFailures = toolEvents.filter((l) => l.event?.type === 'tool.completed' && l.event.isError === true).length
  const durationMs =
    (fixture.events.find((e) => ['run.completed', 'run.failed', 'run.aborted'].includes(e.type))
      ?.timestamp ?? 0) -
    (fixture.events.find((e) => e.type === 'run.started')?.timestamp ?? 0)
  const totalTokens = toolEvents.length // tokens come from message events below
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
        ok: parsedLines.some((l) => l.event?.type === 'tool.started' && l.event.toolName === assertion.toolName),
        detail: `tool '${assertion.toolName}' called`
      }
    case 'toolNotCalled':
      return {
        ok: !parsedLines.some((l) => l.event?.type === 'tool.started' && l.event.toolName === assertion.toolName),
        detail: `tool '${assertion.toolName}' not called`
      }
    case 'maxToolFailures':
      return { ok: toolFailures <= assertion.max, detail: `tool failures ${toolFailures} <= ${assertion.max}` }
    case 'maxTokens':
      return { ok: actualTokens <= assertion.max, detail: `tokens ${actualTokens} <= ${assertion.max}` }
    case 'maxDurationMs':
      return { ok: durationMs <= assertion.max, detail: `duration ${durationMs}ms <= ${assertion.max}ms` }
    case 'noUnredactedSecret':
      return { ok: !rawExport.includes(assertion.secretSeed), detail: 'no unredacted secret in export' }
    case 'failed':
      return { ok: fixture.events.some((e) => e.type === 'run.failed'), detail: 'run failed as expected' }
    case 'aborted':
      return { ok: fixture.events.some((e) => e.type === 'run.aborted'), detail: 'run aborted as expected' }
    default:
      return { ok: false, detail: `unknown assertion kind '${assertion.kind}'` }
  }
}

function compareToBaseline(metrics, baseline) {
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
    issues.push(`tokens up ${Math.round(((metrics.totalTokens - b.totalTokens) / b.totalTokens) * 100)}%`)
    if (verdict === 'same' || verdict === 'warning') verdict = 'regression'
  } else if (b.totalTokens > 0 && metrics.totalTokens > b.totalTokens * 1.05 && verdict === 'same') {
    issues.push(`tokens up ${Math.round(((metrics.totalTokens - b.totalTokens) / b.totalTokens) * 100)}%`)
    verdict = 'warning'
  }
  if (b.totalDurationMs > 0 && metrics.totalDurationMs > b.totalDurationMs * 1.1) {
    issues.push(`duration up ${Math.round(((metrics.totalDurationMs - b.totalDurationMs) / b.totalDurationMs) * 100)}%`)
    if (verdict === 'same' || verdict === 'warning') verdict = 'regression'
  } else if (b.totalDurationMs > 0 && metrics.totalDurationMs > b.totalDurationMs * 1.05 && verdict === 'same') {
    issues.push(`duration up ${Math.round(((metrics.totalDurationMs - b.totalDurationMs) / b.totalDurationMs) * 100)}%`)
    verdict = 'warning'
  }
  return { verdict, reason: issues.join('; ') || 'within tolerance', version: baseline.version ?? null }
}

function loadBaseline(suite) {
  const file = path.join(BASELINES_DIR, `${suite}.json`)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

function isTimestampDate(value) {
  return freshTimestamp() === value
}
const freshTimestamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function renderMarkdown(suiteId, results, metrics, comparison, baseline) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.suite) {
    console.error('Missing --suite')
    process.exit(3)
  }
  let mod
  try {
    mod = await loadSuite(args.suite)
  } catch (err) {
    console.error(`Runtime error loading suite: ${err.message}`)
    process.exit(3)
  }
  const suite = mod.suite
  if (!suite || !Array.isArray(suite.fixtures) || suite.fixtures.length < 10 || suite.fixtures.length > 15) {
    console.error('Suite must contain 10-15 fixtures')
    process.exit(3)
  }

  const fixtureResults = []
  const parsedLines = []
  try {
    for (const fixture of suite.fixtures) {
      const exportFile = exportFixture(fixture)
      const rawExport = readFileSync(exportFile, 'utf8')
      const parsed = rawExport
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
      parsedLines.push(...parsed)
      const failures = []
      for (const assertion of fixture.assertions ?? []) {
        const res = evaluateAssertion(assertion, parsed, fixture, rawExport)
        if (!res.ok) failures.push(`${assertion.kind} (${res.detail})`)
      }
      const footerLine = parsed.find((l) => l.footer)
      fixtureResults.push({
        id: fixture.id,
        scenario: fixture.scenario,
        pass: failures.length === 0,
        failures,
        footer: footerLine?.footer ?? null
      })
    }
  } catch (err) {
    console.error(`Runtime error during evaluation: ${err.message}`)
    process.exit(3)
  }

  const metrics = aggregateMetrics(parsedLines, fixtureResults)
  let baseline = loadBaseline(args.suite)
  const comparison = compareToBaseline(metrics, baseline)
  const failures = fixtureResults.filter((r) => !r.pass)
  const hasRegression = comparison.verdict === 'regression'

  mkdirSync(REPORTS_DIR, { recursive: true })
  const stamp = dateStamp()
  const report = { suite: args.suite, date: new Date().toISOString(), metrics, comparison, fixtures: fixtureResults }
  const jsonFile = path.join(REPORTS_DIR, `${args.suite}-${stamp}.json`)
  const mdFile = path.join(REPORTS_DIR, `${args.suite}-${stamp}.md`)
  const latestFile = path.join(REPORTS_DIR, `${args.suite}-latest.json`)
  writeFileSync(jsonFile, JSON.stringify(report, null, 2))
  writeFileSync(latestFile, JSON.stringify(report, null, 2))
  writeFileSync(mdFile, renderMarkdown(args.suite, fixtureResults, metrics, comparison, baseline))

  if (args.updateBaseline) {
    if (!args.reason) {
      console.error('--update-baseline requires --reason')
      process.exit(3)
    }
    mkdirSync(BASELINES_DIR, { recursive: true })
    const now = new Date().toISOString()
    baseline = {
      suite: args.suite,
      version: (baseline?.version ?? 0) + 1,
      updatedAt: now,
      reason: args.reason,
      metrics
    }
    writeFileSync(path.join(BASELINES_DIR, `${args.suite}.json`), JSON.stringify(baseline, null, 2))
    console.log(`Baseline updated to v${baseline.version}: ${args.reason}`)
  }

  console.log(`Suite: ${args.suite} — pass ${fixtureResults.filter((r) => r.pass).length}/${fixtureResults.length}`)
  console.log(`Metrics: passRate=${metrics.passRate.toFixed(2)}% tokens=${metrics.totalTokens} duration=${metrics.totalDurationMs}ms toolFailRate=${metrics.toolFailureRate.toFixed(2)}%`)
  console.log(`Verdict: ${comparison.verdict} (${comparison.reason})`)
  console.log(`Reports: ${jsonFile} | ${mdFile}`)
  for (const f of failures) console.log(`FAIL ${f.id}: ${f.failures.join('; ')}`)

  const code = hasRegression ? 2 : failures.length > 0 ? 1 : 0
  process.exit(code)
}

main().catch((err) => {
  console.error(`Runtime error: ${err.message}`)
  process.exit(3)
})