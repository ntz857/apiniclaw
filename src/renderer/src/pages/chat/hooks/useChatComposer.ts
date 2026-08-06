import { useCallback, useEffect, useRef, useState } from 'react'
import type { UploadFile } from 'antd'
import type { AttachmentPayload } from '../../../hooks/useGatewayWs'
import { buildAttachmentPayloads } from '../chat-page.utils'

interface SessionDraft {
  text: string
  files: UploadFile[]
}

interface UseChatComposerArgs {
  sendMessage: (text: string, attachments?: AttachmentPayload[]) => void
  /** 当前会话 key；切换时草稿随会话走 */
  sessionKey?: string | null
}

const emptyDraft = (): SessionDraft => ({ text: '', files: [] })

export function useChatComposer({ sendMessage, sessionKey }: UseChatComposerArgs) {
  const [inputValue, setInputValue] = useState('')
  const [attachFiles, setAttachFiles] = useState<UploadFile[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const attachRef = useRef(null)

  /** 各会话未发送草稿（文本 + 附件列表） */
  const draftsRef = useRef<Map<string, SessionDraft>>(new Map())
  /** 当前绑定的 sessionKey（用于切换时落盘草稿） */
  const activeKeyRef = useRef<string | null>(null)

  // 会话切换：保存旧草稿，恢复新会话草稿
  useEffect(() => {
    const nextKey = sessionKey?.trim() || null
    const prevKey = activeKeyRef.current

    if (prevKey && prevKey !== nextKey) {
      draftsRef.current.set(prevKey, {
        text: inputValue,
        files: attachFiles,
      })
    }

    activeKeyRef.current = nextKey

    if (!nextKey) {
      setInputValue('')
      setAttachFiles([])
      setAttachOpen(false)
      return
    }

    const draft = draftsRef.current.get(nextKey) ?? emptyDraft()
    setInputValue(draft.text)
    setAttachFiles(draft.files)
    setAttachOpen(false)
    // 仅在 sessionKey 变化时切换；inputValue/attachFiles 由草稿表维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  // 同步当前会话草稿（输入中）
  useEffect(() => {
    const key = activeKeyRef.current
    if (!key) return
    draftsRef.current.set(key, { text: inputValue, files: attachFiles })
  }, [inputValue, attachFiles])

  const handleSend = useCallback(
    (text: string): void => {
      if (!text.trim() && !attachFiles.length) return

      const key = activeKeyRef.current
      const filesSnapshot = attachFiles

      // 先清空当前会话草稿与输入框
      setInputValue('')
      setAttachFiles([])
      setAttachOpen(false)
      if (key) {
        draftsRef.current.set(key, emptyDraft())
      }

      const doSend = async (): Promise<void> => {
        let payloads: AttachmentPayload[] | undefined
        if (filesSnapshot.length > 0) {
          payloads = await buildAttachmentPayloads(filesSnapshot)
        }
        sendMessage(text, payloads)
      }

      void doSend()
    },
    [attachFiles, sendMessage]
  )

  return {
    inputValue,
    setInputValue,
    attachFiles,
    setAttachFiles,
    attachOpen,
    setAttachOpen,
    attachRef,
    handleSend,
  }
}
