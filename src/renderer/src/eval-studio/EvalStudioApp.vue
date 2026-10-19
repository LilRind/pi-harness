<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ token?: string }>(), { token: '' })

const tabs = ['Suite', '运行', '报告', '历史', '对比', 'Trace'] as const
const tabTestIds = {
  Suite: 'tab-suite',
  运行: 'tab-run',
  报告: 'tab-report',
  历史: 'tab-history',
  对比: 'tab-compare',
  Trace: 'tab-trace'
} as const
const activeTab = ref<(typeof tabs)[number]>('Suite')

interface SuiteCatalogEntry {
  suiteId: string
  name: string
  description: string
  fixtureCount: number
}

interface SuiteDetail {
  suiteId: string
  fixtures: Array<{
    id: string
    scenario: string
    assertions?: Array<{ kind: string }>
  }>
}

interface RunReportDetail {
  id: string
  status: string
  judge?: {
    kind: string
    score: number
    reason: string
    model: string | null
    promptSummary: string | null
    references: string[]
    affectsDeterministicResult: boolean
    affectsBaseline: boolean
  }
  sessionDir?: string
  workingDir?: string
  artifacts?: { reportPath: string; exportPaths: string[]; eventLogPath?: string }
  repeats: Array<{
    id: string
    metrics: {
      passRate: number
      totalTokens: number
      durationMs: number
      toolFailureRate: number
      assertionFailureCount: number
      firstEventLatencyMs: number | null
      toolExecutionDurationMs: number[]
      toolErrorCount: number
      eventCompleteness: string
      cost: number | null
      modelResponseDurationMs: number[] | null
    }
    fixtureResults: Array<{
      fixtureId: string
      scenario: string
      status: string
      failureReasons: Array<{ message: string }>
    }>
  }>
}

const suites = ref<SuiteCatalogEntry[]>([])
const selectedSuite = ref<SuiteDetail | null>(null)
const suiteLoading = ref(false)
const suiteError = ref<string | null>(null)
const runDraft = ref({
  mode: 'deterministic-suite',
  provider: '',
  model: '',
  prompt: '',
  tools: 'bash',
  repeatCount: 1,
  timeoutMs: 180000,
  maxTokens: 20000,
  maxDurationMs: 180000,
  maxToolCalls: 10,
  maxToolFailures: 2
})
const createdRun = ref<{ id: string; status: string } | null>(null)
const runStatus = ref<string>('not-created')
const runEvents = ref<Array<{ label: string }>>([])
const runDetail = ref<RunReportDetail | null>(null)
const traceDetail = ref<{ runId: string; exportPath: string; raw: string } | null>(null)
const historyFilters = ref({
  suiteId: '',
  mode: '',
  status: '',
  from: '',
  to: ''
})
const historyRecords = ref<
  Array<{
    id: string
    createdAt: number
    status: string
    config: {
      suiteId: string
      mode: string
      provider: string | null
      model: string | null
      repeatCount: number
    }
  }>
>([])
const selectedHistoryRunIds = ref<string[]>([])
const runComparison = ref<{
  configDiff: Array<{ path: string; left: unknown; right: unknown }>
  metrics: Array<{
    key: string
    unit: string
    left: number
    right: number
    absoluteChange: number
    direction: string
  }>
} | null>(null)
const repeatMetricKeys = ['passRate', 'totalTokens', 'durationMs', 'toolFailureRate'] as const
const runError = ref<string | null>(null)
const runSubmitting = ref(false)
let eventSource: EventSource | null = null

interface TraceEvent {
  type: string
  timestamp: number
  usage?: { total?: number; input?: number; output?: number; cacheRead?: number }
  toolName?: string
  isError?: boolean
  [key: string]: unknown
}

interface TraceNode {
  id: string
  kind: 'model' | 'tool'
  name: string
  start: number
  end: number | null
  tokens: number | null
  error: boolean
  children: TraceNode[]
  depth: number
}

function parseTrace(raw: string): { events: TraceEvent[]; footer: Record<string, unknown> | null } {
  const records = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event?: TraceEvent; footer?: Record<string, unknown> })
  return {
    events: records.filter((record) => record.event).map((record) => record.event as TraceEvent),
    footer: records.find((record) => record.footer)?.footer ?? null
  }
}

function traceUsageTotal(event: TraceEvent): number {
  const usage = event.usage
  if (!usage) return 0
  return usage.total || (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) || 0
}

function buildTraceNodes(raw: string): TraceNode[] {
  const { events } = parseTrace(raw)
  const roots: TraceNode[] = []
  const stack: TraceNode[] = []
  let seq = 0
  const create = (kind: TraceNode['kind'], name: string, timestamp: number): TraceNode => {
    const parent = stack.at(-1)
    const node: TraceNode = {
      id: `trace-${seq++}`,
      kind,
      name,
      start: timestamp,
      end: null,
      tokens: null,
      error: false,
      children: [],
      depth: parent ? parent.depth + 1 : 0
    }
    if (parent) parent.children.push(node)
    else roots.push(node)
    return node
  }
  for (const event of events) {
    if (event.type === 'message.started') {
      stack.push(create('model', 'model turn', event.timestamp))
    } else if (event.type === 'message.completed') {
      const node = stack.pop()
      if (node) {
        node.end = event.timestamp
        node.tokens = traceUsageTotal(event)
      }
    } else if (event.type === 'tool.started') {
      stack.push(create('tool', event.toolName ?? 'tool', event.timestamp))
    } else if (event.type === 'tool.completed') {
      const node = stack.pop()
      if (node) {
        node.end = event.timestamp
        node.error = event.isError === true
      }
    }
  }
  const flattened: TraceNode[] = []
  const visit = (node: TraceNode) => {
    flattened.push(node)
    for (const child of node.children) visit(child)
  }
  for (const root of roots) visit(root)
  return flattened
}

const traceNodes = computed(() => (traceDetail.value ? buildTraceNodes(traceDetail.value.raw) : []))
const traceSummary = computed(() => {
  if (!traceDetail.value) return []
  const { events, footer } = parseTrace(traceDetail.value.raw)
  const tokens = events
    .filter((event) => event.type === 'message.completed')
    .reduce((sum, event) => sum + traceUsageTotal(event), 0)
  const tools = events.filter((event) => event.type === 'tool.completed')
  return [
    ['runId', String(footer?.runId ?? '—')],
    ['状态', String(footer?.status ?? '—')],
    ['事件数', String(footer?.eventCount ?? events.length)],
    ['token', String(tokens)],
    ['工具', `${tools.length} / ${tools.filter((tool) => tool.isError).length} failed`]
  ]
})

function apiUrl(path: string, token: string): string {
  if (!token) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}token=${encodeURIComponent(token)}`
}

async function requestJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(apiUrl(path, token))
  if (!response.ok) throw new Error(`Request failed: ${path} (${response.status})`)
  return (await response.json()) as T
}

async function loadSuites(): Promise<void> {
  suiteLoading.value = true
  suiteError.value = null
  try {
    suites.value = await requestJson<SuiteCatalogEntry[]>('/api/suites', props.token)
  } catch (error) {
    suiteError.value = error instanceof Error ? error.message : String(error)
  } finally {
    suiteLoading.value = false
  }
}

async function selectSuite(suiteId: string): Promise<void> {
  suiteLoading.value = true
  suiteError.value = null
  try {
    selectedSuite.value = await requestJson<SuiteDetail>(
      `/api/suites/${encodeURIComponent(suiteId)}`,
      props.token
    )
  } catch (error) {
    suiteError.value = error instanceof Error ? error.message : String(error)
  } finally {
    suiteLoading.value = false
  }
}

async function createRun(): Promise<void> {
  const isAdHocReal = runDraft.value.mode === 'ad-hoc-real'
  const suite = selectedSuite.value
  if (!isAdHocReal && !suite) {
    runError.value = '请先选择 suite'
    return
  }
  runSubmitting.value = true
  runError.value = null
  try {
    const response = await fetch(apiUrl('/api/runs', props.token), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: runDraft.value.mode,
        suiteId: isAdHocReal ? 'ad-hoc' : suite?.suiteId,
        provider: runDraft.value.provider.trim() || null,
        model: runDraft.value.model.trim() || null,
        prompt: runDraft.value.prompt.trim() || null,
        tools: runDraft.value.tools
          .split(/[\n,]/)
          .map((tool) => tool.trim())
          .filter(Boolean),
        repeatCount: runDraft.value.repeatCount,
        timeoutMs: runDraft.value.timeoutMs,
        thresholds: {
          maxTokens: runDraft.value.maxTokens,
          maxDurationMs: runDraft.value.maxDurationMs,
          maxToolCalls: runDraft.value.maxToolCalls,
          maxToolFailures: runDraft.value.maxToolFailures
        }
      })
    })
    if (!response.ok) throw new Error(`创建运行失败 (${response.status})`)
    createdRun.value = (await response.json()) as { id: string; status: string }
    runStatus.value = createdRun.value.status
    subscribeRunEvents(createdRun.value.id)
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  } finally {
    runSubmitting.value = false
  }
}

function closeRunEvents(): void {
  eventSource?.close()
  eventSource = null
}

function subscribeRunEvents(runId: string): void {
  closeRunEvents()
  if (typeof window === 'undefined' || !('EventSource' in window)) return
  eventSource = new EventSource(apiUrl(`/api/runs/${encodeURIComponent(runId)}/events`, props.token))
  eventSource.addEventListener('snapshot', (event) => {
    const snapshot = JSON.parse((event as MessageEvent<string>).data) as { status?: string }
    if (snapshot.status) runStatus.value = snapshot.status
  })
  eventSource.addEventListener('run-event', (event) => {
    const runEvent = JSON.parse((event as MessageEvent<string>).data) as {
      type: string
      fixtureId?: string
      status?: string
    }
    runEvents.value.push({
      label: runEvent.fixtureId ? `${runEvent.type} · ${runEvent.fixtureId}` : runEvent.type
    })
    if (runEvent.status) runStatus.value = runEvent.status
    if (['run.completed', 'run.failed', 'run.cancelled', 'run.timeout'].includes(runEvent.type)) {
      closeRunEvents()
      void loadRunDetail(runId)
    }
  })
}

async function loadRunDetail(runId: string): Promise<void> {
  try {
    runDetail.value = await requestJson<RunReportDetail>(
      `/api/runs/${encodeURIComponent(runId)}`,
      props.token
    )
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  }
}

async function loadTrace(runId: string): Promise<void> {
  try {
    traceDetail.value = await requestJson<{ runId: string; exportPath: string; raw: string }>(
      `/api/runs/${encodeURIComponent(runId)}/trace`,
      props.token
    )
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  }
}

async function loadHistory(): Promise<void> {
  const params = new URLSearchParams()
  if (historyFilters.value.suiteId.trim()) {
    params.set('suiteIds', historyFilters.value.suiteId.trim())
  }
  if (historyFilters.value.mode) params.set('modes', historyFilters.value.mode)
  if (historyFilters.value.status) params.set('statuses', historyFilters.value.status)
  const from = String(historyFilters.value.from).trim()
  const to = String(historyFilters.value.to).trim()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.size > 0 ? `?${params.toString()}` : ''
  try {
    historyRecords.value = await requestJson(`/api/runs${query}`, props.token)
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  }
}

async function loadComparison(): Promise<void> {
  if (selectedHistoryRunIds.value.length !== 2) return
  const [left, right] = selectedHistoryRunIds.value
  try {
    runComparison.value = await requestJson(
      `/api/runs/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
      props.token
    )
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  }
}

function repeatMetricValue(
  repeat: RunReportDetail['repeats'][number],
  key: (typeof repeatMetricKeys)[number]
): number {
  return repeat.metrics[key]
}

function selectTab(tab: (typeof tabs)[number]): void {
  activeTab.value = tab
  if (tab === 'Trace' && createdRun.value && !traceDetail.value) {
    void loadTrace(createdRun.value.id)
  }
  if (tab === '历史' && historyRecords.value.length === 0) void loadHistory()
  if (tab === '对比' && selectedHistoryRunIds.value.length === 2 && !runComparison.value) {
    void loadComparison()
  }
}

async function openHistoryReport(runId: string): Promise<void> {
  await loadRunDetail(runId)
  activeTab.value = '报告'
}

async function openHistoryTrace(runId: string): Promise<void> {
  await loadTrace(runId)
  activeTab.value = 'Trace'
}

async function startCreatedRun(): Promise<void> {
  if (!createdRun.value) return
  runError.value = null
  try {
    const response = await fetch(
      apiUrl(`/api/runs/${encodeURIComponent(createdRun.value.id)}/start`, props.token),
      { method: 'POST' }
    )
    if (!response.ok) throw new Error(`启动运行失败 (${response.status})`)
    runStatus.value = 'running'
  } catch (error) {
    runError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void loadSuites()
})

onBeforeUnmount(() => {
  closeRunEvents()
})
</script>

<template>
  <div class="eval-studio">
    <header class="studio-header">
      <div>
        <h1 data-test="eval-studio-title">Pi Harness Eval Studio</h1>
        <p>本地 Agent 会话评测工作台</p>
      </div>
      <nav class="studio-tabs" aria-label="Eval Studio sections">
        <button
          v-for="tab in tabs"
          :key="tab"
          data-test="tab"
          :data-tab-test="tabTestIds[tab]"
          :class="{ active: activeTab === tab }"
          type="button"
          @click="selectTab(tab)"
        >
          {{ tab }}
        </button>
      </nav>
    </header>

    <main>
      <section v-if="activeTab === 'Suite'" data-test="suite-panel">
        <p v-if="suiteError" class="error">{{ suiteError }}</p>
        <p v-else-if="suiteLoading">加载中…</p>
        <p v-else-if="suites.length === 0">暂无可用 suite。</p>
        <div v-else class="suite-layout">
          <aside>
            <h2>Suite</h2>
            <button
              v-for="suite in suites"
              :key="suite.suiteId"
              data-test="suite-option"
              type="button"
              @click="selectSuite(suite.suiteId)"
            >
              <strong>{{ suite.suiteId }}</strong>
              <span>{{ suite.description }}</span>
            </button>
          </aside>
          <div>
            <h2>Fixture</h2>
            <p v-if="!selectedSuite">选择一个 suite 查看用例与断言。</p>
            <div
              v-for="fixture in selectedSuite?.fixtures ?? []"
              :key="fixture.id"
              data-test="fixture-row"
              class="fixture-row"
            >
              <strong>{{ fixture.id }}</strong>
              <span>{{ fixture.scenario }}</span>
              <code>{{ (fixture.assertions ?? []).map((assertion) => assertion.kind).join(', ') }}</code>
            </div>
          </div>
        </div>
      </section>
      <section v-else-if="activeTab === '运行'" data-test="run-panel">
        <h2>运行参数覆盖</h2>
        <p v-if="runError" class="error">{{ runError }}</p>
        <form data-test="create-run" class="run-form" @submit.prevent="createRun">
          <label>模式
            <select v-model="runDraft.mode" data-test="mode-select">
              <option value="deterministic-suite">确定性 suite</option>
              <option value="real-pi-suite">真实 Pi suite</option>
              <option value="ad-hoc-real">单次即时真实测试</option>
            </select>
          </label>
          <label>Provider<input v-model="runDraft.provider" data-test="provider-input" /></label>
          <label>Model<input v-model="runDraft.model" data-test="model-input" /></label>
          <label>Prompt<textarea v-model="runDraft.prompt" data-test="prompt-input" /></label>
          <label>Tools（逗号分隔）<input v-model="runDraft.tools" data-test="tools-input" /></label>
          <label>重复次数<input v-model.number="runDraft.repeatCount" data-test="repeat-input" type="number" min="1" /></label>
          <label>超时 ms<input v-model.number="runDraft.timeoutMs" data-test="timeout-input" type="number" min="1" /></label>
          <label>Token 上限<input v-model.number="runDraft.maxTokens" data-test="max-tokens-input" type="number" min="0" /></label>
          <label>耗时上限 ms<input v-model.number="runDraft.maxDurationMs" data-test="max-duration-input" type="number" min="0" /></label>
          <label>工具次数上限<input v-model.number="runDraft.maxToolCalls" data-test="max-tool-calls-input" type="number" min="0" /></label>
          <label>工具失败上限<input v-model.number="runDraft.maxToolFailures" data-test="max-tool-failures-input" type="number" min="0" /></label>
          <button type="submit" :disabled="runSubmitting">创建运行</button>
        </form>
        <p v-if="createdRun" data-test="created-run">已创建运行 {{ createdRun.id }}（{{ createdRun.status }}）</p>
        <div v-if="createdRun" class="run-live">
          <div>
            <button data-test="start-run" type="button" @click="startCreatedRun">启动运行</button>
            <p data-test="run-status">状态：{{ runStatus }}</p>
          </div>
          <div>
            <h3>实时事件</h3>
            <p v-if="runEvents.length === 0" class="muted">等待事件…</p>
            <ul>
              <li v-for="(event, index) in runEvents" :key="index" data-test="run-event">
                {{ event.label }}
              </li>
            </ul>
          </div>
        </div>
      </section>
      <section v-else-if="activeTab === '报告'" data-test="report-panel">
        <p v-if="!runDetail">运行完成后此处显示报告。</p>
        <div v-else class="report-layout">
          <div>
            <h2>运行结果</h2>
            <p data-test="report-status">状态：{{ runDetail.status }}</p>
            <div class="metric-grid">
              <div data-test="metric-pass-rate">通过率：{{ (runDetail.repeats[0]?.metrics.passRate ?? 0) * 100 }}%</div>
              <div data-test="metric-tokens">Token：{{ runDetail.repeats[0]?.metrics.totalTokens ?? 0 }}</div>
              <div data-test="metric-duration">耗时：{{ runDetail.repeats[0]?.metrics.durationMs ?? 0 }}ms</div>
              <div data-test="metric-tool-failure">工具失败率：{{ runDetail.repeats[0]?.metrics.toolFailureRate ?? 0 }}</div>
              <div data-test="metric-first-latency">首事件延迟：{{ runDetail.repeats[0]?.metrics.firstEventLatencyMs ?? '—' }}ms</div>
              <div data-test="metric-tool-errors">工具错误数：{{ runDetail.repeats[0]?.metrics.toolErrorCount ?? 0 }}</div>
              <div data-test="metric-event-completeness">事件完整性：{{ runDetail.repeats[0]?.metrics.eventCompleteness }}</div>
              <div data-test="metric-cost">成本：{{ runDetail.repeats[0]?.metrics.cost ?? '—' }}</div>
              <div>Session：{{ runDetail.sessionDir ?? '—' }}</div>
              <div>Workdir：{{ runDetail.workingDir ?? '—' }}</div>
              <div>Report：{{ runDetail.artifacts?.reportPath ?? '—' }}</div>
              <div>Exports：{{ runDetail.artifacts?.exportPaths.join(', ') || '—' }}</div>
            </div>
            <div v-if="runDetail.judge" data-test="judge-section" class="judge-section">
              <h3>LLM-as-Judge（附加评估）</h3>
              <p>分数：{{ runDetail.judge.score }} / 100</p>
              <p>模型：{{ runDetail.judge.model ?? '—' }}</p>
              <p>评估说明：{{ runDetail.judge.promptSummary ?? '—' }}</p>
              <p>理由：{{ runDetail.judge.reason }}</p>
              <p>引用：{{ runDetail.judge.references.join(', ') || '—' }}</p>
              <strong>不影响确定性结果 / 不进入 baseline</strong>
            </div>
          </div>
          <div>
            <h2>重复运行</h2>
            <div
              v-for="repeat in runDetail.repeats"
              :key="repeat.id"
              data-test="repeat-summary"
              class="fixture-row"
            >
              <strong>{{ repeat.id }}</strong>
              <span>通过率 {{ repeat.metrics.passRate }} · Token {{ repeat.metrics.totalTokens }} · 耗时 {{ repeat.metrics.durationMs }}ms</span>
            </div>
            <div data-test="repeat-variation-chart" class="metric-chart-group">
              <div
                v-for="metricKey in repeatMetricKeys"
                :key="metricKey"
                class="metric-chart"
              >
                <div
                  v-for="repeat in runDetail.repeats"
                  :key="`${metricKey}-${repeat.id}`"
                  data-test="repeat-variation-bar"
                  class="metric-bar"
                  :title="`${repeat.id} ${metricKey}: ${repeatMetricValue(repeat, metricKey)}`"
                ></div>
              </div>
            </div>
            <h2>Fixture</h2>
            <div
              v-for="fixture in runDetail.repeats[0]?.fixtureResults ?? []"
              :key="fixture.fixtureId"
              data-test="report-fixture"
              class="fixture-row"
            >
              <strong>{{ fixture.fixtureId }} · {{ fixture.status }}</strong>
              <span>{{ fixture.scenario }}</span>
              <code>{{ fixture.failureReasons.map((reason) => reason.message).join('; ') }}</code>
            </div>
          </div>
        </div>
      </section>
      <section v-else-if="activeTab === '历史'" data-test="history-panel">
        <form class="history-filters" @submit.prevent="loadHistory">
          <label>Suite<input v-model="historyFilters.suiteId" data-test="history-suite-filter" /></label>
          <label>模式
            <select v-model="historyFilters.mode" data-test="history-mode-filter">
              <option value="">全部</option>
              <option value="deterministic-suite">deterministic-suite</option>
              <option value="real-pi-suite">real-pi-suite</option>
              <option value="ad-hoc-real">ad-hoc-real</option>
            </select>
          </label>
          <label>状态
            <select v-model="historyFilters.status" data-test="history-status-filter">
              <option value="">全部</option>
              <option value="pending">pending</option>
              <option value="running">running</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
              <option value="timeout">timeout</option>
            </select>
          </label>
          <label>From<input v-model="historyFilters.from" data-test="history-from-filter" type="number" /></label>
          <label>To<input v-model="historyFilters.to" data-test="history-to-filter" type="number" /></label>
          <button data-test="history-refresh" type="submit">查询</button>
        </form>
        <p v-if="historyRecords.length === 0" class="muted">没有匹配的历史记录。</p>
        <div
          v-for="record in historyRecords"
          :key="record.id"
          data-test="history-row"
          class="fixture-row"
        >
          <input
            v-model="selectedHistoryRunIds"
            data-test="compare-select"
            type="checkbox"
            :value="record.id"
          />
          <strong>{{ record.id }} · {{ record.status }}</strong>
          <span>{{ record.config.suiteId }} · {{ record.config.mode }}</span>
          <span>{{ record.config.provider ?? '(default)' }} / {{ record.config.model ?? '(default)' }} · repeat={{ record.config.repeatCount }}</span>
          <span class="history-actions">
            <button data-test="open-history-report" type="button" @click="openHistoryReport(record.id)">报告</button>
            <button data-test="open-history-trace" type="button" @click="openHistoryTrace(record.id)">Trace</button>
          </span>
        </div>
      </section>
      <section v-else-if="activeTab === '对比'" data-test="compare-panel">
        <p v-if="selectedHistoryRunIds.length !== 2">请先在历史中选择两次运行。</p>
        <template v-else-if="runComparison">
          <h2>配置差异</h2>
          <div
            v-for="diff in runComparison.configDiff"
            :key="diff.path"
            data-test="compare-config-row"
            class="fixture-row"
          >
            <strong>{{ diff.path }}</strong>
            <span>{{ String(diff.left) }} → {{ String(diff.right) }}</span>
          </div>
          <h2>指标差异</h2>
          <div
            v-for="metric in runComparison.metrics"
            :key="metric.key"
            data-test="compare-metric-row"
            class="fixture-row"
          >
            <strong>{{ metric.key }}（{{ metric.unit }}）</strong>
            <span>{{ metric.left }} → {{ metric.right }}</span>
            <span>{{ metric.absoluteChange >= 0 ? '+' : '' }}{{ metric.absoluteChange }} · {{ metric.direction }}</span>
            <div class="metric-chart">
              <div
                data-test="compare-metric-bar"
                class="metric-bar"
                :title="`${metric.key}: ${metric.left} → ${metric.right}`"
              ></div>
            </div>
          </div>
        </template>
        <p v-else>正在加载对比…</p>
      </section>
      <section v-else data-test="trace-panel">
        <p v-if="!traceDetail">运行完成后此处显示 JSONL / span trace。</p>
        <template v-else>
          <p data-test="trace-path">导出文件：{{ traceDetail.exportPath }}</p>
          <div data-test="trace-summary" class="metric-grid">
            <div v-for="[key, value] in traceSummary" :key="key">
              {{ key }}: {{ value }}
            </div>
          </div>
          <div
            v-for="node in traceNodes"
            :key="node.id"
            data-test="trace-tree-node"
            class="trace-node"
            :class="{ error: node.error }"
            :style="{ marginLeft: `${node.depth * 18}px` }"
          >
            <strong>{{ node.name }}</strong>
            <span>{{ node.end != null ? `${node.end - node.start}ms` : '—' }}</span>
            <span v-if="node.tokens != null">{{ node.tokens }} tokens</span>
            <span v-if="node.error" class="error">error</span>
          </div>
          <pre data-test="trace-raw">{{ traceDetail.raw }}</pre>
        </template>
      </section>
    </main>
  </div>
</template>

<style scoped>
.eval-studio {
  min-height: 100vh;
  color: #d7dce4;
  background: #0f1115;
  font: 14px/1.5 system-ui, sans-serif;
}

.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 24px;
  border-bottom: 1px solid #262b36;
  background: #171a21;
}

h1 {
  margin: 0;
  font-size: 18px;
}

.studio-header p {
  margin: 4px 0 0;
  color: #8a93a3;
}

.studio-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  border: 1px solid #262b36;
  border-radius: 6px;
  background: transparent;
  color: #d7dce4;
  cursor: pointer;
  padding: 7px 12px;
}

button.active {
  border-color: #3fb950;
  color: #3fb950;
}

main {
  padding: 20px 24px;
}

section {
  border: 1px solid #262b36;
  border-radius: 8px;
  background: #171a21;
  padding: 16px;
}

.error { color: #f85149; }

.suite-layout {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
  gap: 16px;
}

.suite-layout aside button {
  display: grid;
  width: 100%;
  gap: 4px;
  margin-bottom: 8px;
  text-align: left;
}

.fixture-row {
  display: grid;
  gap: 4px;
  padding: 8px 0;
  border-bottom: 1px solid #262b36;
}

.run-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.run-form label {
  display: grid;
  gap: 5px;
  color: #8a93a3;
}

.run-form input,
.run-form select,
.run-form textarea {
  border: 1px solid #262b36;
  border-radius: 5px;
  padding: 8px;
  color: inherit;
  background: #0f1115;
}

.run-live {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
  gap: 16px;
  margin-top: 16px;
}

.muted { color: #8a93a3; }

.report-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 16px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
}

.metric-grid > div {
  border: 1px solid #262b36;
  border-radius: 5px;
  padding: 8px;
}

.metric-chart-group {
  display: grid;
  gap: 6px;
  margin: 10px 0 18px;
}

.metric-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 48px;
  border-bottom: 1px solid #262b36;
}

.metric-bar {
  flex: 1;
  min-height: 6px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(90deg, #3fb950, #d29922);
}

.judge-section {
  margin-top: 12px;
  padding: 10px;
  border: 1px dashed #d29922;
  border-radius: 6px;
}

.trace-node {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #262b36;
}

.history-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.history-filters label {
  display: grid;
  gap: 4px;
  color: #8a93a3;
}

.history-filters input,
.history-filters select {
  border: 1px solid #262b36;
  border-radius: 4px;
  padding: 6px;
  color: inherit;
  background: #0f1115;
}

.history-actions {
  display: flex;
  gap: 6px;
}

pre {
  overflow: auto;
  max-height: 60vh;
  padding: 12px;
  border: 1px solid #262b36;
  border-radius: 5px;
  background: #0f1115;
}
</style>
