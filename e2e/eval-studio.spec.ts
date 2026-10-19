import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const port = 47611

let server: ChildProcess | null = null
let studioUrl = ''
let dataRoot = ''

async function startStudio(): Promise<void> {
  dataRoot = mkdtempSync(path.join(tmpdir(), 'eval-studio-e2e-'))
  server = spawn(process.execPath, ['out/eval-studio/server.mjs'], {
    env: {
      ...process.env,
      EVAL_STUDIO_PORT: String(port),
      EVAL_STUDIO_DATA_ROOT: dataRoot
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  studioUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('eval studio failed to start')), 15_000)
    const handleOutput = (chunk: Buffer) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\\\s]+/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[0])
      }
    }
    server?.stdout?.on('data', handleOutput)
    server?.stderr?.on('data', handleOutput)
    server?.once('error', reject)
  })
}

async function runSampleSuite(page: Page): Promise<void> {
  await page.locator('[data-tab-test="tab-run"]').click()
  await page.locator('[data-test="create-run"] button[type="submit"]').click()
  await page.waitForSelector('[data-test="start-run"]')
  await page.click('[data-test="start-run"]')
  await page.waitForFunction(
    () => document.querySelector('[data-test="run-status"]')?.textContent?.includes('completed'),
    undefined,
    { timeout: 20_000 }
  )
}

test.beforeAll(async () => {
  await startStudio()
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.once('close', () => resolve())
    server.kill()
  })
  if (dataRoot) rmSync(dataRoot, { recursive: true, force: true })
})

test('eval studio completes deterministic runs, compares history, and opens trace', async ({ page }) => {
  await page.goto(studioUrl)
  await page.click('[data-test="suite-option"]')
  await page.waitForSelector('[data-test="fixture-row"]')
  await expect(page.locator('[data-test="fixture-row"]')).toHaveCount(12)

  await runSampleSuite(page)
  await expect(page.locator('[data-test="run-event"]')).not.toHaveCount(0)

  await runSampleSuite(page)

  await page.locator('[data-tab-test="tab-history"]').click()
  await page.waitForSelector('[data-test="history-row"]')
  const historyRows = page.locator('[data-test="history-row"]')
  await expect(historyRows).toHaveCount(2, { timeout: 20_000 })

  const selections = page.locator('[data-test="compare-select"]')
  await selections.nth(0).check()
  await selections.nth(1).check()
  await page.locator('[data-tab-test="tab-compare"]').click()
  await page.waitForSelector('[data-test="compare-metric-row"]')
  await expect(page.locator('[data-test="compare-metric-row"]')).toHaveCount(4)

  await page.locator('[data-tab-test="tab-history"]').click()
  await page.locator('[data-test="open-history-trace"]').first().click()
  await page.waitForSelector('[data-test="trace-summary"]')
  await expect(page.locator('[data-test="trace-tree-node"]')).not.toHaveCount(0)
  await expect(page.locator('[data-test="trace-raw"]')).toContainText('message.completed')
})

test('eval studio completes a controlled real Pi session', async ({ page }) => {
  test.skip(!process.env.EVAL_STUDIO_REAL_E2E, 'set EVAL_STUDIO_REAL_E2E=1 to spend model quota')
  test.setTimeout(210_000)
  await page.goto(studioUrl)
  await page.locator('[data-tab-test="tab-run"]').click()
  await page.locator('[data-test="mode-select"]').selectOption('ad-hoc-real')
  await page.locator('[data-test="provider-input"]').fill('zhipu')
  await page.locator('[data-test="model-input"]').fill('glm-5.2')
  await page.locator('[data-test="prompt-input"]').fill(
    '请调用 bash 工具执行 echo "ok"，然后用一句话回答结果。回答中必须包含 sk-REAL_SMOKE_SECRET_47。'
  )
  await page.locator('[data-test="tools-input"]').fill('bash')
  await page.locator('[data-test="create-run"] button[type="submit"]').click()
  await page.waitForSelector('[data-test="start-run"]')
  await page.click('[data-test="start-run"]')
  await page.waitForFunction(
    () => document.querySelector('[data-test="run-status"]')?.textContent?.includes('completed'),
    undefined,
    { timeout: 180_000 }
  )

  await page.locator('[data-tab-test="tab-history"]').click()
  await page.waitForSelector('[data-test="history-row"]')
  await expect(page.locator('[data-test="history-row"]')).toHaveCount(3)
  await expect(page.locator('[data-test="history-row"]').first()).toContainText('ad-hoc-real')

  const selections = page.locator('[data-test="compare-select"]')
  await selections.nth(0).check()
  await selections.nth(2).check()
  await page.locator('[data-tab-test="tab-compare"]').click()
  await page.waitForSelector('[data-test="compare-metric-row"]')

  await page.locator('[data-tab-test="tab-history"]').click()
  await page.locator('[data-test="open-history-trace"]').first().click()
  await page.waitForSelector('[data-test="trace-raw"]')
  await expect(page.locator('[data-test="trace-raw"]')).toContainText('toolArgs')
  await expect(page.locator('[data-test="trace-raw"]')).not.toContainText('sk-REAL_SMOKE_SECRET_47')
})
