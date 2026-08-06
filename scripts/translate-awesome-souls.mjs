/**
 * 压缩原版 SOUL → 一次短翻译 → 高质量中文人设（断点续跑）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const allPath = path.join(root, '.cache/awesome-souls/all.json')
const outPath = path.join(root, '.cache/awesome-souls/zh-all.json')
const progressDir = path.join(root, '.cache/awesome-souls/zh-progress')

// Prefer DeepSeek official (Reasonix global .env); fall back to OpenAI-compatible env.
function loadReasonixDeepseekKey() {
  try {
    const envPath = path.join(process.env.APPDATA || '', 'reasonix', '.env')
    if (!fs.existsSync(envPath)) return ''
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((l) => /^\s*DEEPSEEK_API_KEY=/.test(l))
    if (!line) return ''
    return line
      .replace(/^\s*DEEPSEEK_API_KEY=/, '')
      .trim()
      .replace(/^["']|["']$/g, '')
  } catch {
    return ''
  }
}

const API_KEY =
  process.env.DEEPSEEK_API_KEY ||
  process.env.OPENAI_API_KEY ||
  loadReasonixDeepseekKey() ||
  ''
const BASE_URL = (
  process.env.DEEPSEEK_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  (API_KEY ? 'https://api.deepseek.com/v1' : '')
).replace(/\/$/, '')
// deepseek-chat: stable structured output. v4-flash/pro burn tokens on reasoning for this task.
const MODEL = process.env.TRANSLATE_MODEL || 'deepseek-chat'
const CONCURRENCY = Number(process.env.CONCURRENCY || 6)
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 120000)

if (!API_KEY || !BASE_URL) {
  console.error('Need DEEPSEEK_API_KEY from reasonix .env (or OPENAI_API_KEY + OPENAI_BASE_URL)')
  process.exit(1)
}

fs.mkdirSync(progressDir, { recursive: true })
const items = JSON.parse(fs.readFileSync(allPath, 'utf8'))
console.log(`Total=${items.length} model=${MODEL} concurrency=${CONCURRENCY}`)

function isGood(o) {
  if (!o?.soulZh) return false
  const soul = o.soulZh
  const zh = (soul.match(/[\u4e00-\u9fff]/g) || []).length
  const en = (soul.match(/[A-Za-z]{3,}/g) || []).length
  if (soul.length < 400 || zh < 250 || zh / (zh + en + 1) < 0.65) return false
  // 统一结构（避免旧版 Identity/职责 混排）
  const need = [
    /##\s*身份/,
    /##\s*人设/,
    /##\s*能力/,
    /##\s*(工作原则|规则)/,
    /##\s*工作语言/,
  ]
  if (need.some((re) => !re.test(soul))) return false
  // 禁止英文标题块 / 强制英文输出
  if (/##\s*(Identity|Personality|Capabilities|Rules|Responsibilities)\b/i.test(soul)) return false
  if (/始终以英文|必须使用英文|始终用英文|Always (output|respond) in English/i.test(soul)) return false
  // agents 至少要有可执行规则
  if ((o.agentsZh || '').length < 40) return false
  return true
}

function loadProgress(id) {
  const p = path.join(progressDir, `${id}.json`)
  if (!fs.existsSync(p)) return null
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'))
    return isGood(o) ? o : null
  } catch {
    return null
  }
}

function saveProgress(id, obj) {
  fs.writeFileSync(path.join(progressDir, `${id}.json`), JSON.stringify(obj, null, 2), 'utf8')
}

function extractKv(text, key) {
  const m = text.match(new RegExp(`${key}\\s*[:=]\\s*["']?([^"'\\n]+)`, 'i'))
  return m ? m[1].trim().replace(/["']/g, '') : ''
}

function sectionBody(md, titleRe) {
  const re = new RegExp(`##\\s*${titleRe}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')
  const m = md.match(re)
  return m ? m[1].trim() : ''
}

function bullets(text, max = 12) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''))
    .filter(Boolean)
    .slice(0, max)
}

function paras(text, max = 3) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p && !/^[-*•]/.test(p) && p.length > 20)
    .slice(0, max)
}

function compactSource(item) {
  const md = item.soul.replace(/\r\n/g, '\n')
  const name =
    extractKv(md, 'name') ||
    (md.match(/^#\s*SOUL\.md\s*[—–-]\s*(.+)$/m) || [])[1]?.trim() ||
    item.id
  const role = extractKv(md, 'role') || item.id.replace(/-/g, ' ')

  const personality =
    sectionBody(md, 'Personality') ||
    sectionBody(md, 'Core Identity') ||
    sectionBody(md, 'Tone') ||
    ''
  const caps =
    sectionBody(md, 'Capabilities') ||
    sectionBody(md, 'Responsibilities') ||
    sectionBody(md, 'Skills') ||
    ''
  const rules =
    sectionBody(md, 'Rules') ||
    sectionBody(md, 'Behavioral Guidelines') ||
    sectionBody(md, 'Output Format') ||
    ''
  const integ =
    sectionBody(md, 'Integrations?') ||
    sectionBody(md, 'Integration Notes') ||
    sectionBody(md, 'Tools') ||
    ''

  const lines = []
  lines.push(`NAME: ${name}`)
  lines.push(`ROLE: ${role}`)
  lines.push(`CATEGORY: ${item.category}`)
  const p = paras(personality, 2)
  if (p.length) {
    lines.push('PERSONALITY:')
    p.forEach((x) => lines.push(`- ${x.slice(0, 280)}`))
  }
  const cb = bullets(caps, 10)
  if (cb.length) {
    lines.push('CAPABILITIES:')
    cb.forEach((x) => lines.push(`- ${x.slice(0, 160)}`))
  } else {
    paras(caps, 2).forEach((x) => lines.push(`- ${x.slice(0, 200)}`))
  }
  const rb = bullets(rules, 10)
  if (rb.length) {
    lines.push('RULES:')
    rb.forEach((x) => lines.push(`- ${x.slice(0, 160)}`))
  }
  const ib = bullets(integ, 8)
  if (ib.length) {
    lines.push('INTEGRATIONS:')
    ib.forEach((x) => lines.push(`- ${x.slice(0, 140)}`))
  }
  return { name, role, compact: lines.join('\n').slice(0, 2200) }
}

async function chat(messages) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 2500,
        messages,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`)
    const data = await res.json()
    const msg = data.choices?.[0]?.message || {}
    // deepseek-chat: content; some models may put text elsewhere
    const c = (msg.content || msg.reasoning_content || '').trim()
    if (!c) throw new Error(`empty finish=${data.choices?.[0]?.finish_reason || '?'}`)
    return c
  } finally {
    clearTimeout(timer)
  }
}

/**
 * DeepSeek often emits opening tags as <<<SOUL>> (2 >) while END stays <<<END_SOUL>>> (3 >).
 * Accept 2–3 closing angle brackets on both sides.
 */
function parseBlocks(text) {
  const get = (name) => {
    const re = new RegExp(
      `<<<${name}>{2,3}\\s*([\\s\\S]*?)\\s*<<<END_${name}>{2,3}`,
      'i',
    )
    const m = text.match(re)
    if (m) return m[1].trim()
    return ''
  }
  let soulZh = get('SOUL')
  // Fallback: take markdown from first ## 身份 / ## 人设 through next END-like marker
  if (!soulZh) {
    const fb = text.match(
      /(?:##\s*身份[^\n]*\n[\s\S]*?)(?=\n<<<END_|\n<<<AGENTS|\n<<<TOOLS|$)/i,
    )
    if (fb) soulZh = fb[0].trim()
  }
  return {
    nameZh: get('NAME'),
    taglineZh: get('TAGLINE'),
    themeZh: get('THEME'),
    emoji: get('EMOJI') || '🤖',
    soulZh,
    agentsZh: get('AGENTS'),
    toolsZh: get('TOOLS'),
  }
}

async function translateOne(item) {
  const cached = loadProgress(item.id)
  if (cached) return cached
  const { name, role, compact } = compactSource(item)

  const system = `You translate agent role specs into complete Simplified Chinese SOUL docs for production use.
Rules:
- Output ONLY the delimiter blocks requested. Use EXACT tags with three angle brackets, e.g. <<<SOUL>>> and <<<END_SOUL>>>.
- Chinese only (keep API/CLI/product names in English).
- Must include sections: ## 身份, ## 人设, ## 能力, ## 工作原则, ## 工作语言 (默认简体中文), ## 示例.
- Keep ALL capabilities and rules from the source list (do not drop bullets).
- Medical/legal/finance: add disclaimer.
- SOUL body target 700-1400 Chinese characters. Do not truncate mid-section.`

  const user = `Source points for agent ${item.id}:

${compact}

Output format (copy tags exactly, three > on every tag):

<<<NAME>>>
short Chinese name
<<<END_NAME>>>
<<<TAGLINE>>>
one-line Chinese capability
<<<END_TAGLINE>>>
<<<THEME>>>
Chinese vibe phrase
<<<END_THEME>>>
<<<EMOJI>>>
one emoji
<<<END_EMOJI>>>
<<<SOUL>>>
full Chinese SOUL with ## headings (身份/人设/能力/工作原则/工作语言/示例)
<<<END_SOUL>>>
<<<AGENTS>>>
Chinese working rules (markdown)
<<<END_AGENTS>>>
<<<TOOLS>>>
Chinese tools notes (markdown)
<<<END_TOOLS>>>`

  let lastErr
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const raw = await chat([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ])
      const parsed = parseBlocks(raw)
      const emoji = (parsed.emoji.match(/\p{Extended_Pictographic}/u) || ['🤖'])[0]
      const obj = {
        id: item.id,
        category: item.category,
        nameZh: parsed.nameZh || name,
        taglineZh: parsed.taglineZh || role,
        themeZh: parsed.themeZh || '专业助手',
        emoji,
        soulZh: parsed.soulZh,
        agentsZh:
          parsed.agentsZh ||
          '## 工作方式\n- 先澄清目标与约束\n- 输出可执行清单\n\n## 输出\n结论 + 要点 + 下一步',
        toolsZh: parsed.toolsZh || '### 备注\n- 按需补充路径与密钥\n- 对外发布前确认',
        heartbeatZh: '',
      }
      if (!isGood(obj)) throw new Error(`quality len=${obj.soulZh?.length || 0}`)
      saveProgress(item.id, obj)
      return obj
    } catch (err) {
      lastErr = err
      console.warn(`  retry ${attempt} ${item.id}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  throw lastErr
}

async function mapPool(list, limit, fn) {
  let i = 0
  async function worker() {
    while (i < list.length) {
      const idx = i++
      await fn(list[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()))
}

const pending = items.filter((it) => !loadProgress(it.id))
console.log(`done=${items.length - pending.length} pending=${pending.length}`)

let done = 0
const failed = []
await mapPool(pending, CONCURRENCY, async (item) => {
  try {
    const zh = await translateOne(item)
    done++
    console.log(
      `progress ${items.length - pending.length + done}/${items.length} (+${item.id}) len=${zh.soulZh.length}`
    )
  } catch (e) {
    failed.push(item.id)
    console.error(`FAIL ${item.id}: ${e.message}`)
  }
})

console.log(`first pass failed: ${failed.length}`)
for (const id of failed) {
  const item = items.find((x) => x.id === id)
  if (!item) continue
  try {
    const zh = await translateOne(item)
    console.log(`recovered ${id} ${zh.soulZh.length}`)
  } catch (e) {
    console.error(`still fail ${id}: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 2000))
}

const ordered = []
let missing = 0
for (const it of items) {
  const p = loadProgress(it.id)
  if (p) ordered.push(p)
  else missing++
}
fs.writeFileSync(outPath, JSON.stringify(ordered, null, 2), 'utf8')
const avg = Math.round(
  ordered.reduce((a, b) => a + b.soulZh.length, 0) / Math.max(1, ordered.length)
)
console.log(`Wrote ${ordered.length}/${items.length} missing=${missing} avgSoul=${avg}`)
if (missing) process.exitCode = 2
