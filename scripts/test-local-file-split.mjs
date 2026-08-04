// Quick unit test for chat local-file path split (mirrors useChatBubbles)

const LOCAL_REF_RE =
  /!{0,3}\[([^\]]*)\]\((app:\/\/local-file\/open\?path=[^)\s]+|file:\/\/[^)\s]+|[A-Za-z]:[\\/][^)\s]+|\/[^)\s]+)(?:\s+"[^"]*")?\)|MEDIA:((?:[A-Za-z]:[\\/][^\s<>"'`\]]+|\/[^\s<>"'`\]]+))|(?<![\w/:[\]])([A-Za-z]:[\\/][^\s<>"'`\]]+)/gi

function normalizeToFsPath(href) {
  if (!href) return null
  let raw = href.trim().replace(/^<|>$/g, '')
  if (!raw || raw.startsWith('http://') || raw.startsWith('https://')) return null
  raw = raw.replace(/^MEDIA:/i, '').trim()
  if (raw.startsWith('app://local-file')) {
    try {
      const u = new URL(raw)
      const p = u.searchParams.get('path')
      return p ? decodeURIComponent(p) : null
    } catch {
      return null
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(raw)) return raw
  if (raw.startsWith('/')) return raw
  return null
}

function split(content) {
  const segs = []
  let last = 0
  const re = new RegExp(LOCAL_REF_RE.source, LOCAL_REF_RE.flags)
  let m
  while ((m = re.exec(content)) !== null) {
    const candidate = (m[2] || m[3] || m[4] || '').trim()
    const fsPath =
      normalizeToFsPath(candidate) ||
      (/^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('/') ? candidate : null)
    if (!fsPath) continue
    if (m.index > last) segs.push({ kind: 'md', text: content.slice(last, m.index) })
    segs.push({ kind: 'file', fsPath })
    last = m.index + m[0].length
  }
  if (last < content.length) segs.push({ kind: 'md', text: content.slice(last) })
  return segs
}

const samples = [
  '已生成\nMEDIA:C:\\Users\\bunny\\.openclaw\\workspace\\xiaohongshu-auto-poster.html\nMEDIA:C:\\Users\\bunny\\.openclaw\\media\\a.png',
  '源文件仍在：C:\\Users\\bunny\\.openclaw\\workspace\\xiaohongshu-auto-poster.html',
  `!![a.png](app://local-file/open?path=${encodeURIComponent('C:\\Users\\bunny\\.openclaw\\media\\a.png')})`,
  '![a.png](C:/Users/bunny/.openclaw/media/a.png)',
  '[poster.html](C:/Users/bunny/.openclaw/workspace/xiaohongshu-auto-poster.html)',
  '普通文本，没有路径',
]

let failed = 0
for (const s of samples) {
  const segs = split(s)
  console.log('---')
  console.log('IN:', JSON.stringify(s))
  console.log(
    'OUT:',
    segs.map((x) => (x.kind === 'file' ? `FILE:${x.fsPath}` : `MD:${JSON.stringify(x.text)}`))
  )
  for (const seg of segs) {
    if (seg.kind === 'file') {
      if (seg.fsPath.includes('bunny.openclaw') && !seg.fsPath.includes('bunny\\.openclaw') && !seg.fsPath.includes('bunny/.openclaw')) {
        // path must keep separator before .openclaw
        if (!/bunny[\\/]\.openclaw/.test(seg.fsPath)) {
          console.error('BAD PATH (missing separator):', seg.fsPath)
          failed++
        }
      }
      if (!/bunny[\\/]\.openclaw/.test(seg.fsPath) && seg.fsPath.includes('openclaw')) {
        console.error('BAD PATH:', seg.fsPath)
        failed++
      }
    }
    if (seg.kind === 'md' && /MEDIA:|!\[/.test(seg.text) && /[A-Za-z]:[\\/]/.test(seg.text)) {
      console.error('LEAKED path into md:', seg.text)
      failed++
    }
  }
}

if (failed) {
  console.error(`\nFAILED checks: ${failed}`)
  process.exit(1)
}
console.log('\nOK')
