import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { ReloadOutlined, ThunderboltOutlined, ToolOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { AgentSkillsTabProps, SkillEntry } from '../agents-page.types'
import { SKILL_GROUPS } from '../agents-page.utils'
import { NotReadyFixPanel } from '../../skills/components/NotReadyFixPanel'
import { buildMissingHint } from '../../skills/skills-page.utils'

function groupSkillEntries(
  skills: SkillEntry[]
): Array<{ id: string; labelKey: string; skills: SkillEntry[] }> {
  const groups = new Map(
    SKILL_GROUPS.map((g) => [g.id, { id: g.id, labelKey: g.label, skills: [] as SkillEntry[] }])
  )
  const other = { id: 'other', labelKey: 'agents.skills.groupOther', skills: [] as SkillEntry[] }
  for (const skill of skills) {
    const match = skill.bundled
      ? SKILL_GROUPS.find((g) => g.id === 'built-in')
      : SKILL_GROUPS.find((g) => g.sources.includes(skill.source ?? ''))
    if (match) {
      groups.get(match.id)!.skills.push(skill)
    } else {
      other.skills.push(skill)
    }
  }
  const ordered = SKILL_GROUPS.map((g) => groups.get(g.id)!).filter((g) => g.skills.length > 0)
  if (other.skills.length > 0) ordered.push(other)
  return ordered
}

/** 将 skills.status 条目映射为 NotReadyFixPanel 需要的 InstalledSkillInfo */
function toInstalledSkillInfo(skill: SkillEntry): InstalledSkillInfo {
  const rawSource = skill.source || ''
  const isSystem = rawSource.startsWith('openclaw-') || Boolean(skill.bundled)
  let source: InstalledSkillInfo['source'] = 'extra'
  if (isSystem || skill.bundled) source = 'bundled'
  else if (rawSource.includes('workspace') || rawSource.includes('agents-skills')) source = 'workspace'
  else if (rawSource.includes('managed')) source = 'managed'

  return {
    dirName: skill.name,
    filePath: skill.filePath || '',
    baseDir: skill.baseDir || '',
    name: skill.name,
    description: skill.description,
    emoji: skill.emoji,
    source,
    rawSource: skill.source,
    isSystem,
    eligible: skill.eligible,
    missing: skill.missing,
    skillKey: skill.skillKey || skill.name,
    enabled: !skill.disabled,
    error: skill.error,
    primaryEnv: skill.primaryEnv,
    always: skill.always,
  }
}

export function AgentSkillsTab({
  agent,
  wsReady,
  callRpc,
  onSaveAgent,
}: AgentSkillsTabProps): React.ReactElement {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [report, setReport] = useState<SkillEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  /** 展开「去解决」的 skill 名 */
  const [fixOpenName, setFixOpenName] = useState<string | null>(null)

  const currentAllowlist = Array.isArray(agent.skills) ? (agent.skills as string[]) : undefined
  /** 与 agent 配置同步的生效白名单；undefined = 全部启用 */
  const [draftAllowlist, setDraftAllowlist] = useState<string[] | undefined>(currentAllowlist)
  /** 正在切换的单个 skill（防连点） */
  const [togglingName, setTogglingName] = useState<string | null>(null)
  const applyLock = useRef(false)

  useEffect(() => {
    setDraftAllowlist(Array.isArray(agent.skills) ? (agent.skills as string[]) : undefined)
    setReport(null)
    setError(null)
    setFilter('')
    setFixOpenName(null)
    setTogglingName(null)
  }, [agent.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 外部刷新后同步白名单（避免保存后 UI 仍显示草稿）
  useEffect(() => {
    if (applyLock.current) return
    setDraftAllowlist(Array.isArray(agent.skills) ? (agent.skills as string[]) : undefined)
  }, [agent.skills])

  const loadSkills = useCallback(async (): Promise<void> => {
    if (!wsReady) return
    setLoading(true)
    setError(null)
    try {
      const payload = (await callRpc('skills.status', { agentId: agent.id })) as {
        skills: SkillEntry[]
      }
      const skills = payload.skills ?? []
      setReport(skills)
      // 若当前展开的 skill 已就绪，自动收起
      setFixOpenName((prev) => {
        if (!prev) return prev
        const s = skills.find((x) => x.name === prev)
        if (s && s.eligible !== false) return null
        return prev
      })
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [wsReady, callRpc, agent.id])

  useEffect(() => {
    if (wsReady) loadSkills()
  }, [wsReady, agent.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 首次加载后：若有未就绪技能，默认展开第一个，降低发现成本
  useEffect(() => {
    if (!report || fixOpenName) return
    const first = report.find((s) => s.eligible === false)
    if (first) setFixOpenName(first.name)
  }, [report]) // eslint-disable-line react-hooks/exhaustive-deps

  const usingAllowlist = draftAllowlist !== undefined
  const allowSet = new Set(draftAllowlist ?? [])

  /**
   * 真正生效：写 openclaw.json 白名单；对新启用的 skill 尽量复制到 workspace/skills。
   * - 内置/Gateway 已识别的 skill 往往无需复制，allowlist 即可生效
   * - 仅「本地完全找不到且 Gateway 列表里也没有」才算真正失败
   */
  const applySkillsConfig = useCallback(
    async (
      next: string[] | undefined,
      opts?: { silent?: boolean; installOnly?: string[] }
    ): Promise<boolean> => {
      if (applyLock.current) return false
      applyLock.current = true
      setSaving(true)
      const prev = draftAllowlist
      setDraftAllowlist(next)
      try {
        const skillsToPersist = next
        const knownByGateway = new Set((report ?? []).map((s) => s.name))

        let copiedCount = 0
        /** 本地无文件、且 Gateway 也不认识 → 真缺失 */
        let hardMissing: string[] = []
        /** 本地无文件、但 Gateway 列表里有（多为内置，只靠白名单即可） */
        let softMissing: string[] = []

        const toInstall =
          opts?.installOnly && opts.installOnly.length > 0
            ? opts.installOnly
            : next && next.length > 0
              ? next
              : []

        if (toInstall.length > 0) {
          const result = await window.api.agent.installSkills(agent.id, toInstall)
          copiedCount = result.copied.length
          for (const name of result.missing) {
            if (knownByGateway.has(name)) softMissing.push(name)
            else hardMissing.push(name)
          }
        }

        const updated: typeof agent = { ...agent }
        if (skillsToPersist === undefined) {
          // null → config 层删除 skills 字段（merge 无法靠 undefined 删键）
          updated.skills = null
        } else {
          updated.skills = skillsToPersist
        }
        await onSaveAgent(updated)
        // 本地草稿仍用 undefined 表示「全部启用」
        if (skillsToPersist === undefined) {
          setDraftAllowlist(undefined)
        }

        if (!opts?.silent) {
          if (hardMissing.length > 0) {
            message.warning(
              t('agents.skills.installPartial', {
                installed: Math.max(0, toInstall.length - hardMissing.length - softMissing.length),
                missing: hardMissing.join(', '),
              })
            )
          } else if (copiedCount > 0) {
            message.success(t('agents.skills.installSuccess', { count: copiedCount }))
          } else if (softMissing.length > 0) {
            // 内置/已在 Gateway 可见：白名单已生效，无需工作区副本
            message.success(t('agents.skills.saveSuccessAllowlistOnly'))
          } else {
            message.success(t('agents.skills.saveSuccess'))
          }
        }

        return true
      } catch (err) {
        setDraftAllowlist(prev)
        message.error(t('agents.skills.saveFailed', { error: String(err) }))
        return false
      } finally {
        setSaving(false)
        applyLock.current = false
      }
    },
    [agent, draftAllowlist, message, onSaveAgent, report, t]
  )

  const handleToggle = (skillName: string, enabled: boolean): void => {
    if (saving || togglingName) return
    const allSkills = (report ?? []).map((s) => s.name)
    const base = draftAllowlist ?? allSkills
    const next = new Set(base)
    if (enabled) {
      next.add(skillName)
    } else {
      next.delete(skillName)
    }
    const list = [...next]
    setTogglingName(skillName)
    // 只尝试安装「本次新打开」的技能，避免整表白名单误报 missing
    void applySkillsConfig(list, {
      installOnly: enabled ? [skillName] : [],
    }).finally(() => setTogglingName(null))
  }

  const handleUseAll = (): void => {
    if (saving) return
    void applySkillsConfig(undefined)
  }

  const handleDisableAll = (): void => {
    if (saving) return
    void applySkillsConfig([])
  }

  const handleSaveApiKey = useCallback(
    async (skillKey: string, apiKey: string): Promise<void> => {
      await callRpc('skills.update', { skillKey, apiKey })
    },
    [callRpc]
  )

  const handleSaveEnv = useCallback(
    async (skillKey: string, env: Record<string, string>): Promise<void> => {
      await callRpc('skills.update', { skillKey, env })
    },
    [callRpc]
  )

  const filterLower = filter.trim().toLowerCase()
  const rawSkills = report ?? []
  const filtered = filterLower
    ? rawSkills.filter((s) =>
        [s.name, s.description ?? '', s.source].join(' ').toLowerCase().includes(filterLower)
      )
    : rawSkills
  const groups = groupSkillEntries(filtered)

  const enabledCount = usingAllowlist
    ? rawSkills.filter((s) => allowSet.has(s.name)).length
    : rawSkills.length
  const notReadyCount = rawSkills.filter((s) => s.eligible === false).length

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {t('agents.skills.title')}
          </Typography.Text>
          {rawSkills.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {enabledCount}/{rawSkills.length}
              {notReadyCount > 0
                ? ` · ${t('agents.skills.notReadyCount', { count: notReadyCount })}`
                : ''}
            </Typography.Text>
          )}
        </div>
        <Space size={6}>
          <Button size="small" disabled={!wsReady || saving} loading={saving} onClick={handleUseAll}>
            {t('agents.skills.useAll')}
          </Button>
          <Button
            size="small"
            disabled={!wsReady || saving}
            loading={saving}
            onClick={handleDisableAll}
          >
            {t('agents.skills.disableAll')}
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            disabled={!wsReady || saving}
            onClick={loadSkills}
          />
        </Space>
      </div>

      {usingAllowlist ? (
        <Alert
          type="info"
          message={t('agents.skills.usingAllowlist')}
          description={t('agents.skills.autoApplyHint')}
          style={{ marginBottom: 12 }}
          showIcon
        />
      ) : (
        <Alert
          type="success"
          message={t('agents.skills.usingAll')}
          description={t('agents.skills.autoApplyHint')}
          style={{ marginBottom: 12 }}
          showIcon
        />
      )}

      {notReadyCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('agents.skills.notReadyBannerTitle')}
          description={t('agents.skills.notReadyBannerDesc')}
        />
      )}

      {!wsReady && (
        <Alert
          type="warning"
          message={t('agents.skills.wsRequired')}
          style={{ marginBottom: 12 }}
          showIcon
        />
      )}

      {error && (
        <Alert
          type="error"
          message={error}
          style={{ marginBottom: 12 }}
          showIcon
          action={
            <Button size="small" onClick={loadSkills}>
              {t('agents.skills.retry')}
            </Button>
          }
        />
      )}

      {wsReady && (
        <Input
          placeholder={t('agents.skills.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          prefix={<span style={{ color: '#bbb', fontSize: 12 }}>🔍</span>}
          allowClear
          size="small"
          style={{ marginBottom: 12 }}
        />
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin size="small" />
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {t('agents.skills.loading')}
          </Typography.Text>
        </div>
      )}

      {!loading && wsReady && rawSkills.length === 0 && !error && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('agents.skills.noSkills')}
          style={{ margin: '24px 0' }}
        />
      )}

      {!loading &&
        groups.map((group) => (
          <div key={group.id} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                padding: '4px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <ThunderboltOutlined style={{ color: '#FF4D2A', fontSize: 11 }} />
              <Typography.Text
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#595959',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {t(group.labelKey)}
              </Typography.Text>
              <Tag
                style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px', marginLeft: 'auto' }}
              >
                {group.skills.length}
              </Tag>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.skills.map((skill) => {
                const isEnabled = usingAllowlist ? allowSet.has(skill.name) : true
                const canToggle = !skill.always && wsReady
                const notReady = skill.eligible === false
                const fixOpen = fixOpenName === skill.name
                const missingHint = buildMissingHint(skill.missing, t)
                const installInfo = toInstalledSkillInfo(skill)

                return (
                  <div
                    key={skill.name}
                    style={{
                      borderRadius: 8,
                      border: notReady ? '1px solid #ffe7ba' : '1px solid transparent',
                      background: notReady ? '#fffbe6' : isEnabled ? 'transparent' : '#fafafa',
                      opacity: isEnabled || notReady ? 1 : 0.6,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '8px 10px',
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          flexShrink: 0,
                          textAlign: 'center',
                          fontSize: 18,
                          lineHeight: '22px',
                          marginTop: 1,
                        }}
                      >
                        {skill.emoji || (
                          <ThunderboltOutlined style={{ color: '#bbb', fontSize: 14 }} />
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <Typography.Text style={{ fontSize: 13, fontWeight: 500 }}>
                            {skill.name}
                          </Typography.Text>
                          {skill.always && (
                            <Tag
                              color="cyan"
                              style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}
                            >
                              {t('agents.skills.alwaysOn')}
                            </Tag>
                          )}
                          {notReady && (
                            <Tooltip title={missingHint || t('agents.skills.notReady')}>
                              <Tag
                                color="warning"
                                style={{
                                  fontSize: 10,
                                  padding: '0 4px',
                                  lineHeight: '16px',
                                  cursor: 'help',
                                }}
                              >
                                {t('agents.skills.notReady')}
                              </Tag>
                            </Tooltip>
                          )}
                        </div>
                        {skill.description && (
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 11, display: 'block', marginTop: 1 }}
                          >
                            {skill.description}
                          </Typography.Text>
                        )}
                        {notReady && missingHint && !fixOpen && (
                          <Typography.Text
                            type="secondary"
                            style={{
                              fontSize: 11,
                              display: 'block',
                              marginTop: 4,
                              color: '#d48806',
                              whiteSpace: 'pre-line',
                            }}
                          >
                            {missingHint}
                          </Typography.Text>
                        )}
                      </div>

                      <Space size={6} style={{ flexShrink: 0, marginTop: 2 }}>
                        {notReady && (
                          <Button
                            size="small"
                            type={fixOpen ? 'default' : 'primary'}
                            icon={<ToolOutlined />}
                            onClick={() =>
                              setFixOpenName(fixOpen ? null : skill.name)
                            }
                            style={
                              fixOpen
                                ? undefined
                                : { background: '#FF4D2A', borderColor: '#FF4D2A' }
                            }
                          >
                            {fixOpen
                              ? t('skills.fix.collapse')
                              : t('skills.notReadyAction')}
                          </Button>
                        )}
                        <Switch
                          size="small"
                          checked={isEnabled}
                          disabled={!canToggle || saving}
                          loading={togglingName === skill.name}
                          onChange={(checked) => handleToggle(skill.name, checked)}
                        />
                      </Space>
                    </div>

                    {notReady && fixOpen && (
                      <div style={{ padding: '0 10px 10px' }}>
                        <NotReadyFixPanel
                          skill={installInfo}
                          wsReady={wsReady}
                          variant="row"
                          onSaveApiKey={handleSaveApiKey}
                          onSaveEnv={handleSaveEnv}
                          onRecheck={loadSkills}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
    </div>
  )
}
