import { z } from 'zod'

const nonEmptyString = z.string().min(1)
const nonNegativeInteger = z.number().int().nonnegative()
const nonNegativeNumber = z.number().finite().nonnegative()
const nullableNonNegativeNumber = nonNegativeNumber.nullable()
const nullableNonEmptyString = nonEmptyString.nullable()

export const suiteCatalogEntrySchema = z.strictObject({
  suiteId: nonEmptyString,
  name: nonEmptyString,
  description: nonEmptyString,
  fixtureCount: z.number().int().positive()
})

export const runConfigOverrideSchema = z.strictObject({
  mode: z.enum(['deterministic-suite', 'real-pi-suite', 'ad-hoc-real']),
  suiteId: nonEmptyString,
  provider: nullableNonEmptyString,
  model: nullableNonEmptyString,
  prompt: z.string().max(100_000).nullable(),
  tools: z.array(nonEmptyString).min(1),
  repeatCount: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  thresholds: z.strictObject({
    maxTokens: nullableNonNegativeNumber,
    maxDurationMs: nullableNonNegativeNumber,
    maxToolCalls: nonNegativeInteger.nullable(),
    maxToolFailures: nonNegativeInteger.nullable()
  })
})

export const metricsReportSchema = z.strictObject({
  passRate: z.number().min(0).max(1),
  totalTokens: nonNegativeNumber,
  durationMs: nonNegativeNumber,
  toolFailureRate: z.number().min(0).max(1),
  assertionFailureCount: nonNegativeInteger,
  firstEventLatencyMs: nullableNonNegativeNumber,
  toolExecutionDurationMs: z.array(nonNegativeNumber),
  toolErrorCount: nonNegativeInteger,
  eventCompleteness: z.enum(['complete', 'incomplete', 'unknown']),
  cost: nullableNonNegativeNumber,
  modelResponseDurationMs: z.array(nonNegativeNumber).nullable(),
  repeatVariability: z
    .strictObject({
      metric: z.enum(['passRate', 'totalTokens', 'durationMs', 'toolFailureRate']),
      values: z.array(nonNegativeNumber).min(2),
      mean: nonNegativeNumber,
      min: nonNegativeNumber,
      max: nonNegativeNumber,
      dispersion: nullableNonNegativeNumber
    })
    .nullable()
})

export const fixtureResultSchema = z.strictObject({
  fixtureId: nonEmptyString,
  scenario: nonEmptyString,
  status: z.enum(['passed', 'failed', 'skipped']),
  failureReasons: z.array(
    z.strictObject({
      assertionType: nonEmptyString,
      expected: z.string().nullable(),
      actual: z.string().nullable(),
      message: nonEmptyString
    })
  )
})

export const studioRepeatSchema = z.strictObject({
  id: nonEmptyString,
  index: nonNegativeInteger,
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'timeout']),
  startedAt: nonNegativeNumber,
  endedAt: nullableNonNegativeNumber,
  fixtureResults: z.array(fixtureResultSchema),
  metrics: metricsReportSchema,
  exportPath: nonEmptyString,
  sessionDir: nonEmptyString,
  workingDir: nonEmptyString,
  error: z.string().nullable()
})

export const studioRunSchema = z.strictObject({
  id: nonEmptyString,
  createdAt: nonNegativeNumber,
  config: runConfigOverrideSchema,
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'timeout']),
  repeats: z.array(studioRepeatSchema),
  artifacts: z.strictObject({
    reportPath: nonEmptyString,
    exportPaths: z.array(nonEmptyString),
    eventLogPath: nonEmptyString.optional()
  }),
  sessionDir: nonEmptyString,
  workingDir: nonEmptyString,
  error: z.string().nullable()
})

export const historyRecordSchema = studioRunSchema
