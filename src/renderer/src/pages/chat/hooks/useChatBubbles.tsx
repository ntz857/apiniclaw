import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { XMarkdown } from '@ant-design/x-markdown'
import Latex from '@ant-design/x-markdown/plugins/Latex/index.js'
import { Think, ThoughtChain } from '@ant-design/x'
import type { BubbleListProps } from '@ant-design/x'
import { Avatar, Button, message as antdMessage } from 'antd'
import {
  CheckOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import mermaid from 'mermaid'
import type { AttachmentPayload, ChatMessage } from '../../../hooks/useGatewayWs'
import {
  buttonAntType,
  buttonDanger,
  toneColor,
  type MessagePresentation,
  type PresentationButton,
  type PresentationOption,
} from '../presentation-display'

let mermaidInitialized = false
function ensureMermaid(): void {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'default',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  })
  mermaidInitialized = true
}

let mermaidRenderSeq = 0

interface UseChatBubblesArgs {
  messages: ChatMessage[]
  tokenColorTextSecondary: string
  showThinking: boolean
  showToolCalls: boolean
  showUsage: boolean
  onCopied: () => void
  /** 卡片 command 按钮：把命令当作用户消息发出（可选） */
  onSendCommand?: (command: string) => void
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(value)
}

function shortenModelName(model?: string): string | undefined {
  if (!model) return undefined
  const parts = model.split('/')
  return parts[parts.length - 1] || model
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i

/** Latex / KaTeX extensions（块级 $$…$$、行内 $…$、\\( \\)、\\[ \\]） */
const latexExtensions = Latex({ replaceAlignStart: true, katexOptions: { throwOnError: false } })

/**
 * 将 markdown/href 中的本地路径规范成文件系统路径。
 * 支持：MEDIA:、file://、Windows 盘符、Unix 绝对路径、app://local-file。
 *
 * 注意：绝不能把带 `\` 的 Windows 路径塞进 markdown 文本——
 * commonmark 会把 `\.` 当成转义，显示成 `bunny.openclaw`（丢 `\`）。
 */
function normalizeToFsPath(href?: string): string | null {
  if (!href) return null
  let raw = href.trim().replace(/^<|>$/g, '')
  if (!raw || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('mailto:')) {
    return null
  }

  // OpenClaw 渠道投递指令：MEDIA:C:\path\to\file.png（大小写均可）
  raw = raw.replace(/^MEDIA:/i, '').trim()

  // app://local-file/open?path=...
  if (raw.startsWith('app://local-file')) {
    try {
      const u = new URL(raw)
      const p = u.searchParams.get('path')
      return p ? decodeURIComponent(p) : null
    } catch {
      return null
    }
  }

  if (raw.startsWith('file://')) {
    try {
      const parsed = new URL(raw)
      let localPath = decodeURIComponent(parsed.pathname || '')
      // file:///C:/Users/... → /C:/Users/... → C:/Users/...
      if (/^\/[A-Za-z]:\//.test(localPath)) {
        localPath = localPath.slice(1)
      }
      return localPath
    } catch {
      return null
    }
  }

  // media://inbound/id 等非本地引用
  if (/^media:\/\//i.test(raw)) {
    return null
  }

  // Windows 绝对路径 C:\... 或 C:/...
  if (/^[A-Za-z]:[\\/]/.test(raw)) {
    return raw
  }
  // UNC \\server\share
  if (raw.startsWith('\\\\')) {
    return raw
  }
  // Unix 绝对路径
  if (raw.startsWith('/')) {
    return raw
  }

  return null
}

function isLocalFileHref(href?: string): boolean {
  return Boolean(normalizeToFsPath(href))
}

function isImagePath(fsPath: string): boolean {
  return IMAGE_EXT_RE.test(fsPath)
}

function fileBaseName(fsPath: string): string {
  const parts = fsPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || fsPath
}

/** 图片预览：把本地路径改成 app:// 协议，供 protocol handler 读取 */
function toLocalMediaSrc(src?: string): string | undefined {
  if (!src) return src
  const fsPath = normalizeToFsPath(src)
  if (!fsPath) return src
  return `app://local-file/open?path=${encodeURIComponent(fsPath)}`
}

async function openLocalPath(href: string): Promise<void> {
  const fsPath = normalizeToFsPath(href)
  if (!fsPath) {
    if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) {
      await window.api.shell.openExternal(href)
    }
    return
  }
  const err = await window.api.shell.openPath(fsPath)
  if (err) {
    console.warn('[chat] openPath failed:', fsPath, err)
  }
}

type ContentSegment =
  | { kind: 'md'; text: string }
  | { kind: 'file'; fsPath: string }
  | { kind: 'mermaid'; source: string }

/**
 * 匹配可识别的本地文件引用（不要放进 markdown）：
 * - MEDIA:C:\... / MEDIA:/...
 * - 裸 Windows / Unix 绝对路径
 * - 已生成的 ![...](app://local-file...) / [...](C:/...) / 多余的 !!
 */
const LOCAL_REF_RE =
  /!{0,3}\[([^\]]*)\]\((app:\/\/local-file\/open\?path=[^)\s]+|file:\/\/[^)\s]+|[A-Za-z]:[\\/][^)\s]+|\/[^)\s]+)(?:\s+"[^"]*")?\)|MEDIA:((?:[A-Za-z]:[\\/][^\s<>"'`\]]+|\/[^\s<>"'`\]]+))|(?<![\w/:[\]])([A-Za-z]:[\\/][^\s<>"'`\]]+)/gi

/** 闭合的 mermaid 代码块 */
const MERMAID_BLOCK_RE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/gi

function extractFsPathFromMatch(match: RegExpExecArray): string | null {
  // groups: 1=md alt, 2=md url, 3=MEDIA path, 4=bare path
  const candidate = (match[2] || match[3] || match[4] || '').trim()
  if (!candidate) return null
  return (
    normalizeToFsPath(candidate) ||
    (/^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('/') ? candidate : null)
  )
}

type RawHit =
  | { index: number; length: number; kind: 'file'; fsPath: string }
  | { index: number; length: number; kind: 'mermaid'; source: string }

/**
 * 把正文拆成「markdown 文本段」+「本地文件段」+「mermaid 段」。
 * 本地文件 / mermaid 一律用 React 渲染，绕开 markdown 对路径与复杂语法的破坏。
 */
function splitContentSegments(content: string): ContentSegment[] {
  if (!content) return []

  const hits: RawHit[] = []

  const fileRe = new RegExp(LOCAL_REF_RE.source, LOCAL_REF_RE.flags)
  let m: RegExpExecArray | null
  while ((m = fileRe.exec(content)) !== null) {
    const fsPath = extractFsPathFromMatch(m)
    if (!fsPath) continue
    hits.push({ index: m.index, length: m[0].length, kind: 'file', fsPath })
  }

  const mermaidRe = new RegExp(MERMAID_BLOCK_RE.source, MERMAID_BLOCK_RE.flags)
  while ((m = mermaidRe.exec(content)) !== null) {
    hits.push({
      index: m.index,
      length: m[0].length,
      kind: 'mermaid',
      source: (m[1] || '').trim(),
    })
  }

  // 按位置排序；重叠时保留先出现的（文件 vs mermaid 通常不重叠）
  hits.sort((a, b) => a.index - b.index || b.length - a.length)
  const filtered: RawHit[] = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.index < cursor) continue
    filtered.push(hit)
    cursor = hit.index + hit.length
  }

  const segments: ContentSegment[] = []
  let lastIndex = 0
  for (const hit of filtered) {
    if (hit.index > lastIndex) {
      const text = content.slice(lastIndex, hit.index)
      if (text) segments.push({ kind: 'md', text })
    }
    if (hit.kind === 'file') {
      segments.push({ kind: 'file', fsPath: hit.fsPath })
    } else {
      segments.push({ kind: 'mermaid', source: hit.source })
    }
    lastIndex = hit.index + hit.length
  }
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex)
    if (text) segments.push({ kind: 'md', text })
  }

  // 合并相邻 md 段
  const merged: ContentSegment[] = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    if (seg.kind === 'md' && prev?.kind === 'md') {
      prev.text += seg.text
    } else {
      merged.push(seg.kind === 'md' ? { kind: 'md', text: seg.text } : { ...seg })
    }
  }
  return merged
}

/** 从各种图片源得到 base64（供另存为） */
async function fetchImageAsBase64(
  src: string
): Promise<{ base64: string; mime: string; ext: string } | null> {
  try {
    // data:image/png;base64,xxxx
    const dataMatch = /^data:([^;]+);base64,(.+)$/i.exec(src)
    if (dataMatch) {
      const mime = dataMatch[1] || 'image/png'
      const ext = mimeToExt(mime)
      return { base64: dataMatch[2], mime, ext }
    }

    const res = await fetch(src)
    if (!res.ok) return null
    const blob = await res.blob()
    const mime = blob.type || 'image/png'
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return { base64: btoa(binary), mime, ext: mimeToExt(mime) }
  } catch {
    return null
  }
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/x-icon': 'ico',
  }
  return map[mime.toLowerCase()] || 'png'
}

function extFromFileName(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : null
}

async function saveImageToDisk(opts: {
  /** 本地绝对路径（优先：直接复制，质量无损） */
  localPath?: string | null
  /** 可 fetch 的 src：app:// / data: / https: */
  src?: string
  defaultName?: string
}): Promise<void> {
  const defaultName = opts.defaultName || `image-${Date.now()}.png`
  const extHint = extFromFileName(defaultName) || 'png'
  const filters = [
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] },
    { name: 'All Files', extensions: ['*'] },
  ]

  try {
    if (opts.localPath) {
      const result = await window.api.fs.saveAs({
        title: '保存图片',
        defaultPath: defaultName,
        filters,
        sourcePath: opts.localPath,
      })
      if (!result.canceled) {
        antdMessage.success('已保存')
      }
      return
    }

    if (!opts.src) {
      antdMessage.warning('没有可保存的图片')
      return
    }

    const packed = await fetchImageAsBase64(opts.src)
    if (!packed) {
      antdMessage.error('读取图片失败')
      return
    }

    const name =
      extFromFileName(defaultName) ? defaultName : `${defaultName.replace(/\.[^.]+$/, '')}.${packed.ext || extHint}`

    const result = await window.api.fs.saveAs({
      title: '保存图片',
      defaultPath: name,
      filters,
      dataBase64: packed.base64,
    })
    if (!result.canceled) {
      antdMessage.success('已保存')
    }
  } catch (err) {
    antdMessage.error(err instanceof Error ? err.message : '保存失败')
  }
}

const imageToolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderTop: '1px solid rgba(0,0,0,0.06)',
  background: 'rgba(0,0,0,0.02)',
}

const imageCardStyle: CSSProperties = {
  margin: '6px 0',
  maxWidth: '100%',
  border: '1px solid rgba(0,0,0,0.06)',
  borderRadius: 8,
  overflow: 'hidden',
  background: '#fff',
  display: 'inline-block',
  verticalAlign: 'top',
}

/** 通用图片卡片：预览 + 保存（+ 可选打开本地文件） */
function ChatImageCard({
  src,
  alt,
  title,
  localPath,
  defaultName,
  maxHeight,
}: {
  src: string
  alt?: string
  title?: string
  localPath?: string | null
  defaultName?: string
  maxHeight?: number | string
}): ReactElement {
  const [saving, setSaving] = useState(false)
  const name = defaultName || alt || fileBaseName(localPath || '') || `image-${Date.now()}.png`

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await saveImageToDisk({ localPath, src, defaultName: name })
    } finally {
      setSaving(false)
    }
  }

  const handleOpen = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (localPath) void openLocalPath(localPath)
  }

  return (
    <div style={imageCardStyle}>
      <img
        src={src}
        alt={alt || name}
        title={title || localPath || alt}
        style={{
          maxWidth: '100%',
          maxHeight: maxHeight ?? 480,
          display: 'block',
          cursor: localPath ? 'pointer' : 'default',
          objectFit: 'contain',
        }}
        onClick={localPath ? handleOpen : undefined}
      />
      <div style={imageToolbarStyle}>
        <Button
          type="text"
          size="small"
          icon={<DownloadOutlined />}
          loading={saving}
          onClick={() => void handleSave()}
        >
          保存图片
        </Button>
        {localPath ? (
          <Button
            type="text"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={handleOpen}
          >
            打开
          </Button>
        ) : null}
        {localPath || name ? (
          <span
            style={{
              fontSize: 11,
              color: 'rgba(0,0,0,0.45)',
              marginLeft: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 220,
            }}
            title={localPath || name}
          >
            {fileBaseName(localPath || name)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** 本地图片 / 文件：React 直出，不经 markdown */
function LocalFileView({ fsPath }: { fsPath: string }): ReactElement {
  const name = fileBaseName(fsPath)
  const open = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    void openLocalPath(fsPath)
  }

  if (isImagePath(fsPath)) {
    return (
      <ChatImageCard
        src={toLocalMediaSrc(fsPath) || fsPath}
        alt={name}
        title={fsPath}
        localPath={fsPath}
        defaultName={name}
      />
    )
  }

  return (
    <div style={{ margin: '4px 0' }}>
      <a
        href="#"
        title={fsPath}
        onClick={open}
        style={{ color: '#1677ff', wordBreak: 'break-all' }}
      >
        <FileOutlined style={{ marginRight: 4 }} />
        {name}
      </a>
      <div
        style={{
          fontSize: 11,
          color: 'rgba(0,0,0,0.45)',
          wordBreak: 'break-all',
          marginTop: 2,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {fsPath}
      </div>
      <div style={{ marginTop: 4 }}>
        <Button
          type="text"
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => {
            void window.api.fs
              .saveAs({
                title: '保存文件',
                defaultPath: name,
                sourcePath: fsPath,
              })
              .then((r) => {
                if (!r.canceled) antdMessage.success('已保存')
              })
              .catch((err: unknown) => {
                antdMessage.error(err instanceof Error ? err.message : '保存失败')
              })
          }}
        >
          另存为
        </Button>
        <Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={open}>
          打开
        </Button>
      </div>
    </div>
  )
}

/** 规范化 SVG 字符串，保证可作为 Image 加载 */
function serializeSvgForExport(svg: SVGSVGElement): { svgString: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  // 去掉交互 transform，导出静态原图
  clone.style.transform = ''
  clone.style.transformOrigin = ''

  const rect = svg.getBoundingClientRect()
  const vb = svg.viewBox?.baseVal
  let width = Math.max(
    rect.width || 0,
    Number.parseFloat(svg.getAttribute('width') || '') || 0,
    vb?.width || 0
  )
  let height = Math.max(
    rect.height || 0,
    Number.parseFloat(svg.getAttribute('height') || '') || 0,
    vb?.height || 0
  )
  if (!width || !height) {
    try {
      const box = svg.getBBox()
      width = Math.max(width, box.width || 0)
      height = Math.max(height, box.height || 0)
    } catch {
      /* getBBox 在未挂载时可能抛错 */
    }
  }
  width = Math.ceil(width || 640)
  height = Math.ceil(height || 360)

  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  if (!clone.getAttribute('viewBox') && width && height) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }

  return {
    svgString: new XMLSerializer().serializeToString(clone),
    width,
    height,
  }
}

function triggerDownload(href: string, fileName: string): void {
  const link = document.createElement('a')
  link.download = fileName
  link.href = href
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** 将 SVG 导出为 PNG；失败时回退下载 .svg */
async function downloadSvgAsPng(svg: SVGSVGElement, fileNameBase: string): Promise<'png' | 'svg'> {
  const { svgString, width, height } = serializeSvgForExport(svg)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * dpr)
    canvas.height = Math.ceil(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)

    // data URL 比 blob URL 在 Electron 里更稳（避免 CSP / taint 问题）
    const dataUrl =
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('svg image load failed'))
      image.src = dataUrl
    })
    ctx.drawImage(img, 0, 0, width, height)
    triggerDownload(canvas.toDataURL('image/png', 1), `${fileNameBase}.png`)
    return 'png'
  } catch {
    // PNG 失败时至少给用户 SVG 原文
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      triggerDownload(url, `${fileNameBase}.svg`)
      return 'svg'
    } finally {
      // 延迟 revoke，避免下载被中断
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    }
  }
}

/**
 * 自渲染 Mermaid + 底部操作：复制原文 / 导出图片。
 * 不依赖 @ant-design/x Mermaid 内部 DOM，避免 querySelector 找不到 svg。
 */
function MermaidView({ source }: { source: string }): ReactElement {
  const graphRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [ready, setReady] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setRenderError(null)

    const run = async (): Promise<void> => {
      const el = graphRef.current
      if (!el || !source.trim()) return
      el.innerHTML = ''
      ensureMermaid()
      try {
        // mermaid 要求 id 以字母开头且全局唯一
        const id = `ccMermaid${++mermaidRenderSeq}`
        const { svg } = await mermaid.render(id, source.trim())
        if (cancelled || !graphRef.current) return
        graphRef.current.innerHTML = svg
        setReady(true)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setRenderError(msg)
        setReady(false)
        if (graphRef.current) {
          graphRef.current.innerHTML = ''
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [source])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      antdMessage.error('复制失败')
    }
  }, [source])

  const handleExport = useCallback(async () => {
    const svg = graphRef.current?.querySelector('svg')
    if (!svg) {
      antdMessage.warning(renderError ? `图渲染失败：${renderError}` : '图尚未渲染完成，请稍后再试')
      return
    }
    setExporting(true)
    try {
      const kind = await downloadSvgAsPng(svg, `mermaid-${Date.now()}`)
      if (kind === 'svg') {
        antdMessage.info('PNG 转换失败，已改为导出 SVG')
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }, [renderError])

  if (!source.trim()) {
    return <pre style={{ margin: 0, fontSize: 12 }}>```mermaid</pre>
  }

  return (
    <div
      style={{
        margin: '8px 0',
        maxWidth: '100%',
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <div style={{ maxWidth: '100%', overflow: 'auto', padding: 12 }}>
        {renderError ? (
          <div style={{ color: '#cf1322', fontSize: 12, whiteSpace: 'pre-wrap' }}>
            Mermaid 渲染失败：{renderError}
            <pre
              style={{
                marginTop: 8,
                padding: 8,
                background: 'rgba(0,0,0,0.04)',
                borderRadius: 6,
                fontSize: 11,
                overflow: 'auto',
              }}
            >
              {source}
            </pre>
          </div>
        ) : null}
        <div
          ref={graphRef}
          style={{
            display: renderError ? 'none' : 'flex',
            justifyContent: 'center',
            minHeight: ready ? undefined : 48,
          }}
        />
        {!ready && !renderError ? (
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', textAlign: 'center' }}>
            图表渲染中…
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(0,0,0,0.02)',
        }}
      >
        <Button
          type="text"
          size="small"
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={() => void handleCopy()}
        >
          {copied ? '已复制' : '复制原文'}
        </Button>
        <Button
          type="text"
          size="small"
          icon={<DownloadOutlined />}
          loading={exporting}
          disabled={!ready}
          onClick={() => void handleExport()}
        >
          导出图片
        </Button>
      </div>
    </div>
  )
}

interface MarkdownRenderProps {
  content: string
  markdownComponents: Record<string, unknown>
  markdownDompurifyConfig: Record<string, unknown>
  markdownConfig: { extensions: ReturnType<typeof Latex> }
}

function XMarkdownBlock({
  content,
  markdownComponents,
  markdownDompurifyConfig,
  markdownConfig,
}: {
  content: string
  markdownComponents: Record<string, unknown>
  markdownDompurifyConfig: Record<string, unknown>
  markdownConfig: { extensions: ReturnType<typeof Latex> }
}): ReactElement {
  return (
    <XMarkdown
      content={content}
      openLinksInNewTab
      components={markdownComponents}
      dompurifyConfig={markdownDompurifyConfig}
      config={markdownConfig}
      // 允许正文内嵌安全 HTML（标题/列表/表格等已由 MD 覆盖；此处给粘贴的 <b>/<br> 等）
      escapeRawHtml={false}
    />
  )
}

/** 分段渲染：文件 / mermaid 用 React，其余走 XMarkdown（含 LaTeX） */
function SegmentedMarkdown({
  content,
  markdownComponents,
  markdownDompurifyConfig,
  markdownConfig,
}: MarkdownRenderProps): ReactElement {
  const segments = useMemo(() => splitContentSegments(content), [content])

  if (segments.length === 0) {
    return (
      <XMarkdownBlock
        content={content || ''}
        markdownComponents={markdownComponents}
        markdownDompurifyConfig={markdownDompurifyConfig}
        markdownConfig={markdownConfig}
      />
    )
  }

  if (segments.length === 1 && segments[0].kind === 'md') {
    return (
      <XMarkdownBlock
        content={segments[0].text}
        markdownComponents={markdownComponents}
        markdownDompurifyConfig={markdownDompurifyConfig}
        markdownConfig={markdownConfig}
      />
    )
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {segments.map((seg, i) => {
        if (seg.kind === 'file') {
          return <LocalFileView key={`f-${i}-${seg.fsPath}`} fsPath={seg.fsPath} />
        }
        if (seg.kind === 'mermaid') {
          return <MermaidView key={`mm-${i}`} source={seg.source} />
        }
        return (
          <XMarkdownBlock
            key={`m-${i}`}
            content={seg.text}
            markdownComponents={markdownComponents}
            markdownDompurifyConfig={markdownDompurifyConfig}
            markdownConfig={markdownConfig}
          />
        )
      })}
    </div>
  )
}

function attachmentImageSrc(att: AttachmentPayload): string | undefined {
  if (att.localPath) {
    return toLocalMediaSrc(att.localPath) || undefined
  }
  if (att.content) {
    return `data:${att.mimeType || 'image/png'};base64,${att.content}`
  }
  return undefined
}

/** OpenClaw MessagePresentation 卡片（桌面端可读渲染） */
function PresentationCardView({
  presentation,
  onSendCommand,
}: {
  presentation: MessagePresentation
  onSendCommand?: (command: string) => void
}): ReactElement {
  const accent = toneColor(presentation.tone)

  const runButton = (btn: PresentationButton): void => {
    if (btn.disabled) return
    if (btn.url) {
      void window.api.shell.openExternal(btn.url)
      return
    }
    const action = btn.action
    if (action?.type === 'command') {
      if (onSendCommand) {
        onSendCommand(action.command)
      } else {
        void navigator.clipboard.writeText(action.command)
        antdMessage.success('命令已复制，可粘贴发送')
      }
      return
    }
    const callbackValue =
      action?.type === 'callback' ? action.value : btn.value
    if (callbackValue) {
      antdMessage.info('此按钮为渠道回调，需在飞书/微信等渠道内点击')
      return
    }
    antdMessage.info('此按钮暂无可执行动作')
  }

  const runOption = (opt: PresentationOption): void => {
    if (opt.action?.type === 'command') {
      if (onSendCommand) onSendCommand(opt.action.command)
      else {
        void navigator.clipboard.writeText(opt.action.command)
        antdMessage.success('命令已复制')
      }
      return
    }
    if (opt.action?.type === 'callback' || opt.value) {
      antdMessage.info('此选项为渠道回调，需在飞书/微信等渠道内选择')
      return
    }
  }

  return (
    <div
      style={{
        margin: '8px 0',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 10,
        overflow: 'hidden',
        background: '#fff',
        maxWidth: 420,
      }}
    >
      {presentation.title ? (
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            background: `${accent}14`,
            borderLeft: `3px solid ${accent}`,
            fontWeight: 600,
            fontSize: 14,
            color: 'rgba(0,0,0,0.88)',
          }}
        >
          {presentation.title}
          {presentation.source ? (
            <span
              style={{
                marginLeft: 8,
                fontWeight: 400,
                fontSize: 11,
                color: 'rgba(0,0,0,0.45)',
              }}
            >
              {presentation.source}
            </span>
          ) : null}
        </div>
      ) : null}
      <div style={{ padding: '10px 12px', display: 'grid', gap: 10 }}>
        {presentation.blocks.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div
                key={i}
                style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {block.text}
              </div>
            )
          }
          if (block.type === 'context') {
            return (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  color: 'rgba(0,0,0,0.45)',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {block.text}
              </div>
            )
          }
          if (block.type === 'divider') {
            return (
              <div
                key={i}
                style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '2px 0' }}
              />
            )
          }
          if (block.type === 'buttons') {
            return (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {block.buttons.map((btn, j) => (
                  <Button
                    key={j}
                    size="small"
                    type={buttonAntType(btn.style)}
                    danger={buttonDanger(btn.style)}
                    disabled={btn.disabled}
                    onClick={() => runButton(btn)}
                  >
                    {btn.label}
                  </Button>
                ))}
              </div>
            )
          }
          if (block.type === 'select') {
            return (
              <div key={i} style={{ display: 'grid', gap: 6 }}>
                {block.placeholder ? (
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{block.placeholder}</div>
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {block.options.map((opt, j) => (
                    <Button key={j} size="small" onClick={() => runOption(opt)}>
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            )
          }
          return null
        })}
      </div>
      <div
        style={{
          padding: '4px 12px 8px',
          fontSize: 11,
          color: 'rgba(0,0,0,0.35)',
        }}
      >
        交互卡片预览 · 链接可打开 · command 可发送 · 渠道回调需在飞书/微信内完成
      </div>
    </div>
  )
}

/** 渠道「回复引用」条：展示被回复的原文 */
function ReplyQuoteBar({ text }: { text: string }): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        marginBottom: 8,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.04)',
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          width: 3,
          flexShrink: 0,
          borderRadius: 2,
          background: '#1677ff',
          alignSelf: 'stretch',
          minHeight: 28,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(0,0,0,0.45)',
            marginBottom: 2,
            lineHeight: 1.2,
          }}
        >
          回复
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'rgba(0,0,0,0.65)',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={text}
        >
          {text}
        </div>
      </div>
    </div>
  )
}

function AttachmentGallery({
  attachments,
  tokenColorTextSecondary,
  maxHeight = 280,
}: {
  attachments: AttachmentPayload[]
  tokenColorTextSecondary: string
  maxHeight?: number
}): ReactElement {
  return (
    <div style={{ marginBottom: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {attachments.map((att, i) => {
        if (att.category === 'image') {
          const src = attachmentImageSrc(att)
          if (!src) {
            return (
              <span key={i} style={{ fontSize: 12, color: tokenColorTextSecondary }}>
                <FileOutlined style={{ marginRight: 4 }} />
                {att.fileName}
              </span>
            )
          }
          return (
            <ChatImageCard
              key={i}
              src={src}
              alt={att.fileName}
              localPath={att.localPath}
              defaultName={att.fileName || `image-${Date.now()}.png`}
              maxHeight={maxHeight}
            />
          )
        }
        if (att.localPath) {
          return <LocalFileView key={i} fsPath={att.localPath} />
        }
        return (
          <span key={i} style={{ fontSize: 12, color: tokenColorTextSecondary }}>
            <FileOutlined style={{ marginRight: 4 }} />
            {att.fileName}
          </span>
        )
      })}
    </div>
  )
}

export function useChatBubbles({
  messages,
  tokenColorTextSecondary,
  showThinking,
  showToolCalls,
  showUsage,
  onCopied,
  onSendCommand,
}: UseChatBubblesArgs): {
  bubbleItems: BubbleListProps['items']
  bubbleRoles: BubbleListProps['role']
} {
  const markdownComponents = useMemo(
    () => ({
      img: (props: { src?: string; alt?: string; title?: string }): ReactElement => {
        const rawSrc = props.src || ''
        const mappedSrc = toLocalMediaSrc(rawSrc) || rawSrc
        const localPath = normalizeToFsPath(rawSrc)
        const defaultName =
          props.alt && /\.[a-z0-9]+$/i.test(props.alt)
            ? props.alt
            : localPath
              ? fileBaseName(localPath)
              : `image-${Date.now()}.png`
        if (!mappedSrc) {
          return <span>{props.alt || '[image]'}</span>
        }
        return (
          <ChatImageCard
            src={mappedSrc}
            alt={props.alt}
            title={props.title}
            localPath={localPath}
            defaultName={defaultName}
          />
        )
      },
      // 本地文件链接：hover 有样式但原先走 openLinksInNewTab → openExternal，打不开本地路径
      a: (props: {
        href?: string
        title?: string
        children?: ReactNode
      }): ReactElement => {
        const href = props.href || ''
        const local = isLocalFileHref(href)
        if (local) {
          return (
            <a
              href={href}
              title={props.title || normalizeToFsPath(href) || href}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void openLocalPath(href)
              }}
            >
              {props.children}
            </a>
          )
        }
        return (
          <a
            href={href}
            title={props.title}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              // 开发态 Vite 下也避免外链被 SPA 吞掉
              if (href.startsWith('http://') || href.startsWith('https://')) {
                e.preventDefault()
                void window.api.shell.openExternal(href)
              }
            }}
          >
            {props.children}
          </a>
        )
      },
    }),
    []
  )

  const markdownDompurifyConfig = useMemo(
    () => ({
      // app:// 本地预览 + 常规外链
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto|tel|app|file|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
      // 粘贴的轻量 HTML / 富文本常用标签（仍经 DOMPurify 消毒）
      ADD_TAGS: ['video', 'source', 'picture'],
      ADD_ATTR: ['target', 'rel', 'controls', 'poster'],
    }),
    []
  )

  const markdownConfig = useMemo(
    () => ({
      extensions: latexExtensions,
      gfm: true,
      breaks: false,
    }),
    []
  )

  const bubbleItems: BubbleListProps['items'] = useMemo(
    () =>
      messages
        .map((chatMsg) => {
          if (chatMsg.role === 'assistant') {
            const hasText = Boolean(chatMsg.content?.trim()) || Boolean(chatMsg.streaming)
            const hasThinking = showThinking && Boolean(chatMsg.thinking?.trim())
            const hasTools = showToolCalls && Boolean(chatMsg.toolCalls?.length)
            const hasAttachments = Boolean(chatMsg.attachments?.length)
            const hasCards = Boolean(chatMsg.presentations?.length)
            const hasVisibleContent =
              hasText || hasThinking || hasTools || hasAttachments || hasCards

            // 当前开关下没有可见内容时，整条 assistant 气泡不渲染，避免出现空白气泡
            if (!hasVisibleContent) return null
          }

          return {
            key: chatMsg.id,
            role: chatMsg.role === 'assistant' ? 'ai' : 'user',
            content:
              chatMsg.role === 'assistant' ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {showThinking && chatMsg.thinking ? (
                    <Think defaultExpanded={false}>
                      <SegmentedMarkdown
                        content={chatMsg.thinking}
                        markdownComponents={markdownComponents}
                        markdownDompurifyConfig={markdownDompurifyConfig}
                        markdownConfig={markdownConfig}
                      />
                    </Think>
                  ) : null}
                  {showToolCalls && chatMsg.toolCalls && chatMsg.toolCalls.length > 0 ? (
                    <ThoughtChain
                      items={chatMsg.toolCalls.map((toolCall) => ({
                        key: toolCall.id,
                        title: toolCall.name,
                        status: toolCall.status,
                        collapsible: Boolean(toolCall.argumentsText || toolCall.resultText),
                        content:
                          toolCall.argumentsText || toolCall.resultText ? (
                            <div style={{ display: 'grid', gap: 8 }}>
                              {toolCall.argumentsText ? (
                                <pre
                                  style={{
                                    margin: 0,
                                    padding: 8,
                                    borderRadius: 6,
                                    background: 'rgba(0,0,0,0.04)',
                                    whiteSpace: 'pre-wrap',
                                    fontSize: 12,
                                    color: tokenColorTextSecondary,
                                  }}
                                >
                                  {toolCall.argumentsText}
                                </pre>
                              ) : null}
                              {toolCall.resultText ? (
                                <SegmentedMarkdown
                                  content={toolCall.resultText}
                                  markdownComponents={markdownComponents}
                                  markdownDompurifyConfig={markdownDompurifyConfig}
                                  markdownConfig={markdownConfig}
                                />
                              ) : null}
                            </div>
                          ) : undefined,
                      }))}
                      line="dashed"
                    />
                  ) : null}
                  {chatMsg.replyTo ? <ReplyQuoteBar text={chatMsg.replyTo} /> : null}
                  {chatMsg.presentations?.map((p, i) => (
                    <PresentationCardView
                      key={`card-${i}-${p.title || ''}`}
                      presentation={p}
                      onSendCommand={onSendCommand}
                    />
                  ))}
                  {chatMsg.attachments && chatMsg.attachments.length > 0 ? (
                    <AttachmentGallery
                      attachments={chatMsg.attachments}
                      tokenColorTextSecondary={tokenColorTextSecondary}
                      maxHeight={360}
                    />
                  ) : null}
                  {(chatMsg.content || chatMsg.streaming) && (
                    <SegmentedMarkdown
                      content={chatMsg.content || (chatMsg.streaming ? '...' : '')}
                      markdownComponents={markdownComponents}
                      markdownDompurifyConfig={markdownDompurifyConfig}
                      markdownConfig={markdownConfig}
                    />
                  )}
                </div>
              ) : (
                <div>
                  {chatMsg.replyTo ? <ReplyQuoteBar text={chatMsg.replyTo} /> : null}
                  {chatMsg.attachments && chatMsg.attachments.length > 0 ? (
                    <AttachmentGallery
                      attachments={chatMsg.attachments}
                      tokenColorTextSecondary={tokenColorTextSecondary}
                      maxHeight={150}
                    />
                  ) : null}
                  {/* 用户消息同样走 Markdown / 本地文件 / Mermaid / LaTeX */}
                  {chatMsg.content ? (
                    <SegmentedMarkdown
                      content={chatMsg.content}
                      markdownComponents={markdownComponents}
                      markdownDompurifyConfig={markdownDompurifyConfig}
                      markdownConfig={markdownConfig}
                    />
                  ) : null}
                </div>
              ),
            // ant-design/x 的 Bubble 在 loading=true 时会覆盖正文，
            // 仅在还没有任何可见内容时显示 loading，占位避免“整段最终才出现”。
            loading:
              chatMsg.role === 'assistant'
                ? Boolean(
                    chatMsg.streaming &&
                    !(
                      chatMsg.content?.trim() ||
                      chatMsg.thinking?.trim() ||
                      chatMsg.toolCalls?.length ||
                      chatMsg.attachments?.length ||
                      chatMsg.presentations?.length
                    )
                  )
                : false,
            footer:
              chatMsg.role === 'assistant' && !chatMsg.streaming ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  {showUsage &&
                    (chatMsg.model || chatMsg.provider || chatMsg.usage || chatMsg.durationMs) && (
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                        {[
                          shortenModelName(chatMsg.model),
                          chatMsg.provider,
                          chatMsg.usage
                            ? formatCompactNumber(chatMsg.usage.totalTokens)
                            : undefined,
                          chatMsg.durationMs
                            ? `${(chatMsg.durationMs / 1000).toFixed(1)}s`
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    style={{ fontSize: 12, color: '#999', padding: '0 4px', height: 'auto' }}
                    onClick={() => {
                      navigator.clipboard.writeText(chatMsg.content)
                      onCopied()
                    }}
                  />
                </div>
              ) : undefined,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    [
      markdownComponents,
      markdownConfig,
      markdownDompurifyConfig,
      messages,
      onCopied,
      onSendCommand,
      showThinking,
      showToolCalls,
      showUsage,
      tokenColorTextSecondary,
    ]
  )

  const bubbleRoles: BubbleListProps['role'] = useMemo(
    () => ({
      ai: {
        placement: 'start',
        avatar: <Avatar style={{ background: '#FF4D2A', color: '#fff', flexShrink: 0 }}>A</Avatar>,
      },
      user: {
        placement: 'end',
        avatar: <Avatar style={{ background: '#1677ff', color: '#fff', flexShrink: 0 }}>U</Avatar>,
      },
    }),
    []
  )

  return { bubbleItems, bubbleRoles }
}
