// Minimal smoke for presentation extraction (mirror of presentation-display)

function asRecord(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}
function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
function normalizeButton(raw) {
  const r = asRecord(raw)
  if (!r) return
  const label = str(r.label) || str(r.text)
  const value = str(r.value)
  const url = str(r.url)
  if (!label || (!value && !url && !r.action)) return
  return { label, value, url, action: r.action }
}
function normalizeBlock(raw) {
  const r = asRecord(raw)
  if (!r) return
  const type = str(r.type)?.toLowerCase()
  if (type === 'text' || type === 'context') {
    const text = str(r.text)
    return text ? { type, text } : undefined
  }
  if (type === 'divider') return { type: 'divider' }
  if (type === 'buttons') {
    const buttons = (r.buttons || []).map(normalizeButton).filter(Boolean)
    return buttons.length ? { type: 'buttons', buttons } : undefined
  }
  return undefined
}
function normalizeMessagePresentation(raw, source) {
  const r = asRecord(raw)
  if (!r) return
  const blocks = Array.isArray(r.blocks) ? r.blocks.map(normalizeBlock).filter(Boolean) : []
  const title = str(r.title)
  if (!title && !blocks.length) return
  return { title, blocks, source }
}
function extractFromToolArgs(name, args) {
  let parsed = args
  if (typeof args === 'string') parsed = JSON.parse(args)
  const out = []
  if (parsed?.presentation) out.push(normalizeMessagePresentation(parsed.presentation, name))
  if (parsed?.interactive) out.push(normalizeMessagePresentation(parsed.interactive, name))
  return out.filter(Boolean)
}

const sample = {
  action: 'send',
  channel: 'feishu',
  text: '请选择',
  presentation: {
    title: '确认操作',
    tone: 'warning',
    blocks: [
      { type: 'text', text: '是否继续发布？' },
      { type: 'divider' },
      {
        type: 'buttons',
        buttons: [
          { label: '确认', style: 'primary', action: { type: 'command', command: '/yes' } },
          { label: '文档', url: 'https://example.com' },
          { label: '渠道回调', action: { type: 'callback', value: 'opaque' } },
        ],
      },
    ],
  },
}

const cards = extractFromToolArgs('message', sample)
if (cards.length !== 1) throw new Error('expected 1 card')
if (cards[0].title !== '确认操作') throw new Error('title')
if (cards[0].blocks.length !== 3) throw new Error('blocks')
console.log('OK', JSON.stringify(cards[0], null, 2))
