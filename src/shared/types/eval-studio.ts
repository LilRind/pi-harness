import type { z } from 'zod'
import type {
  fixtureResultSchema,
  historyRecordSchema,
  metricsReportSchema,
  runConfigOverrideSchema,
  suiteCatalogEntrySchema,
  studioRepeatSchema,
  studioRunSchema
} from '../schemas/eval-studio'

export type SuiteCatalogEntry = z.infer<typeof suiteCatalogEntrySchema>
export type RunConfigOverride = z.infer<typeof runConfigOverrideSchema>
export type MetricsReport = z.infer<typeof metricsReportSchema>
export type FixtureResult = z.infer<typeof fixtureResultSchema>
export type StudioRepeat = z.infer<typeof studioRepeatSchema>
export type StudioRun = z.infer<typeof studioRunSchema>
export type HistoryRecord = z.infer<typeof historyRecordSchema>
