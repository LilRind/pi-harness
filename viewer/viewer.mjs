const drop = document.getElementById('drop')
const treeBody = document.getElementById('treeBody')
const summary = document.getElementById('summary')

drop.addEventListener('click', () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.jsonl,.json'
  input.onchange = () => input.files?.[0] && load(input.files[0])
  input.click()
})
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag') })
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag') })
drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) load(f) })

async function load(file) {
  const text = await file.text()
  const records = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const events = records.filter((r) => r.event).map((r) => ({ ...r.event, _enriched: r.enriched }))
  const footer = records.find((r) => r.footer)?.footer
  renderTree(events)
  renderSummary(events, footer)
}

function renderTree(events) {
  treeBody.innerHTML = ''
  const stack = []
  const byId = new Map()
  let seq = 0
  const nodeFor = (kind, name, t) => {
    const id = `n${seq++}`
    const parent = stack.length ? stack[stack.length - 1].id : null
    const n = { id, kind, name, t, parent, error: false, children: [] }
    byId.set(id, n)
    if (parent) byId.get(parent).children.push(n)
    return n
  }
  const roots = []
  for (const ev of events) {
    if (ev.type === 'message.started') { const n = nodeFor('model', 'model turn', ev.timestamp); roots.push(n); stack.push(n) }
    else if (ev.type === 'message.completed') { const n = stack.pop(); if (n) { n.end = ev.timestamp; n.tokens = ev.usage?.total ?? null } }
    else if (ev.type === 'tool.started') { const n = nodeFor('tool', ev.toolName ?? 'tool', ev.timestamp); roots.push(...(stack.length ? [] : [n])); stack.push(n) }
    else if (ev.type === 'tool.completed') { const n = stack.pop(); if (n) { n.end = ev.timestamp; if (ev.isError) n.error = true } }
    else if (ev.type === 'runtime.error') { if (stack.length) stack[stack.length - 1].error = true }
  }
  for (const r of roots) treeBody.appendChild(renderNode(r, 0))
}

function renderNode(n, depth) {
  const row = document.createElement('div')
  row.className = 'row' + (depth ? ' indent' : '')
  const dur = n.t && n.end ? `${n.end - n.t}ms` : '—'
  const meta = `${n.error ? '<span class="err">error</span>' : ''} ${dur}${n.tokens != null ? ` · ${n.tokens} tokens` : ''}`
  row.innerHTML = `<div style="padding-left:${depth * 14}px"><span class="${n.error ? 'err' : 'ok'}">●</span> <b>${n.name}</b> <span class="muted">${meta}</span></div>`
  const wrap = document.createElement('div')
  wrap.appendChild(row)
  for (const c of n.children) wrap.appendChild(renderNode(c, depth + 1))
  return wrap
}

function renderSummary(events, footer) {
  const tokens = events.reduce((s, e) => s + (e.usage?.total ?? 0), 0)
  const tools = events.filter((e) => e.type === 'tool.completed').length
  const errs = events.filter((e) => e.type === 'tool.completed' && e.isError).length
  const msgs = events.filter((e) => e.type === 'message.completed').length
  const maxToken = Math.max(1, ...events.filter((e) => e.usage?.total).map((e) => e.usage.total))
  const rows = [
    ['runId', footer?.runId ?? '—'],
    ['状态', footer?.status ?? '—'],
    ['事件数', String(footer?.eventCount ?? events.length)],
    ['明细 token', String(tokens)],
    ['耗时', footer?.durationMs != null ? `${footer.durationMs}ms` : '—'],
    ['工具调用 / 失败', `${tools} / ${errs}`],
    ['assistant 消息', String(msgs)]
  ]
  summary.innerHTML =
    '<ul style="list-style:none;margin:0;padding:0">' +
    rows.map(([k, v]) => `<li class="row"><span class="muted" style="min-width:110px">${k}</span><b>${v}</b></li>`).join('') +
    '</ul>' +
    '<h2>消息 token 趋势（附赠）</h2>' +
    '<div style="display:flex;align-items:flex-end;gap:4px;height:60px">' +
    events.filter((e) => e.type === 'message.completed' && e.usage?.total).map((e) => `<div class="bar" style="flex:1;height:${Math.max(4, (e.usage.total / maxToken) * 56)}px" title="${e.usage.total} tokens"></div>`).join('') +
    '</div>'
}
