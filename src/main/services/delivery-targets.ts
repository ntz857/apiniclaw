/**
 * 收集定时任务「投递目标」候选列表
 *
 * 来源（按渠道过滤）：
 * 1. openclaw.json channels.<id>.allowFrom / groupAllowFrom
 * 2. ~/.openclaw/credentials/*-allowFrom.json（配对审批写入）
 * 3. 历史 cron 任务 / task_delivery_state 中用过的 to
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { OPENCLAW_HOME } from '../constants'
import { getChannels } from '../config'
import { createLogger } from '../logger'

const log = createLogger('delivery-targets')

export interface DeliveryTargetOption {
  /** 写入 delivery.to 的值 */
  value: string
  /** 下拉展示 */
  label: string
  channel?: string
  /** 来源提示 */
  source?: 'allowFrom' | 'groupAllowFrom' | 'credentials' | 'history'
  kind?: 'user' | 'chat' | 'other'
}

function normalizeFeishuTarget(raw: string): { value: string; kind: 'user' | 'chat' | 'other' } {
  const t = raw.trim()
  if (!t) return { value: t, kind: 'other' }
  if (t.startsWith('user:') || t.startsWith('chat:')) {
    return { value: t, kind: t.startsWith('user:') ? 'user' : 'chat' }
  }
  // 飞书 open_id
  if (t.startsWith('ou_')) return { value: `user:${t}`, kind: 'user' }
  // 飞书 chat_id
  if (t.startsWith('oc_')) return { value: `chat:${t}`, kind: 'chat' }
  return { value: t, kind: 'other' }
}

function normalizeTelegramTarget(raw: string): { value: string; kind: 'user' | 'chat' | 'other' } {
  const t = raw.trim()
  if (!t) return { value: t, kind: 'other' }
  // 已是数字或 -100 群 id
  return { value: t, kind: t.startsWith('-') ? 'chat' : 'user' }
}

function normalizeTarget(
  channel: string,
  raw: string
): { value: string; kind: 'user' | 'chat' | 'other' } {
  const ch = channel.toLowerCase()
  if (ch === 'feishu' || ch === 'lark') return normalizeFeishuTarget(raw)
  if (ch === 'telegram') return normalizeTelegramTarget(raw)
  const t = raw.trim()
  return { value: t, kind: 'other' }
}

function labelFor(
  value: string,
  kind: 'user' | 'chat' | 'other',
  source?: DeliveryTargetOption['source']
): string {
  const src =
    source === 'credentials'
      ? '已配对'
      : source === 'allowFrom'
        ? 'DM 白名单'
        : source === 'groupAllowFrom'
          ? '群白名单'
          : source === 'history'
            ? '最近使用'
            : ''
  const kindLabel =
    kind === 'user' ? '用户' : kind === 'chat' ? '群聊/会话' : '目标'
  const short = value.length > 36 ? `${value.slice(0, 18)}…${value.slice(-10)}` : value
  return src ? `${kindLabel} · ${short}（${src}）` : `${kindLabel} · ${short}`
}

function addOption(
  map: Map<string, DeliveryTargetOption>,
  channel: string,
  raw: string,
  source: DeliveryTargetOption['source']
): void {
  if (!raw || raw === '*') return
  const { value, kind } = normalizeTarget(channel, raw)
  if (!value) return
  const key = `${channel}::${value}`
  if (map.has(key)) return
  map.set(key, {
    value,
    label: labelFor(value, kind, source),
    channel,
    source,
    kind,
  })
}

/** 读 credentials 下 *allowFrom*.json */
function collectFromCredentials(map: Map<string, DeliveryTargetOption>, channelFilter?: string): void {
  const dir = join(OPENCLAW_HOME, 'credentials')
  if (!existsSync(dir)) return
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().includes('allowfrom') && f.endsWith('.json'))
  } catch {
    return
  }
  for (const file of files) {
    // feishu-default-allowFrom.json / feishu-allowFrom.json
    const m = file.match(/^([a-z0-9_-]+?)(?:-default)?-allowFrom\.json$/i)
    const channel = m?.[1]?.toLowerCase()
    if (!channel) continue
    if (channelFilter && channel !== channelFilter.toLowerCase()) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as {
        allowFrom?: string[]
      }
      for (const id of raw.allowFrom ?? []) {
        addOption(map, channel, String(id), 'credentials')
      }
    } catch (err) {
      log.debug(`skip credentials file ${file}:`, err)
    }
  }
}

function collectFromChannelConfig(
  map: Map<string, DeliveryTargetOption>,
  channelFilter?: string
): void {
  const channels = getChannels()
  for (const [key, cfg] of Object.entries(channels)) {
    const channel = key.toLowerCase()
    if (channelFilter && channel !== channelFilter.toLowerCase()) continue
    const allowFrom = Array.isArray(cfg.allowFrom) ? (cfg.allowFrom as string[]) : []
    const groupAllowFrom = Array.isArray(cfg.groupAllowFrom)
      ? (cfg.groupAllowFrom as string[])
      : []
    for (const id of allowFrom) addOption(map, channel, String(id), 'allowFrom')
    for (const id of groupAllowFrom) addOption(map, channel, String(id), 'groupAllowFrom')

    // accounts.*.allowFrom 若存在
    const accounts = cfg.accounts
    if (accounts && typeof accounts === 'object') {
      for (const acc of Object.values(accounts as Record<string, Record<string, unknown>>)) {
        if (!acc || typeof acc !== 'object') continue
        if (Array.isArray(acc.allowFrom)) {
          for (const id of acc.allowFrom) addOption(map, channel, String(id), 'allowFrom')
        }
        if (Array.isArray(acc.groupAllowFrom)) {
          for (const id of acc.groupAllowFrom) addOption(map, channel, String(id), 'groupAllowFrom')
        }
      }
    }
  }
}

function collectFromHistory(map: Map<string, DeliveryTargetOption>, channelFilter?: string): void {
  // cron jobs in memory via jobs.json or sqlite — best-effort read jobs.json + sqlite
  const jobsPath = join(OPENCLAW_HOME, 'cron', 'jobs.json')
  if (existsSync(jobsPath)) {
    try {
      const raw = JSON.parse(readFileSync(jobsPath, 'utf-8'))
      const list = Array.isArray(raw) ? raw : raw.jobs
      if (Array.isArray(list)) {
        for (const job of list) {
          const d = job?.delivery
          if (d?.mode === 'announce' && d?.to) {
            const ch = String(d.channel || channelFilter || 'unknown').toLowerCase()
            if (channelFilter && ch !== channelFilter.toLowerCase()) continue
            addOption(map, ch, String(d.to), 'history')
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // sqlite task_delivery_state
  try {
    // dynamic import node:sqlite may fail on older node — use fs string scan fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const dbp = join(OPENCLAW_HOME, 'state', 'openclaw.sqlite')
    if (!existsSync(dbp)) return
    const db = new DatabaseSync(dbp, { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT requester_origin_json FROM task_delivery_state WHERE requester_origin_json IS NOT NULL LIMIT 100`
        )
        .all() as Array<{ requester_origin_json: string }>
      for (const r of rows) {
        try {
          const o = JSON.parse(r.requester_origin_json) as { channel?: string; to?: string }
          if (!o?.to || !o.channel) continue
          if (channelFilter && o.channel.toLowerCase() !== channelFilter.toLowerCase()) continue
          addOption(map, o.channel.toLowerCase(), o.to, 'history')
        } catch {
          /* ignore */
        }
      }
      // cron_jobs table
      try {
        const cronRows = db
          .prepare(
            `SELECT delivery_channel, delivery_to FROM cron_jobs WHERE delivery_to IS NOT NULL AND delivery_to != '' LIMIT 100`
          )
          .all() as Array<{ delivery_channel: string | null; delivery_to: string }>
        for (const r of cronRows) {
          const ch = (r.delivery_channel || channelFilter || 'unknown').toLowerCase()
          if (channelFilter && ch !== channelFilter.toLowerCase()) continue
          addOption(map, ch, r.delivery_to, 'history')
        }
      } catch {
        /* table shape differs */
      }
    } finally {
      try {
        db.close()
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    log.debug('history targets from sqlite skipped:', err)
  }
}

/**
 * 列出投递目标候选。channel 为空时返回所有渠道。
 */
export function listDeliveryTargets(channel?: string): DeliveryTargetOption[] {
  const map = new Map<string, DeliveryTargetOption>()
  collectFromChannelConfig(map, channel)
  collectFromCredentials(map, channel)
  collectFromHistory(map, channel)

  // 仅返回已启用渠道的（若指定 channel 则不限 enabled）
  if (!channel) {
    try {
      const channels = getChannels()
      const enabled = new Set(
        Object.entries(channels)
          .filter(([, c]) => c && (c as { enabled?: boolean }).enabled !== false)
          .map(([k]) => k.toLowerCase())
      )
      // 保留指定 channel 的条目；无 channel 过滤时保留有 enabled 配置或 history 的
      for (const [key, opt] of [...map.entries()]) {
        if (opt.channel && !enabled.has(opt.channel) && opt.source !== 'history') {
          // 仍保留 credentials/history
          if (opt.source === 'allowFrom' || opt.source === 'groupAllowFrom') {
            map.delete(key)
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  const list = [...map.values()]
  // credentials / allow 优先于 history
  const rank = (s?: DeliveryTargetOption['source']): number => {
    if (s === 'credentials') return 0
    if (s === 'allowFrom') return 1
    if (s === 'groupAllowFrom') return 2
    return 3
  }
  list.sort((a, b) => rank(a.source) - rank(b.source) || a.label.localeCompare(b.label))
  return list
}

/** 已配置且可能用于 announce 的渠道列表 */
export function listConfiguredChannels(): Array<{ value: string; label: string; enabled: boolean }> {
  const channels = getChannels()
  const names: Record<string, string> = {
    feishu: '飞书',
    lark: 'Lark',
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    whatsapp: 'WhatsApp',
    signal: 'Signal',
    imessage: 'iMessage',
    wecom: '企业微信',
    dingtalk: '钉钉',
    qqbot: 'QQ',
    weixin: '微信',
  }
  return Object.entries(channels).map(([key, cfg]) => ({
    value: key,
    label: names[key.toLowerCase()] ?? key,
    enabled: (cfg as { enabled?: boolean }).enabled !== false,
  }))
}

