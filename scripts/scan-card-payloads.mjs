import fs from 'fs'
import path from 'path'

const roots = [
  'C:/Users/bunny/.openclaw/agents/fake/sessions',
  'C:/Users/bunny/.openclaw/agents/main/sessions',
]
const hits = []
const re = /presentation|interactive|"blocks"|button|schema.?2\.0|tag.?markdown/i

for (const dir of roots) {
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl') || f.includes('trajectory')) continue
    const full = path.join(dir, f)
    const raw = fs.readFileSync(full, 'utf8')
    if (!re.test(raw)) continue
    for (const line of raw.split(/\n/)) {
      if (!re.test(line)) continue
      try {
        const o = JSON.parse(line)
        const msg = o.message || o
        const c = msg.content ?? o.content
        const s = typeof c === 'string' ? c : JSON.stringify(c)
        const fullMsg = JSON.stringify(msg)
        if (re.test(s) || re.test(fullMsg.slice(0, 3000))) {
          hits.push({
            f,
            role: msg.role,
            keys: Object.keys(msg || {}),
            preview: s.slice(0, 700),
            msgHead: fullMsg.slice(0, 400),
          })
        }
      } catch {
        /* skip */
      }
      if (hits.length >= 25) break
    }
  }
}
console.log('count', hits.length)
console.log(JSON.stringify(hits.slice(0, 15), null, 2))
