/**
 * 为指定 Agent 安装（复制）技能到其工作区 skills/
 *
 * OpenClaw 优先级：workspace/skills > managed > bundled
 * 模板创建时把需要的 skill 落到 agent 私有 workspace，实现「按智能体单独安装」。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { OPENCLAW_HOME } from '../constants'
import { resolveOpenclawLaunch } from './openclaw-resolve'
import { getAgents } from '../config'

const log = createLogger('agent-skills-install')

export interface AgentSkillsInstallResult {
  agentId: string
  workspaceSkillsDir: string
  /** 已安装/已存在于 workspace 的 skill */
  installed: string[]
  /** 本地找不到源的 skill（未装到 clawhub 等） */
  missing: string[]
  /** 本次新复制的 skill */
  copied: string[]
}

function resolveAgentWorkspaceDir(agentId: string): string {
  const normalized = agentId.trim().toLowerCase()
  const agents = getAgents()
  const fromConfig = agents.find((a) => a.id?.trim().toLowerCase() === normalized)?.workspace
  if (fromConfig && typeof fromConfig === 'string' && fromConfig.trim()) {
    return fromConfig.replace(/^~(?=\/|\\|$)/, require('os').homedir())
  }
  if (normalized === 'main') {
    return join(OPENCLAW_HOME, 'workspace')
  }
  return join(OPENCLAW_HOME, `workspace-${normalized}`)
}

function skillHasMd(dir: string): boolean {
  return existsSync(join(dir, 'SKILL.md'))
}

/** 在目录下按 skill 名查找（目录名或 SKILL.md name 字段） */
function findSkillDirInRoot(root: string, skillName: string): string | null {
  if (!root || !existsSync(root)) return null
  const direct = join(root, skillName)
  if (skillHasMd(direct)) return direct

  // 扫描一层：frontmatter name 匹配
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const base = join(root, entry.name)
      const md = join(base, 'SKILL.md')
      if (!existsSync(md)) continue
      if (entry.name === skillName) return base
      try {
        const content = readFileSync(md, 'utf-8')
        const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        if (!m) continue
        const nameLine = m[1].match(/^name:\s*["']?([^\r\n"']+)/m)
        if (nameLine?.[1]?.trim() === skillName) return base
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null
}

function listSkillSearchRoots(): string[] {
  const roots: string[] = []
  try {
    const launch = resolveOpenclawLaunch()
    // openclaw 包内 bundled skills
    roots.push(join(launch.cwd, 'skills'))
    // 部分发行版 skills 在 extensions 旁
    roots.push(join(launch.cwd, 'extensions'))
  } catch {
    // ignore
  }
  // 全局 managed
  roots.push(join(OPENCLAW_HOME, 'skills'))
  // 插件附带技能（可能是 junction）
  roots.push(join(OPENCLAW_HOME, 'plugin-skills'))
  // 默认主 workspace 已装技能（可再复制到其他 agent）
  roots.push(join(OPENCLAW_HOME, 'workspace', 'skills'))
  // 其他 agent 工作区 skills（互拷）
  try {
    for (const entry of readdirSync(OPENCLAW_HOME, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith('workspace')) continue
      roots.push(join(OPENCLAW_HOME, entry.name, 'skills'))
    }
  } catch {
    // ignore
  }
  // agents/<id>/ 下可能也有 skills
  try {
    const agentsRoot = join(OPENCLAW_HOME, 'agents')
    if (existsSync(agentsRoot)) {
      for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        roots.push(join(agentsRoot, entry.name, 'skills'))
        roots.push(join(agentsRoot, entry.name, 'agent', 'skills'))
      }
    }
  } catch {
    // ignore
  }
  return [...new Set(roots)]
}

function copySkillDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  // Node 16+ cpSync
  cpSync(src, dest, { recursive: true, force: true })
}

/**
 * 将 skillNames 安装到 agent 的 workspace/skills/<name>/
 * 优先从 bundled / managed / 主 workspace 复制；找不到记入 missing。
 */
export function installSkillsForAgent(
  agentId: string,
  skillNames: string[]
): AgentSkillsInstallResult {
  const id = agentId.trim()
  if (!id) throw new Error('agentId 不能为空')

  const workspace = resolveAgentWorkspaceDir(id)
  const destRoot = join(workspace, 'skills')
  mkdirSync(destRoot, { recursive: true })

  const searchRoots = listSkillSearchRoots()
  const installed: string[] = []
  const missing: string[] = []
  const copied: string[] = []

  const unique = [...new Set(skillNames.map((s) => s.trim()).filter(Boolean))]

  for (const name of unique) {
    // 已存在于该 agent workspace
    const dest = join(destRoot, name)
    if (skillHasMd(dest)) {
      installed.push(name)
      continue
    }

    let src: string | null = null
    for (const root of searchRoots) {
      src = findSkillDirInRoot(root, name)
      if (src) break
    }

    if (!src) {
      missing.push(name)
      log.warn(`skill "${name}" not found in local roots for agent ${id}`)
      continue
    }

    try {
      // 若 dest 存在但不完整，先覆盖
      if (existsSync(dest)) {
        // force copy
      }
      copySkillDir(src, dest)
      if (skillHasMd(dest)) {
        installed.push(name)
        copied.push(name)
        log.info(`installed skill "${name}" → ${dest} (from ${src})`)
      } else {
        missing.push(name)
        log.warn(`skill copy incomplete: ${name}`)
      }
    } catch (err) {
      missing.push(name)
      log.warn(`failed to copy skill "${name}":`, err)
    }
  }

  return {
    agentId: id,
    workspaceSkillsDir: destRoot,
    installed,
    missing,
    copied,
  }
}

/** 列出本地可安装（bundled/managed 可见）的 skill 名 */
export function listLocalSkillNames(): string[] {
  const names = new Set<string>()
  for (const root of listSkillSearchRoots()) {
    if (!existsSync(root)) continue
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const base = join(root, entry.name)
        if (!skillHasMd(base)) continue
        names.add(entry.name)
        try {
          const content = readFileSync(join(base, 'SKILL.md'), 'utf-8')
          const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
          const nameLine = m?.[1].match(/^name:\s*["']?([^\r\n"']+)/m)
          if (nameLine?.[1]?.trim()) names.add(nameLine[1].trim())
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  return [...names].sort()
}
