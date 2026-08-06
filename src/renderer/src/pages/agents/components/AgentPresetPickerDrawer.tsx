/**
 * 智能体预设选择器
 * - 一键添加前可改显示名 / id
 * - 空白自定义走完整表单
 */

import { useEffect, useState } from 'react'
import { Button, Drawer, Input, Modal, Space, Tag, Typography } from 'antd'
import { EditOutlined, PlusOutlined, RightOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { TITLE_BAR_HEIGHT } from '../../../components/TitleBar'
import {
  AGENT_PRESETS,
  allocateAgentId,
  sanitizeAgentId,
  type AgentPreset,
  type AgentPresetCategory,
} from '../agent-presets.data'

const { Text } = Typography

export interface AgentPresetCreatePayload {
  preset: AgentPreset
  id: string
  displayName: string
}

export interface AgentPresetPickerDrawerProps {
  open: boolean
  existingIds: string[]
  creating?: boolean
  onClose: () => void
  onPickPreset: (payload: AgentPresetCreatePayload) => void
  onPickCustom: () => void
}

const CATEGORY_ORDER: AgentPresetCategory[] = [
  'work',
  'create',
  'marketing',
  'dev',
  'ops',
  'industry',
]

export function AgentPresetPickerDrawer({
  open,
  existingIds,
  creating,
  onClose,
  onPickPreset,
  onPickCustom,
}: AgentPresetPickerDrawerProps): React.ReactElement {
  const { t } = useTranslation()
  const used = new Set(existingIds.map((id) => id.trim().toLowerCase()))

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<AgentPreset | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [idInput, setIdInput] = useState('')
  const [idError, setIdError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmOpen(false)
      setPending(null)
      setIdError(null)
    }
  }, [open])

  const sections = CATEGORY_ORDER.map((cat) => ({
    key: cat,
    title: t(`agents.presets.category.${cat}`),
    items: AGENT_PRESETS.filter((p) => p.category === cat),
  })).filter((s) => s.items.length > 0)

  const openConfirm = (preset: AgentPreset): void => {
    const defaultName = t(`agents.presets.items.${preset.i18nKey}.name`)
    const defaultId = allocateAgentId(
      preset.idPrefix,
      existingIds
    )
    setPending(preset)
    setNameInput(defaultName)
    setIdInput(defaultId)
    setIdError(null)
    setConfirmOpen(true)
  }

  const submitConfirm = (): void => {
    if (!pending) return
    const displayName = nameInput.trim() || t(`agents.presets.items.${pending.i18nKey}.name`)
    let id = sanitizeAgentId(idInput)
    if (!id) {
      setIdError(t('agents.presets.idRequired'))
      return
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      setIdError(t('agents.presets.idInvalid'))
      return
    }
    if (used.has(id)) {
      // 冲突则自动分配
      id = allocateAgentId(id, existingIds)
    }
    onPickPreset({ preset: pending, id, displayName })
    setConfirmOpen(false)
    setPending(null)
  }

  return (
    <>
      <Drawer
        rootStyle={{ top: TITLE_BAR_HEIGHT }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 4, height: 18, background: '#FF4D2A', borderRadius: 2 }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>{t('agents.presets.title')}</span>
          </div>
        }
        open={open}
        onClose={onClose}
        width={520}
        styles={{ body: { paddingTop: 8, paddingBottom: 24 } }}
      >
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
          {t('agents.presets.subtitle')}
        </Text>

        <div
          onClick={() => !creating && onPickCustom()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 10,
            border: '1px dashed #d9d9d9',
            cursor: creating ? 'not-allowed' : 'pointer',
            marginBottom: 20,
            background: '#fafafa',
            opacity: creating ? 0.6 : 1,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#fff',
              border: '1px solid #eee',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            <EditOutlined style={{ color: '#FF4D2A' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t('agents.presets.customTitle')}</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {t('agents.presets.customDesc')}
            </div>
          </div>
          <RightOutlined style={{ color: '#ccc', fontSize: 11 }} />
        </div>

        {sections.map((section) => (
          <div key={section.key} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#8c8c8c',
                letterSpacing: '0.04em',
                marginBottom: 8,
                textTransform: 'uppercase',
              }}
            >
              {section.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {section.items.map((preset) => {
                const already = used.has(preset.idPrefix)
                return (
                  <div
                    key={preset.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1px solid #f0f0f0',
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: '#FFF5F2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                        flexShrink: 0,
                      }}
                    >
                      {preset.emoji}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 14 }}>
                          {t(`agents.presets.items.${preset.i18nKey}.name`)}
                        </span>
                        <Tag style={{ margin: 0, fontSize: 11 }} color="blue">
                          full
                        </Tag>
                        {already && (
                          <Tag style={{ margin: 0, fontSize: 11 }} color="green">
                            {t('agents.presets.alreadyHave')}
                          </Tag>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#888',
                          marginTop: 3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t(`agents.presets.items.${preset.i18nKey}.tagline`)}
                      </div>
                      {preset.skills.length > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#bbb',
                            marginTop: 4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Skills: {preset.skills.slice(0, 4).join(', ')}
                          {preset.skills.length > 4 ? ` +${preset.skills.length - 4}` : ''}
                        </div>
                      )}
                    </div>
                    <Button
                      type="primary"
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={creating}
                      disabled={creating}
                      onClick={() => openConfirm(preset)}
                      style={{ background: '#FF4D2A', borderColor: '#FF4D2A', flexShrink: 0 }}
                    >
                      {t('agents.presets.oneClick')}
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div
          style={{
            marginTop: 8,
            padding: '12px 14px',
            borderRadius: 8,
            background: '#fafafa',
            fontSize: 12,
            color: '#999',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <PlusOutlined style={{ marginTop: 2 }} />
          <span>{t('agents.presets.hint')}</span>
        </div>
      </Drawer>

      <Modal
        title={
          pending
            ? t('agents.presets.confirmTitle', {
                name: t(`agents.presets.items.${pending.i18nKey}.name`),
              })
            : t('agents.presets.oneClick')
        }
        open={confirmOpen}
        onCancel={() => !creating && setConfirmOpen(false)}
        onOk={submitConfirm}
        okText={t('agents.presets.confirmAdd')}
        cancelText={t('common.cancel')}
        confirmLoading={creating}
        okButtonProps={{ style: { background: '#FF4D2A', borderColor: '#FF4D2A' } }}
        destroyOnClose
      >
        {pending && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{pending.emoji}</span>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t(`agents.presets.items.${pending.i18nKey}.tagline`)}
              </Text>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
                {t('agents.presets.displayNameLabel')}
              </div>
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={t(`agents.presets.items.${pending.i18nKey}.name`)}
                maxLength={40}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
                {t('agents.presets.idLabel')}
              </div>
              <Input
                value={idInput}
                onChange={(e) => {
                  setIdInput(e.target.value)
                  setIdError(null)
                }}
                placeholder={pending.idPrefix}
                status={idError ? 'error' : undefined}
              />
              {idError ? (
                <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{idError}</div>
              ) : (
                <div style={{ color: '#bbb', fontSize: 11, marginTop: 4 }}>
                  {t('agents.presets.idHint')}
                </div>
              )}
            </div>
          </Space>
        )}
      </Modal>
    </>
  )
}
