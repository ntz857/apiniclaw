import { memo, useState } from 'react'
import { App, Button, Card, Input, Popconfirm, Space, Switch, Tag, Tooltip, Typography } from 'antd'
import {
  DeleteOutlined,
  FileTextOutlined,
  FileZipOutlined,
  KeyOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { buildMissingHint, resolveSourceTag } from '../skills-page.utils'
import { NotReadyFixPanel } from './NotReadyFixPanel'

const { Text } = Typography

interface InstalledRowProps {
  skill: InstalledSkillInfo
  wsReady: boolean
  onUninstall: (baseDir: string, name: string) => Promise<void>
  onToggleEnabled: (skillKey: string, enabled: boolean) => void
  onSaveApiKey: (skillKey: string, apiKey: string) => Promise<void>
  onSaveEnv: (skillKey: string, env: Record<string, string>) => Promise<void>
  onShowDetail: (skill: InstalledSkillInfo) => void
  onExport: (skill: InstalledSkillInfo) => Promise<void>
  onRefresh: () => void | Promise<void>
}

export const InstalledRow = memo(function InstalledRow({
  skill,
  wsReady,
  onUninstall,
  onToggleEnabled,
  onSaveApiKey,
  onSaveEnv,
  onShowDetail,
  onExport,
  onRefresh,
}: InstalledRowProps): React.ReactElement {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [toggling, setToggling] = useState(false)
  const [apiKeyEditing, setApiKeyEditing] = useState(false)
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [apiKeySaving, setApiKeySaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 未就绪技能默认展开解决面板，避免只有标签没有入口
  const [fixOpen, setFixOpen] = useState(skill.eligible === false)

  const isEnabled = skill.enabled !== false
  const switchDisabled = !wsReady || skill.always === true || !skill.skillKey
  const missingHint = buildMissingHint(skill.missing, t)
  const { label: sourceLabel, color: sourceColor } = resolveSourceTag(skill)
  const notReady = skill.eligible === false

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!skill.skillKey) return
    setToggling(true)
    try {
      onToggleEnabled(skill.skillKey, checked)
    } catch (err) {
      message.error(t('skills.enableFailed', { error: String(err) }))
    } finally {
      setToggling(false)
    }
  }

  const handleSaveApiKey = async (): Promise<void> => {
    if (!skill.skillKey || !apiKeyValue.trim()) return
    setApiKeySaving(true)
    try {
      await onSaveApiKey(skill.skillKey, apiKeyValue.trim())
      message.success(t('skills.apiKeySaved'))
      setApiKeyEditing(false)
      setApiKeyValue('')
    } catch (err) {
      message.error(t('skills.apiKeySaveFailed', { error: String(err) }))
    } finally {
      setApiKeySaving(false)
    }
  }

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      await onExport(skill)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space align="center" wrap>
            {skill.emoji && <span style={{ fontSize: 18 }}>{skill.emoji}</span>}
            <Text
              strong
              style={{ fontSize: 14, cursor: 'pointer', textDecoration: 'underline dotted' }}
              onClick={() => onShowDetail(skill)}
            >
              {skill.name}
            </Text>
            {skill.version && (
              <Tag color="default" style={{ fontSize: 11 }}>
                v{skill.version}
              </Tag>
            )}
            <Tag color={sourceColor} style={{ fontSize: 11 }}>
              {t(`skills.source.${skill.rawSource ?? skill.source}`, { defaultValue: sourceLabel })}
            </Tag>
            {skill.always && (
              <Tag color="cyan" style={{ fontSize: 11 }}>
                {t('skills.alwaysEnabled')}
              </Tag>
            )}
            {notReady && (
              <Tooltip
                title={
                  <div style={{ whiteSpace: 'pre-line', fontSize: 12 }}>
                    {t('skills.notReadyHint')}
                    {'\n'}
                    {missingHint || '—'}
                    {'\n\n'}
                    {t('skills.fix.expand')}
                  </div>
                }
              >
                <Tag
                  color="orange"
                  style={{ fontSize: 11, cursor: 'pointer' }}
                  onClick={() => setFixOpen((v) => !v)}
                >
                  {t('skills.notReady')} · {fixOpen ? t('skills.fix.collapse') : t('skills.notReadyAction')}
                </Tag>
              </Tooltip>
            )}
          </Space>
          {skill.description && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
              {skill.description}
            </Text>
          )}
          {skill.error && (
            <Text type="danger" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              {t('skills.skillError', { msg: skill.error })}
            </Text>
          )}
        </div>

        <Space size={4} style={{ flexShrink: 0 }}>
          {notReady && (
            <Tooltip title={fixOpen ? t('skills.fix.collapse') : t('skills.notReadyAction')}>
              <Button
                size="small"
                type={fixOpen ? 'primary' : 'default'}
                icon={<ToolOutlined />}
                onClick={() => setFixOpen((v) => !v)}
              >
                {t('skills.notReadyAction')}
              </Button>
            </Tooltip>
          )}

          <Tooltip title={t('skills.showDetail')}>
            <Button
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => {
                performance.mark('detail-click')
                onShowDetail(skill)
              }}
            />
          </Tooltip>

          <Tooltip title={t('skills.export')}>
            <Button
              size="small"
              icon={<FileZipOutlined />}
              loading={exporting}
              onClick={handleExport}
            />
          </Tooltip>

          {skill.primaryEnv && (
            <Tooltip title={`${t('skills.setApiKey')} (${skill.primaryEnv})`}>
              <Button
                size="small"
                icon={<KeyOutlined />}
                disabled={!wsReady || !skill.skillKey}
                type={apiKeyEditing ? 'primary' : 'default'}
                onClick={() => {
                  setApiKeyEditing(!apiKeyEditing)
                  setApiKeyValue('')
                }}
              />
            </Tooltip>
          )}

          {!skill.isSystem && (
            <Tooltip title={t('skills.uninstall')}>
              <Popconfirm
                title={t('skills.uninstallConfirm', { name: skill.name })}
                onConfirm={() => onUninstall(skill.baseDir, skill.name)}
                okType="danger"
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Tooltip>
          )}

          <Tooltip
            title={
              skill.always
                ? t('skills.alwaysEnabled')
                : notReady
                  ? t('skills.notReady')
                  : undefined
            }
          >
            <Switch
              size="small"
              checked={isEnabled}
              disabled={switchDisabled}
              loading={toggling}
              onChange={handleToggle}
            />
          </Tooltip>
        </Space>
      </div>

      {apiKeyEditing && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {skill.primaryEnv}:
          </Text>
          <Input.Password
            size="small"
            value={apiKeyValue}
            onChange={(e) => setApiKeyValue(e.target.value)}
            placeholder={t('skills.apiKeyPlaceholder')}
            style={{ flex: 1 }}
            onPressEnter={handleSaveApiKey}
            autoFocus
          />
          <Button
            size="small"
            type="primary"
            loading={apiKeySaving}
            disabled={!apiKeyValue.trim()}
            onClick={handleSaveApiKey}
          >
            {t('skills.apiKeySave')}
          </Button>
          <Button
            size="small"
            onClick={() => {
              setApiKeyEditing(false)
              setApiKeyValue('')
            }}
          >
            {t('skills.apiKeyCancel')}
          </Button>
        </div>
      )}

      {notReady && fixOpen && (
        <NotReadyFixPanel
          skill={skill}
          wsReady={wsReady}
          variant="row"
          onSaveApiKey={onSaveApiKey}
          onSaveEnv={onSaveEnv}
          onRecheck={onRefresh}
        />
      )}
    </Card>
  )
})
