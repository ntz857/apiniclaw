import { describe, expect, it } from 'vitest'
import {
  formatConfigPermissionError,
  isConfigPermissionError,
  wrapConfigAccessError,
} from '../../main/config/config-access-error'

describe('config-access-error', () => {
  it('detects EACCES / openclaw permission messages', () => {
    expect(isConfigPermissionError('EACCES: permission denied')).toBe(true)
    expect(
      isConfigPermissionError(
        "Config file is not readable by the current process. open '/Users/x/.openclaw/openclaw.json'"
      )
    ).toBe(true)
    expect(isConfigPermissionError(new Error('permission denied, open openclaw.json'))).toBe(true)
    expect(isConfigPermissionError('invalid json')).toBe(false)
  })

  it('formats actionable chown guidance', () => {
    const msg = formatConfigPermissionError('EACCES: permission denied')
    expect(msg).toContain('权限不足')
    expect(msg).toContain('sudo chown')
    expect(msg).toContain('openclaw.json')
    expect(msg).toContain('EACCES')
  })

  it('wraps only permission errors', () => {
    const other = new Error('boom')
    expect(wrapConfigAccessError(other)).toBe(other)

    const wrapped = wrapConfigAccessError(new Error('EACCES: permission denied'))
    expect(wrapped).not.toBe(other)
    expect(wrapped.message).toContain('sudo chown')
  })
})
