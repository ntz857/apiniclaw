import { beforeEach, describe, expect, it, vi } from 'vitest'

const existsSyncMock = vi.fn()
const mkdirSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const cpSyncMock = vi.fn()
const rmSyncMock = vi.fn()
const readFileSyncMock = vi.fn()

const readConfigMock = vi.fn()
const writeConfigMock = vi.fn()
const resolveOpenclawLaunchMock = vi.fn()

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  readdirSync: readdirSyncMock,
  cpSync: cpSyncMock,
  rmSync: rmSyncMock,
  readFileSync: readFileSyncMock,
}))

vi.mock('../../main/constants', () => ({
  APINICLAW_GATEWAY_DIR: '/tmp/apiniclaw/gateway',
  CONFIG_PATH: '/tmp/openclaw/openclaw.json',
  IS_WIN: false,
  resolveBundledNodeBin: (): string => '/tmp/runtime/node',
  resolveBundledNpmBin: (): string => '/tmp/runtime/npm-cli.js',
  resolveBundledRuntimeBinDir: (): string => '/tmp/runtime',
  resolveResourcesPath: (): string => '/tmp/resources',
}))

vi.mock('../../main/config', () => ({
  readConfig: readConfigMock,
  writeConfig: writeConfigMock,
}))

vi.mock('../../main/services/openclaw-resolve', () => ({
  resolveOpenclawLaunch: (): unknown => resolveOpenclawLaunchMock(),
  compareOpenclawVersion: (a: string, b: string): number => {
    if (a === b) return 0
    return a > b ? 1 : -1
  },
}))

vi.mock('../../main/services/engine-offline-install', () => ({
  resolveBundledOpenclawMediaDir: (): string => '/tmp/resources/gateway/node_modules/openclaw',
  installBundledEngineOffline: (): {
    ok: boolean
    packageDir: string
    prefix: { label: string; nodeModulesDir: string; binDir: string }
  } => ({
    ok: true,
    packageDir: '/tmp/global/node_modules/openclaw',
    prefix: {
      label: 'test-prefix',
      nodeModulesDir: '/tmp/global/node_modules',
      binDir: '/tmp/global/bin',
    },
  }),
}))

describe('openclaw updater bundled weixin helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    existsSyncMock.mockReturnValue(false)
    mkdirSyncMock.mockImplementation(() => undefined)
    readdirSyncMock.mockReturnValue([])
    cpSyncMock.mockImplementation(() => undefined)
    rmSyncMock.mockImplementation(() => undefined)
    readFileSyncMock.mockReturnValue(JSON.stringify({ version: '2026.3.13' }))
    readConfigMock.mockReturnValue({})
    writeConfigMock.mockImplementation(() => undefined)
    resolveOpenclawLaunchMock.mockReturnValue({
      source: 'bundled',
      nodePath: '/tmp/runtime/node',
      entryPath: '/tmp/resources/gateway/node_modules/openclaw/openclaw.mjs',
      cwd: '/tmp/resources/gateway/node_modules/openclaw',
      version: '2026.7.1-2',
    })
  })

  it('已有配置但未显式设置时，默认启用微信插件', async () => {
    existsSyncMock.mockImplementation((file: string) => file === '/tmp/openclaw/openclaw.json')
    readConfigMock.mockReturnValue({})

    const { ensureBundledWeixinPluginEnabled } =
      await import('../../main/services/openclaw-updater')
    const result = ensureBundledWeixinPluginEnabled()

    expect(result).toEqual({ enabled: true, changed: true, skipped: false })
    expect(writeConfigMock).toHaveBeenCalledWith(
      {
        plugins: {
          entries: {
            'openclaw-weixin': {
              enabled: true,
            },
          },
        },
      },
      { source: 'auto', summary: '启用内置微信插件' }
    )
  })

  it('用户已显式关闭时不覆盖 openclaw-weixin.enabled=false', async () => {
    existsSyncMock.mockImplementation((file: string) => file === '/tmp/openclaw/openclaw.json')
    readConfigMock.mockReturnValue({
      plugins: {
        entries: {
          'openclaw-weixin': {
            enabled: false,
          },
        },
      },
    })

    const { ensureBundledWeixinPluginEnabled } =
      await import('../../main/services/openclaw-updater')
    const result = ensureBundledWeixinPluginEnabled()

    expect(result).toEqual({ enabled: false, changed: false, skipped: true })
    expect(writeConfigMock).not.toHaveBeenCalled()
  })

  it('状态查询会同时返回 bundled、用户目录和 enabled 状态', async () => {
    existsSyncMock.mockImplementation((file: string) => {
      const n = String(file).replace(/\\/g, '/')
      return (
        n.includes('/tmp/openclaw/openclaw.json') ||
        n.endsWith('openclaw/openclaw.json') ||
        n.includes(
          'resources/gateway/node_modules/openclaw/extensions/openclaw-weixin/openclaw.plugin.json'
        ) ||
        n.includes(
          'apiniclaw/gateway/node_modules/openclaw/extensions/openclaw-weixin/openclaw.plugin.json'
        )
      )
    })
    readConfigMock.mockReturnValue({
      plugins: {
        entries: {
          'openclaw-weixin': {
            enabled: true,
          },
        },
      },
    })

    const { getBundledWeixinStatus } = await import('../../main/services/openclaw-updater')
    expect(getBundledWeixinStatus()).toEqual({
      bundled: true,
      installedToUserDir: true,
      enabled: true,
      configMissing: false,
    })
  })
})

describe('openclaw updater current version follows resolve', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('本机 Homebrew 优先时显示 system 版本而不是内置 2026.7.1-2', async () => {
    resolveOpenclawLaunchMock.mockReturnValue({
      source: 'system',
      nodePath: '/opt/homebrew/bin/node',
      entryPath: '/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs',
      cwd: '/opt/homebrew/lib/node_modules/openclaw',
      version: '2026.7.1',
    })

    const { getCurrentOpenclawInfo, getCurrentOpenclawVersion } =
      await import('../../main/services/openclaw-updater')

    expect(getCurrentOpenclawVersion()).toBe('2026.7.1')
    expect(getCurrentOpenclawInfo()).toEqual({
      currentVersion: '2026.7.1',
      source: 'system',
    })
  })

  it('无本机包时回退内置版本与 bundled 来源', async () => {
    resolveOpenclawLaunchMock.mockReturnValue({
      source: 'bundled',
      nodePath: '/tmp/runtime/node',
      entryPath: '/tmp/resources/gateway/node_modules/openclaw/openclaw.mjs',
      cwd: '/tmp/resources/gateway/node_modules/openclaw',
      version: '2026.7.1-2',
    })

    const { getCurrentOpenclawInfo } = await import('../../main/services/openclaw-updater')
    expect(getCurrentOpenclawInfo()).toEqual({
      currentVersion: '2026.7.1-2',
      source: 'bundled',
    })
  })

  it('检查更新对比安装包内置版本，而非 npm 线上', async () => {
    existsSyncMock.mockImplementation((file: string) =>
      String(file).includes('/tmp/resources/gateway/node_modules/openclaw')
    )
    readFileSyncMock.mockReturnValue(JSON.stringify({ version: '2026.7.1-2' }))
    resolveOpenclawLaunchMock.mockReturnValue({
      source: 'system',
      nodePath: '/opt/homebrew/bin/node',
      entryPath: '/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs',
      cwd: '/opt/homebrew/lib/node_modules/openclaw',
      version: '2026.3.1',
    })

    const { checkOpenclawUpdate } = await import('../../main/services/openclaw-updater')
    const info = await checkOpenclawUpdate()
    expect(info.bundledVersion).toBe('2026.7.1-2')
    expect(info.latestVersion).toBe('2026.7.1-2')
    expect(info.currentVersion).toBe('2026.3.1')
    expect(info.status).toBe('available')
  })
})

describe('openclaw updater npm install env', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('把内置 runtime 和 Homebrew bin 插到 PATH 最前，并开启 scripts-prepend-node-path', async () => {
    existsSyncMock.mockImplementation((file: string) => {
      const n = String(file)
      return n === '/tmp/runtime' || n === '/opt/homebrew/bin'
    })

    const { buildNpmInstallEnv } = await import('../../main/services/openclaw-updater')
    const env = buildNpmInstallEnv({ PATH: '/usr/bin:/bin' })

    expect(env.PATH?.startsWith('/tmp/runtime:')).toBe(true)
    expect(env.PATH).toContain('/opt/homebrew/bin')
    expect(env.PATH?.endsWith('/usr/bin:/bin')).toBe(true)
    expect(env.npm_config_scripts_prepend_node_path).toBe('true')
    expect(env.npm_config_yes).toBe('true')
  })
})
