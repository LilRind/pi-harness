import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export function createExecutionSessionDir(baseDir) {
  const dir = path.join(baseDir, `run-${Date.now()}-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function readSessionEntries(sessionDir) {
  const entries = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name)
      if (name.isDirectory()) walk(full)
      else if (/\.(jsonl|json)$/.test(name.name)) {
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            entries.push(JSON.parse(line))
          } catch {
            // Session files may contain non-record lines; ignore them.
          }
        }
      }
    }
  }
  if (existsSync(sessionDir)) walk(sessionDir)
  return entries
}

export function eventsFromEntries(entries, options = {}) {
  const now = options.now ?? Date.now()
  const runId = options.runId ?? `real-${now}`
  const prompt = options.prompt ?? 'real smoke'
  const entryTimestamps = entries
    .map((entry) => (entry.timestamp ? Date.parse(entry.timestamp) : NaN))
    .filter((timestamp) => Number.isFinite(timestamp))
  const startedAt = entryTimestamps.length > 0 ? Math.min(...entryTimestamps) : now
  const events = [{ type: 'run.started', timestamp: startedAt, runId, prompt }]
  const toolCalls = []
  let msgSeq = 0
  for (const entry of entries) {
    const message = entry.message
    if (!message || typeof message !== 'object') continue
    const content = message.content
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : startedAt
    if (message.role === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'toolCall') {
          const id = String(block.toolCallId ?? block.id ?? `real-tool-${toolCalls.length}`)
          const name = String(block.toolName ?? block.name ?? 'tool')
          toolCalls.push({ id, name, input: block.input ?? block.arguments ?? {} })
          events.push({ type: 'tool.started', timestamp: ts, toolCallId: id, toolName: name })
          events.push({
            type: 'tool.completed',
            timestamp: ts + 1,
            toolCallId: id,
            toolName: name,
            isError: false
          })
        }
      }
      events.push({ type: 'message.started', timestamp: ts })
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
              total: message.usage.total ?? message.usage.totalTokens ?? 0,
              cost: message.usage.cost?.total ?? null
            }
          : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null }
      })
    }
  }
  const timestamps = entries
    .map((e) => (e.timestamp ? Date.parse(e.timestamp) : NaN))
    .filter((t) => Number.isFinite(t))
  const lastEntryTs = timestamps.length > 0 ? Math.max(...timestamps) : NaN
  events.push({
    type: 'run.completed',
    timestamp: Number.isFinite(lastEntryTs) ? lastEntryTs : now,
    runId,
    status: 'success'
  })
  return { runId, events, toolCalls }
}

export function assertExport(raw, toolCalls, secretSeed) {
  const failures = []
  if (!raw.includes('message.completed')) failures.push('missing message.completed line')
  if (toolCalls.length > 0 && !raw.includes('tool.started')) {
    failures.push('missing tool.started line')
  }
  if (!raw.includes('enriched')) failures.push('missing enriched fields')
  if (secretSeed && raw.includes(secretSeed)) {
    failures.push('unredacted secret seed found in export')
  }
  if (toolCalls.length > 0 && !raw.includes('"toolArgs"')) {
    failures.push('missing toolArgs for real tool calls')
  }
  return failures
}
