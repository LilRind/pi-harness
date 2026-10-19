import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { historyRecordSchema } from '@shared/schemas/eval-studio'
import type { HistoryRecord } from '@shared/types/eval-studio'

interface AtomicWriteOptions {
  beforeRename?: (temporaryFile: string) => void
}

interface HistoryIndexEntry {
  id: string
  createdAt: number
  suiteId: string
  mode: string
  status: string
}

export interface HistoryQuery {
  ids?: string[]
  suiteIds?: string[]
  modes?: string[]
  statuses?: string[]
  from?: number
  to?: number
}

export function atomicWriteJson(
  file: string,
  value: unknown,
  options: AtomicWriteOptions = {}
): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const temporaryFile = `${file}.${process.pid}-${Date.now()}-${randomUUID()}.tmp`
  writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  options.beforeRename?.(temporaryFile)
  renameSync(temporaryFile, file)
}

function safeRunId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function resolveWithinRoot(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error('artifact path must be relative')
  }
  const rootPath = path.resolve(root)
  const resolvedPath = path.resolve(rootPath, relativePath)
  if (resolvedPath !== rootPath && !resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('path escapes eval studio root')
  }
  return resolvedPath
}

export class EvalHistoryStore {
  private readonly indexPath: string

  constructor(private readonly root: string) {
    this.indexPath = path.join(root, 'index.json')
  }

  save(run: HistoryRecord): void {
    const validated = historyRecordSchema.parse(run)
    const recordPath = this.recordPath(validated.id)
    atomicWriteJson(recordPath, validated)

    const entries = this.readIndex().filter((entry) => entry.id !== validated.id)
    entries.push({
      id: validated.id,
      createdAt: validated.createdAt,
      suiteId: validated.config.suiteId,
      mode: validated.config.mode,
      status: validated.status
    })
    entries.sort((left, right) => right.createdAt - left.createdAt)
    atomicWriteJson(this.indexPath, { schemaVersion: 1, entries })
  }

  load(): HistoryRecord[] {
    return this.readIndex().map((entry) => {
      const raw = JSON.parse(readFileSync(this.recordPath(entry.id), 'utf8'))
      return historyRecordSchema.parse(raw)
    })
  }

  query(filter: HistoryQuery = {}): HistoryRecord[] {
    return this.load().filter((record) => {
      if (filter.ids && !filter.ids.includes(record.id)) return false
      if (filter.suiteIds && !filter.suiteIds.includes(record.config.suiteId)) return false
      if (filter.modes && !filter.modes.includes(record.config.mode)) return false
      if (filter.statuses && !filter.statuses.includes(record.status)) return false
      if (filter.from != null && record.createdAt < filter.from) return false
      if (filter.to != null && record.createdAt > filter.to) return false
      return true
    })
  }

  get(id: string): HistoryRecord | null {
    const file = this.recordPath(id)
    if (!existsSync(file)) return null
    return historyRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  }

  private recordPath(id: string): string {
    return path.join(this.root, 'runs', safeRunId(id), 'record.json')
  }

  private readIndex(): HistoryIndexEntry[] {
    if (!existsSync(this.indexPath)) return []
    const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8')) as {
      entries?: HistoryIndexEntry[]
    }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  }
}
