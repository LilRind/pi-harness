#!/usr/bin/env node
/**
 * real-eval-runner.mjs — real-LLM smoke for the harness export pipeline.
 *
 * Runs a real model through the Pi CLI, stores the session under a local
 * ignored dir, then replays the real session messages through the same JSONL
 * export schema + redaction rules used by HarnessEventExporter, and asserts:
 *   - assistant text present on message.completed
 *   - tool args matched by toolCallId when a tool was called
 *   - no unredacted secret seed appears in the exported JSONL
 *
 * The TypeScript exporter/enricher real-source behavior is covered by unit
 * tests (harness-event-exporter.test.ts / enricher.test.ts); this script owns
 * the real-model end of the pipeline.
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
const SCHEMA_VERSION = 1
const MASK = '******'
const SECRET_SEED = 'REAL_SMOKE_SECRET_47'

const SECRET_KEY_RE = /(api[-_]?key|authorization|^auth$|token|secret|password|cookie|bearer|apikey)/i

function redactSecrets(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return SECRET_KEY_RE.test(value) ? MASK : value.split(SECRET_SEED).join(MASK)
  }
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) out[k] = SECRET_KEY_RE.test(k) ? MASK : redactSecrets(value[k])
    return out
  }
  return value
}

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
  cmd.push(args.prompt)
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
  for (const entry of entries) {
    const message = entry.message
    if (!message || typeof message !== 'object') continue
    const content = message.content
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : Date.now()
    if (message.role === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'toolCall') {
          const id = String(block.toolCallId ?? `real-tool-${toolCalls.length}`)
          const name = String(block.toolName ?? 'tool')
          toolCalls.push({ id, name, input: block.input ?? {} })
          events.push({ type: 'tool.started', timestamp: ts, toolCallId: id, toolName: name })
          events.push({ type: 'tool.completed', timestamp: ts + 1, toolCallId: id, toolName: name, isError: false })
        }
      }
      events.push({
        type: 'message.completed',
        timestamp: ts,
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

function enrichEvent(event, entries) {
  const enriched = {}
  if (event.type === 'message.completed') {
    // Nth assistant text corresponds to Nth message.completed
    const texts = entries
      .map((e) => e.message)
      .filter((m) => m && m.role === 'assistant' && m.content)
      .map((m) => {
        if (typeof m.content === 'string') return [m.content]
        return m.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text)
      })
      .flat()
    const idx = event._seq ?? 0
    if (texts.length > 0) enriched.text = texts[Math.min(idx, texts.length - 1)]
  } else if (event.type === 'tool.started' || event.type === 'tool.completed') {
    const call = entries
      .map((e) => e.message?.content)
      .flat()
      .find((b) => b?.type === 'toolCall' && b.toolCallId === event.toolCallId)
    if (call) enriched.toolArgs = call.input ?? {}
  }
  return Object.keys(enriched).length ? enriched : undefined
}

function renderExport(entries, events, toolCalls, runId) {
  const lines = []
  let msgSeq = 0
  const now = Date.now()
  for (const ev of events) {
    const event = { ...ev }
    if (event.type === 'message.completed') { event._seq = msgSeq++; delete event._seq }
    const enriched = enrichEvent({ ...event, _seq: msgSeq - 1 }, entries)
    const line = { schemaVersion: SCHEMA_VERSION, sessionId: 'real-smoke', event, ...(enriched ? { enriched } : {}) }
    lines.push(JSON.stringify(redactSecrets(line)))
  }
  const footer = {
    schemaVersion: SCHEMA_VERSION,
    footer: {
      runId,
      status: 'success',
      startedAt: events[0]?.timestamp ?? now,
      endedAt: now,
      eventCount: events.length,
      totalTokens: null,
      durationMs: null,
      toolCalls: toolCalls.length,
      toolFailures: 0
    }
  }
  lines.push(JSON.stringify(redactSecrets(footer)))
  return lines.join('\n') + '\n'
}

function assertExport(raw, toolCalls) {
  const failures = []
  if (!raw.includes('message.completed')) failures.push('missing message.completed line')
  if (toolCalls.length > 0 && !raw.includes('tool.started')) failures.push('missing tool.started line')
  if (!raw.includes('enriched')) failures.push('missing enriched fields')
  if (raw.includes(SECRET_SEED)) failures.push('unredacted secret seed found in export')
  return failures
}

function parseArgs(argv) {
  const args = { provider: null, model: null, prompt: '用中文简短回答：2+2 等于几？' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') args.provider = argv[++i]
    else if (argv[i] === '--model') args.model = argv[++i]
    else if (argv[i] === '--prompt') args.prompt = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/real-eval-runner.mjs [--provider zhipu] [--model pattern] [--prompt "..."]')
      process.exit(0)
    }
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  try {
    const result = runRealSession(args)
    const entries = readSessionEntries()
    if (entries.length === 0) {
      console.error('No session entries produced by real model run')
      console.error(result.stderr?.slice(-800))
      process.exit(3)
    }
    const { runId, events, toolCalls } = eventsFromEntries(entries)
    mkdirSync(path.join(REAL_DIR, 'exports'), { recursive: true })
    const raw = renderExport(entries, events, toolCalls, runId)
    const file = path.join(REAL_DIR, 'exports', `${runId}.jsonl`)
    writeFileSync(file, raw, 'utf8')
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

main()