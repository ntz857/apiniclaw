/**
 * Channel plugin ensure — OpenClaw 2026.5+ 起部分渠道（如飞书）为独立 npm 插件。
 * ApiniClaw 只写 channels.* 配置时，若不安装插件，Gateway 会出现：
 *   "channels.feishu is configured but no channel plugin is installed or loadable"
 * 导致「绑定成功但聊天无响应」。
 */

import { createLogger } from '../logger'
import { readConfig, writeConfig } from '../config'
import { runOpenclawCli } from './openclaw-resolve'

const log = createLogger('channel-plugins')

/**
 * 渠道 key → 需要安装的 npm 包（或 stock 插件 id，仅需启用）。
 * stock: 表示随 openclaw 分发但可能默认 disabled，只需 plugins.entries 启用。
 */
const CHANNEL_PLUGIN_MAP: Record<
  string,
  { pluginId: string; npmSpec?: string; stock?: boolean }
> = {
  feishu: { pluginId: 'feishu', npmSpec: '@openclaw/feishu' },
  // 国内 IM（ApiniClaw 安装包可能已注入 extensions）
  'openclaw-weixin': { pluginId: 'openclaw-weixin', npmSpec: '@tencent-weixin/openclaw-weixin' },
  weixin: { pluginId: 'openclaw-weixin', npmSpec: '@tencent-weixin/openclaw-weixin' },
  // stock 渠道常见 id（未安装时 openclaw 会提示 installable）
  telegram: { pluginId: 'telegram', stock: true },
  discord: { pluginId: 'discord', stock: true },
  slack: { pluginId: 'slack', stock: true },
  whatsapp: { pluginId: 'whatsapp', stock: true },
  signal: { pluginId: 'signal', stock: true },
  imessage: { pluginId: 'imessage', stock: true },
}

export function resolveChannelPluginSpec(channelKey: string): {
  pluginId: string
  npmSpec?: string
  stock?: boolean
} | null {
  const key = channelKey.trim().toLowerCase()
  return CHANNEL_PLUGIN_MAP[key] ?? null
}

function isPluginEnabledInConfig(pluginId: string): boolean {
  try {
    const cfg = readConfig()
    const entry = cfg.plugins?.entries?.[pluginId] as { enabled?: boolean } | undefined
    return entry?.enabled === true
  } catch {
    return false
  }
}

function enablePluginInConfig(pluginId: string): boolean {
  const cfg = readConfig()
  if (!cfg.plugins) cfg.plugins = {}
  if (!cfg.plugins.entries) cfg.plugins.entries = {}
  const current = (cfg.plugins.entries[pluginId] as { enabled?: boolean } | undefined) ?? {}
  if (current.enabled === true) return false
  cfg.plugins.entries[pluginId] = { ...current, enabled: true }
  writeConfig(cfg, { source: 'channel', summary: `启用渠道插件: ${pluginId}` })
  return true
}

/**
 * 确保渠道对应的插件已安装并启用。
 * 返回是否建议用户重启 Gateway。
 */
export async function ensureChannelPlugin(channelKey: string): Promise<{
  ok: boolean
  pluginId?: string
  installed: boolean
  enabled: boolean
  needRestart: boolean
  error?: string
}> {
  const spec = resolveChannelPluginSpec(channelKey)
  if (!spec) {
    return { ok: true, installed: false, enabled: false, needRestart: false }
  }

  const { pluginId, npmSpec, stock } = spec
  let installed = false
  let enabled = isPluginEnabledInConfig(pluginId)
  let needRestart = false

  try {
    if (npmSpec && !stock) {
      if (!enabled) {
        log.info(`installing channel plugin ${npmSpec} ...`)
        const result = await runOpenclawCli(['plugins', 'install', npmSpec], {
          timeoutMs: 180_000,
        })
        if (result.code !== 0) {
          throw new Error(result.stderr || result.stdout || `exit ${result.code}`)
        }
        installed = true
        needRestart = true
      }
    }

    if (enablePluginInConfig(pluginId)) {
      enabled = true
      needRestart = true
    } else {
      enabled = true
    }

    return { ok: true, pluginId, installed, enabled, needRestart }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn(`ensureChannelPlugin(${channelKey}) failed:`, message)
    // 仍尝试启用（可能已通过其他方式安装）
    const enabledNow = enablePluginInConfig(pluginId)
    return {
      ok: false,
      pluginId,
      installed,
      enabled: enabled || enabledNow,
      needRestart: needRestart || enabledNow,
      error: message,
    }
  }
}
