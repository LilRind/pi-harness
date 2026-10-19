import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const REAL_PI_ALLOWED_TOOLS = ['bash']

export function validateRealPiSafety(request = {}) {
  const keyNames = Object.keys(request)
  if (keyNames.some((key) => /api[-_]?key|authorization/i.test(key))) {
    return { ok: false, reason: 'plaintext API keys are not accepted' }
  }
  const tools = request.tools ?? REAL_PI_ALLOWED_TOOLS
  if (
    !Array.isArray(tools) ||
    tools.length === 0 ||
    tools.some((tool) => !REAL_PI_ALLOWED_TOOLS.includes(tool))
  ) {
    return { ok: false, reason: `real Pi executor tools are restricted to: ${REAL_PI_ALLOWED_TOOLS.join(', ')}` }
  }

  const prompt = String(request.prompt ?? '')
  const normalized = prompt
    .toLowerCase()
    .replace(/bash\s*工具/g, '')
    .replace(/bash\s+tool/g, '')
  const hasEcho = /\becho\b/.test(normalized)
  const safeEcho = /echo\s+["']?ok["']?/.test(normalized)
  const dangerousCommand = /\b(rm|del|rd|cmd|powershell|curl|wget|invoke-expression|node|python|git)\b/
  const shellMetacharacter = /(?:&&|\|\||[>|<;`$])/
  if ((hasEcho && !safeEcho) || dangerousCommand.test(normalized) || shellMetacharacter.test(normalized)) {
    return { ok: false, reason: 'prompt contains a command outside the bash safety allowlist' }
  }
  return { ok: true }
}

function defaultTerminateTree(child) {
  if (child.pid == null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

export function createRealPiExecutor(options = {}) {
  const spawnFn = options.spawnFn ?? spawn
  const terminateTree = options.terminateTree ?? defaultTerminateTree

  function execute(request = {}) {
    const safety = validateRealPiSafety(request)
    if (!safety.ok) return Promise.reject(new Error(safety.reason))
    const executionId = request.executionId
    if (!executionId || !/^[A-Za-z0-9_-]+$/.test(executionId)) {
      return Promise.reject(new Error('executionId must contain only letters, digits, underscore, or hyphen'))
    }
    const requestedTools = request.tools ?? REAL_PI_ALLOWED_TOOLS
    if (
      !Array.isArray(requestedTools) ||
      requestedTools.some((tool) => !REAL_PI_ALLOWED_TOOLS.includes(tool))
    ) {
      return Promise.reject(new Error(`real Pi executor tools are restricted to: ${REAL_PI_ALLOWED_TOOLS.join(', ')}`))
    }
    const timeoutMs = request.timeoutMs ?? 180000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error('timeoutMs must be a positive finite number'))
    }

    const sessionDir = path.join(options.sessionRoot, executionId)
    const cwd = path.join(options.workRoot, executionId)
    mkdirSync(sessionDir, { recursive: true })
    mkdirSync(cwd, { recursive: true })

    const args = [options.piCliPath, '--print', '-p', '--mode', 'json']
    if (request.provider) args.push('--provider', request.provider)
    if (request.model) args.push('--model', request.model)
    args.push('--session-dir', sessionDir)
    args.push('--tools', requestedTools.join(','))
    args.push(request.prompt ?? '')

    return new Promise((resolve) => {
      const child = spawnFn(process.execPath, args, {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let cancelled = false
      let timedOut = false
      let settled = false
      let timer = null

      const finish = (status, signal) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        request.signal?.removeEventListener('abort', onAbort)
        resolve({
          status: status ?? null,
          signal: signal ?? null,
          cancelled,
          timedOut,
          stdout,
          stderr,
          sessionDir,
          cwd
        })
      }

      function onAbort() {
        if (settled) return
        cancelled = true
        terminateTree(child)
      }

      child.stdout?.on('data', (chunk) => (stdout += chunk))
      child.stderr?.on('data', (chunk) => (stderr += chunk))
      child.once('error', (error) => {
        stderr += String(error?.message ?? error)
        finish(null, null)
      })
      child.once('close', (status, signal) => finish(status, signal))
      request.signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        if (settled) return
        timedOut = true
        terminateTree(child)
      }, timeoutMs)
    })
  }

  return { execute, allowedTools: [...REAL_PI_ALLOWED_TOOLS] }
}
