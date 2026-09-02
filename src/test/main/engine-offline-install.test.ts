import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listGlobalPrefixCandidates,
  pickWritableGlobalPrefix,
  resolveWritableGlobalPrefix,
  type GlobalPrefixInfo,
} from '../../main/services/engine-offline-install'

describe('engine-offline-install', () => {
  const temps: string[] = []

  afterEach(() => {
    for (const d of temps) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    temps.length = 0
  })

  function tempDir(label: string): string {
    const d = mkdtempSync(join(tmpdir(), `apiniclaw-${label}-`))
    temps.push(d)
    return d
  }

  it('lists platform-appropriate global prefix candidates', () => {
    const candidates = listGlobalPrefixCandidates()
    expect(candidates.length).toBeGreaterThan(0)
    if (process.platform === 'darwin') {
      expect(
        candidates.some(
          (c) =>
            c.nodeModulesDir.includes('/opt/homebrew/lib/node_modules') ||
            c.label.startsWith('brew:')
        )
      ).toBe(true)
      expect(candidates.some((c) => c.label === 'npm-global-home')).toBe(true)
      // brew / homebrew 候选应排在 npm-global 之前
      const brewIdx = candidates.findIndex(
        (c) => c.label.startsWith('brew:') || c.label === 'homebrew-arm' || c.label === 'usr-local'
      )
      const npmGlobalIdx = candidates.findIndex((c) => c.label === 'npm-global-home')
      expect(brewIdx).toBeGreaterThanOrEqual(0)
      expect(npmGlobalIdx).toBeGreaterThan(brewIdx)
    }
    if (process.platform === 'win32') {
      expect(candidates.some((c) => c.label.includes('APPDATA'))).toBe(true)
    }
  })

  it('picks first writable prefix in order', () => {
    const a: GlobalPrefixInfo = {
      nodeModulesDir: '/fake/brew/lib/node_modules',
      binDir: '/fake/brew/bin',
      label: 'brew',
    }
    const b: GlobalPrefixInfo = {
      nodeModulesDir: '/fake/npm-global/lib/node_modules',
      binDir: '/fake/npm-global/bin',
      label: 'npm-global-home',
    }
    const writable = new Set([b.nodeModulesDir, b.binDir])
    const picked = pickWritableGlobalPrefix([a, b], (dir) => writable.has(dir))
    expect(picked?.label).toBe('npm-global-home')
  })

  it('prefers brew when both brew and npm-global are writable', () => {
    const brew: GlobalPrefixInfo = {
      nodeModulesDir: '/fake/brew/lib/node_modules',
      binDir: '/fake/brew/bin',
      label: 'brew',
    }
    const npmGlobal: GlobalPrefixInfo = {
      nodeModulesDir: '/fake/npm-global/lib/node_modules',
      binDir: '/fake/npm-global/bin',
      label: 'npm-global-home',
    }
    const allWritable = (): boolean => true
    expect(pickWritableGlobalPrefix([brew, npmGlobal], allWritable)?.label).toBe('brew')
  })

  it('resolves a writable global prefix on this machine (or apiniclaw fallback)', () => {
    const prefix = resolveWritableGlobalPrefix()
    expect(prefix).not.toBeNull()
    expect(prefix!.nodeModulesDir).toBeTruthy()
    expect(prefix!.binDir).toBeTruthy()
    expect(prefix!.label).toBeTruthy()
  })

  it('can stage a fake openclaw package under a writable prefix', () => {
    const root = tempDir('prefix')
    const nodeModulesDir = join(root, 'lib', 'node_modules')
    const binDir = join(root, 'bin')
    mkdirSync(nodeModulesDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })

    const dest = join(nodeModulesDir, 'openclaw')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'openclaw.mjs'), '#!/usr/bin/env node\nconsole.log("ok")\n')

    expect(existsSync(join(dest, 'openclaw.mjs'))).toBe(true)

    const picked = pickWritableGlobalPrefix(
      [{ nodeModulesDir, binDir, label: 'temp-prefix' }],
      () => true
    )
    expect(picked?.nodeModulesDir).toBe(nodeModulesDir)
  })
})
