import type { AddressInfo } from 'node:net'
import { request as httpRequest } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEvalStudioServer, type EvalStudioServer } from './server'
import { EvalHistoryStore } from './history-store'
import { historyRecordSchema } from '@shared/schemas/eval-studio'

const servers: EvalStudioServer[] = []

async function listen(server: EvalStudioServer): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function requestWithHost(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    request.once('error', reject)
    request.end()
  })
}

async function createSampleRun(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({
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
    })
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: string }).id
}

async function createRealSuiteRun(
  baseUrl: string,
  mode = 'real-pi-suite',
  repeatCount = 1
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      mode,
      suiteId: 'sample',
      provider: 'zhipu',
      model: 'glm-5.2',
      prompt: '请调用 bash 工具执行 echo "ok"，然后用一句话回答结果。',
      tools: ['bash'],
      repeatCount,
      timeoutMs: 180000,
      thresholds: {
        maxTokens: 20000,
        maxDurationMs: 180000,
        maxToolCalls: 10,
        maxToolFailures: 2
      }
    })
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: string }).id
}

function baselineMetrics(totalTokens: number): {
  passRate: number
  totalTokens: number
  durationMs: number
  toolFailureRate: number
  assertionFailureCount: number
  firstEventLatencyMs: number | null
  toolExecutionDurationMs: number[]
  toolErrorCount: number
  eventCompleteness: 'complete' | 'incomplete' | 'unknown'
  cost: number | null
  modelResponseDurationMs: number[] | null
  repeatVariability: null
} {
  return {
    passRate: 1,
    totalTokens,
    durationMs: 100 + totalTokens,
    toolFailureRate: 0,
    assertionFailureCount: 0,
    firstEventLatencyMs: 1,
    toolExecutionDurationMs: [2],
    toolErrorCount: 0,
    eventCompleteness: 'complete',
    cost: null,
    modelResponseDurationMs: [3],
    repeatVariability: null
  }
}

function seedHistoryRun(
  store: EvalHistoryStore,
  id: string,
  createdAt: number,
  model: string,
  totalTokens: number
): void {
  store.save(
    historyRecordSchema.parse({
      id,
      createdAt,
      config: {
        mode: 'real-pi-suite',
        suiteId: 'sample',
        provider: 'zhipu',
        model,
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
      repeats: [
        {
          id: `${id}-repeat-1`,
          index: 0,
          status: 'completed',
          startedAt: createdAt,
          endedAt: createdAt + 100,
          fixtureResults: [],
          metrics: baselineMetrics(totalTokens),
          exportPath: `exports/${id}.jsonl`,
          sessionDir: `sessions/${id}`,
          workingDir: `work/${id}`,
          error: null
        }
      ],
      artifacts: {
        reportPath: `reports/${id}.json`,
        exportPaths: [`exports/${id}.jsonl`],
        eventLogPath: `events/${id}.json`
      },
      sessionDir: `sessions/${id}`,
      workingDir: `work/${id}`,
      error: null
    })
  )
}

interface DeterministicRunResponse {
  status: string
  repeats: Array<{ metrics: { passRate: number }; fixtureResults: unknown[] }>
  artifacts: { reportPath: string; eventLogPath: string }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

describe('eval studio server security', () => {
  it('answers authenticated local health requests', async () => {
    const server = createEvalStudioServer({ token: 'test-token' })
    servers.push(server)
    const baseUrl = await listen(server)
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { authorization: 'Bearer test-token' }
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('accepts the startup token from the query string', async () => {
    const server = createEvalStudioServer({ token: 'query-token' })
    servers.push(server)
    const baseUrl = await listen(server)
    const response = await fetch(`${baseUrl}/api/health?token=query-token`)
    expect(response.status).toBe(200)
  })

  it('rejects a missing or incorrect token', async () => {
    const server = createEvalStudioServer({ token: 'good-token' })
    servers.push(server)
    const baseUrl = await listen(server)
    const missing = await fetch(`${baseUrl}/api/health`)
    const wrong = await fetch(`${baseUrl}/api/health`, {
      headers: { authorization: 'Bearer bad-token' }
    })
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
  })

  it('rejects a non-local Host header', async () => {
    const server = createEvalStudioServer({ token: 'test-token' })
    servers.push(server)
    const baseUrl = await listen(server)
    const response = await requestWithHost(`${baseUrl}/api/health`, {
      authorization: 'Bearer test-token',
      host: 'evil.example'
    })
    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({ error: 'local host only' })
  })

  it('serves the suite catalog and suite detail', async () => {
    const server = createEvalStudioServer({ token: 'test-token' })
    servers.push(server)
    const baseUrl = await listen(server)
    const headers = { authorization: 'Bearer test-token' }
    const catalogResponse = await fetch(`${baseUrl}/api/suites`, { headers })
    const catalog = (await catalogResponse.json()) as Array<{ suiteId: string }>
    expect(catalogResponse.status).toBe(200)
    expect(catalog.map((entry) => entry.suiteId)).toContain('sample')

    const detailResponse = await fetch(`${baseUrl}/api/suites/sample`, { headers })
    const detail = (await detailResponse.json()) as {
      suiteId: string
      fixtures: Array<{ id: string; assertions: unknown[] }>
    }
    expect(detailResponse.status).toBe(200)
    expect(detail.suiteId).toBe('sample')
    expect(detail.fixtures).toHaveLength(12)
    expect(detail.fixtures.every((fixture) => Array.isArray(fixture.assertions))).toBe(true)
  })

  it('creates a pending run with persisted config overrides', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-data-'))
    try {
      const server = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(server)
      const baseUrl = await listen(server)
      const response = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          suiteId: 'sample',
          provider: 'zhipu',
          model: 'glm-5.2',
          prompt: null,
          tools: ['bash'],
          repeatCount: 3,
          timeoutMs: 180000,
          thresholds: {
            maxTokens: 20000,
            maxDurationMs: 180000,
            maxToolCalls: 10,
            maxToolFailures: 2
          }
        })
      })
      const run = (await response.json()) as { id: string; config: { repeatCount: number } }
      expect(response.status).toBe(201)
      expect(run.config.repeatCount).toBe(3)
      const history = new EvalHistoryStore(path.join(dataRoot, 'history')).query({ ids: [run.id] })
      expect(history).toHaveLength(1)
      expect(history[0]?.config.provider).toBe('zhipu')
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('rejects invalid run overrides and unknown suites', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-invalid-'))
    try {
      const server = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(server)
      const baseUrl = await listen(server)
      const validConfig = {
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
      }
      const invalidRepeat = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ ...validConfig, repeatCount: 0 })
      })
      const invalidTimeout = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ ...validConfig, timeoutMs: 0 })
      })
      const unknownSuite = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ ...validConfig, suiteId: 'missing' })
      })
      expect(invalidRepeat.status).toBe(400)
      expect(invalidTimeout.status).toBe(400)
      expect(unknownSuite.status).toBe(404)
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('streams snapshots and incremental run events over SSE', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-sse-'))
    try {
      const server = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(server)
      const baseUrl = await listen(server)
      const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' }
      const createResponse = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
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
        })
      })
      const run = (await createResponse.json()) as { id: string }

      async function openStream(onChunk: (chunk: string) => void) {
        const controller = new AbortController()
        const response = await fetch(
          `${baseUrl}/api/runs/${run.id}/events?token=test-token`,
          { signal: controller.signal }
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/event-stream')
        const reader = response.body?.getReader()
        expect(reader).toBeTruthy()
        const decoder = new TextDecoder()
        void (async () => {
          while (true) {
            const result = await reader?.read()
            if (!result || result.done) break
            onChunk(decoder.decode(result.value, { stream: true }))
          }
        })().catch(() => undefined)
        return controller
      }

      let firstStreamText = ''
      const firstController = await openStream((chunk) => (firstStreamText += chunk))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(firstStreamText).toContain('event: snapshot')
      expect(firstStreamText).toContain('"status":"pending"')
      server.emitRunEvent(run.id, { type: 'fixture.completed', fixtureId: 'qa-basic', passed: true })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(firstStreamText).toContain('fixture.completed')
      firstController.abort()

      server.emitRunEvent(run.id, { type: 'run.completed', status: 'completed' })
      let reconnectedText = ''
      const secondController = await openStream((chunk) => (reconnectedText += chunk))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(reconnectedText).toContain('event: snapshot')
      expect(reconnectedText).toContain('"status":"completed"')
      expect(reconnectedText).toContain('run.completed')
      secondController.abort()
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('cancels a run and persists partial event history', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-cancel-'))
    try {
      const server = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(server)
      const baseUrl = await listen(server)
      const createResponse = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({
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
        })
      })
      const created = (await createResponse.json()) as {
        id: string
        artifacts: { eventLogPath: string }
      }
      server.emitRunEvent(created.id, {
        type: 'fixture.completed',
        fixtureId: 'qa-basic',
        passed: true
      })
      const cancelResponse = await fetch(`${baseUrl}/api/runs/${created.id}/cancel`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' }
      })
      const cancelled = (await cancelResponse.json()) as { id: string; status: string }
      expect(cancelResponse.status).toBe(200)
      expect(cancelled.status).toBe('cancelled')
      const history = new EvalHistoryStore(path.join(dataRoot, 'history')).query({
        ids: [created.id]
      })
      expect(history[0]?.status).toBe('cancelled')
      const eventLog = JSON.parse(
        readFileSync(path.join(dataRoot, created.artifacts.eventLogPath), 'utf8')
      ) as Array<{ type: string }>
      expect(eventLog.map((event) => event.type)).toContain('fixture.completed')
      expect(eventLog.map((event) => event.type)).toContain('run.cancelled')
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('starts a deterministic suite and emits fixture/run lifecycle events', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-start-'))
    try {
      const server = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(server)
      const baseUrl = await listen(server)
      const runId = await createSampleRun(baseUrl)
      const startResponse = await fetch(`${baseUrl}/api/runs/${runId}/start`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' }
      })
      expect(startResponse.status).toBe(202)

      let run: DeterministicRunResponse | null = null
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await fetch(`${baseUrl}/api/runs/${runId}`, {
          headers: { authorization: 'Bearer test-token' }
        })
        expect(response.status).toBe(200)
        run = (await response.json()) as DeterministicRunResponse
        if (run.status === 'completed' || run.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(run).not.toBeNull()
      if (!run) throw new Error('run response missing')
      expect(run.status).toBe('completed')
      expect(run.repeats).toHaveLength(1)
      expect(run.repeats[0]?.fixtureResults).toHaveLength(12)
      expect(run.repeats[0]?.metrics.passRate).toBe(1)

      const eventLog = JSON.parse(
        readFileSync(path.join(dataRoot, run.artifacts.eventLogPath), 'utf8')
      ) as Array<{ type: string }>
      const eventTypes = eventLog.map((event) => event.type)
      expect(eventTypes).toContain('run.started')
      expect(eventTypes.filter((type) => type === 'fixture.started')).toHaveLength(12)
      expect(eventTypes.filter((type) => type === 'fixture.completed')).toHaveLength(12)
      expect(eventTypes.at(-1)).toBe('run.completed')

      const report = JSON.parse(
        readFileSync(path.join(dataRoot, run.artifacts.reportPath), 'utf8')
      ) as { metrics: { passRate: number }; fixtures: unknown[] }
      expect(report.metrics.passRate).toBe(1)
      expect(report.fixtures).toHaveLength(12)
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('serves the local UI entry without an API token and blocks path traversal', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-static-data-'))
    const uiDir = mkdtempSync(path.join(tmpdir(), 'eval-studio-static-ui-'))
    try {
      mkdirSync(path.join(uiDir, 'assets'), { recursive: true })
      writeFileSync(
        path.join(uiDir, 'index.html'),
        '<!doctype html><title>Eval Studio</title><div id="app"></div>',
        'utf8'
      )
      writeFileSync(path.join(uiDir, 'assets', 'app.js'), 'console.log("eval studio")', 'utf8')
      const server = createEvalStudioServer({ token: 'test-token', dataRoot, uiDir })
      servers.push(server)
      const baseUrl = await listen(server)
      const indexResponse = await fetch(`${baseUrl}/`)
      expect(indexResponse.status).toBe(200)
      expect(indexResponse.headers.get('content-type')).toContain('text/html')
      expect(await indexResponse.text()).toContain('<div id="app"></div>')

      const assetResponse = await fetch(`${baseUrl}/assets/app.js`)
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get('content-type')).toContain('text/javascript')

      const traversalResponse = await fetch(`${baseUrl}/../package.json`)
      expect(traversalResponse.status).toBe(404)
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
      rmSync(uiDir, { recursive: true, force: true })
    }
  })

  it('runs an injected real Pi suite through exporter, report, and history', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-real-suite-'))
    try {
      const server = createEvalStudioServer({
        token: 'test-token',
        dataRoot,
        realExecutor: {
          allowedTools: ['bash'],
          async execute(request) {
            const sessionDir = path.join(dataRoot, request.executionId, 'session')
            mkdirSync(sessionDir, { recursive: true })
            writeFileSync(
              path.join(sessionDir, 'session.jsonl'),
              [
                JSON.stringify({
                  timestamp: '2026-10-19T02:00:00.000Z',
                  message: {
                    role: 'assistant',
                    model: 'glm-5.2',
                    provider: 'zhipu',
                    usage: { input: 3, output: 4, cacheRead: 5, totalTokens: 12 },
                    content: [
                      {
                        type: 'toolCall',
                        id: 'call-real',
                        name: 'bash',
                        arguments: { command: 'echo ok' }
                      },
                      { type: 'text', text: 'ok' }
                    ]
                  }
                })
              ].join('\n'),
              'utf8'
            )
            return {
              status: 0,
              signal: null,
              cancelled: false,
              timedOut: false,
              stdout: '',
              stderr: '',
              sessionDir,
              cwd: path.join(dataRoot, request.executionId, 'work')
            }
          }
        }
      })
      servers.push(server)
      const baseUrl = await listen(server)
      const runId = await createRealSuiteRun(baseUrl)
      const start = await fetch(`${baseUrl}/api/runs/${runId}/start`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' }
      })
      expect(start.status).toBe(202)

      let run: {
        status: string
        repeats: Array<{
          metrics: { totalTokens: number; eventCompleteness: string }
          exportPath: string
        }>
        artifacts: { reportPath: string; eventLogPath: string }
      } | null = null
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await fetch(`${baseUrl}/api/runs/${runId}`, {
          headers: { authorization: 'Bearer test-token' }
        })
        run = (await response.json()) as {
          status: string
          repeats: Array<{
            metrics: { totalTokens: number; eventCompleteness: string }
            exportPath: string
          }>
          artifacts: { reportPath: string; eventLogPath: string }
        }
        if (run.status === 'completed' || run.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(run).not.toBeNull()
      if (!run) throw new Error('real suite response missing')
      expect(run.status).toBe('completed')
      expect(run.repeats).toHaveLength(1)
      expect(run.repeats[0]?.metrics.totalTokens).toBe(12)
      expect(run.repeats[0]?.metrics.eventCompleteness).toBe('complete')
      expect(existsSync(path.join(dataRoot, run.repeats[0]?.exportPath ?? ''))).toBe(true)
      expect(existsSync(path.join(dataRoot, run.artifacts.reportPath))).toBe(true)
      const eventLog = JSON.parse(
        readFileSync(path.join(dataRoot, run.artifacts.eventLogPath), 'utf8')
      ) as Array<{ type: string }>
      expect(eventLog.map((event) => event.type)).toContain('session.started')
      expect(eventLog.map((event) => event.type)).toContain('session.completed')
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('creates and runs an ad-hoc real session without a suite fixture file', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-adhoc-real-'))
    try {
      const server = createEvalStudioServer({
        token: 'test-token',
        dataRoot,
        realExecutor: {
          async execute(request) {
            const sessionDir = path.join(dataRoot, request.executionId, 'session')
            mkdirSync(sessionDir, { recursive: true })
            writeFileSync(
              path.join(sessionDir, 'session.jsonl'),
              JSON.stringify({
                timestamp: '2026-10-19T02:00:00.000Z',
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'ok' }],
                  usage: { input: 1, output: 2, cacheRead: 3, totalTokens: 6 }
                }
              }),
              'utf8'
            )
            return {
              status: 0,
              signal: null,
              cancelled: false,
              timedOut: false,
              stdout: '',
              stderr: '',
              sessionDir,
              cwd: path.join(dataRoot, request.executionId, 'work')
            }
          }
        }
      })
      servers.push(server)
      const baseUrl = await listen(server)
      const createResponse = await fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'ad-hoc-real',
          suiteId: 'ad-hoc',
          provider: null,
          model: null,
          prompt: '请调用 bash 工具执行 echo "ok"，然后用一句话回答结果。',
          tools: ['bash'],
          repeatCount: 1,
          timeoutMs: 180000,
          thresholds: {
            maxTokens: 100,
            maxDurationMs: 1000,
            maxToolCalls: 1,
            maxToolFailures: 0
          }
        })
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string; config: { mode: string } }
      expect(created.config.mode).toBe('ad-hoc-real')

      const start = await fetch(`${baseUrl}/api/runs/${created.id}/start`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' }
      })
      expect(start.status).toBe(202)
      let run: { status: string; artifacts: { reportPath: string } } | null = null
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await fetch(`${baseUrl}/api/runs/${created.id}`, {
          headers: { authorization: 'Bearer test-token' }
        })
        run = (await response.json()) as { status: string; artifacts: { reportPath: string } }
        if (run.status === 'completed' || run.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(run).not.toBeNull()
      if (!run) throw new Error('ad-hoc response missing')
      expect(run.status).toBe('completed')
      expect(existsSync(path.join(dataRoot, run.artifacts.reportPath))).toBe(true)
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('creates a repeated real-LLM baseline with samples and dispersion', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-baseline-'))
    try {
      const server = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(server)
      const baseUrl = await listen(server)
      const runId = await createRealSuiteRun(baseUrl, 'real-pi-suite', 3)
      const store = new EvalHistoryStore(path.join(dataRoot, 'history'))
      const run = store.get(runId)
      expect(run).not.toBeNull()
      if (!run) throw new Error('run missing')
      store.save({
        ...run,
        status: 'completed',
        repeats: [10, 12, 14].map((tokens, index) => ({
          id: `repeat-${index + 1}`,
          index,
          status: 'completed' as const,
          startedAt: index * 100,
          endedAt: index * 100 + 50,
          fixtureResults: [],
          metrics: baselineMetrics(tokens),
          exportPath: `exports/repeat-${index + 1}.jsonl`,
          sessionDir: `sessions/repeat-${index + 1}`,
          workingDir: `work/repeat-${index + 1}`,
          error: null
        }))
      })

      const response = await fetch(`${baseUrl}/api/runs/${runId}/baseline`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'accept current model', sampleCount: 3 })
      })
      const baseline = (await response.json()) as {
        suite: string
        version: number
        sampleCount: number
        aggregates: { totalTokens: { mean: number; min: number; max: number; dispersion: number } }
      }
      expect(response.status).toBe(201)
      expect(baseline).toMatchObject({
        suite: 'sample',
        version: 1,
        sampleCount: 3
      })
      expect(baseline.aggregates.totalTokens.mean).toBe(12)
      expect(baseline.aggregates.totalTokens.min).toBe(10)
      expect(baseline.aggregates.totalTokens.max).toBe(14)
      expect(baseline.aggregates.totalTokens.dispersion).toBeCloseTo(Math.sqrt(8 / 3), 10)
      expect(existsSync(path.join(dataRoot, 'baselines', 'sample.json'))).toBe(true)
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('compares any two persisted runs', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-compare-'))
    try {
      const store = new EvalHistoryStore(path.join(dataRoot, 'history'))
      seedHistoryRun(store, 'left-run', 100, 'glm-5.2', 100)
      seedHistoryRun(store, 'right-run', 200, 'glm-5.3', 120)
      const server = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(server)
      const baseUrl = await listen(server)
      const response = await fetch(
        `${baseUrl}/api/runs/compare?left=left-run&right=right-run`,
        { headers: { authorization: 'Bearer test-token' } }
      )
      const comparison = (await response.json()) as {
        configDiff: Array<{ path: string; left: unknown; right: unknown }>
        metrics: Array<{
          key: string
          unit: string
          left: number
          right: number
          absoluteChange: number
          direction: string
        }>
      }
      expect(response.status).toBe(200)
      expect(comparison.configDiff).toContainEqual({
        path: 'model',
        left: 'glm-5.2',
        right: 'glm-5.3'
      })
      expect(comparison.metrics).toContainEqual({
        key: 'totalTokens',
        unit: 'tokens',
        left: 100,
        right: 120,
        absoluteChange: 20,
        direction: 'worse'
      })
    } finally {
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('reopens completed history and trace after a service restart', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-restart-'))
    let firstServer: EvalStudioServer | null = null
    try {
      firstServer = createEvalStudioServer({ token: 'test-token', dataRoot })
      const firstBaseUrl = await listen(firstServer)
      const runId = await createSampleRun(firstBaseUrl)
      const start = await fetch(`${firstBaseUrl}/api/runs/${runId}/start`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' }
      })
      expect(start.status).toBe(202)
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await fetch(`${firstBaseUrl}/api/runs/${runId}`, {
          headers: { authorization: 'Bearer test-token' }
        })
        const run = (await response.json()) as { status: string }
        if (run.status === 'completed') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      await new Promise<void>((resolve, reject) => {
        firstServer?.close((error) => (error ? reject(error) : resolve()))
      })
      firstServer = null

      const secondServer = createEvalStudioServer({ token: 'test-token', dataRoot })
      servers.push(secondServer)
      const secondBaseUrl = await listen(secondServer)
      const historyResponse = await fetch(`${secondBaseUrl}/api/runs?ids=${runId}`, {
        headers: { authorization: 'Bearer test-token' }
      })
      const history = (await historyResponse.json()) as Array<{ id: string; status: string }>
      expect(historyResponse.status).toBe(200)
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({ id: runId, status: 'completed' })

      const traceResponse = await fetch(`${secondBaseUrl}/api/runs/${runId}/trace`, {
        headers: { authorization: 'Bearer test-token' }
      })
      const trace = (await traceResponse.json()) as { runId: string; raw: string }
      expect(traceResponse.status).toBe(200)
      expect(trace.runId).toBe(runId)
      expect(trace.raw).toContain('message.completed')
    } finally {
      if (firstServer) servers.push(firstServer)
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })
})
