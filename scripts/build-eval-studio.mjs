#!/usr/bin/env node
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vite/package.json'))
const esbuild = viteRequire('esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await esbuild.build({
  entryPoints: [path.join(root, 'src/main/harness/eval-studio/server-launcher.ts')],
  outfile: path.join(root, 'out/eval-studio/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias: {
    '@shared': path.join(root, 'src/shared')
  },
  logLevel: 'info'
})
