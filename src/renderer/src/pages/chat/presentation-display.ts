/**
 * OpenClaw MessagePresentation / InteractiveReply 解析与展示辅助。
 *
 * 渠道（飞书等）真实卡片由插件转成飞书 schema；ApiniClaw 桌面聊天线拿到的是
 * 便携 presentation（tool 参数 / 偶发 JSON），先做可读渲染 + 有限交互。
 */

export type PresentationTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

export type PresentationAction =
  | { type: 'command'; command: string }
  | { type: 'callback'; value: string }

export type PresentationButton = {
  label: string
  action?: PresentationAction
  value?: string
  url?: string
  style?: 'primary' | 'secondary' | 'success' | 'danger'
  disabled?: boolean
}

export type PresentationOption = {
  label: string
  action?: PresentationAction
  value?: string
}

export type PresentationBlock =
  | { type: 'text'; text: string }
  | { type: 'context'; text: string }
  | { type: 'divider' }
  | { type: 'buttons'; buttons: PresentationButton[] }
  | { type: 'select'; placeholder?: string; options: PresentationOption[] }

export type MessagePresentation = {
  title?: string
  tone?: PresentationTone
  blocks: PresentationBlock[]
  /** 来源提示（工具名等） */
  source?: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function normalizeAction(raw: unknown): PresentationAction | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  const type = str(r.type)?.toLowerCase()
  if (type === 'command') {
    const command = str(r.command)
    return command ? { type: 'command', command } : undefined
  }
  if (type === 'callback') {
    const value = str(r.value)
    return value ? { type: 'callback', value } : undefined
  }
  return undefined
}

function normalizeButton(raw: unknown): PresentationButton | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  const label = str(r.label) ?? str(r.text)
  const action = normalizeAction(r.action)
  const value = str(r.value) ?? str(r.callbackData) ?? str(r.callback_data)
  const url = str(r.url)
  const webApp = asRecord(r.webApp) ?? asRecord(r.web_app)
  const webUrl = str(webApp?.url)
  if (!label || (!action && !value && !url && !webUrl)) return undefined
  const styleRaw = str(r.style)?.toLowerCase()
  const style =
    styleRaw === 'primary' ||
    styleRaw === 'secondary' ||
    styleRaw === 'success' ||
    styleRaw === 'danger'
      ? styleRaw
      : undefined
  return {
    label,
    ...action ? { action } : {},
    ...value ? { value } : {},
    ...url || webUrl ? { url: url || webUrl } : {},
    ...style ? { style } : {},
    ...r.disabled === true ? { disabled: true } : {},
  }
}

function normalizeOption(raw: unknown): PresentationOption | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  const label = str(r.label) ?? str(r.text)
  const action = normalizeAction(r.action)
  const value = str(r.value) ?? (action?.type === 'command' ? action.command : action?.type === 'callback' ? action.value : undefined)
  if (!label || !value) return undefined
  return {
    label,
    ...action ? { action } : {},
    value,
  }
}

function normalizeBlock(raw: unknown): PresentationBlock | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  const type = str(r.type)?.toLowerCase()
  if (type === 'text' || type === 'context') {
    const text = str(r.text)
    return text ? { type, text } : undefined
  }
  if (type === 'divider') return { type: 'divider' }
  if (type === 'buttons') {
    const buttons = Array.isArray(r.buttons)
      ? r.buttons.map(normalizeButton).filter((b): b is PresentationButton => Boolean(b))
      : []
    return buttons.length > 0 ? { type: 'buttons', buttons } : undefined
  }
  if (type === 'select') {
    const options = Array.isArray(r.options)
      ? r.options.map(normalizeOption).filter((o): o is PresentationOption => Boolean(o))
      : []
    return options.length > 0
      ? { type: 'select', placeholder: str(r.placeholder), options }
      : undefined
  }
  return undefined
}

/** 规范化便携 MessagePresentation */
export function normalizeMessagePresentation(
  raw: unknown,
  source?: string
): MessagePresentation | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  const blocks = Array.isArray(r.blocks)
    ? r.blocks.map(normalizeBlock).filter((b): b is PresentationBlock => Boolean(b))
    : []
  const title = str(r.title)
  if (!title && blocks.length === 0) return undefined
  const toneRaw = str(r.tone)?.toLowerCase()
  const tone =
    toneRaw === 'info' ||
    toneRaw === 'success' ||
    toneRaw === 'warning' ||
    toneRaw === 'danger' ||
    toneRaw === 'neutral'
      ? toneRaw
      : undefined
  return {
    ...title ? { title } : {},
    ...tone ? { tone } : {},
    blocks,
    ...source ? { source } : {},
  }
}

/** 旧 InteractiveReply → Presentation */
export function interactiveToPresentation(
  raw: unknown,
  source?: string
): MessagePresentation | undefined {
  const r = asRecord(raw)
  if (!r || !Array.isArray(r.blocks)) return undefined
  return normalizeMessagePresentation({ blocks: r.blocks }, source)
}

function pushIfPresentation(
  out: MessagePresentation[],
  raw: unknown,
  source?: string
): void {
  const p =
    normalizeMessagePresentation(raw, source) || interactiveToPresentation(raw, source)
  if (p) out.push(p)
}

/** 从任意对象树里收集 presentation / interactive */
export function collectPresentationsFromValue(
  value: unknown,
  source?: string,
  depth = 0
): MessagePresentation[] {
  if (depth > 6 || value == null) return []
  const out: MessagePresentation[] = []
  const r = asRecord(value)
  if (r) {
    if (r.presentation) pushIfPresentation(out, r.presentation, source)
    if (r.interactive) pushIfPresentation(out, r.interactive, source)
    // 自身就是 presentation
    if (Array.isArray(r.blocks) && (r.title || r.blocks.length > 0) && !r.presentation) {
      pushIfPresentation(out, r, source)
    }
    // 常见包装
    if (r.params) out.push(...collectPresentationsFromValue(r.params, source, depth + 1))
    if (r.arguments) out.push(...collectPresentationsFromValue(r.arguments, source, depth + 1))
    if (r.payload) out.push(...collectPresentationsFromValue(r.payload, source, depth + 1))
    if (r.details) out.push(...collectPresentationsFromValue(r.details, source, depth + 1))
  }
  return out
}

/** 解析 toolCall.arguments（对象或 JSON 字符串） */
export function extractPresentationsFromToolArgs(
  toolName: string,
  args: unknown
): MessagePresentation[] {
  let parsed = args
  if (typeof args === 'string' && args.trim()) {
    try {
      parsed = JSON.parse(args)
    } catch {
      return []
    }
  }
  const source = toolName || 'tool'
  return collectPresentationsFromValue(parsed, source)
}

/** 从正文中 ```json 代码块尝试解析 presentation */
export function extractPresentationsFromText(text: string): MessagePresentation[] {
  if (!text || !text.includes('```')) return []
  const out: MessagePresentation[] = []
  const re = /```(?:json)?\s*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    try {
      const json = JSON.parse(m[1])
      out.push(...collectPresentationsFromValue(json, 'json'))
    } catch {
      /* skip */
    }
  }
  return out
}

export function toneColor(tone?: PresentationTone): string {
  switch (tone) {
    case 'success':
      return '#52c41a'
    case 'warning':
      return '#faad14'
    case 'danger':
      return '#ff4d4f'
    case 'info':
      return '#1677ff'
    default:
      return '#8c8c8c'
  }
}

export function buttonAntType(
  style?: PresentationButton['style']
): 'primary' | 'default' | 'dashed' | 'link' | 'text' {
  if (style === 'primary' || style === 'success') return 'primary'
  if (style === 'danger') return 'primary'
  return 'default'
}

export function buttonDanger(style?: PresentationButton['style']): boolean {
  return style === 'danger'
}
