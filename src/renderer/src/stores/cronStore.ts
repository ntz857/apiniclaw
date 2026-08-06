/**
 * cronStore — 定时任务 Zustand Store
 *
 * callRpc 以参数形式传入，Store 不直接依赖 React Context。
 */

import { create } from 'zustand'

// ========== 类型定义 ==========

export type ScheduleKind = 'interval' | 'cron' | 'once'

/** 运行结果投递：none=不推送（默认）；announce=推到 IM；webhook=HTTP 回调 */
export type DeliveryMode = 'none' | 'announce' | 'webhook'

export interface CronDelivery {
  mode: DeliveryMode
  /** announce 时的渠道：feishu / telegram / discord / slack … */
  channel?: string
  /** announce 时的目标 chatId/user:openId；webhook 时为 URL */
  to?: string
}

export interface CronJob {
  id: string
  agentId?: string
  sessionKey?: string
  name: string
  description?: string
  enabled: boolean
  createdAtMs?: number
  updatedAtMs?: number
  schedule: {
    kind: 'every' | 'cron' | 'at'
    everyMs?: number
    expr?: string
    at?: string
    tz?: string
  }
  sessionTarget?: 'main' | 'isolated'
  wakeMode?: string
  payload: {
    kind: 'agentTurn' | 'systemEvent' | 'command'
    message?: string // agentTurn
    text?: string // systemEvent
  }
  delivery?: CronDelivery
  // 运行状态嵌套在 state 字段（实际 API 格式）
  state?: {
    nextRunAtMs?: number
    lastRunAtMs?: number
    lastRunStatus?: 'ok' | 'error' | 'skipped'
    lastStatus?: string
    lastDurationMs?: number
    lastDeliveryStatus?: string
    consecutiveErrors?: number
  }
  // 兼容旧版扁平字段
  lastRun?: {
    status: 'ok' | 'error' | 'skipped'
    startedAt: number
    durationMs?: number
    error?: string
  }
  lastRunAt?: number
  lastRunStatus?: 'ok' | 'error' | 'skipped'
  nextRunAt?: number
  nextRunAtMs?: number
  createdAt?: number
}

export interface CronRun {
  ts: number // 记录时间戳，用作唯一 key
  jobId: string
  action?: string // 'finished' | 'started' 等
  status: 'ok' | 'error' | 'skipped'
  summary?: string // AI 运行摘要
  /** 失败原因（如投递到飞书缺少 target） */
  error?: string
  runAtMs: number // 实际运行开始时间（ms）
  durationMs?: number
  nextRunAtMs?: number // 本次运行完成后的下次计划时间
  /** delivered | not-delivered | not-requested | unknown */
  deliveryStatus?: string
  delivered?: boolean
  deliveryError?: string
}

/** 表单值（面向用户的简化结构） */
export interface CronFormValues {
  name: string
  description?: string
  scheduleKind: ScheduleKind
  // interval
  intervalAmount?: number
  intervalUnit?: 'minutes' | 'hours' | 'days'
  // cron
  cronPreset?: string
  cronExpr?: string
  // once
  runAt?: number // timestamp ms
  message: string
  agentId?: string
  /** 投递模式，默认 none */
  deliveryMode?: DeliveryMode
  /** announce 渠道 */
  deliveryChannel?: string
  /** announce 目标 / webhook URL */
  deliveryTo?: string
  enabled: boolean
}

/** 常见 IM 渠道（与 OpenClaw announce 对齐） */
export const DELIVERY_CHANNEL_OPTIONS = [
  { value: 'feishu', labelKey: 'cron.form.channel.feishu' },
  { value: 'telegram', labelKey: 'cron.form.channel.telegram' },
  { value: 'discord', labelKey: 'cron.form.channel.discord' },
  { value: 'slack', labelKey: 'cron.form.channel.slack' },
  { value: 'whatsapp', labelKey: 'cron.form.channel.whatsapp' },
  { value: 'signal', labelKey: 'cron.form.channel.signal' },
  { value: 'imessage', labelKey: 'cron.form.channel.imessage' },
  { value: 'wecom', labelKey: 'cron.form.channel.wecom' },
  { value: 'dingtalk', labelKey: 'cron.form.channel.dingtalk' },
] as const

/** 表单 → OpenClaw delivery 对象 */
export function formToDelivery(values: CronFormValues): CronDelivery {
  const mode = values.deliveryMode ?? 'none'
  if (mode === 'none') return { mode: 'none' }
  if (mode === 'webhook') {
    return {
      mode: 'webhook',
      to: values.deliveryTo?.trim() || undefined,
    }
  }
  // announce
  return {
    mode: 'announce',
    channel: values.deliveryChannel?.trim() || undefined,
    to: values.deliveryTo?.trim() || undefined,
  }
}

/** 任务 delivery → 表单字段 */
export function deliveryToForm(delivery?: CronDelivery | null): Partial<CronFormValues> {
  if (!delivery || !delivery.mode) {
    return { deliveryMode: 'none', deliveryChannel: undefined, deliveryTo: undefined }
  }
  return {
    deliveryMode: delivery.mode,
    deliveryChannel: delivery.channel,
    deliveryTo: delivery.to,
  }
}

/** 规范化 cron.list 单项（兼容 delivery 嵌套 / 扁平） */
export function normalizeCronJob(raw: CronJob & Record<string, unknown>): CronJob {
  const nested = raw.delivery as CronDelivery | undefined
  if (nested?.mode) {
    return { ...raw, delivery: nested }
  }
  // 少数实现可能扁平返回
  const mode = (raw.deliveryMode ?? raw.delivery_mode) as DeliveryMode | undefined
  if (mode) {
    return {
      ...raw,
      delivery: {
        mode,
        channel: (raw.deliveryChannel ?? raw.delivery_channel ?? raw.channel) as string | undefined,
        to: (raw.deliveryTo ?? raw.delivery_to ?? raw.to) as string | undefined,
      },
    }
  }
  return raw
}

type CallRpc = (method: string, params: unknown) => Promise<unknown>

/**
 * OpenClaw `cron.list` 默认只返回 enabled 任务（enabledFilter="enabled"）。
 * 管理页需要同时展示已暂停任务，否则关闭开关后刷新/重载会像「被删除」。
 * 兼容两种参数：enabled:"all" 与 includeDisabled:true。
 */
/** 导出供测试断言；管理页所有 cron.list 必须用此参数 */
export const CRON_LIST_PARAMS = {
  limit: 100,
  offset: 0,
  enabled: 'all' as const,
  includeDisabled: true,
}

async function listCronJobs(callRpc: CallRpc): Promise<CronJob[]> {
  const result = (await callRpc('cron.list', CRON_LIST_PARAMS)) as {
    jobs?: Array<CronJob & Record<string, unknown>>
  }
  return (result.jobs ?? []).map((j) => normalizeCronJob(j))
}

// ========== 表单 → API 转换 ==========

export function formToSchedule(values: CronFormValues): CronJob['schedule'] {
  if (values.scheduleKind === 'interval') {
    const amount = values.intervalAmount ?? 30
    const unit = values.intervalUnit ?? 'minutes'
    const multiplier = unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 86_400_000
    return { kind: 'every', everyMs: amount * multiplier }
  }
  if (values.scheduleKind === 'cron') {
    const expr =
      values.cronPreset === 'custom' || !values.cronPreset
        ? (values.cronExpr ?? '0 9 * * *')
        : (CRON_PRESETS[values.cronPreset] ?? values.cronExpr ?? '0 9 * * *')
    return { kind: 'cron', expr }
  }
  // once
  return { kind: 'at', at: new Date(values.runAt ?? Date.now()).toISOString() }
}

export const CRON_PRESETS: Record<string, string> = {
  everyMinute: '* * * * *',
  every5Min: '*/5 * * * *',
  every15Min: '*/15 * * * *',
  everyHour: '0 * * * *',
  daily9am: '0 9 * * *',
  daily18pm: '0 18 * * *',
  weeklyMonday: '0 9 * * 1',
  monthly1st: '0 9 1 * *',
}

// ========== Schedule → 表单回填 ==========

export function scheduleToForm(schedule: CronJob['schedule']): Partial<CronFormValues> {
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs ?? 1_800_000
    if (ms % 86_400_000 === 0)
      return {
        scheduleKind: 'interval',
        intervalAmount: ms / 86_400_000,
        intervalUnit: 'days',
      }
    if (ms % 3_600_000 === 0)
      return {
        scheduleKind: 'interval',
        intervalAmount: ms / 3_600_000,
        intervalUnit: 'hours',
      }
    return {
      scheduleKind: 'interval',
      intervalAmount: ms / 60_000,
      intervalUnit: 'minutes',
    }
  }
  if (schedule.kind === 'cron') {
    const expr = schedule.expr ?? ''
    const preset = Object.entries(CRON_PRESETS).find(([, v]) => v === expr)?.[0]
    return {
      scheduleKind: 'cron',
      cronPreset: preset ?? 'custom',
      cronExpr: expr,
    }
  }
  // at
  return {
    scheduleKind: 'once',
    runAt: schedule.at ? new Date(schedule.at).getTime() : Date.now(),
  }
}

// ========== Store ==========

interface CronStore {
  jobs: CronJob[]
  loading: boolean
  error: string | null

  fetchAll: (callRpc: CallRpc) => Promise<void>
  createJob: (callRpc: CallRpc, form: CronFormValues) => Promise<void>
  updateJob: (callRpc: CallRpc, id: string, form: CronFormValues) => Promise<void>
  toggleJob: (callRpc: CallRpc, id: string, enabled: boolean) => Promise<void>
  triggerJob: (callRpc: CallRpc, id: string) => Promise<string>
  deleteJob: (callRpc: CallRpc, id: string) => Promise<void>
  fetchRuns: (
    callRpc: CallRpc,
    jobId: string,
    opts?: { limit?: number; offset?: number }
  ) => Promise<{ runs: CronRun[]; total: number }>
}

export const useCronStore = create<CronStore>((set) => ({
  jobs: [],
  loading: false,
  error: null,

  fetchAll: async (callRpc) => {
    set({ loading: true, error: null })
    try {
      const jobs = await listCronJobs(callRpc)
      set({ jobs, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  createJob: async (callRpc, form) => {
    // OpenClaw ≥2026.4 CronAddParamsSchema:
    // - agentId / sessionKey 在任务顶层（不在 payload 内）
    // - agentTurn 必填 sessionTarget=isolated|current|session:* 与 wakeMode
    // - payload.agentTurn 仅允许 message（及 model/thinking 等），additionalProperties=false
    const schedule = formToSchedule(form)
    const delivery = formToDelivery(form)
    await callRpc('cron.add', {
      name: form.name,
      description: form.description || undefined,
      ...(form.agentId ? { agentId: form.agentId } : {}),
      schedule,
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: {
        kind: 'agentTurn',
        message: form.message,
      },
      delivery,
      enabled: form.enabled,
    })
    set({ jobs: await listCronJobs(callRpc) })
  },

  updateJob: async (callRpc, id, form) => {
    const schedule = formToSchedule(form)
    const delivery = formToDelivery(form)
    await callRpc('cron.update', {
      id,
      patch: {
        name: form.name,
        description: form.description || undefined,
        // null 显式清空 agent；undefined 表示不改（此处用 null 以支持「默认 agent」）
        agentId: form.agentId ? form.agentId : null,
        schedule,
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: {
          kind: 'agentTurn',
          message: form.message,
        },
        delivery,
        enabled: form.enabled,
      },
    })
    set({ jobs: await listCronJobs(callRpc) })
  },

  toggleJob: async (callRpc, id, enabled) => {
    // 仅 patch enabled，不走 remove；关闭后任务仍保留，列表用 includeDisabled 可再看到
    await callRpc('cron.update', { id, patch: { enabled } })
    // 乐观更新，再全量拉取（含已禁用）确保与 Gateway 一致
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === id ? { ...j, enabled } : j)),
    }))
    try {
      set({ jobs: await listCronJobs(callRpc) })
    } catch {
      // 列表刷新失败时保留乐观结果
    }
  },

  triggerJob: async (callRpc, id) => {
    const result = (await callRpc('cron.run', { id, mode: 'force' })) as { runId?: string }
    return result.runId ?? ''
  },

  deleteJob: async (callRpc, id) => {
    await callRpc('cron.remove', { id })
    set((state) => ({ jobs: state.jobs.filter((j) => j.id !== id) }))
  },

  fetchRuns: async (callRpc, jobId, opts = {}) => {
    const result = (await callRpc('cron.runs', {
      scope: 'job',
      id: jobId,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    })) as { entries: CronRun[]; total: number }
    // API 返回 entries（不是 runs），total 在顶层
    return { runs: result.entries ?? [], total: result.total ?? 0 }
  },
}))
