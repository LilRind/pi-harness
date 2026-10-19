import { describe, expect, it } from 'vitest'
import {
  aggregateMetrics,
  compareToBaseline,
  evaluateAssertion,
  evaluateFixture,
  loadSuite,
  renderJsonl,
  renderMarkdown
} from './eval-core.mjs'

const fixture = {
  id: 'core-fixture',
  scenario: 'tool-success',
  secretSeed: 'TEST_SECRET',
  events: [
    { type: 'run.started', timestamp: 100, runId: 'core-run', prompt: 'test' },
    { type: 'tool.started', timestamp: 110, runId: 'core-run', toolCallId: 't1', toolName: 'bash' },
    { type: 'tool.completed', timestamp: 130, runId: 'core-run', toolCallId: 't1', toolName: 'bash', isError: false },
    {
      type: 'message.completed',
      timestamp: 150,
      runId: 'core-run',
      usage: { total: 18 },
      text: 'ok TEST_SECRET'
    },
    { type: 'run.completed', timestamp: 160, runId: 'core-run', status: 'success' }
  ],
  assertions: [
    { kind: 'containsText', text: 'ok' },
    { kind: 'toolCalled', toolName: 'bash' },
    { kind: 'maxTokens', max: 20 },
    { kind: 'maxDurationMs', max: 100 },
    { kind: 'noUnredactedSecret', secretSeed: 'TEST_SECRET' }
  ]
}

function parseJsonl(raw) {
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

describe('eval core', () => {
  it('loads the deterministic sample suite', async () => {
    const mod = await loadSuite('sample')
    expect(mod.suite.id).toBe('sample')
    expect(mod.suite.fixtures).toHaveLength(12)
  })

  it('renders schema-v1 JSONL with masking and footer metrics', () => {
    const parsed = parseJsonl(renderJsonl(fixture))
    const message = parsed.find((line) => line.event?.type === 'message.completed')
    const footer = parsed.at(-1).footer
    expect(message.schemaVersion).toBe(1)
    expect(message.enriched.text).toBe('ok ******')
    expect(footer).toMatchObject({
      runId: 'core-fixture',
      status: 'success',
      eventCount: 5,
      durationMs: 60,
      toolCalls: 1,
      toolFailures: 0
    })
  })

  it('evaluates deterministic assertions', () => {
    const raw = renderJsonl(fixture)
    const parsed = parseJsonl(raw)
    for (const assertion of fixture.assertions) {
      expect(evaluateAssertion(assertion, parsed, fixture, raw).ok).toBe(true)
    }
    expect(
      evaluateAssertion({ kind: 'containsText', text: 'missing' }, parsed, fixture, raw)
    ).toEqual({ ok: false, detail: "text contains 'missing'" })
  })

  it('returns structured assertion failure reasons for reports', () => {
    const raw = renderJsonl(fixture)
    const parsed = parseJsonl(raw)
    const result = evaluateFixture(
      {
        ...fixture,
        assertions: [
          { kind: 'containsText', text: 'missing' },
          { kind: 'maxTokens', max: 10 }
        ]
      },
      parsed,
      raw
    )
    expect(result.pass).toBe(false)
    expect(result.failures).toEqual([
      "containsText (text contains 'missing')",
      'maxTokens (tokens 18 <= 10)'
    ])
    expect(result.failureDetails).toEqual([
      {
        fixtureId: 'core-fixture',
        assertionType: 'containsText',
        expected: 'missing',
        actual: 'ok ******',
        message: "text contains 'missing'"
      },
      {
        fixtureId: 'core-fixture',
        assertionType: 'maxTokens',
        expected: '10',
        actual: '18',
        message: 'tokens 18 <= 10'
      }
    ])
  })

  it('aggregates the four deterministic metrics', () => {
    const parsed = parseJsonl(renderJsonl(fixture))
    const footer = parsed.find((line) => line.footer).footer
    const metrics = aggregateMetrics(parsed, [
      { pass: true, footer },
      { pass: false, footer }
    ])
    expect(metrics).toEqual({
      passRate: 50,
      totalTokens: 18,
      totalDurationMs: 120,
      toolFailureRate: 0
    })
  })

  it('compares metrics against versioned baseline thresholds', () => {
    const baseline = {
      version: 7,
      metrics: { passRate: 100, totalTokens: 100, totalDurationMs: 100 }
    }
    expect(compareToBaseline({ passRate: 94, totalTokens: 100, totalDurationMs: 100 }, baseline)).toMatchObject({
      verdict: 'regression',
      version: 7
    })
    expect(compareToBaseline({ passRate: 100, totalTokens: 100, totalDurationMs: 100 }, baseline)).toMatchObject({
      verdict: 'same'
    })
  })

  it('renders a readable Markdown report', () => {
    const markdown = renderMarkdown(
      'sample',
      [{ id: 'qa-basic', pass: true, failures: [] }],
      { passRate: 100, totalTokens: 18, totalDurationMs: 60, toolFailureRate: 0 },
      { verdict: 'same', reason: 'within tolerance', version: 1 },
      { version: 1 }
    )
    expect(markdown).toContain('# Eval Report — sample')
    expect(markdown).toContain('| Pass rate | 100.00% |')
    expect(markdown).toContain('- [x] qa-basic — ok')
  })
})
