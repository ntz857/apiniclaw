/**
 * CronFormDrawer — 创建/编辑定时任务表单 Drawer
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  AutoComplete,
  DatePicker,
  Radio,
  Switch,
  Button,
  Space,
  Typography,
  Alert,
  Spin,
} from 'antd'
import { useTranslation } from 'react-i18next'
import type { CronJob, CronFormValues } from '../../../stores/cronStore'
import { scheduleToForm, deliveryToForm, DELIVERY_CHANNEL_OPTIONS } from '../../../stores/cronStore'
import { TITLE_BAR_HEIGHT } from '../../../components/TitleBar'
import dayjs from 'dayjs'

const { Text } = Typography

interface DeliveryTargetOpt {
  value: string
  label: string
  channel?: string
  source?: string
  kind?: string
}

interface CronFormDrawerProps {
  open: boolean
  editJob: CronJob | null
  onClose: () => void
  onSave: (values: CronFormValues) => Promise<void>
  saving: boolean
}

const { TextArea } = Input

export default function CronFormDrawer({
  open,
  editJob,
  onClose,
  onSave,
  saving,
}: CronFormDrawerProps): React.ReactElement {
  const { t } = useTranslation()
  const [form] = Form.useForm<CronFormValues>()
  const scheduleKind = Form.useWatch('scheduleKind', form)
  const cronPreset = Form.useWatch('cronPreset', form)
  const deliveryMode = Form.useWatch('deliveryMode', form)
  const deliveryChannel = Form.useWatch('deliveryChannel', form)

  // Agent 选项列表
  const [agentOptions, setAgentOptions] = useState<{ value: string; label: string }[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)
  // 投递目标候选（按渠道）
  const [targetOptions, setTargetOptions] = useState<DeliveryTargetOpt[]>([])
  const [loadingTargets, setLoadingTargets] = useState(false)

  // Drawer 打开时加载 agents
  const loadAgents = useCallback(async (): Promise<void> => {
    setLoadingAgents(true)
    try {
      const list = (await window.api.agent.list()) as Array<{
        id: string
        name?: string
        identity?: { name?: string; emoji?: string }
        default?: boolean
      }>
      const opts = list.map((a) => {
        const displayName = a.identity?.name || a.name || a.id
        const emoji = a.identity?.emoji
        return {
          value: a.id,
          label: emoji ? `${emoji} ${displayName}` : displayName,
        }
      })
      setAgentOptions(opts)
    } catch {
      setAgentOptions([])
    } finally {
      setLoadingAgents(false)
    }
  }, [])

  const loadDeliveryTargets = useCallback(async (channel?: string): Promise<void> => {
    if (!channel) {
      setTargetOptions([])
      return
    }
    setLoadingTargets(true)
    try {
      const list = await window.api.cron.listDeliveryTargets(channel)
      setTargetOptions(Array.isArray(list) ? list : [])
    } catch (err) {
      console.warn('[cron] listDeliveryTargets failed', err)
      setTargetOptions([])
    } finally {
      setLoadingTargets(false)
    }
  }, [])

  // 切换投递渠道 / 打开抽屉时刷新目标列表
  useEffect(() => {
    if (!open || deliveryMode !== 'announce') {
      if (!open) setTargetOptions([])
      return
    }
    void loadDeliveryTargets(deliveryChannel)
  }, [open, deliveryMode, deliveryChannel, loadDeliveryTargets])

  useEffect(() => {
    if (open) {
      loadAgents()
      if (editJob) {
        const schedPart = scheduleToForm(editJob.schedule)
        const deliveryPart = deliveryToForm(editJob.delivery)
        form.setFieldsValue({
          name: editJob.name,
          description: editJob.description,
          // OpenClaw 2026.7：message 在 payload；agentId 在任务顶层
          message: editJob.payload?.message ?? editJob.payload?.text,
          agentId: editJob.agentId ?? undefined,
          enabled: editJob.enabled,
          ...schedPart,
          runAt: schedPart.runAt,
          ...deliveryPart,
        })
      } else {
        form.resetFields()
        form.setFieldsValue({
          scheduleKind: 'interval',
          intervalAmount: 30,
          intervalUnit: 'minutes',
          cronPreset: 'daily9am',
          deliveryMode: 'none',
          enabled: true,
        })
      }
    }
  }, [open, editJob, form, loadAgents])

  const handleSubmit = async (): Promise<void> => {
    const values = await form.validateFields()
    // DatePicker 通过 getValueFromEvent 已转为数值，此处做保险处理
    if (values.scheduleKind === 'once' && values.runAt) {
      if (typeof values.runAt !== 'number') {
        const d = values.runAt as unknown
        values.runAt =
          typeof (d as { valueOf?: () => number }).valueOf === 'function'
            ? (d as { valueOf: () => number }).valueOf()
            : Number(d)
      }
    }
    await onSave(values)
  }

  const title = editJob ? t('cron.form.editTitle') : t('cron.form.createTitle')

  const PRESET_OPTIONS = [
    { value: 'everyMinute', label: t('cron.form.presets.everyMinute') },
    { value: 'every5Min', label: t('cron.form.presets.every5Min') },
    { value: 'every15Min', label: t('cron.form.presets.every15Min') },
    { value: 'everyHour', label: t('cron.form.presets.everyHour') },
    { value: 'daily9am', label: t('cron.form.presets.daily9am') },
    { value: 'daily18pm', label: t('cron.form.presets.daily18pm') },
    { value: 'weeklyMonday', label: t('cron.form.presets.weeklyMonday') },
    { value: 'monthly1st', label: t('cron.form.presets.monthly1st') },
    { value: 'custom', label: t('cron.form.presets.custom') },
  ]

  return (
    <Drawer
      title={title}
      open={open}
      onClose={onClose}
      rootStyle={{ top: TITLE_BAR_HEIGHT }}
      width={480}
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" onClick={handleSubmit} loading={saving}>
            {t('common.save')}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        {/* 基本信息 */}
        <Form.Item
          label={t('cron.form.name')}
          name="name"
          rules={[{ required: true, message: t('cron.form.nameRequired') }]}
        >
          <Input placeholder={t('cron.form.namePlaceholder')} />
        </Form.Item>

        <Form.Item label={t('cron.form.description')} name="description">
          <Input placeholder={t('cron.form.descriptionPlaceholder')} />
        </Form.Item>

        {/* 调度方式 */}
        <Form.Item label={t('cron.form.scheduleType')} name="scheduleKind">
          <Radio.Group>
            <Radio.Button value="interval">{t('cron.form.interval')}</Radio.Button>
            <Radio.Button value="cron">{t('cron.form.cron')}</Radio.Button>
            <Radio.Button value="once">{t('cron.form.once')}</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {/* 间隔执行 */}
        {scheduleKind === 'interval' && (
          <Form.Item label={t('cron.form.every')} style={{ marginBottom: 16 }}>
            <Space>
              <Form.Item name="intervalAmount" noStyle rules={[{ required: true }]}>
                <InputNumber min={1} max={9999} style={{ width: 100 }} />
              </Form.Item>
              <Form.Item name="intervalUnit" noStyle>
                <Select style={{ width: 100 }}>
                  <Select.Option value="minutes">{t('cron.form.unit.minutes')}</Select.Option>
                  <Select.Option value="hours">{t('cron.form.unit.hours')}</Select.Option>
                  <Select.Option value="days">{t('cron.form.unit.days')}</Select.Option>
                </Select>
              </Form.Item>
            </Space>
          </Form.Item>
        )}

        {/* 定时执行 */}
        {scheduleKind === 'cron' && (
          <>
            <Form.Item label={t('cron.form.cronPreset')} name="cronPreset">
              <Select options={PRESET_OPTIONS} />
            </Form.Item>
            {cronPreset === 'custom' && (
              <Form.Item
                label={t('cron.form.cronExpr')}
                name="cronExpr"
                rules={[{ required: true, message: t('cron.form.cronExprRequired') }]}
              >
                <Input placeholder="0 9 * * *" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            )}
          </>
        )}

        {/* 单次执行 */}
        {scheduleKind === 'once' && (
          <Form.Item
            label={t('cron.form.runAt')}
            name="runAt"
            rules={[{ required: true }]}
            getValueFromEvent={(d: dayjs.Dayjs | null) => d?.valueOf()}
            getValueProps={(v: number | undefined) => ({ value: v ? dayjs(v) : null })}
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        )}

        {/* 执行内容 */}
        <Form.Item
          label={t('cron.form.message')}
          name="message"
          rules={[{ required: true, message: t('cron.form.messageRequired') }]}
        >
          <TextArea rows={4} placeholder={t('cron.form.messagePlaceholder')} />
        </Form.Item>

        {/* Agent 选择（下拉，留空=使用默认） */}
        <Form.Item label={t('cron.form.agentId')} name="agentId">
          <Select
            allowClear
            loading={loadingAgents}
            placeholder={t('cron.form.agentIdPlaceholder')}
            options={agentOptions}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>

        {/* 结果投递 */}
        <Form.Item
          label={t('cron.form.deliveryMode')}
          name="deliveryMode"
          extra={<Text type="secondary" style={{ fontSize: 12 }}>{t('cron.form.deliveryHint')}</Text>}
        >
          <Radio.Group>
            <Radio.Button value="none">{t('cron.form.delivery.none')}</Radio.Button>
            <Radio.Button value="announce">{t('cron.form.delivery.announce')}</Radio.Button>
            <Radio.Button value="webhook">{t('cron.form.delivery.webhook')}</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {deliveryMode === 'announce' && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={t('cron.form.announceTip')}
            />
            <Form.Item
              label={t('cron.form.deliveryChannel')}
              name="deliveryChannel"
              rules={[{ required: true, message: t('cron.form.deliveryChannelRequired') }]}
            >
              <Select
                placeholder={t('cron.form.deliveryChannelPlaceholder')}
                options={DELIVERY_CHANNEL_OPTIONS.map((c) => ({
                  value: c.value,
                  label: t(c.labelKey),
                }))}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item
              label={t('cron.form.deliveryTo')}
              name="deliveryTo"
              rules={[{ required: true, message: t('cron.form.deliveryToRequired') }]}
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {loadingTargets
                    ? t('cron.form.deliveryToLoading')
                    : targetOptions.length > 0
                      ? t('cron.form.deliveryToSelectHintCount', { n: targetOptions.length })
                      : t('cron.form.deliveryToHint')}
                </Text>
              }
            >
              <AutoComplete
                options={targetOptions.map((o) => ({
                  value: o.value,
                  // 用 label 展示来源；选中后框内仍是 value
                  label: o.label,
                }))}
                placeholder={
                  deliveryChannel
                    ? t('cron.form.deliveryToPlaceholder')
                    : t('cron.form.deliveryToNeedChannel')
                }
                disabled={!deliveryChannel}
                allowClear
                defaultOpen={false}
                filterOption={(input, option) => {
                  const v = String(option?.value ?? '')
                  const l = String(option?.label ?? '')
                  const q = input.toLowerCase()
                  return v.toLowerCase().includes(q) || l.toLowerCase().includes(q)
                }}
                notFoundContent={
                  loadingTargets ? (
                    <Spin size="small" />
                  ) : !deliveryChannel ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('cron.form.deliveryToNeedChannel')}
                    </Text>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('cron.form.deliveryToEmpty')}
                    </Text>
                  )
                }
              />
            </Form.Item>
          </>
        )}

        {deliveryMode === 'webhook' && (
          <Form.Item
            label={t('cron.form.webhookUrl')}
            name="deliveryTo"
            rules={[
              { required: true, message: t('cron.form.webhookUrlRequired') },
              {
                type: 'url',
                message: t('cron.form.webhookUrlInvalid'),
              },
            ]}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{t('cron.form.webhookUrlHint')}</Text>}
          >
            <Input placeholder="https://example.com/hooks/cron" />
          </Form.Item>
        )}

        {/* 启用开关 */}
        <Form.Item label={t('cron.form.enableNow')} name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
