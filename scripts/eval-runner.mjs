#!/usr/bin/env node
/**
 * eval-runner.mjs — deterministic batch eval loop (zero dependencies).
 *
 * Usage:
 *   node scripts/eval-runner.mjs --suite sample
 *   node scripts/eval-runner.mjs --suite sample --update-baseline --reason "rebaseline"
 *
 * Exit codes: 3 runtime error > 1 fixture failure > 2 regression > 0 pass.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aggregateMetrics,
  compareToBaseline,
  dateStamp,
  evaluateFixture,
  loadSuite,
  renderJsonl,
  renderMarkdown
} from './lib/eval-core.mjs'
import { createBaseline } from './lib/metrics-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(ROOT, 'harness-obs-output')
const EXPORTS_DIR = path.join(OUT_ROOT, 'exports')
const REPORTS_DIR = path.join(OUT_ROOT, 'reports')
const BASELINES_DIR = path.join(OUT_ROOT, 'baselines')

function parseArgs(argv) {
  const args = { suite: null, updateBaseline: false, reason: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--suite') args.suite = argv[++i]
    else if (argv[i] === '--update-baseline') args.updateBaseline = true
    else if (argv[i] === '--reason') args.reason = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        'Usage: node scripts/eval-runner.mjs --suite <name> [--update-baseline --reason "..."]'
      )
      process.exit(0)
    }
  }
  return args
}

function exportFixture(fixture) {
  mkdirSync(EXPORTS_DIR, { recursive: true })
  const file = path.join(EXPORTS_DIR, `${fixture.id}.jsonl`)
  writeFileSync(file, renderJsonl(fixture), 'utf8')
  return file
}

function loadBaseline(suite) {
  const file = path.join(BASELINES_DIR, `${suite}.json`)
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
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
  if (
    !suite ||
    !Array.isArray(suite.fixtures) ||
    suite.fixtures.length < 10 ||
    suite.fixtures.length > 15
  ) {
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
      fixtureResults.push(evaluateFixture(fixture, parsed, rawExport))
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
  const report = {
    suite: args.suite,
    date: new Date().toISOString(),
    metrics,
    comparison,
    fixtures: fixtureResults
  }
  const jsonFile = path.join(REPORTS_DIR, `${args.suite}-${stamp}.json`)
  const mdFile = path.join(REPORTS_DIR, `${args.suite}-${stamp}.md`)
  const latestFile = path.join(REPORTS_DIR, `${args.suite}-latest.json`)
  writeFileSync(jsonFile, JSON.stringify(report, null, 2))
  writeFileSync(latestFile, JSON.stringify(report, null, 2))
  writeFileSync(mdFile, renderMarkdown(args.suite, fixtureResults, metrics, comparison))

  if (args.updateBaseline) {
    if (!args.reason) {
      console.error('--update-baseline requires --reason')
      process.exit(3)
    }
    mkdirSync(BASELINES_DIR, { recursive: true })
    baseline = createBaseline({
      suite: args.suite,
      reason: args.reason,
      sampleMetrics: [
        {
          passRate: metrics.passRate,
          totalTokens: metrics.totalTokens,
          durationMs: metrics.totalDurationMs,
          toolFailureRate: metrics.toolFailureRate
        }
      ],
      expectedSampleCount: 1,
      existing: baseline
    })
    writeFileSync(
      path.join(BASELINES_DIR, `${args.suite}.json`),
      JSON.stringify(baseline, null, 2)
    )
    console.log(`Baseline updated to v${baseline.version}: ${baseline.reason}`)
  }

  console.log(
    `Suite: ${args.suite} — pass ${fixtureResults.filter((r) => r.pass).length}/${fixtureResults.length}`
  )
  console.log(
    `Metrics: passRate=${metrics.passRate.toFixed(2)}% tokens=${metrics.totalTokens} duration=${metrics.totalDurationMs}ms toolFailRate=${metrics.toolFailureRate.toFixed(2)}%`
  )
  console.log(`Verdict: ${comparison.verdict} (${comparison.reason})`)
  console.log(`Reports: ${jsonFile} | ${mdFile}`)
  for (const f of failures) console.log(`FAIL ${f.id}: ${f.failures.join('; ')}`)

  process.exit(hasRegression ? 2 : failures.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(`Runtime error: ${err.message}`)
  process.exit(3)
})
