import { Conversations } from '@ant-design/x'
import { Button, Layout } from 'antd'
import { ClearOutlined, DeleteOutlined, MessageOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'

const { Sider } = Layout

const WIDTH_STORAGE_KEY = 'clickclaw.chat.sessionsSiderWidth'
const MIN_WIDTH = 180
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 240

interface ChatSessionItem {
  key: string
  label: string
  updatedAt?: number
}

interface ChatSessionsSiderProps {
  status: string
  isStreaming: boolean
  sessions: ChatSessionItem[]
  sessionKey?: string | null
  tokenBgContainer: string
  tokenBorderColor: string
  tokenTextTertiary: string
  onOpenNewSession: () => void
  onSwitchSession: (key: string) => void
  onResetSession: (key: string) => void
  onDeleteSession: (key: string) => void
  t: TFunction
}

function loadSiderWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return Math.round(n)
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH
}

export function ChatSessionsSider({
  status,
  isStreaming,
  sessions,
  sessionKey,
  tokenBgContainer,
  tokenBorderColor,
  tokenTextTertiary,
  onOpenNewSession,
  onSwitchSession,
  onResetSession,
  onDeleteSession,
  t,
}: ChatSessionsSiderProps): React.ReactElement {
  const [width, setWidth] = useState<number>(() => loadSiderWidth())
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const persistWidth = useCallback((next: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next)))
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped))
    } catch {
      // ignore
    }
    return clamped
  }, [])

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragStateRef.current = { startX: e.clientX, startWidth: width }
      setDragging(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width]
  )

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent): void => {
      const state = dragStateRef.current
      if (!state) return
      const next = state.startWidth + (e.clientX - state.startX)
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next))))
    }

    const onUp = (): void => {
      dragStateRef.current = null
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => persistWidth(w))
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, persistWidth])

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`

  const groups = sessions.reduce<Array<{ key: string; title: string; items: ChatSessionItem[] }>>(
    (acc, session) => {
      const date = session.updatedAt ? new Date(session.updatedAt) : new Date(0)
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      let title = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')}`
      if (dayKey === todayKey) title = t('chat.sessions.group.today')
      else if (dayKey === yesterdayKey) title = t('chat.sessions.group.yesterday')

      const existing = acc.find((group) => group.key === dayKey)
      if (existing) {
        existing.items.push(session)
      } else {
        acc.push({ key: dayKey, title, items: [session] })
      }
      return acc
    },
    []
  )

  // 图标 + 右侧菜单 + 左右边距，预留给标题文本
  const labelMaxWidth = Math.max(80, width - 86)

  return (
    <Sider
      width={width}
      style={{
        background: tokenBgContainer,
        borderRight: `1px solid ${tokenBorderColor}`,
        overflow: 'hidden',
        position: 'relative',
        flex: '0 0 auto',
      }}
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 12px 8px' }}>
          <Button
            block
            type="primary"
            icon={<MessageOutlined />}
            onClick={onOpenNewSession}
            disabled={status !== 'ready' || isStreaming}
            style={{ background: '#FF4D2A', borderColor: '#FF4D2A' }}
          >
            {t('chat.sessions.newSession')}
          </Button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {sessions.length === 0 ? (
            <div
              style={{
                padding: '20px 16px',
                textAlign: 'center',
                color: tokenTextTertiary,
                fontSize: 13,
              }}
            >
              {t('chat.sessions.empty')}
            </div>
          ) : (
            <div style={{ paddingBottom: 8 }}>
              {groups.map((group) => (
                <div key={group.key} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      padding: '8px 14px 4px',
                      fontSize: 11,
                      color: tokenTextTertiary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    {group.title}
                  </div>
                  <Conversations
                    activeKey={sessionKey || undefined}
                    onActiveChange={(key) => onSwitchSession(key)}
                    items={group.items.map((s) => ({
                      key: s.key,
                      label: (
                        <span
                          title={s.label}
                          style={{
                            display: 'inline-block',
                            maxWidth: labelMaxWidth,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            verticalAlign: 'bottom',
                          }}
                        >
                          {s.label}
                        </span>
                      ),
                      icon: <MessageOutlined style={{ color: '#FF4D2A' }} />,
                    }))}
                    menu={(conversation) => ({
                      items: [
                        {
                          key: 'reset',
                          label: t('chat.sessions.resetSession'),
                          icon: <ClearOutlined />,
                        },
                        {
                          key: 'delete',
                          label: t('chat.sessions.deleteSession'),
                          icon: <DeleteOutlined />,
                          danger: true,
                        },
                      ],
                      onClick: ({ key }: { key: string }) => {
                        if (key === 'reset') onResetSession(conversation.key)
                        if (key === 'delete') onDeleteSession(conversation.key)
                      },
                    })}
                    styles={{
                      item: { borderRadius: 6, margin: '2px 8px' },
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 左右拖动调宽手柄 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('chat.sessions.resizeHandle')}
        title={t('chat.sessions.resizeHandle')}
        onMouseDown={onResizeMouseDown}
        style={{
          position: 'absolute',
          top: 0,
          right: -3,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 20,
          background: dragging ? 'rgba(255, 77, 42, 0.35)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!dragging) e.currentTarget.style.background = 'rgba(255, 77, 42, 0.18)'
        }}
        onMouseLeave={(e) => {
          if (!dragging) e.currentTarget.style.background = 'transparent'
        }}
      />
    </Sider>
  )
}
