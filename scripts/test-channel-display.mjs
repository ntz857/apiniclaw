// Smoke test for channel display sanitization (mirrors channel-display.ts)

function extractReplyQuote(text) {
  if (!text) return { body: text }
  let t = text.replace(/\r\n/g, '\n')
  let replyTo
  const reQuoted = /^\s*\[Replying to:\s*"((?:\\.|[^"\\])*)"\s*\]\s*(?:\r?\n)*/i
  const m = reQuoted.exec(t)
  if (m) {
    replyTo = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim()
    t = t.slice(m[0].length)
  }
  return { replyTo, body: t }
}

function sanitize(raw) {
  if (!raw) return { text: raw }
  const hadMessageId = /\[message_id:/i.test(raw)
  let t = raw.replace(/\r\n/g, '\n')
  t = t.replace(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s*/, '')
  t = t
    .split('\n')
    .filter((l) => !/^\s*\[message_id:\s*[^\]]+\]\s*$/i.test(l) && !/^\s*\[System:\s/i.test(l))
    .join('\n')
  t = t.replace(/^(ou_[a-zA-Z0-9]+|on_[a-zA-Z0-9]+|oc_[a-zA-Z0-9]+):\s*/m, '')
  if (hadMessageId) t = t.replace(/^(?!\s*\[)([^\n:\[\]]{1,64}):\s+/, '')
  t = t.replace(/<at\s+[^>]*?(?:user_id|open_id)=["'][^"']*["'][^>]*>([\s\S]*?)<\/at>/gi, '@$1')
  const q = extractReplyQuote(t)
  t = q.body.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '').trim()
  return { text: t, replyTo: q.replyTo }
}

function resolveLocalPathForImageRef(ref, openclawHome) {
  const alt = ref.alt?.trim()
  if (alt && openclawHome) {
    const sep = openclawHome.includes('\\') ? '\\' : '/'
    return `${openclawHome.replace(/[\\/]+$/, '')}${sep}media${sep}outbound${sep}${alt}`
  }
  return null
}

const samples = [
  {
    in: `[message_id: om_x100b6830b76390b0b4a4c1142d80b51]
ou_cb095752f694d3ef1101b23e8991fe46: 你好

[System: The content may include mention tags in the form <at user_id="...">name</at>. Treat these as real mentions of Feishu entities (users or bots).]
[System: If user_id is "ou_0a4a7235e6d2e809ee3d18d4a8d5c949", that mention refers to you.]`,
    out: '你好',
  },
  {
    in: `[message_id: om_x]
ou_xxx: 帮我生成一个小红书的海报 内容是 自动化生成海报

[System: foo]`,
    out: '帮我生成一个小红书的海报 内容是 自动化生成海报',
  },
  {
    in: `请看 <at user_id="ou_1">张三</at> 的回复`,
    out: '请看 @张三 的回复',
  },
  {
    in: '普通消息不用改',
    out: '普通消息不用改',
  },
  {
    in: `[message_id: om_reply]
ou_abc: [Replying to: "上一句海报怎么样"]

再改一下标题

[System: mention hint]`,
    out: '再改一下标题',
    replyTo: '上一句海报怎么样',
  },
]

let failed = 0
for (const s of samples) {
  const got = sanitize(s.in)
  if (got.text !== s.out) {
    console.error('FAIL text\n expected:', JSON.stringify(s.out), '\n got:', JSON.stringify(got.text))
    failed++
  } else if (s.replyTo !== undefined && got.replyTo !== s.replyTo) {
    console.error('FAIL replyTo\n expected:', JSON.stringify(s.replyTo), '\n got:', JSON.stringify(got.replyTo))
    failed++
  } else {
    console.log('OK:', JSON.stringify(got))
  }
}

const local = resolveLocalPathForImageRef(
  { alt: 'xiaohongshu-auto-poster---be548250-26e0-4ae6-9068-6cbfa2010742.png' },
  'C:\\Users\\bunny\\.openclaw'
)
const expected =
  'C:\\Users\\bunny\\.openclaw\\media\\outbound\\xiaohongshu-auto-poster---be548250-26e0-4ae6-9068-6cbfa2010742.png'
if (local !== expected) {
  console.error('path fail', local)
  failed++
} else {
  console.log('OK path')
}

// Feishu document inbound sample
const docIn = `[Feishu ou_cb095752f694d3ef1101b23e8991fe46 Tue 2026-08-04 01:15:28 GMT+8] [message_id: om_x100b6838842acca4b36840466921de5]
ou_cb095752f694d3ef1101b23e8991fe46: <media:document> (AI证书考试培训市场调研_report.md)

<file name="AI证书考试培训市场调研_report---9f8f06d7-62c7-4d21-841d-a6047b4834cd.md" mime="text/markdown">

<<<EXTERNAL_UNTRUSTED_CONTENT id="cf63c9a4d560a76f">>>
Source: External
---
# AI方向证书类考试及培训市场调研报告

很长正文不应出现在 UI
`

// inline strip mirror for media
function stripMedia(text) {
  const hints = []
  let t = text
  t = t.replace(/<media:(image|document|audio|video|sticker|file)>(?:\s*\(([^)]*)\))?/gi, (_m, kind, label) => {
    hints.push({ kind, fileName: (label || '').trim() || 'file' })
    return ''
  })
  t = t.replace(/<file\s+name="([^"]*)"(?:\s+mime="([^"]*)")?\s*>/gi, (_m, name) => {
    hints.push({ kind: 'document', fileName: name })
    return ''
  })
  t = t.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT\b[^>]*>>>[\s\S]*?(?:<<<END_EXTERNAL_UNTRUSTED_CONTENT\b[^>]*>>>|$)/gi, '')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  return { text: t, hints }
}

const afterSan = sanitize(docIn)
const media = stripMedia(afterSan.text)
if (media.text.includes('EXTERNAL_UNTRUSTED') || media.text.includes('很长正文')) {
  console.error('FAIL media strip left body', JSON.stringify(media.text.slice(0, 200)))
  failed++
} else if (!media.hints.some((h) => h.fileName.includes('AI证书') || h.fileName.includes('report'))) {
  // sanitize already may have left media tags if we only run sanitize without stripMedia on raw
  const media2 = stripMedia(docIn)
  if (!media2.hints.length) {
    console.error('FAIL no media hints', media2)
    failed++
  } else {
    console.log('OK media hints', media2.hints)
  }
} else {
  console.log('OK media stripped', media.hints)
}

// Combined pipeline like production
function fullUserSanitize(raw) {
  const s = sanitize(raw)
  const m = stripMedia(s.text)
  return { text: m.text, replyTo: s.replyTo, hints: m.hints }
}
const full = fullUserSanitize(docIn)
if (full.text.includes('证书类考试') || full.text.includes('<media:')) {
  console.error('FAIL full pipeline', JSON.stringify(full))
  failed++
} else {
  console.log('OK full pipeline', full)
}

if (failed) process.exit(1)
console.log('ALL OK')
