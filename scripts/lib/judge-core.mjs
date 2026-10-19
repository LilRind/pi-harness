export function buildJudgedReport(deterministicReport, judgeEvaluation = null) {
  if (!judgeEvaluation) {
    return { ...deterministicReport, judge: null }
  }
  const score = Number(judgeEvaluation.score)
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('judge score must be a finite number between 0 and 100')
  }
  return {
    ...deterministicReport,
    judge: {
      kind: 'llm-as-judge',
      score,
      reason: judgeEvaluation.reason ?? '',
      model: judgeEvaluation.model ?? null,
      promptSummary: judgeEvaluation.promptSummary ?? null,
      references: Array.isArray(judgeEvaluation.references)
        ? [...judgeEvaluation.references]
        : [],
      affectsDeterministicResult: false,
      affectsBaseline: false
    }
  }
}

export async function evaluateWithJudge(
  deterministicReport,
  judgeConfig,
  judgeInput,
  invokeJudge
) {
  if (!judgeConfig?.enabled) {
    return buildJudgedReport(deterministicReport, null)
  }
  const evaluation = await invokeJudge(judgeConfig, judgeInput)
  return buildJudgedReport(deterministicReport, {
    ...evaluation,
    model: evaluation.model ?? judgeConfig.model ?? null,
    promptSummary: evaluation.promptSummary ?? judgeConfig.promptSummary ?? null,
    references: evaluation.references ?? judgeInput.references ?? []
  })
}
