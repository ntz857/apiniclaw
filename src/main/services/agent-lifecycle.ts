/**
 * Agent 生命周期服务
 *
 * 目标：
 * - 创建/删除优先复用 OpenClaw 原生 CLI 行为（配置校验 + 清理语义）
 * - 作为 renderer 端 WS 调用失败时的兜底路径
 */

import { homedir } from 'os'
import { join } from 'path'
import { createLogger } from '../logger'
import { OPENCLAW_HOME } from '../constants'
import { getAgents, readConfig, saveAgent, type AgentConfig } from '../config'

const log = createLogger('agent-lifecycle')

interface CliAddResult {
  agentId: string
  name?: string
  workspace?: string
}

interface CliDeleteResult {
  agentId: string
}

function normalizeAgentId(input: string): string {
  return input.trim().toLowerCase()
}

function resolveDefaultAgentIdFromConfig(): string {
  const cfg = readConfig()
  const list = cfg.agents?.list ?? []
  if (list.length === 0) return 'main'
  const defaultEntry = list.find((agent) => agent?.default)
  const picked = defaultEntry?.id || list[0]?.id || 'main'
  return normalizeAgentId(picked)
}

function resolveWorkspaceForNewAgent(agentId: string): string {
  const normalizedId = normalizeAgentId(agentId)
  const cfg = readConfig()
  const defaultAgentId = resolveDefaultAgentIdFromConfig()

  if (normalizedId === defaultAgentId) {
    const configuredDefaultWorkspace = cfg.agents?.defaults?.workspace?.trim()
    if (configuredDefaultWorkspace) {
      return configuredDefaultWorkspace.replace(/^~(?=\/|\\|$)/, homedir())
    }
    return join(OPENCLAW_HOME, 'workspace')
  }

  return join(OPENCLAW_HOME, `workspace-${normalizedId}`)
}

function extractJsonBlock(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // 优先快速路径：stdout 只有 JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  // 兼容混合日志：取最后一个 JSON 对象
  const start = trimmed.lastIndexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }
  return null
}

function parseCliJson<T>(stdout: string, action: string): T {
  const jsonText = extractJsonBlock(stdout)
  if (!jsonText) {
    throw new Error(`${action} 返回非 JSON 输出`)
  }
  try {
    return JSON.parse(jsonText) as T
  } catch (err) {
    throw new Error(`${action} JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function runOpenclawCli(args: string[]): Promise<string> {
  const { runOpenclawCli: runCli } = await import('./openclaw-resolve')
  const result = await runCli(args, { timeoutMs: 60_000 })
  if (result.stderr?.trim()) {
    log.warn(`openclaw cli [${result.source}] stderr: ${result.stderr.trim()}`)
  }
  if (result.code !== 0) {
    throw new Error(
      `openclaw CLI failed (exit ${result.code}, source=${result.source}): ${(result.stderr || result.stdout).trim().slice(0, 400)}`
    )
  }
  return result.stdout
}

export async function createAgentViaCli(
  agent: Omit<AgentConfig, 'id'> & { id?: string }
): Promise<AgentConfig> {
  const rawId = agent.id?.trim()
  if (!rawId) {
    // 更新路径仍复用原有 saveAgent 行为；CLI 仅处理创建
    return saveAgent(agent)
  }

  const normalizedId = normalizeAgentId(rawId)
  const existing = getAgents().find((item) => normalizeAgentId(item.id) === normalizedId)
  if (existing) {
    // 已存在视为更新，避免误报 "already exists"
    return saveAgent({ ...agent, id: existing.id })
  }

  const workspace = resolveWorkspaceForNewAgent(normalizedId)
  const args = ['agents', 'add', rawId, '--workspace', workspace, '--non-interactive', '--json']

  if (typeof agent.model === 'string' && agent.model.trim()) {
    args.push('--model', agent.model.trim())
  }

  const stdout = await runOpenclawCli(args)
  const result = parseCliJson<CliAddResult>(stdout, '创建智能体')
  const createdId = result.agentId?.trim()
  if (!createdId) {
    throw new Error('创建智能体失败：未返回 agentId')
  }

  // 用 ClickClaw 现有补丁能力补齐 identity/tools/theme 等字段
  return saveAgent({ ...agent, id: createdId })
}

export async function deleteAgentViaCli(agentId: string): Promise<void> {
  const trimmed = agentId.trim()
  if (!trimmed) throw new Error('agentId 不能为空')

  const stdout = await runOpenclawCli(['agents', 'delete', trimmed, '--force', '--json'])
  const result = parseCliJson<CliDeleteResult>(stdout, '删除智能体')
  if (!result.agentId) {
    throw new Error('删除智能体失败：未返回 agentId')
  }
}
