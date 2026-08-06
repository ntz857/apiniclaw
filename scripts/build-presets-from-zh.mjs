/**
 * 用 .cache/awesome-souls/zh-all.json（或 zh-progress 合并）重建：
 * - src/renderer/src/pages/agents/agent-presets.data.ts
 * - 合并 zh-CN / en i18n 的 presets.items
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const zhAllPath = path.join(root, '.cache/awesome-souls/zh-all.json')
const progressDir = path.join(root, '.cache/awesome-souls/zh-progress')
const presetsPath = path.join(root, 'src/renderer/src/pages/agents/agent-presets.data.ts')
const zhI18nPath = path.join(root, 'src/renderer/src/i18n/locales/zh-CN.json')
const enI18nPath = path.join(root, 'src/renderer/src/i18n/locales/en.json')

function loadZhCatalog() {
  if (fs.existsSync(zhAllPath)) {
    return JSON.parse(fs.readFileSync(zhAllPath, 'utf8'))
  }
  // fallback: merge progress
  const files = fs.readdirSync(progressDir).filter((f) => f.endsWith('.json'))
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(progressDir, f), 'utf8')))
}

const CAT_MAP = {
  productivity: 'work',
  business: 'work',
  personal: 'work',
  freelance: 'work',
  customer: 'work',
  'customer-success': 'work',
  automation: 'work',
  voice: 'work',
  creative: 'create',
  marketing: 'marketing',
  moltbook: 'marketing',
  development: 'dev',
  data: 'dev',
  saas: 'dev',
  devops: 'ops',
  security: 'ops',
  compliance: 'ops',
  finance: 'industry',
  education: 'industry',
  healthcare: 'industry',
  hr: 'industry',
  legal: 'industry',
  ecommerce: 'industry',
  'real-estate': 'industry',
  'supply-chain': 'industry',
  ollama: 'dev',
}

const SKILL_BY_CAT = {
  work: `['notion','session-logs','himalaya']`,
  create: `['blogwatcher','meme-maker','notion','obsidian']`,
  marketing: `['blogwatcher','browser-use','session-logs','clawhub']`,
  dev: `['coding-agent','github','gh-issues','session-logs']`,
  ops: `['github','session-logs','healthcheck','coding-agent']`,
  industry: `['session-logs','notion','oracle','nano-pdf']`,
}

// 部分角色覆盖更贴合的 skills
const SKILL_OVERRIDE = {
  'code-reviewer': `['coding-agent','github','gh-issues','session-logs']`,
  'bug-hunter': `['coding-agent','github','python-debugpy','node-inspect-debugger','session-logs']`,
  'test-writer': `['coding-agent','github','session-logs']`,
  coder: `['coding-agent','github','gh-issues','session-logs','clawhub']`,
  github: `['github','gh-issues','session-logs']`,
  'github-pr-reviewer': `['github','gh-issues','coding-agent','session-logs']`,
  'github-issue-triager': `['github','gh-issues','session-logs']`,
  'inbox-zero': `['himalaya','session-logs','notion']`,
  'meeting-notes': `['notion','obsidian','session-logs','himalaya']`,
  'seo-writer': `['blogwatcher','browser-use','nano-pdf','session-logs']`,
  'seo-assistant': `['blogwatcher','browser-use','nano-pdf','session-logs']`,
  newsletter: `['blogwatcher','himalaya','notion','session-logs']`,
  'brand-monitor': `['blogwatcher','browser-use','session-logs','oracle']`,
  'competitor-watch': `['blogwatcher','browser-use','session-logs','oracle']`,
  devops: `['github','session-logs','healthcheck','coding-agent','node-connect']`,
  'incident-responder': `['github','session-logs','healthcheck','coding-agent']`,
  'travel-planner': `['goplaces','weather','browser-use','session-logs']`,
  'sql-assistant': `['coding-agent','oracle','session-logs','github']`,
}

function camel(id) {
  return id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
}

function esc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
}

function mapCategory(c) {
  return CAT_MAP[c] || 'industry'
}

function skillsFor(id, cat) {
  if (SKILL_OVERRIDE[id]) return SKILL_OVERRIDE[id]
  // prefix match
  for (const [k, v] of Object.entries(SKILL_OVERRIDE)) {
    if (id.includes(k) || k.includes(id)) return v
  }
  return SKILL_BY_CAT[cat] || SKILL_BY_CAT.industry
}

const catalog = loadZhCatalog().filter((x) => x && x.id && x.soulZh)
console.log('catalog size', catalog.length)

// dedupe by id
const seen = new Set()
const unique = []
for (const item of catalog) {
  if (seen.has(item.id)) continue
  seen.add(item.id)
  unique.push(item)
}

const header = `/**
 * 智能体预设模板库
 *
 * 角色来自社区整理（完整中文本地化）：
 *   https://github.com/mergisi/awesome-openclaw-agents
 * SOUL/AGENTS 按原版深度翻译，非摘要骨架。
 * tools 默认 full；skills 为推荐预装列表。
 *
 * 本文件由 scripts/build-presets-from-zh.mjs 生成，请勿手改大段内容。
 * 重新生成：node scripts/build-presets-from-zh.mjs
 */

export type AgentToolsProfile = 'minimal' | 'coding' | 'messaging' | 'full'

export type AgentPresetCategory =
  | 'work'
  | 'create'
  | 'marketing'
  | 'dev'
  | 'ops'
  | 'industry'

export type AgentWorkspaceFiles = {
  'SOUL.md': string
  'IDENTITY.md': string
  'AGENTS.md': string
  'USER.md': string
  'TOOLS.md': string
  'HEARTBEAT.md': string
}

export interface AgentPreset {
  key: string
  idPrefix: string
  emoji: string
  toolsProfile: 'full'
  category: AgentPresetCategory
  i18nKey: string
  skills: string[]
  buildFiles: (ctx: { name: string; emoji: string; theme: string }) => AgentWorkspaceFiles
}

function baseHeartbeat(extra = ''): string {
  return \`<!-- 仅注释时可跳过定时 heartbeat；需要巡检时再写任务 -->

# Heartbeat

\${extra || '# 需要周期性检查时，在下方添加任务。'}
\`
}

function baseUserMd(): string {
  return \`# USER.md - 关于你的主人

_在使用中逐步完善。_

- **称呼：**
- **时区：** Asia/Shanghai (GMT+8)
- **偏好：**
- **备注：**

## 背景

_(项目、目标、禁忌词、沟通习惯……)_
\`
}

function identityMd(ctx: { name: string; emoji: string; theme: string }): string {
  return \`# IDENTITY.md - 我是谁

- **Name:** \${ctx.name}
- **Creature:** AI 助手
- **Vibe:** \${ctx.theme}
- **Emoji:** \${ctx.emoji}
- **Avatar:**

---

这是身份起点，可在对话中与用户一起演进。
\`
}

type PackInput = {
  key: string
  idPrefix: string
  emoji: string
  category: AgentPresetCategory
  i18nKey: string
  skills: string[]
  soul: string
  agents: string
  tools?: string
  heartbeat?: string
}

function pack(p: PackInput): AgentPreset {
  return {
    key: p.key,
    idPrefix: p.idPrefix,
    emoji: p.emoji,
    toolsProfile: 'full',
    category: p.category,
    i18nKey: p.i18nKey,
    skills: p.skills,
    buildFiles: (ctx) => ({
      'SOUL.md': \`# SOUL.md - \${ctx.name}

\${p.soul.trim()}
\`,
      'IDENTITY.md': identityMd(ctx),
      'AGENTS.md': \`# AGENTS.md - 工作区规则（\${ctx.name}）

\${p.agents.trim()}
\`,
      'USER.md': baseUserMd(),
      'TOOLS.md': \`# TOOLS.md - \${ctx.name}

\${(p.tools || '### 备注\\n- 按需补充本机路径、账号别名、团队规范链接等。').trim()}
\`,
      'HEARTBEAT.md': baseHeartbeat(p.heartbeat),
    }),
  }
}

// ============================================================================
// 模板列表（awesome-openclaw-agents 全量中文本地化）
// ============================================================================

export const AGENT_PRESETS: AgentPreset[] = [
`

const packs = unique
  .map((item) => {
    const cat = mapCategory(item.category)
    const i18nKey = camel(item.id)
    const idPrefix = item.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 28)
    const emoji = item.emoji || '🤖'
    const skills = skillsFor(item.id, cat)
    const soul = esc(item.soulZh)
    const agents = esc(
      item.agentsZh ||
        '## 工作方式\n- 先澄清目标与约束\n- 输出可执行、可验证\n\n## 输出\n结构化要点 + 下一步'
    )
    const tools = esc(item.toolsZh || '### 备注\n- 按需补充本机路径、账号别名、团队规范链接等。')
    const hb = item.heartbeatZh ? esc(item.heartbeatZh) : ''
    const hbPart = hb ? `,\n    heartbeat: \`${hb}\`` : ''
    return `  pack({
    key: '${item.id}',
    idPrefix: '${idPrefix}',
    emoji: '${emoji}',
    category: '${cat}',
    i18nKey: '${i18nKey}',
    skills: ${skills},
    soul: \`${soul}\`,
    agents: \`${agents}\`,
    tools: \`${tools}\`${hbPart},
  }),`
  })
  .join('\n')

const footer = `
]

export function allocateAgentId(idPrefix: string, existingIds: string[]): string {
  const used = new Set(existingIds.map((id) => id.trim().toLowerCase()))
  const base = idPrefix.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'agent'
  if (!used.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = \`\${base}-\${i}\`
    if (!used.has(candidate)) return candidate
  }
  return \`\${base}-\${Date.now().toString(36)}\`
}

export function sanitizeAgentId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
`

fs.writeFileSync(presetsPath, header + packs + footer, 'utf8')
console.log('wrote presets', unique.length, presetsPath)

// i18n
function patchI18n(file, isZh) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  const items = {}
  for (const it of unique) {
    const key = camel(it.id)
    if (isZh) {
      items[key] = {
        name: it.nameZh || it.id,
        tagline: it.taglineZh || '',
        theme: it.themeZh || '专业助手',
      }
    } else {
      const enName = it.id
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
      items[key] = {
        name: enName,
        tagline: it.taglineZh || enName, // fallback; EN ideally from original role
        theme: it.themeZh || 'Professional assistant',
      }
    }
  }
  // keep category labels
  const prev = j.agents?.presets?.items || {}
  j.agents = j.agents || {}
  j.agents.presets = j.agents.presets || {}
  // preserve non-item keys structure
  const cat = j.agents.presets.category || {
    work: isZh ? '工作协作' : 'Work & Collaboration',
    create: isZh ? '内容创作' : 'Creative Writing',
    marketing: isZh ? '营销增长' : 'Marketing & Growth',
    dev: isZh ? '研发工程' : 'Engineering',
    ops: isZh ? '运维安全' : 'Ops & Security',
    industry: isZh ? '行业专业' : 'Industry Specialists',
  }
  j.agents.presets.items = items
  j.agents.presets.category = cat
  // ensure UI strings exist
  const ui = j.agents.presets
  if (!ui.title) {
    Object.assign(ui, isZh
      ? {
          title: '选择智能体模板',
          subtitle: '选模板 → 可改名字 → 一键生成完整人设与技能配置（工具默认 full）。',
          oneClick: '一键添加',
          alreadyHave: '已有同类',
          customTitle: '空白自定义',
          customDesc: '自己填写名称、模型与工具权限',
          hint: '模板会初始化 SOUL / IDENTITY / AGENTS 等文件，并预开相关 Skills；之后仍可改。',
          addFromTemplate: '从模板添加',
          createSuccess: '已添加智能体「{{name}}」',
          createSuccessWithSkills: '已添加「{{name}}」，并安装 {{count}} 个技能到该智能体工作区',
          createPartialSkills: '已添加「{{name}}」：安装 {{installed}} 个技能；未找到：{{missing}}',
          confirmTitle: '添加「{{name}}」',
          confirmAdd: '确认添加',
          displayNameLabel: '显示名称',
          idLabel: '智能体 ID',
          idHint: '仅小写字母、数字和连字符；冲突时会自动改名',
          idRequired: '请填写智能体 ID',
          idInvalid: 'ID 只能包含小写字母、数字和连字符',
        }
      : {
          title: 'Choose an agent template',
          subtitle: 'Pick a template → rename if you want → create with full workspace files (tools: full).',
          oneClick: 'Add',
          alreadyHave: 'Similar exists',
          customTitle: 'Blank custom',
          customDesc: 'Fill in name, model and tool profile yourself',
          hint: 'Templates seed SOUL / IDENTITY / AGENTS and recommended Skills; you can edit later.',
          addFromTemplate: 'Add from template',
          createSuccess: 'Agent "{{name}}" added',
          createSuccessWithSkills: 'Added "{{name}}" with {{count}} skills installed to its workspace',
          createPartialSkills: 'Added "{{name}}": installed {{installed}} skills; missing: {{missing}}',
          confirmTitle: 'Add "{{name}}"',
          confirmAdd: 'Confirm',
          displayNameLabel: 'Display name',
          idLabel: 'Agent ID',
          idHint: 'Lowercase letters, digits and hyphens only; auto-renamed on conflict',
          idRequired: 'Agent ID is required',
          idInvalid: 'ID may only contain lowercase letters, digits and hyphens',
        })
  }
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n', 'utf8')
  console.log('patched i18n', file, 'items', Object.keys(items).length)
}

// For English taglines: re-read original all.json for role names
const allEn = JSON.parse(fs.readFileSync(path.join(root, '.cache/awesome-souls/all.json'), 'utf8'))
const enMeta = new Map()
for (const it of allEn) {
  const m = it.soul.match(/role:\s*["']?([^\n"']+)/i) || it.soul.match(/##\s*Identity[\s\S]*?role[:\s]+["']?([^\n"']+)/i)
  const name = it.soul.match(/name:\s*["']?([^\n"']+)/i)
  enMeta.set(it.id, {
    role: m?.[1]?.trim() || '',
    name: name?.[1]?.trim() || '',
  })
}

// patch zh
patchI18n(zhI18nPath, true)

// patch en with better taglines
const jEn = JSON.parse(fs.readFileSync(enI18nPath, 'utf8'))
const itemsEn = {}
for (const it of unique) {
  const key = camel(it.id)
  const meta = enMeta.get(it.id) || {}
  const enName =
    meta.name && meta.name.length > 1 && meta.name.length < 40
      ? meta.name
      : it.id
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
  itemsEn[key] = {
    name: enName,
    tagline: meta.role || it.taglineZh || enName,
    theme: it.themeZh || 'Professional assistant',
  }
}
jEn.agents = jEn.agents || {}
jEn.agents.presets = jEn.agents.presets || {}
jEn.agents.presets.items = itemsEn
if (!jEn.agents.presets.category) {
  jEn.agents.presets.category = {
    work: 'Work & Collaboration',
    create: 'Creative Writing',
    marketing: 'Marketing & Growth',
    dev: 'Engineering',
    ops: 'Ops & Security',
    industry: 'Industry Specialists',
  }
}
fs.writeFileSync(enI18nPath, JSON.stringify(jEn, null, 2) + '\n', 'utf8')
console.log('patched en items', Object.keys(itemsEn).length)
console.log('done')
