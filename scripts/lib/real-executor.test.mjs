import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRealPiExecutor, validateRealPiSafety } from './real-executor.mjs'

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => {
    child.killed = true
    child.emit('close', null, 'SIGTERM')
    return true
  }
  return child
}

function createExecutor(root, calls) {
  return createRealPiExecutor({
    piCliPath: path.join(root, 'pi-cli.js'),
    sessionRoot: path.join(root, 'sessions'),
    workRoot: path.join(root, 'work'),
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options })
      const child = fakeChild()
      queueMicrotask(() => {
        child.emit('close', 0, null)
      })
      return child
    }
  })
}

describe('real Pi executor', () => {
  it('uses an isolated session directory and cwd for each execution', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-executor-isolation-'))
    const calls = []
    try {
      const executor = createExecutor(root, calls)
      await executor.execute({
        executionId: 'run-a',
        provider: 'zhipu',
        model: 'glm-5.2',
        prompt: 'first',
        tools: ['bash'],
        timeoutMs: 1000
      })
      await executor.execute({
        executionId: 'run-b',
        provider: 'zhipu',
        model: 'glm-5.2',
        prompt: 'second',
        tools: ['bash'],
        timeoutMs: 1000
      })

      expect(calls).toHaveLength(2)
      expect(calls[0].options.cwd).toBe(path.join(root, 'work', 'run-a'))
      expect(calls[1].options.cwd).toBe(path.join(root, 'work', 'run-b'))
      expect(calls[0].args).toContain(path.join(root, 'sessions', 'run-a'))
      expect(calls[1].args).toContain(path.join(root, 'sessions', 'run-b'))
      expect(existsSync(path.join(root, 'sessions', 'run-a'))).toBe(true)
      expect(existsSync(path.join(root, 'sessions', 'run-b'))).toBe(true)
      expect(existsSync(path.join(root, 'work', 'run-a'))).toBe(true)
      expect(existsSync(path.join(root, 'work', 'run-b'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('supports cancellation and kills the process tree', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-executor-cancel-'))
    try {
      let target
      const executor = createRealPiExecutor({
        piCliPath: path.join(root, 'pi-cli.js'),
        sessionRoot: path.join(root, 'sessions'),
        workRoot: path.join(root, 'work'),
        spawnFn: () => {
          target = fakeChild()
          return target
        },
        terminateTree: (child) => child.kill()
      })
      const controller = new AbortController()
      const promise = executor.execute({
        executionId: 'cancelled',
        prompt: 'test',
        tools: ['bash'],
        timeoutMs: 1000,
        signal: controller.signal
      })
      controller.abort()
      const result = await promise
      expect(result.status).toBeNull()
      expect(result.cancelled).toBe(true)
      expect(target.killed).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('times out and kills the process tree', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-executor-timeout-'))
    try {
      let target
      const executor = createRealPiExecutor({
        piCliPath: path.join(root, 'pi-cli.js'),
        sessionRoot: path.join(root, 'sessions'),
        workRoot: path.join(root, 'work'),
        spawnFn: () => {
          target = fakeChild()
          return target
        },
        terminateTree: (child) => child.kill(),
        timeoutPollMs: 1
      })
      const result = await executor.execute({
        executionId: 'timeout',
        prompt: 'test',
        tools: ['bash'],
        timeoutMs: 1
      })
      expect(result.status).toBeNull()
      expect(result.timedOut).toBe(true)
      expect(target.killed).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts only the safe bash demonstration command', () => {
    expect(
      validateRealPiSafety({
        tools: ['bash'],
        prompt: '请调用 bash 工具执行 echo "ok"，然后用一句话回答结果。'
      })
    ).toEqual({ ok: true })
    expect(
      validateRealPiSafety({
        tools: ['bash'],
        prompt: '请调用 bash 工具执行 echo ok'
      })
    ).toEqual({ ok: true })
  })

  it('rejects dangerous shell commands and plaintext API keys', () => {
    expect(
      validateRealPiSafety({ tools: ['bash'], prompt: '请执行 rm -rf C:\\' })
    ).toEqual({ ok: false, reason: 'prompt contains a command outside the bash safety allowlist' })
    expect(validateRealPiSafety({ tools: ['read_file'], prompt: 'hello' })).toEqual({
      ok: false,
      reason: 'real Pi executor tools are restricted to: bash'
    })
    expect(
      validateRealPiSafety({ tools: ['bash'], prompt: 'hello', apiKey: 'sk-secret' })
    ).toEqual({ ok: false, reason: 'plaintext API keys are not accepted' })
  })
})
