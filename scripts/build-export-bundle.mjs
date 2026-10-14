#!/usr/bin/env node
/**
 * build-export-bundle.mjs — bundle the real HarnessEventExporter (TS) into a
 * plain ESM file so real-eval-runner.mjs (plain JS) can call the actual
 * exporter class end-to-end instead of reimplementing it.
 *
 * Output: harness-obs-output/real/bundle/exporter.mjs (ignored dir, never committed).
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const esbuild = require(path.join(ROOT, 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild'))

const entry = path.join(ROOT, 'src', 'main', 'harness', 'export', 'harness-event-exporter.ts')
const outDir = path.join(ROOT, 'harness-obs-output', 'real', 'bundle')
mkdirSync(outDir, { recursive: true })

async function main() {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: path.join(outDir, 'exporter.mjs'),
    external: ['consola'],
    alias: { '@shared': path.join(ROOT, 'src', 'shared') },
    logLevel: 'warning'
  })
  console.log(`bundle written: ${path.join(outDir, 'exporter.mjs')} (warnings=${result.warnings.length})`)
}

main().catch((err) => { console.error(err); process.exit(1) })