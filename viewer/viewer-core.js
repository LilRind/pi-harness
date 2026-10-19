(function (root) {
  function parseJsonl(text) {
    const records = []
    let malformedLines = 0
    for (const line of String(text ?? '').split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        malformedLines++
      }
    }
    const events = records
      .filter((record) => record.event)
      .map((record) => ({ ...record.event, _enriched: record.enriched }))
    const footer = records.find((record) => record.footer)?.footer ?? null
    return { records, malformedLines, events, footer }
  }

  function buildSpanTree(events) {
    const stack = []
    const byId = new Map()
    let seq = 0
    const nodeFor = (kind, name, t) => {
      const id = `n${seq++}`
      const parent = stack.length ? stack[stack.length - 1] : null
      const node = { id, kind, name, t, parent, error: false, children: [] }
      byId.set(id, node)
      if (parent) byId.get(parent.id).children.push(node)
      return node
    }
    const roots = []
    for (const event of events) {
      if (event.type === 'message.started') {
        const node = nodeFor('model', 'model turn', event.timestamp)
        roots.push(node)
        stack.push(node)
      } else if (event.type === 'message.completed') {
        const node = stack.pop()
        if (node) {
          node.end = event.timestamp
          node.tokens = usageTotal(event)
        }
      } else if (event.type === 'tool.started') {
        const node = nodeFor('tool', event.toolName ?? 'tool', event.timestamp)
        if (!stack.length) roots.push(node)
        stack.push(node)
      } else if (event.type === 'tool.completed') {
        const node = stack.pop()
        if (node) {
          node.end = event.timestamp
          if (event.isError) node.error = true
        }
      } else if (event.type === 'runtime.error') {
        if (stack.length) stack[stack.length - 1].error = true
      }
    }
    return roots
  }

  function usageTotal(event) {
    const usage = event.usage
    if (!usage) return 0
    return (
      usage.total ||
      (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) ||
      0
    )
  }

  function summarizeEvents(events, footer) {
    const tokens = events.reduce((sum, event) => sum + usageTotal(event), 0)
    const tools = events.filter((event) => event.type === 'tool.completed').length
    const errors = events.filter(
      (event) => event.type === 'tool.completed' && event.isError
    ).length
    const messages = events.filter((event) => event.type === 'message.completed').length
    const rows = [
      ['runId', footer?.runId ?? '—'],
      ['状态', footer?.status ?? '—'],
      ['事件数', String(footer?.eventCount ?? events.length)],
      ['明细 token', String(tokens)],
      ['耗时', footer?.durationMs != null ? `${footer.durationMs}ms` : '—'],
      ['工具调用 / 失败', `${tools} / ${errors}`],
      ['assistant 消息', String(messages)]
    ]
    const maxToken = Math.max(
      1,
      ...events.filter((event) => usageTotal(event) > 0).map(usageTotal)
    )
    const bars = events
      .filter((event) => event.type === 'message.completed' && usageTotal(event) > 0)
      .map((event) => ({
        value: usageTotal(event),
        title: `${usageTotal(event)} tokens`
      }))
    return { tokens, tools, errors, messages, rows, maxToken, bars }
  }

  root.ViewerCore = { parseJsonl, buildSpanTree, summarizeEvents }
})(globalThis)
