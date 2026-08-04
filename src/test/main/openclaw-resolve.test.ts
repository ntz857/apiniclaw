import { describe, expect, it } from 'vitest'
import { resolveOpenclawLaunch, describeOpenclawResolve } from '../../main/services/openclaw-resolve'

describe('openclaw-resolve', () => {
  it('resolves a launchable openclaw entry', () => {
    const launch = resolveOpenclawLaunch()
    expect(launch.entryPath).toBeTruthy()
    expect(launch.nodePath).toBeTruthy()
    expect(['system', 'user', 'bundled']).toContain(launch.source)
    // 本机有 npm 全局 2026.7 时优先 system
    if (launch.source === 'system') {
      expect(launch.version).toMatch(/^2026\./)
    }
  })

  it('describeOpenclawResolve returns summary string', () => {
    const s = describeOpenclawResolve()
    expect(s).toMatch(/system|user|bundled/)
  })
})
