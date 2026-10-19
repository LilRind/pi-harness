const drop = document.getElementById('drop')
const treeBody = document.getElementById('treeBody')
const summary = document.getElementById('summary')
const { parseJsonl, buildSpanTree, summarizeEvents } = window.ViewerCore

// 点击选择文件（回退方式）
drop.addEventListener('click', () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.jsonl,.json'
  input.onchange = () => input.files?.[0] && load(input.files[0])
  input.click()
})

// 全页拖拽：拖到页面任意位置都能加载，并阻止浏览器默认“打开文件”行为
let dragDepth = 0
document.addEventListener('dragenter', (event) => {
  event.preventDefault()
  dragDepth++
  document.body.classList.add('drag-over')
})
document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('dragleave', (event) => {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) document.body.classList.remove('drag-over')
})
document.addEventListener('drop', (event) => {
  event.preventDefault()
  dragDepth = 0
  document.body.classList.remove('drag-over')
  const file = event.dataTransfer?.files?.[0]
  if (file) load(file)
})

async function load(file) {
  try {
    const text = await file.text()
    const parsed = parseJsonl(text)
    if (parsed.events.length === 0) {
      treeBody.innerHTML = `<p class="muted">没有找到可识别的事件行。文件共 ${parsed.records.length} 行、${parsed.malformedLines} 行解析失败，需包含带 <code>event</code> 字段的 JSONL 导出。</p>`
      summary.innerHTML = '<p class="muted">没有可显示的摘要。</p>'
      return
    }
    renderTree(parsed.events)
    renderSummary(parsed.events, parsed.footer)
    drop.innerHTML = `已加载 <b>${file.name}</b>（${parsed.events.length} 个事件）— 可继续点击或拖入其他文件`
  } catch (err) {
    treeBody.innerHTML = `<p class="err">读取文件失败：${err?.message ?? err}</p>`
  }
}

function renderTree(events) {
  treeBody.innerHTML = ''
  for (const root of buildSpanTree(events)) treeBody.appendChild(renderNode(root, 0))
}

function renderNode(node, depth) {
  const row = document.createElement('div')
  row.className = 'row' + (depth ? ' indent' : '')
  const duration = node.t && node.end ? `${node.end - node.t}ms` : '—'
  const meta = `${node.error ? '<span class="err">error</span>' : ''} ${duration}${
    node.tokens != null ? ` · ${node.tokens} tokens` : ''
  }`
  row.innerHTML = `<div style="padding-left:${depth * 14}px"><span class="${
    node.error ? 'err' : 'ok'
  }">●</span> <b>${node.name}</b> <span class="muted">${meta}</span></div>`
  const wrap = document.createElement('div')
  wrap.appendChild(row)
  for (const child of node.children) wrap.appendChild(renderNode(child, depth + 1))
  return wrap
}

function renderSummary(events, footer) {
  const result = summarizeEvents(events, footer)
  summary.innerHTML =
    '<ul style="list-style:none;margin:0;padding:0">' +
    result.rows
      .map(([key, value]) => `<li class="row"><span class="muted" style="min-width:110px">${key}</span><b>${value}</b></li>`)
      .join('') +
    '</ul>' +
    '<h2>消息 token 趋势（附赠）</h2>' +
    '<div style="display:flex;align-items:flex-end;gap:4px;height:60px">' +
    result.bars
      .map(
        (bar) =>
          `<div class="bar" style="flex:1;height:${Math.max(4, (bar.value / result.maxToken) * 56)}px" title="${bar.title}"></div>`
      )
      .join('') +
    '</div>'
}
