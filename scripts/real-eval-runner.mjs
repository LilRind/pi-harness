#!/usr/bin/env node
/**
 * real-eval-runner.mjs — real-LLM smoke for the harness export pipeline.
 *
 * Security: never accepts an API key on the command line; reuses existing Pi
 * config/env. Results stay under harness-obs-output/real/ and are never
 * committed or folded into stable baselines.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertExport,
  createExecutionSessionDir,
  eventsFromEntries,
  readSessionEntries
} from './lib/real-eval-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(ROOT, 'harness-obs-output')
const REAL_DIR = path.join(OUT_ROOT, 'real')
const SESSION_DIR = path.join(REAL_DIR, 'session')
const BUNDLE = path.join(REAL_DIR, 'bundle', 'exporter.mjs')
const SECRET_SEED = 'sk' + '-REAL_SMOKE_SECRET_47'

function piCli() {
  const candidate = path.join(
    ROOT,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'bundle',
    'cli.js'
  )
  if (!existsSync(candidate)) {
    throw new Error(`Pi CLI not found at ${candidate}. Run pnpm install first.`)
  }
  return candidate
}

function runRealSession(args, sessionDir) {
  mkdirSync(sessionDir, { recursive: true })
  const cli = piCli()
  const cmd = [cli, '--print', '-p', '--mode', 'json']
  if (args.provider) cmd.push('--provider', args.provider)
  if (args.model) cmd.push('--model', args.model)
  cmd.push('--session-dir', sessionDir)
  cmd.push('--tools', 'bash')
  cmd.push(
    `请调用 bash 工具执行 echo "ok"，然后用一句话回答结果。回答中必须包含 ${SECRET_SEED}。`
  )
  const res = spawnSync(process.execPath, cmd, { encoding: 'utf8', timeout: 180000 })
  if (res.error) throw res.error
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status }
}

function parseArgs(argv) {
  const args = { provider: null, model: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') args.provider = argv[++i]
    else if (argv[i] === '--model') args.model = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/real-eval-runner.mjs [--provider zhipu] [--model pattern]')
      process.exit(0)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  try {
    if (!existsSync(BUNDLE)) {
      console.error('Exporter bundle missing. Run: node scripts/build-export-bundle.mjs')
      process.exit(3)
    }
    const { HarnessEventExporter } = await import(pathToFileURL(BUNDLE).href)
    const executionSessionDir = createExecutionSessionDir(SESSION_DIR)
    const result = runRealSession(args, executionSessionDir)
    const entries = readSessionEntries(executionSessionDir)
    if (entries.length === 0) {
      console.error('No session entries produced by real model run')
      console.error(result.stderr?.slice(-800))
      process.exit(3)
    }
    const { runId, events, toolCalls } = eventsFromEntries(entries)
    const dir = path.join(REAL_DIR, 'exports')
    mkdirSync(dir, { recursive: true })
    const exporter = new HarnessEventExporter({
      dir,
      registerExitHook: false,
      source: { readRawEntries: async () => entries }
    })
    for (const event of events) exporter.observe(event, 'real-smoke')
    await exporter.shutdown()
    const file = path.join(dir, `${runId}.jsonl`)
    const raw = readFileSync(file, 'utf8')
    const failures = assertExport(raw, toolCalls, SECRET_SEED)
    const report = {
      runId,
      provider: args.provider ?? '(default)',
      model: args.model ?? '(default)',
      toolCalls: toolCalls.map((t) => t.name),
      entries: entries.length,
      failures,
      passed: failures.length === 0,
      cliExitCode: result.status,
      stdoutTail: result.stdout?.slice(-800) ?? '',
      sessionDir: executionSessionDir,
      exportFile: file
    }
    writeFileSync(path.join(REAL_DIR, 'real-report.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log(
      `Real smoke: ${report.passed ? 'PASS' : 'FAIL'} (entries=${report.entries}, toolCalls=${report.toolCalls.length})`
    )
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(report.passed ? 0 : 1)
  } catch (err) {
    console.error(`Runtime error: ${err?.message ?? err}`)
    process.exit(3)
  }
}

await main()
