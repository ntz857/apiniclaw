/**
 * CronJobCard — 单个定时任务卡片
 */

import { Card, Switch, Button, Popconfirm, Tag, Typography, Space, Tooltip } from 'antd'
import {
  PlayCircleOutlined,
  EditOutlined,
  HistoryOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { CronJob } from '../../../stores/cronStore'

const { Text } = Typography

interface CronJobCardProps {
  job: CronJob
  onToggle: (id: string, enabled: boolean) => void
  onEdit: (job: CronJob) => void
  onHistory: (job: CronJob) => void
  onRun: (id: string) => void
  onDelete: (id: string) => void
}

/** 将 schedule 转换为人可读描述 */
function scheduleLabel(
  job: CronJob,
  t: (k: string, opts?: Record<string, unknown>) => string
): string {
  const s = job.schedule
  if (s.kind === 'every') {
    const ms = s.everyMs ?? 0
    if (ms % 86_400_000 === 0) return t('cron.schedule.everyNDays', { n: ms / 86_400_000 })
    if (ms % 3_600_000 === 0) return t('cron.schedule.everyNHours', { n: ms / 3_600_000 })
    return t('cron.schedule.everyNMinutes', { n: ms / 60_000 })
  }
  if (s.kind === 'cron') return s.expr ?? ''
  if (s.kind === 'at') {
    const d = s.at ? new Date(s.at) : null
    return d ? d.toLocaleString() : ''
  }
  return ''
}

/** 格式化相对时间 */
function relativeTime(
  ts: number,
  t: (k: string, opts?: Record<string, unknown>) => string
): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return t('cron.time.justNow')
  if (diff < 3_600_000) return t('cron.time.minutesAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('cron.time.hoursAgo', { n: Math.floor(diff / 3_600_000) })
  return t('cron.time.daysAgo', { n: Math.floor(diff / 86_400_000) })
}

function LastRunBadge({
  job,
  t,
}: {
  job: CronJob
  t: (k: string, opts?: Record<string, unknown>) => string
}): React.ReactElement | null {
  // 优先读 state 嵌套字段（实际 API），兼容旧版扁平字段
  const startedAt = job.state?.lastRunAtMs ?? job.lastRun?.startedAt ?? job.lastRunAt
  const status = job.state?.lastRunStatus ?? job.lastRun?.status ?? job.lastRunStatus
  const error =
    job.lastRun?.error ||
    (job.state as { lastError?: string } | undefined)?.lastError ||
    (job.state?.lastDeliveryStatus && job.state.lastDeliveryStatus !== 'ok'
      ? `delivery: ${job.state.lastDeliveryStatus}`
      : undefined)

  if (!startedAt || !status) return null
  if (status === 'ok')
    return (
      <Space size={4}>
        <CheckCircleFilled style={{ color: '#52c41a' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {relativeTime(startedAt, t)}
        </Text>
      </Space>
    )
  if (status === 'error')
    return (
      <Tooltip title={error || t('cron.runs.statusError')}>
        <Space size={4}>
          <CloseCircleFilled style={{ color: '#ff4d4f' }} />
          <Text type="danger" style={{ fontSize: 12 }}>
            {relativeTime(startedAt, t)}
            {error ? ` · ${error.length > 40 ? `${error.slice(0, 40)}…` : error}` : ''}
          </Text>
        </Space>
      </Tooltip>
    )
  return (
    <Space size={4}>
      <MinusCircleOutlined style={{ color: '#faad14' }} />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('cron.runs.statusSkipped')}
      </Text>
    </Space>
  )
}

export default function CronJobCard({
  job,
  onToggle,
  onEdit,
  onHistory,
  onRun,
  onDelete,
}: CronJobCardProps): React.ReactElement {
  const { t } = useTranslation()

  const title = (
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <Space size={8}>
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
          {scheduleLabel(job, t)}
        </Text>
        {!job.enabled && <Tag style={{ fontSize: 11 }}>{t('cron.card.disabled')}</Tag>}
      </Space>
      <Switch size="small" checked={job.enabled} onChange={(v) => onToggle(job.id, v)} />
    </Space>
  )

  return (
    <Card
      title={title}
      size="small"
      style={{
        borderRadius: 10,
        // 暂停任务仍展示，仅弱化，避免被误认为删除
        opacity: job.enabled ? 1 : 0.72,
      }}
      styles={{ body: { paddingBottom: 10 } }}
    >
      {/* 任务名称 */}
      <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>
        {job.name}
      </Text>

      {/* 消息预览：兼容 agentTurn(message) 和 systemEvent(text) */}
      <Text type="secondary" ellipsis style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        {job.payload?.message ?? job.payload?.text}
      </Text>

      {/* 投递方式 */}
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 10 }}>
        {job.agentId ? `${t('cron.card.agent')}: ${job.agentId}` : t('cron.card.agentDefault')}
        {' · '}
        {job.delivery?.mode === 'announce'
          ? `${t('cron.card.deliveryAnnounce')}${job.delivery.channel ? `/${job.delivery.channel}` : ''}${job.delivery.to ? ` → ${job.delivery.to}` : ''}`
          : job.delivery?.mode === 'webhook'
            ? `${t('cron.card.deliveryWebhook')}${job.delivery.to ? ` → ${job.delivery.to}` : ''}`
            : t('cron.card.deliveryNone')}
      </Text>

      {/* 上次 / 下次 */}
      <Space size={16} style={{ marginBottom: 12 }}>
        <Space size={4}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('cron.card.lastRun')}：
          </Text>
          <LastRunBadge job={job} t={t} />
          {!job.state?.lastRunAtMs && !job.lastRun && !job.lastRunAt && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Text>
          )}
        </Space>
        {/* 优先读 state.nextRunAtMs，兼容旧版字段 */}
        {(job.state?.nextRunAtMs ?? job.nextRunAt ?? job.nextRunAtMs) ? (
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('cron.card.nextRun')}：
            </Text>
            <Text style={{ fontSize: 12 }}>
              {new Date(
                job.state?.nextRunAtMs ?? job.nextRunAt ?? job.nextRunAtMs!
              ).toLocaleString()}
            </Text>
          </Space>
        ) : null}
      </Space>

      {/* 操作按钮 */}
      <Space size={8}>
        <Button size="small" icon={<PlayCircleOutlined />} onClick={() => onRun(job.id)}>
          {t('cron.card.runNow')}
        </Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(job)}>
          {t('cron.card.edit')}
        </Button>
        <Button size="small" icon={<HistoryOutlined />} onClick={() => onHistory(job)}>
          {t('cron.card.history')}
        </Button>
        <Popconfirm
          title={t('cron.card.deleteConfirm')}
          onConfirm={() => onDelete(job.id)}
          okType="danger"
        >
          <Button size="small" icon={<DeleteOutlined />} danger />
        </Popconfirm>
      </Space>
    </Card>
  )
}
