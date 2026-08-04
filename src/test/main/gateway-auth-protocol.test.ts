import { describe, expect, it } from 'vitest'
import {
  buildConnectFrame,
  GATEWAY_PROTOCOL_MAX,
  GATEWAY_PROTOCOL_MIN,
  OPERATOR_SCOPES,
} from '../../main/gateway/auth'

describe('gateway connect protocol', () => {
  it('negotiates protocol range covering OpenClaw 2026.3 (v3) and 2026.7 (v4)', () => {
    // 2026.3.x: maxProtocol < 3 || minProtocol > 3 → reject
    expect(GATEWAY_PROTOCOL_MAX).toBeGreaterThanOrEqual(3)
    expect(GATEWAY_PROTOCOL_MIN).toBeLessThanOrEqual(3)

    // 2026.7.x: maxProtocol >= 4 && minProtocol <= 4
    expect(GATEWAY_PROTOCOL_MAX).toBeGreaterThanOrEqual(4)
    expect(GATEWAY_PROTOCOL_MIN).toBeLessThanOrEqual(4)
  })

  it('buildConnectFrame declares dual protocol range and operator scopes', () => {
    const frame = buildConnectFrame('test-nonce') as {
      type: string
      method: string
      params: {
        minProtocol: number
        maxProtocol: number
        role: string
        scopes: string[]
        client: { id: string; mode: string }
        device: { nonce: string; signature: string }
      }
    }

    expect(frame.type).toBe('req')
    expect(frame.method).toBe('connect')
    expect(frame.params.minProtocol).toBe(GATEWAY_PROTOCOL_MIN)
    expect(frame.params.maxProtocol).toBe(GATEWAY_PROTOCOL_MAX)
    expect(frame.params.role).toBe('operator')
    expect(frame.params.client.id).toBe('openclaw-control-ui')
    expect(frame.params.client.mode).toBe('ui')
    expect(frame.params.device.nonce).toBe('test-nonce')
    expect(frame.params.device.signature).toBeTruthy()
    expect(frame.params.scopes).toEqual([...OPERATOR_SCOPES])
    expect(frame.params.scopes).toContain('operator.read')
    expect(frame.params.scopes).toContain('operator.write')
    expect(frame.params.scopes).toContain('operator.talk.secrets')
  })
})
