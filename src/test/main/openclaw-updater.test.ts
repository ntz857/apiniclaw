import { beforeEach, describe, expect, it, vi } from 'vitest'

const existsSyncMock = vi.fn()
const mkdirSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const cpSyncMock = vi.fn()
const rmSyncMock = vi.fn()
const readFileSyncMock = vi.fn()

const readConfigMock = vi.fn()
const writeConfigMock = vi.fn()

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
  resolveBundledNodeBin: (): string => '/tmp/runtime/node',
  resolveBundledNpmBin: (): string => '/tmp/runtime/npm-cli.js',
  resolveResourcesPath: (): string => '/tmp/resources',
}))

vi.mock('../../main/config', () => ({
  readConfig: readConfigMock,
  writeConfig: writeConfigMock,
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
      { source: 'auto', summary: '启用内置微信插件' },
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
          'resources/gateway/node_modules/openclaw/extensions/openclaw-weixin/openclaw.plugin.json',
        ) ||
        n.includes(
          'apiniclaw/gateway/node_modules/openclaw/extensions/openclaw-weixin/openclaw.plugin.json',
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
