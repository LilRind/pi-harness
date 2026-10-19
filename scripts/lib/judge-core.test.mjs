import { describe, expect, it } from 'vitest'
import { buildJudgedReport, evaluateWithJudge } from './judge-core.mjs'

const deterministic = {
  passRate: 0.8,
  passed: false,
  baselineVerdict: 'regression',
  failures: ['containsText']
}

describe('judged report schema', () => {
  it('keeps judge disabled by default', () => {
    expect(buildJudgedReport(deterministic)).toEqual({
      ...deterministic,
      judge: null
    })
  })

  it('attaches an explicitly labeled judge without changing deterministic result', () => {
    const report = buildJudgedReport(deterministic, {
      score: 72,
      reason: 'Mostly correct but verbose',
      model: 'glm-5.2',
      promptSummary: 'Judge answer quality',
      references: ['fixture-1']
    })
    expect(report.passRate).toBe(0.8)
    expect(report.passed).toBe(false)
    expect(report.baselineVerdict).toBe('regression')
    expect(report.failures).toEqual(['containsText'])
    expect(report.judge).toEqual({
      kind: 'llm-as-judge',
      score: 72,
      reason: 'Mostly correct but verbose',
      model: 'glm-5.2',
      promptSummary: 'Judge answer quality',
      references: ['fixture-1'],
      affectsDeterministicResult: false,
      affectsBaseline: false
    })
  })

  it('rejects malformed judge scores', () => {
    expect(() => buildJudgedReport(deterministic, { score: 101 })).toThrow(
      'judge score must be a finite number between 0 and 100'
    )
  })

  it('does not invoke a judge when disabled', async () => {
    let calls = 0
    const result = await evaluateWithJudge(
      deterministic,
      { enabled: false, model: 'glm-5.2' },
      { prompt: 'judge prompt', references: ['fixture-1'] },
      async () => {
        calls++
        return { score: 100, reason: 'should not run' }
      }
    )
    expect(calls).toBe(0)
    expect(result.judge).toBeNull()
    expect(result.passRate).toBe(0.8)
  })

  it('invokes the judge once when explicitly enabled', async () => {
    let calls = 0
    const result = await evaluateWithJudge(
      deterministic,
      { enabled: true, model: 'glm-5.2', promptSummary: 'Judge correctness' },
      { prompt: 'judge prompt', references: ['fixture-1'] },
      async (config, input) => {
        calls++
        expect(config.model).toBe('glm-5.2')
        expect(input.references).toEqual(['fixture-1'])
        return { score: 88, reason: 'good', references: input.references }
      }
    )
    expect(calls).toBe(1)
    expect(result.judge).toMatchObject({
      kind: 'llm-as-judge',
      score: 88,
      reason: 'good',
      model: 'glm-5.2',
      promptSummary: 'Judge correctness',
      references: ['fixture-1'],
      affectsDeterministicResult: false,
      affectsBaseline: false
    })
    expect(result.passRate).toBe(0.8)
  })
})
