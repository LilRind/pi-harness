export interface EvalAssertion {
  kind: string
  [key: string]: unknown
}

export interface EvalFixture {
  id: string
  scenario: string
  secretSeed?: string
  events: Array<Record<string, unknown>>
  assertions?: EvalAssertion[]
}

export interface EvalSuite {
  id: string
  name?: string
  fixtures: EvalFixture[]
}

export function loadSuite(
  name: string,
  fixturesDir?: string
): Promise<{ suite: EvalSuite }>

export function renderJsonl(fixture: EvalFixture): string

export interface FixtureFailureDetail {
  fixtureId: string
  assertionType: string
  expected: string | null
  actual: string | null
  message: string
}

export interface EvaluatedFixture {
  id: string
  scenario: string
  pass: boolean
  failures: string[]
  failureDetails: FixtureFailureDetail[]
  footer: Record<string, unknown> | null
}

export function evaluateFixture(
  fixture: EvalFixture,
  parsedLines: Array<Record<string, unknown>>,
  rawExport: string
): EvaluatedFixture
