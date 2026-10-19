export interface RealPiExecutorRequest {
  executionId?: string
  provider?: string | null
  model?: string | null
  prompt?: string | null
  tools?: string[]
  timeoutMs?: number
  signal?: AbortSignal
}

export interface RealPiExecutorResult {
  status: number | null
  signal: NodeJS.Signals | null
  cancelled: boolean
  timedOut: boolean
  stdout: string
  stderr: string
  sessionDir: string
  cwd: string
}

export interface RealPiExecutor {
  execute(request: RealPiExecutorRequest): Promise<RealPiExecutorResult>
  allowedTools: string[]
}

export function createRealPiExecutor(options?: {
  piCliPath: string
  sessionRoot: string
  workRoot: string
}): RealPiExecutor

export function validateRealPiSafety(request: RealPiExecutorRequest): {
  ok: boolean
  reason?: string
}
