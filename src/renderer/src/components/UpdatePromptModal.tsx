/**
 * 全局更新提示弹窗
 *
 * - 发现新版本（available）：立即下载 / 稍后
 * - 下载完成（downloaded）：安装并重启 / 稍后
 * - 同一阶段 + 同一版本号，本会话只自动弹出一次（「稍后」后不再打扰）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Button, Typography, Space } from 'antd'
import { CloudDownloadOutlined, RocketOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Text, Paragraph } = Typography

type PromptKind = 'available' | 'downloaded'

function dismissKey(kind: PromptKind, version: string): string {
  return `${kind}:${version}`
}

export function UpdatePromptModal(): React.ReactElement | null {
  const { t } = useTranslation()
  const [kind, setKind] = useState<PromptKind | null>(null)
  const [version, setVersion] = useState<string | undefined>()
  const [open, setOpen] = useState(false)
  const dismissedRef = useRef(new Set<string>())

  const tryOpen = useCallback((nextKind: PromptKind, nextVersion?: string) => {
    if (!nextVersion) return
    const key = dismissKey(nextKind, nextVersion)
    if (dismissedRef.current.has(key)) return
    setKind(nextKind)
    setVersion(nextVersion)
    setOpen(true)
  }, [])

  useEffect(() => {
    let cancelled = false

    const apply = (info: UpdateInfo): void => {
      if (cancelled) return
      if (info.status === 'available') {
        tryOpen('available', info.version)
        return
      }
      if (info.status === 'downloaded') {
        tryOpen('downloaded', info.version)
      }
    }

    window.api.update.getInfo().then(apply)
    const off = window.api.update.onStatusChanged(apply)
    return () => {
      cancelled = true
      off()
    }
  }, [tryOpen])

  const markDismissed = (): void => {
    if (kind && version) {
      dismissedRef.current.add(dismissKey(kind, version))
    }
  }

  const handleLater = (): void => {
    markDismissed()
    setOpen(false)
  }

  const handlePrimary = (): void => {
    markDismissed()
    setOpen(false)
    if (kind === 'available') {
      window.api.update.download()
      return
    }
    if (kind === 'downloaded') {
      window.api.update.install()
    }
  }

  if (!kind || !version) return null

  const isAvailable = kind === 'available'
  const title = isAvailable
    ? t('app.updatePrompt.availableTitle')
    : t('app.updatePrompt.downloadedTitle')
  const description = isAvailable
    ? t('app.updatePrompt.availableDesc', { version })
    : t('app.updatePrompt.downloadedDesc', { version })
  const primaryText = isAvailable
    ? t('app.updatePrompt.downloadNow')
    : t('app.updatePrompt.installNow')
  const PrimaryIcon = isAvailable ? CloudDownloadOutlined : RocketOutlined

  return (
    <Modal
      open={open}
      title={title}
      centered
      maskClosable={false}
      keyboard
      onCancel={handleLater}
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={handleLater}>{t('app.updatePrompt.later')}</Button>
          <Button type="primary" icon={<PrimaryIcon />} onClick={handlePrimary}>
            {primaryText}
          </Button>
        </Space>
      }
    >
      <Paragraph style={{ marginBottom: 8 }}>{description}</Paragraph>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('app.updatePrompt.hint')}
      </Text>
    </Modal>
  )
}
