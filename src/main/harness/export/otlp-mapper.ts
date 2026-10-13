import { createHash } from 'node:crypto'
import type { HarnessEvent } from '@shared/types/harness'

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string | null
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, string | number | boolean | null>
}

type OpenSpan = {
  span: OtlpSpan
  kind: string
}

/**
 * Pure function: maps an ordered (redacted) HarnessEvent sequence to OTLP spans.
 * A local stack merges paired started/completed events so end timestamps,
 * parent/child relations and merged attributes are computable from the
 * sequence alone. No external state, no side effects.
 */
export function eventsToSpans(events: HarnessEvent[], runId = 'run'): OtlpSpan[] {
  const traceId = stableId(runId, 'trace')
  const spans: OtlpSpan[] = []
  const stack: OpenSpan[] = []
  let counter = 0

  const open = (
    kind: string,
    name: string,
    timestamp: number,
    attributes: Record<string, string | number | boolean | null> = {}
  ): void => {
    const spanId = stableId(runId, `span-${counter++}`)
    const span: OtlpSpan = {
      traceId,
      spanId,
      parentSpanId: stack.length > 0 ? stack.at(-1)!.span.spanId : null,
      name,
      startTimeUnixNano: String(timestamp * 1_000_000),
      endTimeUnixNano: null,
      status: 'unset',
      attributes: { ...attributes }
    }
    stack.push({ span, kind })
    spans.push(span)
  }

  const close = (
    kind: string,
    timestamp: number,
    status: 'ok' | 'error' | 'unset',
    attributes: Record<string, string | number | boolean | null> = {}
  ): void => {
    const idx = [...stack].reverse().findIndex((s) => s.kind === kind)
    if (idx < 0) return
    const target = stack[stack.length - 1 - idx]
    stack.splice(stack.length - 1 - idx, 1)
    target.span.endTimeUnixNano = String(timestamp * 1_000_000)
    target.span.status = status
    target.span.attributes = { ...target.span.attributes, ...attributes }
  }

  for (const event of events) {
    switch (event.type) {
      case 'message.started':
        open('model', 'model turn', event.timestamp)
        break
      case 'message.completed':
        close('model', event.timestamp, 'ok', {
          model: event.model ?? null,
          provider: event.provider ?? null,
          totalTokens: event.usage?.total ?? null
        })
        break
      case 'tool.started':
        open('tool', event.toolName, event.timestamp, { toolCallId: event.toolCallId ?? null })
        break
      case 'tool.completed':
        close('tool', event.timestamp, event.isError ? 'error' : 'ok', {
          toolCallId: event.toolCallId ?? null,
          isError: event.isError ?? false
        })
        break
      case 'compaction.started':
        open('compaction', 'compaction', event.timestamp, { automatic: event.automatic })
        break
      case 'compaction.completed':
        close('compaction', event.timestamp, event.aborted === true ? 'error' : 'ok', {
          aborted: event.aborted ?? false
        })
        break
      default:
        break
    }
  }

  // An unterminated trailing span gets a synthetic end (last event timestamp).
  if (stack.length > 0) {
    const end = events.at(-1)?.timestamp ?? Date.now()
    for (const openSpan of stack) {
      openSpan.span.endTimeUnixNano = String(end * 1_000_000)
      openSpan.span.status = openSpan.span.status === 'error' ? 'error' : 'unset'
    }
  }
  return spans
}

function stableId(base: string, label: string): string {
  return createHash('sha256').update(`${base}:${label}`).digest('hex').slice(0, 32)
}