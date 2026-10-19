import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { evaluateFixture, loadSuite, renderJsonl } from '../../../../scripts/lib/eval-core.mjs'
import { aggregateExtendedMetrics, createBaseline } from '../../../../scripts/lib/metrics-core.mjs'
import {
  assertExport,
  eventsFromEntries,
  readSessionEntries
} from '../../../../scripts/lib/real-eval-core.mjs'
import { createRealPiExecutor, validateRealPiSafety } from '../../../../scripts/lib/real-executor.mjs'
import { runConfigOverrideSchema } from '@shared/schemas/eval-studio'
import type { HarnessEvent } from '@shared/types/harness'
import type { MetricsReport, StudioRepeat, StudioRun } from '@shared/types/eval-studio'
import type { SessionEntry } from '@shared/types/workspace'
import { HarnessEventExporter } from '../export/harness-event-exporter'
import { atomicWriteJson, EvalHistoryStore, resolveWithinRoot } from './history-store'
import { compareRuns } from './run-comparison'

export interface EvalStudioServerOptions {
  token?: string
  fixturesDir?: string
  dataRoot?: string
  uiDir?: string
  realExecutor?: RealPiExecutor
}

export interface EvalStudioServer extends Server {
  readonly evalStudioToken: string
  emitRunEvent(runId: string, event: EvalRunEventInput): void
}

export interface EvalRunEventInput {
  type: string
  [key: string]: unknown
}

interface EvalRunEvent extends EvalRunEventInput {
  runId: string
  seq: number
  timestamp: number
}

interface EventStreamState {
  events: EvalRunEvent[]
  subscribers: Set<ServerResponse>
}

interface RealPiExecutor {
  allowedTools?: string[]
  execute(request: {
    executionId: string
    provider?: string | null
    model?: string | null
    prompt?: string | null
    tools?: string[]
    timeoutMs?: number
  }): Promise<{
    status: number | null
    cancelled: boolean
    timedOut: boolean
    stdout: string
    stderr: string
    sessionDir: string
    cwd: string
  }>
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(body)
}

function isLocalHost(value: string | undefined): boolean {
  if (!value) return false
  const host = value.split(':')[0]?.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
}

function tokenFromRequest(request: IncomingMessage, url: URL): string | null {
  const authorization = request.headers.authorization
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length)
  return url.searchParams.get('token')
}

function contentTypeFor(file: string): string {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function createEvalStudioServer(options: EvalStudioServerOptions = {}): EvalStudioServer {
  const token = options.token ?? randomUUID()
  const fixturesDir = options.fixturesDir ?? path.resolve(process.cwd(), 'scripts', 'fixtures')
  const dataRoot = options.dataRoot ?? path.resolve(process.cwd(), 'harness-obs-output', 'studio')
  const uiDir = options.uiDir ?? path.resolve(process.cwd(), 'out', 'eval-studio')
  const history = new EvalHistoryStore(path.join(dataRoot, 'history'))
  const realExecutor =
    options.realExecutor ??
    createRealPiExecutor({
      piCliPath: path.resolve(
        process.cwd(),
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'dist',
        'bundle',
        'cli.js'
      ),
      sessionRoot: path.join(dataRoot, 'sessions'),
      workRoot: path.join(dataRoot, 'work')
    })
  const eventStreams = new Map<string, EventStreamState>()
  const server = createServer(async (request, response) => {
    try {
      if (!isLocalHost(request.headers.host)) {
        sendJson(response, 403, { error: 'local host only' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        !url.pathname.startsWith('/api/')
      ) {
        const relativePath =
          url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '')
        let file: string
        try {
          file = resolveWithinRoot(uiDir, relativePath)
        } catch {
          sendJson(response, 404, { error: 'not found' })
          return
        }
        if (!existsSync(file) || !statSync(file).isFile()) {
          sendJson(response, 404, { error: 'not found' })
          return
        }
        const body = readFileSync(file)
        response.writeHead(200, {
          'content-type': contentTypeFor(file),
          'cache-control': 'no-store'
        })
        response.end(request.method === 'HEAD' ? undefined : body)
        return
      }
      if (tokenFromRequest(request, url) !== token) {
        sendJson(response, 401, { error: 'invalid eval studio token' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, { status: 'ok' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/suites') {
        const suites = []
        for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
          const suiteId = entry.name.slice(0, -'.mjs'.length)
          const mod = await loadSuite(suiteId, fixturesDir)
          if (!mod.suite) continue
          suites.push({
            suiteId: mod.suite.id ?? suiteId,
            name: mod.suite.name ?? suiteId,
            description: `${mod.suite.fixtures?.length ?? 0} deterministic fixtures`,
            fixtureCount: mod.suite.fixtures?.length ?? 0
          })
        }
        suites.sort((left, right) => left.suiteId.localeCompare(right.suiteId))
        sendJson(response, 200, suites)
        return
      }
      const detailMatch = url.pathname.match(/^\/api\/suites\/([^/]+)$/)
      if (request.method === 'GET' && detailMatch) {
        const suiteId = decodeURIComponent(detailMatch[1] ?? '')
        const mod = await loadSuite(suiteId, fixturesDir)
        if (!mod.suite) {
          sendJson(response, 404, { error: 'suite not found' })
          return
        }
        sendJson(response, 200, { ...mod.suite, suiteId: mod.suite.id ?? suiteId })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') {
        const suiteIds = url.searchParams.getAll('suiteIds').filter(Boolean)
        const modes = url.searchParams.getAll('modes').filter(Boolean)
        const statuses = url.searchParams.getAll('statuses').filter(Boolean)
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')
        sendJson(
          response,
          200,
          history.query({
            ...(suiteIds.length > 0 ? { suiteIds } : {}),
            ...(modes.length > 0 ? { modes } : {}),
            ...(statuses.length > 0 ? { statuses } : {}),
            ...(from != null && from !== '' ? { from: Number(from) } : {}),
            ...(to != null && to !== '' ? { to: Number(to) } : {})
          })
        )
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/runs/compare') {
        const leftId = url.searchParams.get('left')
        const rightId = url.searchParams.get('right')
        if (!leftId || !rightId) {
          sendJson(response, 400, { error: 'left and right run ids are required' })
          return
        }
        const left = history.get(leftId)
        const right = history.get(rightId)
        if (!left || !right) {
          sendJson(response, 404, { error: 'one or both runs not found' })
          return
        }
        sendJson(response, 200, compareRuns(left, right))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const body = await readJsonBody(request)
        const configResult = runConfigOverrideSchema.safeParse({
          mode: 'deterministic-suite',
          ...(body as Record<string, unknown>)
        })
        if (!configResult.success) {
          sendJson(response, 400, {
            error: 'invalid run configuration',
            details: configResult.error.issues
          })
          return
        }
        const config = configResult.data
        if (config.mode !== 'ad-hoc-real') {
          try {
            await loadSuite(config.suiteId, fixturesDir)
          } catch {
            sendJson(response, 404, { error: 'suite not found' })
            return
          }
        }
        const runId = `studio-${Date.now()}-${randomUUID()}`
        const run: StudioRun = {
          id: runId,
          createdAt: Date.now(),
          config,
          status: 'pending',
          repeats: [],
          artifacts: {
            reportPath: path.join('reports', `${runId}.json`),
            exportPaths: [],
            eventLogPath: path.join('events', `${runId}.json`)
          },
          sessionDir: path.join('sessions', runId),
          workingDir: path.join('work', runId),
          error: null
        }
        history.save(run)
        getEventStream(runId)
        emitRunEvent(runId, { type: 'run.created', status: run.status })
        sendJson(response, 201, run)
        return
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
      if (request.method === 'GET' && runMatch) {
        const run = history.get(decodeURIComponent(runMatch[1] ?? ''))
        if (!run) {
          sendJson(response, 404, { error: 'run not found' })
          return
        }
        sendJson(response, 200, run)
        return
      }
      const startMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/start$/)
      if (request.method === 'POST' && startMatch) {
        const runId = decodeURIComponent(startMatch[1] ?? '')
        const run = history.get(runId)
        if (!run) {
          sendJson(response, 404, { error: 'run not found' })
          return
        }
        if (run.status !== 'pending') {
          sendJson(response, 409, { error: `run already ${run.status}` })
          return
        }
        if (run.config.mode === 'real-pi-suite' || run.config.mode === 'ad-hoc-real') {
          void executeRealPiRun(runId)
        }
        else void executeDeterministicRun(runId)
        sendJson(response, 202, { id: runId, status: 'running' })
        return
      }
      const baselineMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/baseline$/)
      if (request.method === 'POST' && baselineMatch) {
        const runId = decodeURIComponent(baselineMatch[1] ?? '')
        const run = history.get(runId)
        if (!run) {
          sendJson(response, 404, { error: 'run not found' })
          return
        }
        if (run.config.mode !== 'real-pi-suite' && run.config.mode !== 'ad-hoc-real') {
          sendJson(response, 400, { error: 'baseline endpoint requires a real LLM run' })
          return
        }
        if (run.status !== 'completed') {
          sendJson(response, 409, { error: 'run must be completed before baseline creation' })
          return
        }
        const body = (await readJsonBody(request)) as { reason?: unknown; sampleCount?: unknown }
        const reason = typeof body.reason === 'string' ? body.reason : ''
        const sampleCount =
          typeof body.sampleCount === 'number' && Number.isInteger(body.sampleCount)
            ? body.sampleCount
            : 3
        if (sampleCount < 1) {
          sendJson(response, 400, { error: 'sampleCount must be a positive integer' })
          return
        }
        if (run.repeats.length !== sampleCount) {
          sendJson(response, 400, {
            error: `baseline requires ${sampleCount} samples, run contains ${run.repeats.length}`
          })
          return
        }
        const baselinePath = path.join(dataRoot, 'baselines', `${run.config.suiteId}.json`)
        let existing = null
        try {
          existing = JSON.parse(readFileSync(baselinePath, 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const baseline = createBaseline({
          suite: run.config.suiteId,
          mode: run.config.mode,
          reason,
          sampleMetrics: run.repeats.map((repeat) => ({
            passRate: repeat.metrics.passRate,
            totalTokens: repeat.metrics.totalTokens,
            durationMs: repeat.metrics.durationMs,
            toolFailureRate: repeat.metrics.toolFailureRate
          })),
          expectedSampleCount: sampleCount,
          existing
        })
        atomicWriteJson(baselinePath, baseline)
        sendJson(response, 201, baseline)
        return
      }
      const traceMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/trace$/)
      if (request.method === 'GET' && traceMatch) {
        const runId = decodeURIComponent(traceMatch[1] ?? '')
        const run = history.get(runId)
        if (!run) {
          sendJson(response, 404, { error: 'run not found' })
          return
        }
        const exportPath = run.repeats[0]?.exportPath
        if (!exportPath) {
          sendJson(response, 404, { error: 'run export not found' })
          return
        }
        const file = resolveWithinRoot(dataRoot, exportPath)
        if (!existsSync(file)) {
          sendJson(response, 404, { error: 'run export file not found' })
          return
        }
        sendJson(response, 200, {
          runId,
          exportPath,
          raw: readFileSync(file, 'utf8')
        })
        return
      }
      const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
      if (request.method === 'GET' && eventMatch) {
        const runId = decodeURIComponent(eventMatch[1] ?? '')
        const run = history.get(runId)
        if (!run) {
          sendJson(response, 404, { error: 'run not found' })
          return
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive'
        })
        response.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`)
        const state = getEventStream(runId)
        for (const event of state.events) {
          response.write(formatSseEvent(event))
        }
        state.subscribers.add(response)
        request.once('close', () => state.subscribers.delete(response))
        return
      }
      const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
      if (request.method === 'POST' && cancelMatch) {
        const runId = decodeURIComponent(cancelMatch[1] ?? '')
        const run = history.get(runId)
        if (!run) {
          sendJson(response, 404, { error: 'run not found' })
          return
        }
        if (run.status !== 'pending' && run.status !== 'running') {
          sendJson(response, 409, { error: `run already ${run.status}` })
          return
        }
        const cancelled = { ...run, status: 'cancelled' as const }
        history.save(cancelled)
        emitRunEvent(runId, { type: 'run.cancelled', status: 'cancelled' })
        sendJson(response, 200, history.get(runId))
        return
      }
      sendJson(response, 404, { error: 'not found' })
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'server error' })
    }
  }) as EvalStudioServer

  Object.defineProperty(server, 'evalStudioToken', {
    value: token,
    enumerable: true
  })
  Object.defineProperty(server, 'emitRunEvent', {
    value: emitRunEvent,
    enumerable: true
  })
  return server

  function getEventStream(runId: string): EventStreamState {
    let state = eventStreams.get(runId)
    if (!state) {
      state = { events: readEventLog(runId), subscribers: new Set() }
      eventStreams.set(runId, state)
    }
    return state
  }

  function eventLogPath(runId: string): string | null {
    const run = history.get(runId)
    return run?.artifacts.eventLogPath ?? null
  }

  function readEventLog(runId: string): EvalRunEvent[] {
    const relativePath = eventLogPath(runId)
    if (!relativePath) return []
    try {
      const file = resolveWithinRoot(dataRoot, relativePath)
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as EvalRunEvent[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  function persistEventLog(runId: string, events: EvalRunEvent[]): void {
    const relativePath = eventLogPath(runId)
    if (!relativePath) return
    atomicWriteJson(resolveWithinRoot(dataRoot, relativePath), events)
  }

  function parseJsonl(raw: string): Array<Record<string, unknown>> {
    return raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  async function executeDeterministicRun(runId: string): Promise<void> {
    const initialRun = history.get(runId)
    if (!initialRun) return
    const running: StudioRun = { ...initialRun, status: 'running', error: null }
    history.save(running)
    emitRunEvent(runId, { type: 'run.started', status: 'running' })
    try {
      const mod = await loadSuite(running.config.suiteId, fixturesDir)
      if (!mod.suite) throw new Error('suite not found')
      const repeats: StudioRepeat[] = []
      const exportPaths: string[] = []

      for (let index = 0; index < running.config.repeatCount; index++) {
        const repeatId = `${runId}-repeat-${index + 1}`
        const startedAt = Date.now()
        const sessionDir = path.join('sessions', repeatId)
        const workingDir = path.join('work', repeatId)
        const exportDir = path.join('exports', repeatId)
        mkdirSync(resolveWithinRoot(dataRoot, sessionDir), { recursive: true })
        mkdirSync(resolveWithinRoot(dataRoot, workingDir), { recursive: true })
        mkdirSync(resolveWithinRoot(dataRoot, exportDir), { recursive: true })
        emitRunEvent(runId, { type: 'repeat.started', repeatId, index })

        const evaluatedFixtures = []
        const fixtureResults = []
        const parsedLines = []
        let repeatExportPath = path.join(exportDir, 'index.jsonl')
        for (const fixture of mod.suite.fixtures) {
          emitRunEvent(runId, {
            type: 'fixture.started',
            repeatId,
            fixtureId: fixture.id
          })
          const rawExport = renderJsonl(fixture)
          const exportPath = path.join(exportDir, `${encodeURIComponent(fixture.id)}.jsonl`)
          repeatExportPath = exportPath
          writeFileSync(resolveWithinRoot(dataRoot, exportPath), rawExport, 'utf8')
          exportPaths.push(exportPath)
          const parsed = parseJsonl(rawExport)
          parsedLines.push(...parsed)
          const result = evaluateFixture(fixture, parsed, rawExport)
          evaluatedFixtures.push(result)
          fixtureResults.push({
            fixtureId: result.id,
            scenario: result.scenario,
            status: result.pass ? ('passed' as const) : ('failed' as const),
            failureReasons: result.failureDetails
          })
          emitRunEvent(runId, {
            type: 'fixture.completed',
            repeatId,
            fixtureId: fixture.id,
            passed: result.pass,
            failures: result.failures
          })
        }

        const metrics = aggregateExtendedMetrics(
          parsedLines,
          evaluatedFixtures
        ) as MetricsReport
        const repeat: StudioRepeat = {
          id: repeatId,
          index,
          status: 'completed',
          startedAt,
          endedAt: Date.now(),
          fixtureResults,
          metrics,
          exportPath: repeatExportPath,
          sessionDir,
          workingDir,
          error: null
        }
        repeats.push(repeat)
        const current = history.get(runId)
        if (current) {
          history.save({
            ...current,
            status: 'running',
            repeats: [...repeats],
            artifacts: { ...current.artifacts, exportPaths: [...exportPaths] }
          })
        }
        emitRunEvent(runId, { type: 'repeat.completed', repeatId, index })
      }

      const completedRun = history.get(runId)
      if (!completedRun) throw new Error('run disappeared during execution')
      const report = {
        runId,
        completedAt: new Date().toISOString(),
        metrics: repeats[0]?.metrics ?? null,
        repeats: repeats.map((repeat) => ({
          id: repeat.id,
          metrics: repeat.metrics,
          fixtureResults: repeat.fixtureResults
        })),
        fixtures: repeats[0]?.fixtureResults ?? []
      }
      atomicWriteJson(
        resolveWithinRoot(dataRoot, completedRun.artifacts.reportPath),
        report
      )
      history.save({ ...completedRun, status: 'completed' })
      emitRunEvent(runId, { type: 'run.completed', status: 'completed' })
    } catch (error) {
      const failedRun = history.get(runId)
      if (failedRun) {
        history.save({
          ...failedRun,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      }
      emitRunEvent(runId, {
        type: 'run.failed',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function executeRealPiRun(runId: string): Promise<void> {
    const initialRun = history.get(runId)
    if (!initialRun) return
    const running: StudioRun = { ...initialRun, status: 'running', error: null }
    history.save(running)
    emitRunEvent(runId, { type: 'run.started', status: 'running' })
    try {
      const safePrompt =
        running.config.prompt ??
        '请调用 bash 工具执行 echo "ok"，然后用一句话回答结果。'
      const safety = validateRealPiSafety({
        tools: running.config.tools,
        prompt: safePrompt
      })
      if (!safety.ok) throw new Error(safety.reason ?? 'real session safety validation failed')

      const repeats: StudioRepeat[] = []
      const exportPaths: string[] = []
      for (let index = 0; index < running.config.repeatCount; index++) {
        const repeatId = `${runId}-repeat-${index + 1}`
        const startedAt = Date.now()
        emitRunEvent(runId, { type: 'session.started', repeatId, index })
        const execution = await realExecutor.execute({
          executionId: repeatId,
          provider: running.config.provider,
          model: running.config.model,
          prompt: safePrompt,
          tools: running.config.tools,
          timeoutMs: running.config.timeoutMs
        })
        if (execution.cancelled || execution.timedOut || execution.status !== 0) {
          throw new Error(
            execution.timedOut
              ? 'real Pi session timed out'
              : execution.cancelled
                ? 'real Pi session cancelled'
                : `real Pi session failed with exit code ${execution.status ?? 'null'}: ${execution.stderr.slice(-500)}`
          )
        }

        const entries = readSessionEntries(execution.sessionDir)
        if (entries.length === 0) throw new Error('real Pi session produced no entries')
        const eventResult = eventsFromEntries(entries, {
          runId: repeatId,
          now: startedAt,
          prompt: safePrompt
        })
        const exportDir = path.join('exports', repeatId)
        const exporter = new HarnessEventExporter({
          dir: resolveWithinRoot(dataRoot, exportDir),
          registerExitHook: false,
          source: { readRawEntries: async () => entries as SessionEntry[] }
        })
        for (const event of eventResult.events as unknown as HarnessEvent[]) {
          exporter.observe(event, runId)
        }
        await exporter.shutdown()
        const exportPath = path.join(exportDir, `${repeatId}.jsonl`)
        const rawExport = readFileSync(resolveWithinRoot(dataRoot, exportPath), 'utf8')
        exportPaths.push(exportPath)
        const failures = assertExport(
          rawExport,
          eventResult.toolCalls,
          'sk-REAL_SMOKE_SECRET_47'
        )
        const parsedLines = parseJsonl(rawExport)
        const passed = failures.length === 0
        const fixtureResults = [
          {
            fixtureId: `${running.config.suiteId}:real`,
            scenario: 'real-pi-session',
            status: passed ? ('passed' as const) : ('failed' as const),
            failureReasons: failures.map((message: string) => ({
              assertionType: 'realExport',
              expected: 'complete redacted export',
              actual: 'failed',
              message
            }))
          }
        ]
        const metrics = aggregateExtendedMetrics(parsedLines, [
          { pass: passed, failures }
        ]) as MetricsReport
        const repeat: StudioRepeat = {
          id: repeatId,
          index,
          status: 'completed',
          startedAt,
          endedAt: Date.now(),
          fixtureResults,
          metrics,
          exportPath,
          sessionDir: path.relative(dataRoot, execution.sessionDir),
          workingDir: path.relative(dataRoot, execution.cwd),
          error: null
        }
        repeats.push(repeat)
        const current = history.get(runId)
        if (current) {
          history.save({
            ...current,
            status: 'running',
            repeats: [...repeats],
            artifacts: { ...current.artifacts, exportPaths: [...exportPaths] }
          })
        }
        emitRunEvent(runId, {
          type: 'session.completed',
          repeatId,
          index,
          passed,
          failures
        })
      }

      const completedRun = history.get(runId)
      if (!completedRun) throw new Error('run disappeared during real execution')
      const report = {
        runId,
        completedAt: new Date().toISOString(),
        mode: 'real-pi-suite',
        metrics: repeats[0]?.metrics ?? null,
        repeats: repeats.map((repeat) => ({
          id: repeat.id,
          metrics: repeat.metrics,
          fixtureResults: repeat.fixtureResults
        })),
        fixtures: repeats[0]?.fixtureResults ?? []
      }
      atomicWriteJson(resolveWithinRoot(dataRoot, completedRun.artifacts.reportPath), report)
      history.save({ ...completedRun, status: 'completed' })
      emitRunEvent(runId, { type: 'run.completed', status: 'completed' })
    } catch (error) {
      const failedRun = history.get(runId)
      if (failedRun) {
        history.save({
          ...failedRun,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      }
      emitRunEvent(runId, {
        type: 'run.failed',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  function formatSseEvent(event: EvalRunEvent): string {
    return `event: run-event\ndata: ${JSON.stringify(event)}\n\n`
  }

  function emitRunEvent(runId: string, input: EvalRunEventInput): void {
    const state = getEventStream(runId)
    const event: EvalRunEvent = {
      ...input,
      runId,
      seq: state.events.length,
      timestamp: Date.now()
    }
    state.events.push(event)
    persistEventLog(runId, state.events)

    if (
      input.type === 'run.completed' ||
      input.type === 'run.failed' ||
      input.type === 'run.cancelled' ||
      input.type === 'run.timeout'
    ) {
      const run = history.get(runId)
      if (run) {
        const status =
          input.type === 'run.completed'
            ? 'completed'
            : input.type === 'run.failed'
              ? 'failed'
              : input.type === 'run.cancelled'
                ? 'cancelled'
                : 'timeout'
        history.save({
          ...run,
          status,
          error: typeof input.error === 'string' ? input.error : run.error
        })
      }
    }

    const payload = formatSseEvent(event)
    for (const subscriber of state.subscribers) subscriber.write(payload)
  }
}
