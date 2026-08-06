/**
 * 将会话 key 格式化为人类可读的展示名。
 *
 * 常见 key：
 * - agent:<agentId>:main
 * - agent:<agentId>:<用户命名/时间戳>
 * - agent:<agentId>:<channel>:<kind>:<peerId>
 * - draft:<ts>:<rand>:<name>
 */

export type SessionLabelTranslator = (key: string, options?: Record<string, unknown>) => string

const CHANNEL_I18N: Record<string, string> = {
  feishu: 'chat.sessions.channel.feishu',
  lark: 'chat.sessions.channel.lark',
  telegram: 'chat.sessions.channel.telegram',
  discord: 'chat.sessions.channel.discord',
  slack: 'chat.sessions.channel.slack',
  whatsapp: 'chat.sessions.channel.whatsapp',
  weixin: 'chat.sessions.channel.weixin',
  wechat: 'chat.sessions.channel.wechat',
  dingtalk: 'chat.sessions.channel.dingtalk',
  qq: 'chat.sessions.channel.qq',
  webchat: 'chat.sessions.channel.webchat',
  imessage: 'chat.sessions.channel.imessage',
  line: 'chat.sessions.channel.line',
}

const KIND_I18N: Record<string, string> = {
  direct: 'chat.sessions.channel.direct',
  dm: 'chat.sessions.channel.direct',
  private: 'chat.sessions.channel.direct',
  group: 'chat.sessions.channel.group',
  channel: 'chat.sessions.channel.group',
  room: 'chat.sessions.channel.group',
  topic: 'chat.sessions.channel.topic',
}

function shortenId(id: string, head = 6, tail = 4): string {
  const s = id.trim()
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

function looksLikeDatetime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([ T_]\d{2}:\d{2}(:\d{2})?)?$/.test(value.trim())
}

function looksLikeTechnicalId(value: string): boolean {
  if (!value || value.length < 16) return false
  // UUID / open_id / long opaque tokens
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true
  if (/^(ou_|oc_|on_|cli_|U|C|G|D)[A-Za-z0-9_-]{8,}$/.test(value)) return true
  if (/^[-+]?\d{10,}$/.test(value)) return true
  if (value.length >= 28 && /^[A-Za-z0-9_.:-]+$/.test(value)) return true
  return false
}

/** 无 i18n 时的基础标签（会话列表存储 / 兜底） */
export function parseSessionLabel(key: string): string {
  if (!key) return '未知'
  if (key.startsWith('draft:')) {
    const parts = key.split(':')
    return parts.slice(3).join(':') || '草稿会话'
  }
  const parts = key.split(':')
  if (parts.length < 3 || parts[0] !== 'agent') return key
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return '主会话'
  if (channel === 'main') return `${agent} · 主会话`
  if (agent === 'main') return channel
  return `${agent} · ${channel}`
}

function humanizeChannelPart(channel: string, t?: SessionLabelTranslator): string {
  const translate = (k: string, fallback: string, opts?: Record<string, unknown>): string => {
    if (!t) return fallback
    const out = t(k, opts)
    return !out || out === k ? fallback : out
  }

  if (!channel || channel === 'main') {
    return translate('chat.sessions.mainSession', '主会话')
  }

  // 用户新建会话的自动时间名，直接展示
  if (looksLikeDatetime(channel)) return channel

  const parts = channel.split(':').filter(Boolean)
  if (parts.length === 0) {
    return translate('chat.sessions.sessionFallback', '会话')
  }

  const typeKey = parts[0].toLowerCase()
  const typeI18n = CHANNEL_I18N[typeKey]
  if (typeI18n) {
    const typeLabel = translate(typeI18n, parts[0])
    const rest = parts.slice(1)
    if (rest.length === 0) return typeLabel

    const kindKey = rest[0].toLowerCase()
    const kindI18n = KIND_I18N[kindKey]
    if (kindI18n) {
      const kindLabel = translate(kindI18n, rest[0])
      const peer = rest.slice(1).join(':')
      if (!peer) return `${typeLabel} · ${kindLabel}`
      const peerShow = looksLikeTechnicalId(peer) ? shortenId(peer) : peer
      return `${typeLabel} · ${kindLabel} ${peerShow}`
    }

    const peer = rest.join(':')
    const peerShow = looksLikeTechnicalId(peer) ? shortenId(peer) : peer
    return peerShow ? `${typeLabel} · ${peerShow}` : typeLabel
  }

  // 纯技术串：缩短
  if (looksLikeTechnicalId(channel)) {
    return `${translate('chat.sessions.sessionFallback', '会话')} ${shortenId(channel, 8, 4)}`
  }

  return channel
}

export interface FormatSessionDisplayOptions {
  /** agentId -> 显示名 */
  agentNames?: Record<string, string>
  /** draft 等已有友好名时优先使用 */
  fallbackLabel?: string
  /** 默认智能体 id（该 agent 的主会话可省略 agent 前缀） */
  defaultAgentId?: string | null
  t?: SessionLabelTranslator
}

/**
 * 聊天侧栏 / 顶栏用的人类可读会话名
 */
export function formatSessionDisplayLabel(
  key: string | null | undefined,
  options: FormatSessionDisplayOptions = {}
): string {
  const { agentNames, fallbackLabel, defaultAgentId, t } = options
  const translate = (k: string, fallback: string, opts?: Record<string, unknown>): string => {
    if (!t) return fallback
    const out = t(k, opts)
    return !out || out === k ? fallback : out
  }

  if (!key) return translate('chat.model.noSession', '未选择会话')

  if (key.startsWith('draft:')) {
    const parts = key.split(':')
    const draftName = parts.slice(3).join(':')
    return draftName || fallbackLabel || translate('chat.sessions.draftSession', '草稿会话')
  }

  const parts = key.split(':')
  if (parts.length < 3 || parts[0] !== 'agent') {
    return fallbackLabel || key
  }

  const agentId = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  const agentName =
    agentNames?.[agentId] ||
    (agentId === 'main'
      ? translate('chat.sessions.defaultAgent', '默认智能体')
      : agentId)
  const sessionPart = humanizeChannelPart(channel, t)

  const multiAgent = Boolean(agentNames && Object.keys(agentNames).length > 1)
  const isDefaultAgent = agentId === 'main' || (!!defaultAgentId && agentId === defaultAgentId)

  // 单 agent 场景：默认智能体的主会话只显示「主会话」
  if (channel === 'main' && isDefaultAgent && !multiAgent) {
    return sessionPart
  }

  // 默认智能体下的用户命名会话（时间戳等）：省略 agent 前缀
  const channelHead = channel.split(':')[0]?.toLowerCase() || ''
  const omitAgent =
    isDefaultAgent &&
    channel !== 'main' &&
    !looksLikeTechnicalId(channel) &&
    !CHANNEL_I18N[channelHead]

  if (omitAgent) return sessionPart

  return translate('chat.sessions.labelAgentSession', `${agentName} · ${sessionPart}`, {
    agent: agentName,
    session: sessionPart,
  })
}
