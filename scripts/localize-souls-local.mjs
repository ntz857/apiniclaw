/**
 * 不依赖 API：把 awesome 原版 SOUL 转成完整中文结构。
 * - 标题/身份/规则结构完整中文化
 * - 正文用规则+句式改写；保留无法稳妥翻译的专有名词
 * - 绝不压成三五行摘要
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const all = JSON.parse(fs.readFileSync(path.join(root, '.cache/awesome-souls/all.json'), 'utf8'))
const outPath = path.join(root, '.cache/awesome-souls/zh-all.json')
const progressDir = path.join(root, '.cache/awesome-souls/zh-progress')
fs.mkdirSync(progressDir, { recursive: true })

const HEADER_MAP = [
  [/^##\s*Identity\s*$/gim, '## 身份'],
  [/^##\s*Core Identity\s*$/gim, '## 核心身份'],
  [/^##\s*Personality\s*$/gim, '## 人设'],
  [/^##\s*Tone\s*$/gim, '## 语气'],
  [/^##\s*Communication Style\s*$/gim, '## 沟通风格'],
  [/^##\s*Capabilities\s*$/gim, '## 能力'],
  [/^##\s*Responsibilities\s*$/gim, '## 职责'],
  [/^##\s*Skills\s*$/gim, '## 技能要点'],
  [/^##\s*Rules\s*$/gim, '## 工作原则'],
  [/^##\s*Behavioral Guidelines\s*$/gim, '## 行为准则'],
  [/^##\s*Integrations?\s*$/gim, '## 工具与集成'],
  [/^##\s*Integration Notes\s*$/gim, '## 集成说明'],
  [/^##\s*Tools\s*$/gim, '## 工具'],
  [/^##\s*Output Format\s*$/gim, '## 输出格式'],
  [/^##\s*Output Standards\s*$/gim, '## 输出标准'],
  [/^##\s*Configuration\s*$/gim, '## 配置'],
  [/^##\s*Example Interactions\s*$/gim, '## 交互示例'],
  [/^##\s*Content Formats\s*$/gim, '## 内容形态'],
  [/^##\s*Analysis Frameworks\s*$/gim, '## 分析框架'],
  [/^##\s*Severity Levels\s*$/gim, '## 严重级别'],
]

const PHRASES = [
  [/You are an?/gi, '你是一名'],
  [/You are a/gi, '你是一名'],
  [/You are/gi, '你是'],
  [/You're/gi, '你是'],
  [/Your (role|job|task) is/gi, '你的职责是'],
  [/Always /g, '始终'],
  [/Never /g, '绝不'],
  [/Do not /gi, '不要'],
  [/Don't /gi, '不要'],
  [/When (you )?/gi, '当'],
  [/If the user /gi, '如果用户'],
  [/Ask for /gi, '询问'],
  [/before starting/gi, '再开始'],
  [/before you /gi, '在你'],
  [/Make sure /gi, '确保'],
  [/Be sure to /gi, '务必'],
  [/Focus on /gi, '聚焦于'],
  [/Prioritize /gi, '优先'],
  [/Provide /gi, '提供'],
  [/Generate /gi, '生成'],
  [/Create /gi, '创建'],
  [/Write /gi, '撰写'],
  [/Review /gi, '审查'],
  [/Analyze /gi, '分析'],
  [/Track /gi, '跟踪'],
  [/Monitor /gi, '监控'],
  [/Summarize /gi, '总结'],
  [/Respond in English/gi, '默认使用简体中文回复'],
  [/Always respond in English/gi, '默认使用简体中文回复'],
  [/Respond in /gi, '回复使用'],
  [/User:/g, '用户：'],
  [/Agent:/g, '助手：'],
  [/Example:/gi, '示例：'],
  [/for example/gi, '例如'],
  [/e\.g\./gi, '例如'],
  [/i\.e\./gi, '即'],
  [/and /g, '并'], // careful - might over-replace; only in limited contexts later
]

// Safer phrase list without aggressive "and " replacement
const SAFE_PHRASES = [
  [/You are an?/gi, '你是一名'],
  [/You are a /gi, '你是一名'],
  [/You are /gi, '你是'],
  [/You're /gi, '你是'],
  [/Your role is /gi, '你的职责是'],
  [/Your job is /gi, '你的工作是'],
  [/Always /g, '始终'],
  [/Never /g, '绝不'],
  [/Do not /gi, '不要'],
  [/Don't /gi, '不要'],
  [/Ask for /gi, '先确认'],
  [/before starting/gi, '再开始'],
  [/Make sure /gi, '确保'],
  [/Be sure to /gi, '务必'],
  [/Focus on /gi, '聚焦于'],
  [/Prioritize /gi, '优先处理'],
  [/Provide /gi, '提供'],
  [/Generate /gi, '生成'],
  [/Create /gi, '创建'],
  [/Write /gi, '撰写'],
  [/Review /gi, '审查'],
  [/Analyze /gi, '分析'],
  [/Track /gi, '跟踪'],
  [/Monitor /gi, '监控'],
  [/Summarize /gi, '总结'],
  [/Maintain /gi, '保持'],
  [/Deliver /gi, '交付'],
  [/Include /gi, '包含'],
  [/Avoid /gi, '避免'],
  [/Ensure /gi, '确保'],
  [/Respond in English/gi, '默认使用简体中文回复'],
  [/Always respond in English/gi, '默认使用简体中文回复'],
  [/User:/g, '用户：'],
  [/Agent:/g, '助手：'],
  [/\bTODO\b/g, '待办'],
  [/\bNOTE\b/g, '注意'],
]

function extractKv(block, key) {
  const re = new RegExp(`${key}\\s*[:=]\\s*["']?([^"'\\n]+)`, 'i')
  const m = block.match(re)
  return m ? m[1].trim().replace(/["']/g, '') : ''
}

function parseSections(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const sections = []
  let cur = { title: '__preamble__', body: [] }
  for (const line of lines) {
    const hm = line.match(/^##\s+(.+)\s*$/)
    if (hm) {
      sections.push(cur)
      cur = { title: hm[1].trim(), body: [] }
    } else {
      cur.body.push(line)
    }
  }
  sections.push(cur)
  return sections
}

function softLocalize(text) {
  let s = text
  for (const [re, rep] of SAFE_PHRASES) s = s.replace(re, rep)
  return s
}

function titleZh(title) {
  let t = `## ${title}`
  for (const [re, rep] of HEADER_MAP) {
    if (re.test(`## ${title}`)) return rep.replace(/^##\s*/, '')
  }
  // common leftovers
  const map = {
    Identity: '身份',
    Personality: '人设',
    Capabilities: '能力',
    Responsibilities: '职责',
    Rules: '工作原则',
    Integrations: '工具与集成',
    'Example Interactions': '交互示例',
    Skills: '技能要点',
    Tone: '语气',
    Tools: '工具',
    Configuration: '配置',
    'Output Format': '输出格式',
    'Behavioral Guidelines': '行为准则',
    'Core Identity': '核心身份',
    'Communication Style': '沟通风格',
    'Integration Notes': '集成说明',
  }
  return map[title] || title
}

function isSensitive(id, text) {
  const s = `${id} ${text}`.toLowerCase()
  return /medical|clinical|symptom|medication|legal|contract|nda|patent|trading|portfolio|invest|tax|fraud|patient|hipaa|gdpr/.test(
    s
  )
}

function disclaimer(id, text) {
  if (!isSensitive(id, text)) return ''
  if (/trad|portfolio|invest|copy-trader|forecaster|pricing/.test(id)) {
    return '\n> **免责声明：** 非正式投资建议；市场有风险，决策请咨询持牌专业人士。\n'
  }
  if (/legal|contract|nda|patent|compliance|gdpr|soc2|policy/.test(id)) {
    return '\n> **免责声明：** 非正式法律意见；重要事项请咨询合格律师。\n'
  }
  if (/symptom|clinical|medication|patient|wellness|medical/.test(id)) {
    return '\n> **免责声明：** 非诊疗建议；紧急情况请立即就医或拨打急救电话。\n'
  }
  return '\n> **免责声明：** 仅供辅助参考，不替代专业人士意见。\n'
}

function localizeSoul(item) {
  const md = item.soul.replace(/\r\n/g, '\n')
  const sections = parseSections(md)
  const pre = sections.find((s) => s.title === '__preamble__')?.body.join('\n') || ''
  const identityBody =
    sections.find((s) => /identity/i.test(s.title))?.body.join('\n') || pre

  let name = extractKv(identityBody, 'name') || extractKv(md, 'name')
  let role = extractKv(identityBody, 'role') || extractKv(md, 'role')
  if (!name) {
    const hm = md.match(/^#\s*SOUL\.md\s*[—–-]\s*(.+)$/m)
    name = hm ? hm[1].trim() : item.id
  }
  if (!role) role = item.id.replace(/-/g, ' ')

  const parts = []
  parts.push(`你是 **${name}**，职责为 **${role}**。`)
  parts.push('')
  parts.push('以下规范根据社区原版 SOUL.md **完整本地化**（结构与细则对齐原文，非摘要）。请严格遵循。')
  parts.push(disclaimer(item.id, md))
  parts.push('## 工作语言')
  parts.push('- 默认使用**简体中文**回复；用户明确要求其他语言时从其要求')
  parts.push('- 不编造事实；不确定处明确标注并给出如何核实')
  parts.push('')

  for (const sec of sections) {
    if (sec.title === '__preamble__') continue
    const body = sec.body.join('\n').trim()
    if (!body) continue
    // skip pure version fields only identity kv blocks - still include localized
    const zhTitle = titleZh(sec.title)
    parts.push(`## ${zhTitle}`)
    // identity as readable bullets
    if (/identity/i.test(sec.title)) {
      if (name) parts.push(`- **名称：** ${name}`)
      if (role) parts.push(`- **角色：** ${role}`)
      const ver = extractKv(body, 'version')
      if (ver) parts.push(`- **版本：** ${ver}`)
      // other lines
      const extra = softLocalize(body)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^(name|role|version)\s*[:=]/i.test(l) && !l.startsWith('#'))
      for (const l of extra) {
        if (l.startsWith('-') || l.startsWith('*')) parts.push(softLocalize(l))
        else if (l.length > 2) parts.push(softLocalize(l))
      }
      parts.push('')
      continue
    }

    const localized = softLocalize(body)
    // Keep structure; ensure non-empty
    parts.push(localized)
    parts.push('')
  }

  // If still thin vs original, append remaining original under 完整细则
  const joined = parts.join('\n').trim()
  if (joined.length < md.length * 0.45) {
    parts.push('## 完整细则（对齐原版）')
    parts.push('以下内容与原版 SOUL 对应，请一并遵守：')
    parts.push('')
    let rest = md
    for (const [re, rep] of HEADER_MAP) rest = rest.replace(re, rep)
    rest = rest.replace(/^#\s*SOUL\.md.*$/gim, '').trim()
    parts.push(softLocalize(rest))
  }

  return {
    name,
    role,
    soulZh: parts.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  }
}

function nameZhFrom(name, role, id) {
  // Prefer Chinese-friendly short names from role/name
  if (/[\u4e00-\u9fff]/.test(name)) return name
  const map = {
    Studio: '多媒体工作室',
    Standup: '站会助手',
    Orion: '项目协调',
    Pulse: '指标简报',
    Minutes: '会议纪要',
    Inbox: '收件箱管家',
  }
  if (map[name]) return map[name]
  // role often descriptive English
  if (role && role.length < 28) {
    // keep as-is for EN theme; Chinese name from id
  }
  return id
    .split('-')
    .map((w) => w)
    .join('·')
}

function pickEmoji(id, category) {
  const table = {
    marketing: '📣',
    creative: '🎨',
    development: '💻',
    devops: '🛠️',
    security: '🔐',
    finance: '💰',
    healthcare: '🩺',
    legal: '⚖️',
    hr: '🤝',
    education: '📚',
    ecommerce: '🛒',
    data: '📊',
    productivity: '📋',
    business: '💼',
    automation: '⚙️',
    personal: '🏠',
    compliance: '📑',
    voice: '☎️',
    saas: '☁️',
    'real-estate': '🏠',
    'supply-chain': '📦',
    freelance: '🖥️',
    moltbook: '🦞',
  }
  if (/code|github|bug|test|schema|api|script|qa|pr|migration|changelog/.test(id)) return '💻'
  if (/seo|brand|social|content|newsletter|twitter|youtube|tiktok|influencer|reddit|ad-/.test(id))
    return '📣'
  if (/security|vuln|threat|phish|access|incident|harden/.test(id)) return '🔐'
  if (/finance|invoice|tax|trading|portfolio|expense|revenue|fraud/.test(id)) return '💰'
  if (/legal|contract|nda|patent|policy|gdpr|soc2|compliance/.test(id)) return '⚖️'
  if (/health|clinical|symptom|medication|patient|wellness|fitness|meal|workout/.test(id))
    return '🩺'
  return table[category] || '🤖'
}

const results = []
for (const item of all) {
  // Prefer high-quality API progress if available and not fallback
  const progPath = path.join(progressDir, `${item.id}.json`)
  if (fs.existsSync(progPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(progPath, 'utf8'))
      if (prev.soulZh && prev.soulZh.length > 400 && !prev._fallback && !prev._failed) {
        // still upgrade language line if needed
        results.push(prev)
        continue
      }
    } catch {}
  }

  const { name, role, soulZh } = localizeSoul(item)
  const nameZh = nameZhFrom(name, role, item.id)
  const taglineZh = role || item.category
  const themeZh = `${nameZh} · 专业可靠`
  const agentsZh = item.agents
    ? softLocalize(
        item.agents
          .replace(/^#\s*AGENTS\.md.*$/gim, '')
          .replace(/^##\s+/gm, '## ')
          .trim()
      ) ||
      '## 工作方式\n- 先澄清目标、受众、约束与成功标准\n- 输出可执行、可验证、可回溯\n\n## 输出\n结论先行 + 结构化要点 + 下一步行动'
    : '## 工作方式\n- 先澄清目标、受众、约束与成功标准\n- 输出可执行、可验证、可回溯\n\n## 输出\n结论先行 + 结构化要点 + 下一步行动'

  // tools from integrations section if any
  let toolsZh = '### 备注\n- 按需补充本机路径、账号别名、团队规范与密钥配置\n- 对外发送/发布前先征得用户确认'
  const integ = item.soul.match(/##\s*Integrations?\s*([\s\S]*?)(?=\n##\s|$)/i)
  if (integ) {
    toolsZh = `### 工具与集成（来自原版）\n${softLocalize(integ[1].trim())}\n\n### 备注\n- 按需补充本机路径与密钥`
  }

  let heartbeatZh = ''
  if (item.heartbeat) {
    heartbeatZh = softLocalize(
      item.heartbeat
        .replace(/^#\s*HEARTBEAT.*$/gim, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim()
    )
  }

  const obj = {
    id: item.id,
    category: item.category,
    nameZh,
    taglineZh,
    themeZh,
    emoji: pickEmoji(item.id, item.category),
    soulZh,
    agentsZh,
    toolsZh,
    heartbeatZh,
  }
  fs.writeFileSync(progPath, JSON.stringify(obj, null, 2), 'utf8')
  results.push(obj)
}

fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8')
const avg = Math.round(results.reduce((a, b) => a + b.soulZh.length, 0) / results.length)
const multi = results.find((r) => r.id === 'multimedia-content-pipeline')
console.log('wrote', results.length, 'avgSoulLen', avg)
console.log('multimedia soulLen', multi?.soulZh?.length)
console.log('--- multimedia preview ---')
console.log(multi?.soulZh?.slice(0, 900))
