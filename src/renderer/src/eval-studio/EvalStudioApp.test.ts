import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EvalStudioApp from './EvalStudioApp.vue'

describe('EvalStudioApp', () => {
  it('renders the six primary workbench sections', () => {
    const wrapper = mount(EvalStudioApp, {
      props: { token: 'test-token' }
    })
    const tabs = wrapper.findAll('button[data-test="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual([
      'Suite',
      '运行',
      '报告',
      '历史',
      '对比',
      'Trace'
    ])
    expect(wrapper.find('[data-test="eval-studio-title"]').text()).toBe('Pi Harness Eval Studio')
  })

  it('loads and displays suite catalog and fixture detail', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/suites/sample')) {
        return new Response(
          JSON.stringify({
            suiteId: 'sample',
            fixtures: Array.from({ length: 12 }, (_, index) => ({
              id: `fixture-${index + 1}`,
              scenario: `scenario-${index + 1}`,
              assertions: [{ kind: 'containsText', text: 'ok' }]
            }))
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) {
        return new Response(
          JSON.stringify([
            {
              suiteId: 'sample',
              name: 'sample',
              description: '12 deterministic fixtures',
              fixtureCount: 12
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      const suiteItems = wrapper.findAll('[data-test="suite-option"]')
      expect(suiteItems).toHaveLength(1)
      expect(suiteItems[0]?.text()).toContain('sample')
      expect(suiteItems[0]?.text()).toContain('12 deterministic fixtures')

      await suiteItems[0]?.trigger('click')
      await flushPromises()
      const fixtureRows = wrapper.findAll('[data-test="fixture-row"]')
      expect(fixtureRows).toHaveLength(12)
      expect(fixtureRows[0]?.text()).toContain('fixture-1')
      expect(fixtureRows[0]?.text()).toContain('containsText')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('submits run parameter overrides without changing the suite source', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; method: string; body?: unknown }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      })
      if (url.startsWith('/api/runs')) {
        return new Response(
          JSON.stringify({
            id: 'run-1',
            status: 'pending',
            config: requests.at(-1)?.body
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites/sample')) {
        return new Response(
          JSON.stringify({
            suiteId: 'sample',
            fixtures: Array.from({ length: 12 }, (_, index) => ({
              id: `fixture-${index + 1}`,
              scenario: `scenario-${index + 1}`,
              assertions: [{ kind: 'containsText' }]
            }))
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) {
        return new Response(
          JSON.stringify([
            { suiteId: 'sample', name: 'sample', description: '12 fixtures', fixtureCount: 12 }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-test="suite-option"]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-run"]').trigger('click')
      await wrapper.find('[data-test="provider-input"]').setValue('zhipu')
      await wrapper.find('[data-test="model-input"]').setValue('glm-5.2')
      await wrapper.find('[data-test="prompt-input"]').setValue('请执行安全命令')
      await wrapper.find('[data-test="tools-input"]').setValue('bash')
      await wrapper.find('[data-test="repeat-input"]').setValue('3')
      await wrapper.find('[data-test="timeout-input"]').setValue('180000')
      await wrapper.find('[data-test="max-tokens-input"]').setValue('20000')
      await wrapper.find('[data-test="max-duration-input"]').setValue('180000')
      await wrapper.find('[data-test="max-tool-calls-input"]').setValue('10')
      await wrapper.find('[data-test="max-tool-failures-input"]').setValue('2')
      await wrapper.find('[data-test="create-run"]').trigger('submit')
      await flushPromises()

      const runRequest = requests.find((request) => request.url.startsWith('/api/runs'))
      expect(runRequest?.method).toBe('POST')
      expect(runRequest?.body).toEqual({
        mode: 'deterministic-suite',
        suiteId: 'sample',
        provider: 'zhipu',
        model: 'glm-5.2',
        prompt: '请执行安全命令',
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
      expect(wrapper.find('[data-test="created-run"]').text()).toContain('run-1')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('starts a run and renders live SSE lifecycle events', async () => {
    const originalFetch = globalThis.fetch
    const originalEventSource = globalThis.EventSource
    const startRequests: string[] = []
    const eventSources: Array<{
      url: string
      listeners: Map<string, (event: { data: string }) => void>
    }> = []

    class FakeEventSource {
      url: string
      listeners = new Map<string, (event: { data: string }) => void>()
      constructor(url: string) {
        this.url = url
        eventSources.push({ url, listeners: this.listeners })
      }
      addEventListener(type: string, listener: (event: { data: string }) => void): void {
        this.listeners.set(type, listener)
      }
      close(): void {}
    }

    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/runs') && init?.method === 'POST') {
        if (url.includes('/start')) {
          startRequests.push(url)
          return new Response(JSON.stringify({ status: 'running' }), { status: 202 })
        }
        const body = JSON.parse(String(init.body)) as { suiteId: string }
        return new Response(
          JSON.stringify({ id: 'run-live', status: 'pending', config: body }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites/sample')) {
        return new Response(
          JSON.stringify({
            suiteId: 'sample',
            fixtures: Array.from({ length: 12 }, (_, index) => ({
              id: `fixture-${index + 1}`,
              scenario: 'scenario',
              assertions: []
            }))
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) {
        return new Response(
          JSON.stringify([
            { suiteId: 'sample', name: 'sample', description: '12', fixtureCount: 12 }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-test="suite-option"]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-run"]').trigger('click')
      await wrapper.find('[data-test="create-run"]').trigger('submit')
      await flushPromises()
      await wrapper.find('[data-test="start-run"]').trigger('click')
      await flushPromises()

      expect(startRequests).toEqual(['/api/runs/run-live/start?token=test-token'])
      expect(eventSources[0]?.url).toBe('/api/runs/run-live/events?token=test-token')

      const listener = eventSources[0]?.listeners.get('run-event')
      listener?.({
        data: JSON.stringify({ type: 'fixture.completed', fixtureId: 'fixture-1', passed: true })
      })
      listener?.({
        data: JSON.stringify({ type: 'run.completed', status: 'completed' })
      })
      await flushPromises()
      const events = wrapper.findAll('[data-test="run-event"]')
      expect(events.map((event) => event.text())).toEqual([
        'fixture.completed · fixture-1',
        'run.completed'
      ])
      expect(wrapper.find('[data-test="run-status"]').text()).toContain('completed')
    } finally {
      globalThis.fetch = originalFetch
      globalThis.EventSource = originalEventSource
    }
  })

  it('renders API-backed core and extended metrics with fixture failures', async () => {
    const originalFetch = globalThis.fetch
    const originalEventSource = globalThis.EventSource
    const eventSources: Array<{
      listeners: Map<string, (event: { data: string }) => void>
    }> = []

    class FakeEventSource {
      listeners = new Map<string, (event: { data: string }) => void>()
      constructor() {
        eventSources.push({ listeners: this.listeners })
      }
      addEventListener(type: string, listener: (event: { data: string }) => void): void {
        this.listeners.set(type, listener)
      }
      close(): void {}
    }

    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/runs/report-run') && (!init || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            id: 'report-run',
            status: 'completed',
            judge: {
              kind: 'llm-as-judge',
              score: 72,
              reason: 'Mostly correct but verbose',
              model: 'glm-5.2',
              promptSummary: 'Judge answer quality',
              references: ['fixture-1'],
              affectsDeterministicResult: false,
              affectsBaseline: false
            },
            repeats: [
              {
                id: 'repeat-1',
                metrics: {
                  passRate: 0.5,
                  totalTokens: 24,
                  durationMs: 160,
                  toolFailureRate: 0.5,
                  assertionFailureCount: 1,
                  firstEventLatencyMs: 10,
                  toolExecutionDurationMs: [20, 30],
                  toolErrorCount: 1,
                  eventCompleteness: 'complete',
                  cost: 0.5,
                  modelResponseDurationMs: [40, 30],
                  repeatVariability: null
                },
                fixtureResults: [
                  {
                    fixtureId: 'passing',
                    scenario: 'pass',
                    status: 'passed',
                    failureReasons: []
                  },
                  {
                    fixtureId: 'failing',
                    scenario: 'fail',
                    status: 'failed',
                    failureReasons: [
                      {
                        fixtureId: 'failing',
                        assertionType: 'containsText',
                        expected: 'ok',
                        actual: 'bad',
                        message: "text contains 'ok'"
                      }
                    ]
                  }
                ]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/runs') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'report-run', status: 'pending' }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites/sample')) {
        return new Response(
          JSON.stringify({
            suiteId: 'sample',
            fixtures: Array.from({ length: 12 }, (_, index) => ({
              id: `fixture-${index + 1}`,
              scenario: 'scenario',
              assertions: []
            }))
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) {
        return new Response(
          JSON.stringify([
            { suiteId: 'sample', name: 'sample', description: '12', fixtureCount: 12 }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-test="suite-option"]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-run"]').trigger('click')
      await wrapper.find('[data-test="create-run"]').trigger('submit')
      await flushPromises()
      eventSources[0]?.listeners.get('run-event')?.({
        data: JSON.stringify({ type: 'run.completed', status: 'completed' })
      })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-report"]').trigger('click')

      expect(wrapper.find('[data-test="report-status"]').text()).toContain('completed')
      expect(wrapper.find('[data-test="metric-pass-rate"]').text()).toContain('50%')
      expect(wrapper.find('[data-test="metric-tokens"]').text()).toContain('24')
      expect(wrapper.find('[data-test="metric-first-latency"]').text()).toContain('10ms')
      expect(wrapper.find('[data-test="metric-tool-errors"]').text()).toContain('1')
      const judge = wrapper.find('[data-test="judge-section"]')
      expect(judge.text()).toContain('LLM-as-Judge')
      expect(judge.text()).toContain('72')
      expect(judge.text()).toContain('glm-5.2')
      expect(judge.text()).toContain('不影响确定性结果 / 不进入 baseline')
      expect(wrapper.find('[data-test="metric-pass-rate"]').text()).toContain('50%')
      expect(wrapper.find('[data-test="repeat-summary"]').text()).toContain('repeat-1')
      const fixtureRows = wrapper.findAll('[data-test="report-fixture"]')
      expect(fixtureRows).toHaveLength(2)
      expect(fixtureRows[1]?.text()).toContain('failing')
      expect(fixtureRows[1]?.text()).toContain("text contains 'ok'")
    } finally {
      globalThis.fetch = originalFetch
      globalThis.EventSource = originalEventSource
    }
  })

  it('submits an ad-hoc real run without selecting a suite', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/runs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        requests.push({ url, method: 'POST', body })
        return new Response(
          JSON.stringify({ id: 'adhoc-run', status: 'pending', config: body }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-run"]').trigger('click')
      await wrapper.find('[data-test="mode-select"]').setValue('ad-hoc-real')
      await wrapper.find('[data-test="provider-input"]').setValue('zhipu')
      await wrapper.find('[data-test="model-input"]').setValue('glm-5.2')
      await wrapper.find('[data-test="prompt-input"]').setValue('请调用 bash 工具执行 echo "ok"')
      await wrapper.find('[data-test="tools-input"]').setValue('bash')
      await wrapper.find('[data-test="create-run"]').trigger('submit')
      await flushPromises()

      expect(requests).toHaveLength(1)
      expect(requests[0]?.body).toMatchObject({
        mode: 'ad-hoc-real',
        suiteId: 'ad-hoc',
        provider: 'zhipu',
        model: 'glm-5.2',
        tools: ['bash']
      })
      expect(wrapper.find('[data-test="created-run"]').text()).toContain('adhoc-run')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('opens the raw trace for a created run', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/runs/adhoc-run/trace')) {
        return new Response(
          JSON.stringify({
            runId: 'adhoc-run',
            exportPath: 'exports/repeat-1.jsonl',
            raw: [
              JSON.stringify({ event: { type: 'run.started', timestamp: 100, runId: 'trace-run' } }),
              JSON.stringify({ event: { type: 'message.started', timestamp: 105 } }),
              JSON.stringify({ event: { type: 'tool.started', timestamp: 110, toolCallId: 't1', toolName: 'bash' } }),
              JSON.stringify({ event: { type: 'tool.completed', timestamp: 130, toolCallId: 't1', toolName: 'bash', isError: true } }),
              JSON.stringify({
                event: { type: 'message.completed', timestamp: 170, usage: { input: 3, output: 4, cacheRead: 5, total: 0 } }
              }),
              JSON.stringify({
                footer: { runId: 'trace-run', status: 'failed', eventCount: 5, durationMs: 70 }
              })
            ].join('\n')
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/runs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'adhoc-run', status: 'pending' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.startsWith('/api/suites')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-run"]').trigger('click')
      await wrapper.find('[data-test="mode-select"]').setValue('ad-hoc-real')
      await wrapper.find('[data-test="prompt-input"]').setValue('请调用 bash 工具执行 echo "ok"')
      await wrapper.find('[data-test="create-run"]').trigger('submit')
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-trace"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test="trace-path"]').text()).toContain('exports/repeat-1.jsonl')
      expect(wrapper.find('[data-test="trace-raw"]').text()).toContain('message.completed')
      expect(wrapper.find('[data-test="trace-summary"]').text()).toContain('trace-run')
      expect(wrapper.find('[data-test="trace-summary"]').text()).toContain('failed')
      expect(wrapper.find('[data-test="trace-summary"]').text()).toContain('12')
      const nodes = wrapper.findAll('[data-test="trace-tree-node"]')
      expect(nodes[1]?.text()).toContain('bash')
      expect(nodes[1]?.text()).toContain('20ms')
      expect(nodes[1]?.text()).toContain('error')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('loads and filters history records', async () => {
    const originalFetch = globalThis.fetch
    const historyRequests: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/runs?')) {
        historyRequests.push(url)
        return new Response(
          JSON.stringify([
            {
              id: 'history-1',
              createdAt: 200,
              status: 'completed',
              config: {
                suiteId: 'sample',
                mode: 'real-pi-suite',
                provider: 'zhipu',
                model: 'glm-5.2',
                repeatCount: 3
              }
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-history"]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-test="history-panel"] form').trigger('submit')
      await flushPromises()
      let rows = wrapper.findAll('[data-test="history-row"]')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.text()).toContain('history-1')
      expect(rows[0]?.text()).toContain('sample')
      expect(rows[0]?.text()).toContain('real-pi-suite')
      expect(rows[0]?.text()).toContain('zhipu / glm-5.2')
      expect(rows[0]?.text()).toContain('repeat=3')

      await wrapper.find('[data-test="history-suite-filter"]').setValue('sample')
      await wrapper.find('[data-test="history-mode-filter"]').setValue('real-pi-suite')
      await wrapper.find('[data-test="history-status-filter"]').setValue('completed')
      await wrapper.find('[data-test="history-from-filter"]').setValue('100')
      await wrapper.find('[data-test="history-to-filter"]').setValue('300')
      await wrapper.find('[data-test="history-panel"] form').trigger('submit')
      await flushPromises()
      rows = wrapper.findAll('[data-test="history-row"]')
      expect(rows).toHaveLength(1)
      expect(historyRequests.at(-1)).toBe(
        '/api/runs?suiteIds=sample&modes=real-pi-suite&statuses=completed&from=100&to=300&token=test-token'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('selects two history records and renders their comparison table', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/runs/compare')) {
        return new Response(
          JSON.stringify({
            configDiff: [{ path: 'model', left: 'glm-5.2', right: 'glm-5.3' }],
            metrics: [
              { key: 'passRate', unit: 'ratio', left: 1, right: 0.8, absoluteChange: -0.2, direction: 'worse' },
              { key: 'totalTokens', unit: 'tokens', left: 100, right: 120, absoluteChange: 20, direction: 'worse' },
              { key: 'durationMs', unit: 'ms', left: 1000, right: 900, absoluteChange: -100, direction: 'better' },
              { key: 'toolFailureRate', unit: 'ratio', left: 0, right: 0.1, absoluteChange: 0.1, direction: 'worse' }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/runs?')) {
        return new Response(
          JSON.stringify([
            {
              id: 'run-left',
              createdAt: 100,
              status: 'completed',
              config: { suiteId: 'sample', mode: 'real-pi-suite', provider: null, model: 'glm-5.2', repeatCount: 1 }
            },
            {
              id: 'run-right',
              createdAt: 200,
              status: 'completed',
              config: { suiteId: 'sample', mode: 'real-pi-suite', provider: null, model: 'glm-5.3', repeatCount: 1 }
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) return new Response(JSON.stringify([]), { status: 200 })
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-history"]').trigger('click')
      await wrapper.find('[data-test="history-panel"] form').trigger('submit')
      await flushPromises()
      const selections = wrapper.findAll('[data-test="compare-select"]')
      expect(selections).toHaveLength(2)
      await selections[0]?.setValue(true)
      await selections[1]?.setValue(true)
      await wrapper.find('[data-tab-test="tab-compare"]').trigger('click')
      await flushPromises()

      const configRows = wrapper.findAll('[data-test="compare-config-row"]')
      const metricRows = wrapper.findAll('[data-test="compare-metric-row"]')
      expect(configRows[0]?.text()).toContain('model')
      expect(configRows[0]?.text()).toContain('glm-5.2')
      expect(configRows[0]?.text()).toContain('glm-5.3')
      expect(metricRows[1]?.text()).toContain('totalTokens')
      expect(metricRows[1]?.text()).toContain('tokens')
      expect(metricRows[1]?.text()).toContain('100')
      expect(metricRows[1]?.text()).toContain('120')
      expect(metricRows[1]?.text()).toContain('+20')
      expect(metricRows[1]?.text()).toContain('worse')
      const bars = wrapper.findAll('[data-test="compare-metric-bar"]')
      expect(bars).toHaveLength(4)
      expect(bars.map((bar) => bar.attributes('title'))).toEqual([
        'passRate: 1 → 0.8',
        'totalTokens: 100 → 120',
        'durationMs: 1000 → 900',
        'toolFailureRate: 0 → 0.1'
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('renders repeat variability charts for all core metrics', async () => {
    const originalFetch = globalThis.fetch
    const originalEventSource = globalThis.EventSource
    const eventSources: Array<{
      listeners: Map<string, (event: { data: string }) => void>
    }> = []
    class FakeEventSource {
      listeners = new Map<string, (event: { data: string }) => void>()
      constructor() {
        eventSources.push({ listeners: this.listeners })
      }
      addEventListener(type: string, listener: (event: { data: string }) => void): void {
        this.listeners.set(type, listener)
      }
      close(): void {}
    }
    const metrics = {
      passRate: 1,
      totalTokens: 10,
      durationMs: 100,
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
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/runs/variation-run') && (!init || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            id: 'variation-run',
            status: 'completed',
            repeats: [1, 2, 3].map((index) => ({
              id: `repeat-${index}`,
              metrics: {
                ...metrics,
                totalTokens: 10 * index,
                durationMs: 100 * index,
                toolFailureRate: index === 3 ? 0.2 : 0
              },
              fixtureResults: []
            }))
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/runs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'variation-run', status: 'pending' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.startsWith('/api/suites')) return new Response(JSON.stringify([]), { status: 200 })
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-run"]').trigger('click')
      await wrapper.find('[data-test="mode-select"]').setValue('ad-hoc-real')
      await wrapper.find('[data-test="prompt-input"]').setValue('请调用 bash 工具执行 echo "ok"')
      await wrapper.find('[data-test="create-run"]').trigger('submit')
      await flushPromises()
      eventSources[0]?.listeners.get('run-event')?.({
        data: JSON.stringify({ type: 'run.completed', status: 'completed' })
      })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-report"]').trigger('click')
      const bars = wrapper.findAll('[data-test="repeat-variation-bar"]')
      expect(bars).toHaveLength(12)
      expect(bars.map((bar) => bar.attributes('title'))).toContain('repeat-2 totalTokens: 20')
      expect(bars.map((bar) => bar.attributes('title'))).toContain('repeat-3 toolFailureRate: 0.2')
    } finally {
      globalThis.fetch = originalFetch
      globalThis.EventSource = originalEventSource
    }
  })

  it('opens report and trace artifacts from history rows', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/runs/history-report/trace')) {
        return new Response(
          JSON.stringify({
            runId: 'history-report',
            exportPath: 'exports/history-report.jsonl',
            raw: '{"event":{"type":"message.completed"}}'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/runs/history-report')) {
        return new Response(
          JSON.stringify({
            id: 'history-report',
            status: 'completed',
            repeats: [
              {
                id: 'repeat-1',
                metrics: {
                  passRate: 1,
                  totalTokens: 12,
                  durationMs: 60,
                  toolFailureRate: 0,
                  assertionFailureCount: 0,
                  firstEventLatencyMs: 1,
                  toolExecutionDurationMs: [],
                  toolErrorCount: 0,
                  eventCompleteness: 'complete',
                  cost: null,
                  modelResponseDurationMs: null
                },
                fixtureResults: []
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/runs?')) {
        return new Response(
          JSON.stringify([
            {
              id: 'history-report',
              createdAt: 100,
              status: 'completed',
              config: { suiteId: 'sample', mode: 'deterministic-suite', provider: null, model: null, repeatCount: 1 }
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.startsWith('/api/suites')) return new Response(JSON.stringify([]), { status: 200 })
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    try {
      const wrapper = mount(EvalStudioApp, { props: { token: 'test-token' } })
      await flushPromises()
      await wrapper.find('[data-tab-test="tab-history"]').trigger('click')
      await wrapper.find('[data-test="history-panel"] form').trigger('submit')
      await flushPromises()
      await wrapper.find('[data-test="open-history-report"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test="report-status"]').text()).toContain('completed')

      await wrapper.find('[data-tab-test="tab-history"]').trigger('click')
      await wrapper.find('[data-test="open-history-trace"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test="trace-path"]').text()).toContain(
        'exports/history-report.jsonl'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
