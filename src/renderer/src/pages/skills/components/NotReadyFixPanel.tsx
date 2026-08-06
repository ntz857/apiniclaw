import { memo, useEffect, useMemo, useState } from 'react'
import { App, Button, Input, Progress, Space, Typography } from 'antd'
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import {
  canOneClickInstallBin,
  formatOsList,
  getBinInstallCommand,
  resolveEnvKeysToFill,
} from '../skills-page.utils'

const { Text } = Typography

export interface NotReadyFixPanelProps {
  skill: InstalledSkillInfo
  wsReady: boolean
  variant?: 'row' | 'detail'
  onSaveApiKey: (skillKey: string, apiKey: string) => Promise<void>
  onSaveEnv: (skillKey: string, env: Record<string, string>) => Promise<void>
  onRecheck: () => void | Promise<void>
}

export const NotReadyFixPanel = memo(function NotReadyFixPanel({
  skill,
  wsReady,
  variant = 'row',
  onSaveApiKey,
  onSaveEnv,
  onRecheck,
}: NotReadyFixPanelProps): React.ReactElement | null {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const platform =
    typeof window !== 'undefined' ? window.api?.win?.platform : undefined

  const envKeys = useMemo(() => resolveEnvKeysToFill(skill), [skill])
  const bins = skill.missing?.bins ?? []
  const anyBins = skill.missing?.anyBins ?? []
  const configs = skill.missing?.config ?? []
  const osList = skill.missing?.os ?? []

  const oneClickBins = useMemo(
    () => [...new Set([...bins, ...anyBins])].filter((b) => canOneClickInstallBin(b, platform)),
    [bins, anyBins, platform]
  )

  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [installingBin, setInstallingBin] = useState<string | null>(null)
  const [installingAll, setInstallingAll] = useState(false)
  const [installLog, setInstallLog] = useState<string | null>(null)

  useEffect(() => {
    setEnvValues({})
    setInstallLog(null)
  }, [skill.skillKey, skill.baseDir, envKeys.join('|')])

  if (skill.eligible !== false) return null

  const hasActionable =
    envKeys.length > 0 ||
    bins.length > 0 ||
    anyBins.length > 0 ||
    configs.length > 0 ||
    osList.length > 0

  const pad = variant === 'detail' ? 12 : 10
  const gap = variant === 'detail' ? 10 : 8
  const busy = Boolean(installingBin || installingAll || saving)

  const copyText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(t('skills.fix.copyOk'))
    } catch {
      message.error(t('skills.fix.copyFailed'))
    }
  }

  const handleSaveEnv = async (): Promise<void> => {
    if (!skill.skillKey) {
      message.error(t('skills.fix.noSkillKey'))
      return
    }
    const filled = Object.fromEntries(
      Object.entries(envValues)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v.length > 0)
    )
    if (Object.keys(filled).length === 0) {
      message.warning(t('skills.fix.envEmpty'))
      return
    }

    setSaving(true)
    try {
      if (skill.primaryEnv && filled[skill.primaryEnv] !== undefined) {
        const { [skill.primaryEnv]: apiKey, ...rest } = filled
        await onSaveApiKey(skill.skillKey, apiKey)
        if (Object.keys(rest).length > 0) {
          await onSaveEnv(skill.skillKey, rest)
        }
      } else {
        await onSaveEnv(skill.skillKey, filled)
      }
      message.success(t('skills.fix.envSaved'))
      setEnvValues({})
      await onRecheck()
    } catch (err) {
      message.error(t('skills.fix.envSaveFailed', { error: String(err) }))
    } finally {
      setSaving(false)
    }
  }

  const handleRecheck = async (): Promise<void> => {
    setRechecking(true)
    try {
      await onRecheck()
      message.success(t('skills.fix.rechecked'))
    } catch (err) {
      message.error(t('skills.fix.recheckFailed', { error: String(err) }))
    } finally {
      setRechecking(false)
    }
  }

  const handleInstallBin = async (bin: string): Promise<void> => {
    setInstallingBin(bin)
    setInstallLog(t('skills.fix.installing', { bin }))
    try {
      const result = await window.api.skill.installBin(bin)
      if (result.success) {
        const tip = result.gatewayRestarted
          ? t('skills.fix.installOkRestarted', { bin })
          : t('skills.fix.installOk', { bin })
        message.success(tip)
        setInstallLog(tip)
        await onRecheck()
      } else {
        const err = result.error || t('skills.fix.installFailed', { bin, error: 'unknown' })
        message.error(err)
        setInstallLog(err)
        // 失败时仍给出复制命令兜底
        const cmd = getBinInstallCommand(bin, platform)
        if (cmd) {
          modal.warning({
            title: t('skills.fix.installFailedTitle', { bin }),
            content: (
              <div>
                <p>{err}</p>
                <p style={{ fontSize: 12 }}>{t('skills.fix.fallbackCmd')}</p>
                <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{cmd}</code>
              </div>
            ),
            okText: t('skills.fix.copy'),
            onOk: () => copyText(cmd),
          })
        }
      }
    } catch (err) {
      message.error(t('skills.fix.installFailed', { bin, error: String(err) }))
      setInstallLog(String(err))
    } finally {
      setInstallingBin(null)
    }
  }

  const handleInstallAll = async (): Promise<void> => {
    if (oneClickBins.length === 0) return
    setInstallingAll(true)
    setInstallLog(t('skills.fix.installingAll', { count: oneClickBins.length }))
    try {
      const { results, gatewayRestarted } = await window.api.skill.installBins(oneClickBins)
      const ok = results.filter((r) => r.success).map((r) => r.bin)
      const fail = results.filter((r) => !r.success)
      if (ok.length > 0) {
        message.success(
          gatewayRestarted
            ? t('skills.fix.installAllOkRestarted', { list: ok.join(', ') })
            : t('skills.fix.installAllOk', { list: ok.join(', ') })
        )
      }
      if (fail.length > 0) {
        message.warning(
          t('skills.fix.installAllPartial', {
            ok: ok.length,
            fail: fail.map((f) => `${f.bin}: ${f.error || 'fail'}`).join('; '),
          })
        )
        setInstallLog(fail.map((f) => `${f.bin}: ${f.error}`).join('\n'))
      } else {
        setInstallLog(null)
      }
      await onRecheck()
    } catch (err) {
      message.error(t('skills.fix.installAllFailed', { error: String(err) }))
    } finally {
      setInstallingAll(false)
    }
  }

  const renderBinRow = (bin: string, optionalGroup?: boolean): React.ReactElement => {
    const cmd = getBinInstallCommand(bin, platform)
    const canClick = canOneClickInstallBin(bin, platform)
    const thisInstalling = installingBin === bin
    return (
      <div
        key={`${optionalGroup ? 'any' : 'bin'}-${bin}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          fontSize: 12,
          padding: '6px 8px',
          background: 'rgba(255,255,255,0.5)',
          borderRadius: 6,
        }}
      >
        <Text code>{bin}</Text>
        {canClick ? (
          <Button
            size="small"
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={thisInstalling || installingAll}
            disabled={busy && !thisInstalling}
            onClick={() => handleInstallBin(bin)}
          >
            {t('skills.fix.oneClickInstall')}
          </Button>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('skills.fix.installManually', { bin })}
          </Text>
        )}
        {cmd && (
          <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => copyText(cmd)}>
            {t('skills.fix.copyCmd')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: pad,
        borderRadius: 8,
        background: 'rgba(250, 173, 20, 0.08)',
        border: '1px solid rgba(250, 173, 20, 0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Text strong style={{ fontSize: 13, color: '#d48806' }}>
          {t('skills.fix.title')}
        </Text>
        <Space size={6} wrap>
          {oneClickBins.length > 0 && (
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={installingAll}
              disabled={busy && !installingAll}
              onClick={handleInstallAll}
            >
              {t('skills.fix.oneClickInstallAll', { count: oneClickBins.length })}
            </Button>
          )}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={rechecking}
            disabled={!wsReady || busy}
            onClick={handleRecheck}
          >
            {t('skills.fix.recheck')}
          </Button>
        </Space>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
        {t('skills.fix.hintOneClick')}
      </Text>

      {(installingBin || installingAll) && (
        <div style={{ marginTop: 8 }}>
          <Progress percent={99} status="active" showInfo={false} size="small" />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {installLog || t('skills.fix.installProgress')}
          </Text>
        </div>
      )}
      {installLog && !installingBin && !installingAll && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6, whiteSpace: 'pre-wrap' }}>
          {installLog}
        </Text>
      )}

      {!hasActionable && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: gap }}>
          {t('skills.fix.unknownReason')}
        </Text>
      )}

      {envKeys.length > 0 && (
        <div style={{ marginTop: gap }}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('skills.fix.envSection')}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
            {t('skills.fix.envOneClickHint')}
          </Text>
          <Space direction="vertical" style={{ width: '100%', marginTop: 6 }} size={6}>
            {envKeys.map((key) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text code style={{ fontSize: 11, minWidth: 120, flexShrink: 0 }}>
                  {key}
                </Text>
                <Input.Password
                  size="small"
                  value={envValues[key] ?? ''}
                  placeholder={t('skills.fix.envPlaceholder')}
                  disabled={!wsReady || !skill.skillKey || busy}
                  onChange={(e) => setEnvValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  style={{ flex: 1 }}
                  onPressEnter={handleSaveEnv}
                />
              </div>
            ))}
            <div>
              <Button
                size="small"
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={saving}
                disabled={!wsReady || !skill.skillKey || busy}
                onClick={handleSaveEnv}
              >
                {t('skills.fix.saveEnv')}
              </Button>
              {!wsReady && (
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                  {t('skills.gatewayOffline')}
                </Text>
              )}
            </div>
          </Space>
        </div>
      )}

      {bins.length > 0 && (
        <div style={{ marginTop: gap }}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('skills.fix.binsSection')}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', margin: '2px 0 6px' }}>
            {t('skills.fix.binsOneClickHint')}
          </Text>
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            {bins.map((b) => renderBinRow(b))}
          </Space>
        </div>
      )}

      {anyBins.length > 0 && (
        <div style={{ marginTop: gap }}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('skills.fix.anyBinsSection')}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', margin: '2px 0 6px' }}>
            {t('skills.fix.anyBinsOneClickHint')}
          </Text>
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            {anyBins.map((b) => renderBinRow(b, true))}
          </Space>
          {anyBins.some((b) => canOneClickInstallBin(b, platform)) && (
            <Button
              size="small"
              style={{ marginTop: 6 }}
              type="primary"
              ghost
              icon={<CloudDownloadOutlined />}
              loading={busy}
              disabled={busy}
              onClick={() => {
                const first = anyBins.find((b) => canOneClickInstallBin(b, platform))
                if (first) void handleInstallBin(first)
              }}
            >
              {t('skills.fix.installAnyOne')}
            </Button>
          )}
        </div>
      )}

      {configs.length > 0 && (
        <div style={{ marginTop: gap }}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('skills.fix.configSection')}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {t('skills.fix.configHint')}
          </Text>
          <div style={{ marginTop: 4 }}>
            {configs.map((c) => (
              <Text code key={c} style={{ fontSize: 11, marginRight: 6 }}>
                {c}
              </Text>
            ))}
          </div>
        </div>
      )}

      {osList.length > 0 && (
        <div style={{ marginTop: gap }}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('skills.fix.osSection')}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {t('skills.fix.osHint', { list: formatOsList(osList) })}
          </Text>
        </div>
      )}
    </div>
  )
})
