import { existsSync } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  compareOpenclawVersion,
  describeOpenclawResolve,
  listSystemOpenclawPackageCandidates,
  resolveOpenclawLaunch,
} from '../../main/services/openclaw-resolve'

describe('openclaw-resolve', () => {
  it('lists brew/npm global package candidates including Homebrew lib', () => {
    const candidates = listSystemOpenclawPackageCandidates()
    expect(candidates.length).toBeGreaterThan(0)
    // macOS Apple Silicon 常见路径必须在候选中（即使本机未安装）
    if (process.platform === 'darwin') {
      expect(candidates.some((p) => p.includes('/opt/homebrew/lib/node_modules/openclaw'))).toBe(
        true
      )
    }
  })

  it('resolves a launchable openclaw entry', () => {
    const launch = resolveOpenclawLaunch()
    expect(launch.entryPath).toBeTruthy()
    expect(launch.nodePath).toBeTruthy()
    expect(['system', 'user', 'bundled']).toContain(launch.source)
    // 本机有全局 2026.x 时优先 system，且能读到版本
    if (launch.source === 'system') {
      expect(launch.version).toMatch(/^2026\./)
      expect(existsSync(launch.entryPath)).toBe(true)
    }
  })

  it('does not fall back to bundled when Homebrew or newer user openclaw exists', () => {
    const brewEntry = '/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs'
    if (process.platform !== 'darwin' || !existsSync(brewEntry)) {
      return
    }
    const launch = resolveOpenclawLaunch()
    // system/user 择优后不应再落到 bundled
    expect(['system', 'user']).toContain(launch.source)
    expect(launch.version).not.toBe('unknown')
    expect(existsSync(launch.entryPath)).toBe(true)
  })

  it('describeOpenclawResolve returns summary string', () => {
    const s = describeOpenclawResolve()
    expect(s).toMatch(/system|user|bundled/)
  })

  it('compareOpenclawVersion orders calendar versions', () => {
    expect(compareOpenclawVersion('2026.7.1-2', '2026.3.1')).toBeGreaterThan(0)
    expect(compareOpenclawVersion('2026.3.1', '2026.7.1')).toBeLessThan(0)
    expect(compareOpenclawVersion('2026.7.1', '2026.7.1')).toBe(0)
    expect(compareOpenclawVersion('unknown', '2026.7.1')).toBeLessThan(0)
  })
})
