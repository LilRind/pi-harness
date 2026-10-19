import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { historyRecordSchema } from '@shared/schemas/eval-studio'
import { atomicWriteJson, EvalHistoryStore, resolveWithinRoot } from './history-store'

const metrics = {
  passRate: 1,
  totalTokens: 18,
  durationMs: 60,
  toolFailureRate: 0,
  assertionFailureCount: 0,
  firstEventLatencyMs: 10,
  toolExecutionDurationMs: [20],
  toolErrorCount: 0,
  eventCompleteness: 'complete',
  cost: null,
  modelResponseDurationMs: [30],
  repeatVariability: null
}

const repeat = {
  id: 'repeat-1',
  index: 0,
  status: 'completed' as const,
  startedAt: 100,
  endedAt: 160,
  fixtureResults: [
    {
      fixtureId: 'qa-basic',
      scenario: 'simple-qa',
      status: 'passed' as const,
      failureReasons: []
    }
  ],
  metrics,
  exportPath: 'exports/run-1.jsonl',
  sessionDir: 'sessions/run-1',
  workingDir: 'work/run-1',
  error: null
}

const run = historyRecordSchema.parse({
  id: 'run-1',
  createdAt: 100,
  config: {
    mode: 'deterministic-suite',
    suiteId: 'sample',
    provider: null,
    model: null,
    prompt: null,
    tools: ['bash'],
    repeatCount: 1,
    timeoutMs: 180000,
    thresholds: {
      maxTokens: 20000,
      maxDurationMs: 180000,
      maxToolCalls: 10,
      maxToolFailures: 2
    }
  },
  status: 'completed',
  repeats: [repeat],
  artifacts: {
    reportPath: 'reports/run-1.json',
    exportPaths: ['exports/run-1.jsonl']
  },
  sessionDir: 'sessions/run-1',
  workingDir: 'work/run-1',
  error: null
})

describe('eval history store', () => {
  it('atomically writes JSON and removes temporary files after rename', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-history-atomic-'))
    const file = path.join(dir, 'data.json')
    try {
      atomicWriteJson(file, { value: 1 })
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ value: 1 })
      expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the previous file when interruption happens before rename', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-history-interrupt-'))
    const file = path.join(dir, 'data.json')
    try {
      writeFileSync(file, JSON.stringify({ value: 1 }), 'utf8')
      expect(() =>
        atomicWriteJson(file, { value: 2 }, {
          beforeRename() {
            throw new Error('simulated interruption')
          }
        })
      ).toThrow('simulated interruption')
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ value: 1 })
      expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists an index plus per-run record and reloads it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-history-store-'))
    try {
      const store = new EvalHistoryStore(dir)
      store.save(run)
      const recordPath = path.join(dir, 'runs', 'run-1', 'record.json')
      const indexPath = path.join(dir, 'index.json')
      expect(existsSync(recordPath)).toBe(true)
      expect(existsSync(indexPath)).toBe(true)
      const reloaded = new EvalHistoryStore(dir).load()
      expect(reloaded).toEqual([run])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('queries history by id, suite, mode, status, and time range', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-history-query-'))
    try {
      const store = new EvalHistoryStore(dir)
      const laterRun = historyRecordSchema.parse({
        ...run,
        id: 'run-2',
        createdAt: 200
      })
      const realRun = historyRecordSchema.parse({
        ...run,
        id: 'run-3',
        createdAt: 300,
        status: 'failed',
        config: { ...run.config, mode: 'real-pi-suite' }
      })
      store.save(run)
      store.save(laterRun)
      store.save(realRun)

      expect(store.query({ ids: ['run-1'] }).map((record) => record.id)).toEqual(['run-1'])
      expect(
        store
          .query({
            suiteIds: ['sample'],
            modes: ['deterministic-suite'],
            statuses: ['completed'],
            from: 150,
            to: 250
          })
          .map((record) => record.id)
      ).toEqual(['run-2'])
      expect(store.query({ modes: ['real-pi-suite'] }).map((record) => record.id)).toEqual([
        'run-3'
      ])
      expect(store.query({ suiteIds: ['missing'] })).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves only relative paths inside the history root', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-history-paths-'))
    try {
      expect(resolveWithinRoot(dir, 'reports/run.json')).toBe(
        path.resolve(dir, 'reports/run.json')
      )
      expect(() => resolveWithinRoot(dir, '../escape.json')).toThrow(
        'path escapes eval studio root'
      )
      expect(() => resolveWithinRoot(dir, path.resolve(dir, 'absolute.json'))).toThrow(
        'artifact path must be relative'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sanitizes malicious run ids without escaping the runs directory', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-history-run-id-'))
    try {
      const maliciousRun = historyRecordSchema.parse({ ...run, id: '../../evil' })
      const store = new EvalHistoryStore(dir)
      store.save(maliciousRun)
      expect(existsSync(path.resolve(dir, 'evil.json'))).toBe(false)
      expect(readdirSync(path.join(dir, 'runs')).join('\n')).not.toContain('..')
      expect(store.get('../../evil')?.id).toBe('../../evil')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
