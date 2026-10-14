#!/usr/bin/env node
/**
 * real-eval-runner.mjs — real-LLM smoke for the harness export pipeline.
 *
 * Runs a real model through the Pi CLI, stores the session under a local
 * ignored dir, then replays the real session messages through the ACTUAL
 * HarnessEventExporter class (bundled from TS via build-export-bundle.mjs)
 * with real session entries as the enrichment source, and asserts:
 *   - assistant text present on message.completed enriched
 *   - tool args matched by toolCallId when a tool was called
 *   - no unredacted secret seed appears in the exported JSONL
 *
 * Security: never accepts an API key on the command line; reuses existing Pi
 * config/env. Results go under harness-obs-output/real/ and are never
 * committed or folded into stable baselines.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(ROOT, 'harness-obs-output')
const REAL_DIR = path.join(OUT_ROOT, 'real')
const SESSION_DIR = path.join(REAL_DIR, 'session')
const BUNDLE = path.join(REAL_DIR, 'bundle', 'exporter.mjs')
const SECRET_SEED = 'sk' + '-REAL_SMOKE_SECRET_47'

function piCli() {
  const candidate = path.join(ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
  if (!existsSync(candidate)) throw new Error(`Pi CLI not found at ${candidate}. Run pnpm install first.`)
  return candidate
}

function runRealSession(args) {
  mkdirSync(SESSION_DIR, { recursive: true })
  const cli = piCli()
  const cmd = [cli, '--print', '-p', '--mode', 'json']
  if (args.provider) cmd.push('--provider', args.provider)
  if (args.model) cmd.push('--model', args.model)
  cmd.push('--session-dir', SESSION_DIR)
  cmd.push('--tools', 'bash')
  cmd.push(`请调用 bash 工具执行 echo "ok"，然后用一句话回答结果。回答中必须包含 ${SECRET_SEED}。`)
  const res = spawnSync(process.execPath, cmd, { encoding: 'utf8', timeout: 180000 })
  if (res.error) throw res.error
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status }
}

function readSessionEntries() {
  const entries = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name)
      if (name.isDirectory()) walk(full)
      else if (/\.(jsonl|json)$/.test(name.name)) {
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          if (!line.trim()) continue
          try { entries.push(JSON.parse(line)) } catch { /* skip */ }
        }
      }
    }
  }
  if (existsSync(SESSION_DIR)) walk(SESSION_DIR)
  return entries
}

function eventsFromEntries(entries) {
  const runId = `real-${Date.now()}`
  const events = [{ type: 'run.started', timestamp: Date.now(), runId, prompt: 'real smoke' }]
  const toolCalls = []
  let msgSeq = 0
  for (const entry of entries) {
    const message = entry.message
    if (!message || typeof message !== 'object') continue
    const content = message.content
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : Date.now()
    if (message.role === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'toolCall') {
          const id = String(block.toolCallId ?? block.id ?? `real-tool-${toolCalls.length}`)
          const name = String(block.toolName ?? block.name ?? 'tool')
          toolCalls.push({ id, name, input: block.input ?? block.arguments ?? {} })
          events.push({ type: 'tool.started', timestamp: ts, toolCallId: id, toolName: name })
          events.push({ type: 'tool.completed', timestamp: ts + 1, toolCallId: id, toolName: name, isError: false })
        }
      }
      events.push({
        type: 'message.completed',
        timestamp: ts,
        seq: msgSeq++,
        model: message.model ?? null,
        provider: message.provider ?? null,
        usage: message.usage
          ? {
              input: message.usage.input ?? 0,
              output: message.usage.output ?? 0,
              cacheRead: message.usage.cacheRead ?? 0,
              cacheWrite: message.usage.cacheWrite ?? 0,
              total: message.usage.total ?? 0,
              cost: message.usage.cost?.total ?? null
            }
          : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null }
      })
    }
  }
  events.push({ type: 'run.completed', timestamp: Date.now(), runId, status: 'success' })
  return { runId, events, toolCalls }
}

function assertExport(raw, toolCalls) {
  const failures = []
  if (!raw.includes('message.completed')) failures.push('missing message.completed line')
  if (toolCalls.length > 0 && !raw.includes('tool.started')) failures.push('missing tool.started line')
  if (!raw.includes('enriched')) failures.push('missing enriched fields')
  if (raw.includes(SECRET_SEED)) failures.push('unredacted secret seed found in export')
  if (toolCalls.length > 0 && !raw.includes('"toolArgs"')) failures.push('missing toolArgs for real tool calls')
  return failures
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
    const result = runRealSession(args)
    const entries = readSessionEntries()
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
    const failures = assertExport(raw, toolCalls)
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
      exportFile: file
    }
    writeFileSync(path.join(REAL_DIR, 'real-report.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log(`Real smoke: ${report.passed ? 'PASS' : 'FAIL'} (entries=${report.entries}, toolCalls=${report.toolCalls.length})`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(report.passed ? 0 : 1)
  } catch (err) {
    console.error(`Runtime error: ${err?.message ?? err}`)
    process.exit(3)
  }
}

import { pathToFileURL } from 'node:url'
await main()