import { describe, expect, it } from 'vitest'
import { formToSchedule, type CronFormValues } from '../../renderer/src/stores/cronStore'

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
    enabled: form.enabled,
  }
}

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
})
