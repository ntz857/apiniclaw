import { describe, expect, it } from 'vitest'
import {
  formToSchedule,
  formToDelivery,
  CRON_LIST_PARAMS,
  type CronFormValues,
} from '../../renderer/src/stores/cronStore'

/**
 * 与 OpenClaw CronAddParamsSchema 对齐的参数构造（抽取自 createJob 逻辑）。
 * 回归：禁止 payload.agentId / payload 使用 message 以外的 agent 字段。
 */
function buildCronAddParams(form: CronFormValues): Record<string, unknown> {
  const schedule = formToSchedule(form)
  return {
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
    delivery: formToDelivery(form),
    enabled: form.enabled,
  }
}

describe('cron.list params (include disabled jobs)', () => {
  it('management list must request enabled=all / includeDisabled', () => {
    // Gateway 默认只返回 enabled；关掉后若不用 all 会像被删除
    expect(CRON_LIST_PARAMS.enabled).toBe('all')
    expect(CRON_LIST_PARAMS.includeDisabled).toBe(true)
  })
})

describe('cron.add payload (OpenClaw 2026.7 schema)', () => {
  const base: CronFormValues = {
    name: 'test-job',
    description: 'desc',
    scheduleKind: 'cron',
    cronExpr: '0 9 * * *',
    message: 'hello agent',
    agentId: 'main',
    enabled: true,
  }

  it('puts agentId at top level, not inside payload', () => {
    const params = buildCronAddParams(base)
    expect(params.agentId).toBe('main')
    expect(params.sessionTarget).toBe('isolated')
    expect(params.wakeMode).toBe('now')
    const payload = params.payload as Record<string, unknown>
    expect(payload.kind).toBe('agentTurn')
    expect(payload.message).toBe('hello agent')
    expect(payload).not.toHaveProperty('agentId')
    expect(payload).not.toHaveProperty('text')
  })

  it('omits agentId when not set', () => {
    const params = buildCronAddParams({ ...base, agentId: undefined })
    expect(params).not.toHaveProperty('agentId')
  })

  it('defaults delivery.mode to none to avoid Feishu announce without target', () => {
    const params = buildCronAddParams(base)
    expect(params.delivery).toEqual({ mode: 'none' })
  })

  it('builds announce delivery with channel and to', () => {
    const params = buildCronAddParams({
      ...base,
      deliveryMode: 'announce',
      deliveryChannel: 'feishu',
      deliveryTo: 'chat:oc_xxx',
    })
    expect(params.delivery).toEqual({
      mode: 'announce',
      channel: 'feishu',
      to: 'chat:oc_xxx',
    })
  })

  it('builds webhook delivery with url in to', () => {
    const params = buildCronAddParams({
      ...base,
      deliveryMode: 'webhook',
      deliveryTo: 'https://example.com/hook',
    })
    expect(params.delivery).toEqual({
      mode: 'webhook',
      to: 'https://example.com/hook',
    })
  })
})
