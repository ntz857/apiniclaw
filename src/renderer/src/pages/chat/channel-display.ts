/**
 * Channel message display helpers
 *
 * OpenClaw 渠道（飞书 / 微信 / Telegram 等）写入 transcript 的用户正文常带
 * AI 上下文信封（message_id、System 提示、open_id 前缀等）。Control UI / TUI
 * 会在展示前剥离；ApiniClaw 聊天列表也需要同样的净化，否则气泡里全是元数据。
 *
 * 另：assistant/tool 的 content 可能含 type:"image" 块（base64 或
 * /api/chat/media/outgoing/...），需转成可预览的附件。
 */

import type { AttachmentPayload } from '../../hooks/useGatewayWs'

/** 与 openclaw ENVELOPE_CHANNELS 对齐的常见渠道前缀 */
const ENVELOPE_CHANNELS = [
  'WebChat',
  'WhatsApp',
  'Telegram',
  'Signal',
  'Slack',
  'Discord',
  'Google Chat',
  'iMessage',
  'Teams',
  'Matrix',
  'Zalo',
  'Zalo Personal',
  'Feishu',
  'Lark',
  'Weixin',
  'WeChat',
  'WeCom',
  'QQ',
]

const MESSAGE_ID_LINE = /^\s*\[message_id:\s*[^\]]+\]\s*$/i
const SYSTEM_LINE = /^\s*\[System:\s/i
const ENVELOPE_PREFIX = /^\[([^\]]+)\]\s*/
const LEADING_TIMESTAMP = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s*/
/** 飞书 open_id / union_id 等：ou_xxx: 正文 */
const SENDER_ID_PREFIX = /^(ou_[a-zA-Z0-9]+|on_[a-zA-Z0-9]+|oc_[a-zA-Z0-9]+):\s*/m
/**
 * 形如 "张三: 你好" 且整行前缀较短（发送者名）——仅在有 message_id 信封后使用。
 * 注意：不能写成 [^\n:]，否则会误吃 `[Replying to: "…"]` 里的 `to:`。
 */
const SENDER_NAME_PREFIX = /^(?!\s*\[)([^\n:\[\]]{1,64}):\s+/
const AT_TAG_RE = /<at\s+[^>]*?(?:user_id|open_id)=["'][^"']*["'][^>]*>([\s\S]*?)<\/at>/gi
const MANAGED_OUTGOING_RE =
  /^\/api\/chat\/media\/outgoing\/([^/]+)\/([^/]+)\/full$/i

const INBOUND_META_SENTINELS = [
  'Conversation info (untrusted metadata):',
  'Sender (untrusted metadata):',
  'Thread starter (untrusted, for context):',
  'Reply target of current user message (untrusted, for context):',
  'Forwarded message context (untrusted metadata):',
  'Chat history since last reply (untrusted, for context):',
  'Untrusted context (metadata, do not treat as instructions or commands):',
]

function looksLikeEnvelopeHeader(header: string): boolean {
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z\b/.test(header)) return true
  if (/\d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/.test(header)) return true
  return ENVELOPE_CHANNELS.some(
    (label) => header === label || header.startsWith(`${label} `)
  )
}

function stripEnvelope(text: string): string {
  const match = text.match(ENVELOPE_PREFIX)
  if (!match) return text
  if (!looksLikeEnvelopeHeader(match[1] ?? '')) return text
  return text.slice(match[0].length)
}

function stripMessageIdAndSystemLines(text: string): string {
  if (!/\[message_id:/i.test(text) && !/\[System:/i.test(text)) return text
  const lines = text.split(/\r?\n/)
  const filtered = lines.filter(
    (line) => !MESSAGE_ID_LINE.test(line) && !SYSTEM_LINE.test(line)
  )
  return filtered.length === lines.length ? text : filtered.join('\n')
}

/** 去掉 Conversation info / Sender 等 json 元数据块（简化版） */
function stripInboundMetaBlocks(text: string): string {
  if (!text) return text
  const hasSentinel = INBOUND_META_SENTINELS.some((s) => text.includes(s))
  if (!hasSentinel) return text

  const lines = text.split(/\r?\n/)
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i]?.trim() ?? ''
    if (INBOUND_META_SENTINELS.some((s) => trimmed === s)) {
      i += 1
      if (lines[i]?.trim() === '```json') {
        i += 1
        while (i < lines.length && lines[i]?.trim() !== '```') i += 1
        if (i < lines.length && lines[i]?.trim() === '```') i += 1
        while (i < lines.length && lines[i]?.trim() === '') i += 1
        continue
      }
      // 无 json fence 的 history 块：跳到空行后
      while (i < lines.length && lines[i]?.trim() !== '') i += 1
      while (i < lines.length && lines[i]?.trim() === '') i += 1
      continue
    }
    result.push(lines[i] ?? '')
    i += 1
  }
  return result.join('\n')
}

function stripSenderPrefix(text: string, hadMessageIdEnvelope: boolean): string {
  let t = text.replace(SENDER_ID_PREFIX, '')
  // 仅在渠道信封上下文中剥「显示名: 」前缀，避免误伤普通对话
  if (hadMessageIdEnvelope) {
    t = t.replace(SENDER_NAME_PREFIX, '')
  }
  return t
}

function convertAtTags(text: string): string {
  return text.replace(AT_TAG_RE, (_m, name: string) => {
    const n = String(name || '').trim()
    return n ? `@${n}` : '@'
  })
}

/**
 * 飞书等渠道写入的引用提示：
 *   [Replying to: "原消息全文"]
 *   或 [Replying to: '…'] / 无引号单行
 * 抽出后供引用条 UI 使用，并从正文中移除该标记（避免当普通文本显示）。
 */
const REPLYING_TO_QUOTED_RE =
  /^\s*\[Replying to:\s*"((?:\\.|[^"\\])*)"\s*\]\s*(?:\r?\n)*/i
const REPLYING_TO_SINGLE_RE =
  /^\s*\[Replying to:\s*'((?:\\.|[^'\\])*)'\s*\]\s*(?:\r?\n)*/i
const REPLYING_TO_PLAIN_RE =
  /^\s*\[Replying to:\s*([^\]]+?)\s*\]\s*(?:\r?\n)*/i

function unescapeQuoted(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\')
    .trim()
}

export function extractReplyQuote(text: string): { replyTo?: string; body: string } {
  if (!text) return { body: text }
  let t = text.replace(/\r\n/g, '\n')
  let replyTo: string | undefined

  const tryMatch = (re: RegExp): boolean => {
    const m = re.exec(t)
    if (!m) return false
    replyTo = unescapeQuoted(m[1] || '')
    t = t.slice(m[0].length)
    return true
  }

  if (!tryMatch(REPLYING_TO_QUOTED_RE) && !tryMatch(REPLYING_TO_SINGLE_RE)) {
    // 无引号：避免误吞后面内容，只匹配整段 bracket
    tryMatch(REPLYING_TO_PLAIN_RE)
  }

  if (replyTo !== undefined && !replyTo) replyTo = undefined
  return { replyTo, body: t }
}

export interface SanitizeDisplayResult {
  text: string
  /** 渠道「回复引用」原文，已从 text 中剥离 */
  replyTo?: string
  /**
   * 从正文占位符 / file 标签解析出的附件名（尚无路径时）。
   * 与消息级 MediaPath 合并后成为可点开的附件。
   */
  mediaHints?: Array<{ kind: string; fileName: string; mimeType?: string }>
}

/** 飞书等：`<media:document> (报告.md)` / `<media:image>` */
const MEDIA_PLACEHOLDER_RE =
  /<media:(image|document|audio|video|sticker|file)>(?:\s*\(([^)]*)\))?/gi
/** `<file name="xxx.md" mime="text/markdown">` */
const FILE_TAG_RE = /<file\s+name="([^"]*)"(?:\s+mime="([^"]*)")?\s*>/gi
/** 注入给模型看的外部文件全文，UI 不应整篇铺开 */
const EXTERNAL_UNTRUSTED_RE =
  /<<<EXTERNAL_UNTRUSTED_CONTENT\b[^>]*>>>[\s\S]*?(?:<<<END_EXTERNAL_UNTRUSTED_CONTENT\b[^>]*>>>|$)/gi

function mimeFromKind(kind: string, hint?: string): string {
  if (hint && hint.includes('/')) return hint
  switch (kind.toLowerCase()) {
    case 'image':
      return 'image/*'
    case 'audio':
      return 'audio/*'
    case 'video':
      return 'video/*'
    case 'document':
    case 'file':
    default:
      return 'application/octet-stream'
  }
}

function categoryFromMime(
  mime: string,
  kind?: string
): AttachmentPayload['category'] {
  if (mime.startsWith('image/') || kind === 'image') return 'image'
  if (mime.startsWith('video/') || kind === 'video') return 'video'
  if (mime.startsWith('audio/') || kind === 'audio') return 'audio'
  return 'document'
}

/**
 * 从正文剥掉渠道媒体占位与注入全文，并收集文件名提示。
 */
export function stripInboundMediaMarkup(text: string): {
  text: string
  mediaHints: Array<{ kind: string; fileName: string; mimeType?: string }>
} {
  if (!text) return { text, mediaHints: [] }
  const mediaHints: Array<{ kind: string; fileName: string; mimeType?: string }> = []
  let t = text

  t = t.replace(MEDIA_PLACEHOLDER_RE, (_m, kind: string, label?: string) => {
    const fileName = (label || '').trim() || `media.${kind === 'image' ? 'png' : 'bin'}`
    mediaHints.push({
      kind: String(kind).toLowerCase(),
      fileName,
      mimeType: mimeFromKind(String(kind)),
    })
    return ''
  })

  t = t.replace(FILE_TAG_RE, (_m, name: string, mime?: string) => {
    const fileName = (name || '').trim()
    if (fileName) {
      mediaHints.push({
        kind: 'document',
        fileName,
        mimeType: mime || mimeFromKind('document'),
      })
    }
    return ''
  })

  t = t.replace(EXTERNAL_UNTRUSTED_RE, '')
  // 残留的 Source: External / AIGC 头若单独成行
  t = t
    .split('\n')
    .filter((line) => {
      const s = line.trim()
      if (!s) return true
      if (/^Source:\s*External$/i.test(s)) return false
      if (/^AIGC:\s*$/i.test(s)) return false
      if (/^(Label|ContentProducer|ProduceID|ReservedCode|ContentPropagator|PropagateID):/i.test(s))
        return false
      return true
    })
    .join('\n')

  t = t.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '').trim()
  return { text: t, mediaHints }
}

/**
 * 把消息级 MediaPath(s) 转成 AttachmentPayload。
 * OpenClaw transcript 常见字段：MediaPath / MediaPaths / MediaType / MediaTypes
 */
export function attachmentsFromMediaFields(msg: {
  MediaPath?: unknown
  MediaPaths?: unknown
  MediaType?: unknown
  MediaTypes?: unknown
  mediaPath?: unknown
  mediaPaths?: unknown
  mediaType?: unknown
  mediaTypes?: unknown
}): AttachmentPayload[] {
  const pathsRaw = msg.MediaPaths ?? msg.mediaPaths
  const pathSingle = msg.MediaPath ?? msg.mediaPath
  const typesRaw = msg.MediaTypes ?? msg.mediaTypes
  const typeSingle = msg.MediaType ?? msg.mediaType

  const paths: string[] = []
  if (Array.isArray(pathsRaw)) {
    for (const p of pathsRaw) if (typeof p === 'string' && p.trim()) paths.push(p.trim())
  }
  if (paths.length === 0 && typeof pathSingle === 'string' && pathSingle.trim()) {
    paths.push(pathSingle.trim())
  }

  const types: string[] = []
  if (Array.isArray(typesRaw)) {
    for (const t of typesRaw) if (typeof t === 'string' && t.trim()) types.push(t.trim())
  }
  if (types.length === 0 && typeof typeSingle === 'string' && typeSingle.trim()) {
    types.push(typeSingle.trim())
  }

  return paths.map((localPath, i) => {
    const mime = types[i] || types[0] || 'application/octet-stream'
    const fileName = localPath.replace(/^.*[\\/]/, '') || `file-${i + 1}`
    return {
      category: categoryFromMime(mime),
      mimeType: mime,
      fileName,
      content: '',
      localPath,
    }
  })
}

/**
 * mediaHints（只有文件名）与已有路径附件合并：同名补全 / 无路径则仅文件名展示。
 */
export function mergeMediaHintsAsAttachments(
  hints: Array<{ kind: string; fileName: string; mimeType?: string }> | undefined,
  pathAttachments: AttachmentPayload[] | undefined
): AttachmentPayload[] {
  const out: AttachmentPayload[] = [...(pathAttachments || [])]
  if (!hints?.length) return out

  for (const hint of hints) {
    const base = hint.fileName.replace(/---[0-9a-f-]{36}/i, '') // 去掉 openclaw 去重后缀再比
    const matched = out.find((a) => {
      const an = a.fileName
      return (
        an === hint.fileName ||
        an.includes(hint.fileName) ||
        hint.fileName.includes(an) ||
        an.replace(/---[0-9a-f-]{36}/i, '') === base
      )
    })
    if (matched) {
      // 展示名优先用用户可见短名
      if (hint.fileName && !hint.fileName.includes('---') && matched.fileName.includes('---')) {
        matched.fileName = hint.fileName
      }
      continue
    }
    out.push({
      category: categoryFromMime(hint.mimeType || '', hint.kind),
      mimeType: hint.mimeType || mimeFromKind(hint.kind),
      fileName: hint.fileName,
      content: '',
    })
  }
  return out
}

/**
 * 把渠道/入站信封净化成适合气泡展示的用户文本，并抽出引用。
 */
export function sanitizeChannelUserTextDetailed(raw: string): SanitizeDisplayResult {
  if (!raw) return { text: raw }
  const hadMessageId = /\[message_id:/i.test(raw) || /\[Feishu\b/i.test(raw) || /\[Lark\b/i.test(raw)
  let t = raw.replace(/\r\n/g, '\n')
  t = t.replace(LEADING_TIMESTAMP, '')
  t = stripMessageIdAndSystemLines(t)
  t = stripInboundMetaBlocks(t)
  // 可能连着 [Feishu …] [message_id: …] 同一行
  t = stripEnvelope(t)
  t = stripMessageIdAndSystemLines(t)
  t = stripSenderPrefix(t, hadMessageId)
  t = convertAtTags(t)
  // 引用标记可能在 sender 前缀之后，也可能在更前（若 message_id 已剥）
  const quoted = extractReplyQuote(t)
  t = quoted.body
  const media = stripInboundMediaMarkup(t)
  t = media.text
  // 压缩因剥离产生的多余空行
  t = t.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '').trim()
  return {
    text: t,
    replyTo: quoted.replyTo,
    mediaHints: media.mediaHints.length > 0 ? media.mediaHints : undefined,
  }
}

/**
 * 把渠道/入站信封净化成适合气泡展示的用户文本。
 */
export function sanitizeChannelUserText(raw: string): string {
  return sanitizeChannelUserTextDetailed(raw).text
}

/** assistant 侧仅去掉内部元数据，保留正文；若有引用标记也抽出 */
export function sanitizeChannelAssistantTextDetailed(raw: string): SanitizeDisplayResult {
  if (!raw) return { text: raw }
  let t = raw.replace(/\r\n/g, '\n')
  t = stripInboundMetaBlocks(t)
  t = convertAtTags(t)
  const quoted = extractReplyQuote(t)
  t = quoted.body.replace(/\n{3,}/g, '\n\n').trim()
  return { text: t, replyTo: quoted.replyTo }
}

/** assistant 侧仅去掉内部元数据，保留正文 */
export function sanitizeChannelAssistantText(raw: string): string {
  return sanitizeChannelAssistantTextDetailed(raw).text
}

export interface ContentImageBlock {
  type: 'image'
  data?: string
  mimeType?: string
  url?: string
  openUrl?: string
  alt?: string
  width?: number
  height?: number
  source?: { type?: string; path?: string; mediaType?: string }
}

export interface NormalizedMessageContent {
  text: string
  /** 渠道回复引用（[Replying to: "…"]） */
  replyTo?: string
  /** 正文里 <media:document> 等解析出的文件名提示 */
  mediaHints?: Array<{ kind: string; fileName: string; mimeType?: string }>
  /** 从 content blocks 抽出的图片附件 */
  imageAttachments: AttachmentPayload[]
  /** 仍可能需要通过网关/本地路径解析的 URL 型图片 */
  imageRefs: Array<{
    url?: string
    alt?: string
    mimeType?: string
    localHint?: string
  }>
}

function mimeToCategory(mime: string): AttachmentPayload['category'] {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

/**
 * 从 string | ContentBlock[] 抽出展示用文本 + 图片。
 * role=user 时做渠道信封剥离。
 */
export function normalizeDisplayContent(
  content: unknown,
  role: 'user' | 'assistant' | 'toolResult' | string
): NormalizedMessageContent {
  const imageAttachments: AttachmentPayload[] = []
  const imageRefs: NormalizedMessageContent['imageRefs'] = []
  const textParts: string[] = []

  const pushImageBlock = (block: ContentImageBlock): void => {
    const mime = block.mimeType || block.source?.mediaType || 'image/png'
    const alt = block.alt || 'image'
    if (typeof block.data === 'string' && block.data.trim()) {
      imageAttachments.push({
        category: mimeToCategory(mime),
        mimeType: mime,
        fileName: alt.includes('.') ? alt : `${alt}.png`,
        content: block.data.replace(/\s+/g, ''),
      })
      return
    }
    // path 直接给出时
    if (block.source?.path) {
      imageRefs.push({
        url: block.source.path,
        alt,
        mimeType: mime,
        localHint: block.source.path,
      })
      return
    }
    if (block.url || block.openUrl) {
      imageRefs.push({
        url: block.url || block.openUrl,
        alt,
        mimeType: mime,
      })
    }
  }

  if (typeof content === 'string') {
    const sanitized =
      role === 'user'
        ? sanitizeChannelUserTextDetailed(content)
        : sanitizeChannelAssistantTextDetailed(content)
    return {
      text: sanitized.text,
      replyTo: sanitized.replyTo,
      mediaHints: sanitized.mediaHints,
      imageAttachments,
      imageRefs,
    }
  }

  if (!Array.isArray(content)) {
    return { text: '', imageAttachments, imageRefs }
  }

  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as Record<string, unknown>
    const type = typeof block.type === 'string' ? block.type : ''

    if ((type === 'text' || type === 'input_text' || type === 'output_text') && typeof block.text === 'string') {
      textParts.push(block.text)
      continue
    }
    if (type === 'image') {
      pushImageBlock(block as unknown as ContentImageBlock)
      continue
    }
    // Anthropic-style image source
    if (type === 'image' || block.source) {
      const source = block.source as { type?: string; data?: string; media_type?: string; path?: string } | undefined
      if (source?.type === 'base64' && source.data) {
        pushImageBlock({
          type: 'image',
          data: source.data,
          mimeType: source.media_type || 'image/png',
          alt: typeof block.alt === 'string' ? block.alt : undefined,
        })
      }
    }
  }

  const joined = textParts.join('\n')
  const sanitized =
    role === 'user'
      ? sanitizeChannelUserTextDetailed(joined)
      : sanitizeChannelAssistantTextDetailed(joined)

  return {
    text: sanitized.text,
    replyTo: sanitized.replyTo,
    mediaHints: sanitized.mediaHints,
    imageAttachments,
    imageRefs,
  }
}

/**
 * 把网关托管的 outgoing 图片 URL 尽量映射到本机路径：
 * - ~/.openclaw/media/outbound/<alt>
 * - ~/.openclaw/media/outgoing/originals/...
 * 返回 null 表示仍需用 HTTP/其它方式。
 */
export function resolveLocalPathForImageRef(
  ref: { url?: string; alt?: string; localHint?: string },
  openclawHome: string
): string | null {
  if (ref.localHint && /^[A-Za-z]:[\\/]/.test(ref.localHint)) {
    return ref.localHint
  }
  if (ref.localHint && ref.localHint.startsWith('/')) {
    return ref.localHint
  }

  const alt = ref.alt?.trim()
  if (alt && openclawHome) {
    // media/outbound 下文件名常与 alt 一致
    const sep = openclawHome.includes('\\') ? '\\' : '/'
    const candidate = `${openclawHome.replace(/[\\/]+$/, '')}${sep}media${sep}outbound${sep}${alt}`
    return candidate
  }

  if (ref.url) {
    const m = MANAGED_OUTGOING_RE.exec(ref.url.split('?')[0] || '')
    if (m && alt && openclawHome) {
      const sep = openclawHome.includes('\\') ? '\\' : '/'
      return `${openclawHome.replace(/[\\/]+$/, '')}${sep}media${sep}outbound${sep}${alt}`
    }
  }

  return null
}

/** 解析 managed outgoing URL 的 attachmentId */
export function parseManagedOutgoingUrl(url: string): { sessionKey: string; attachmentId: string } | null {
  try {
    const pathOnly = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]
    const m = MANAGED_OUTGOING_RE.exec(pathOnly || '')
    if (!m) return null
    return {
      sessionKey: decodeURIComponent(m[1]),
      attachmentId: m[2],
    }
  } catch {
    return null
  }
}
