/**
 * OpenClaw 升级服务
 *
 * 优先装到可写全局前缀（brew / npm-global，与离线安装一致）；
 * 不可写时降级 ~/.apiniclaw/gateway。升级成功后由主进程 restart Gateway。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import {
  APINICLAW_GATEWAY_DIR,
  CONFIG_PATH,
  IS_WIN,
  resolveBundledNodeBin,
  resolveBundledRuntimeBinDir,
  resolveResourcesPath,
} from '../constants'
import { installCli } from './cli-integration'
import {
  installBundledEngineOffline,
  resolveBundledOpenclawMediaDir,
} from './engine-offline-install'
import { createLogger } from '../logger'
import { readConfig, writeConfig } from '../config'
import {
  compareOpenclawVersion,
  resolveOpenclawLaunch,
  type OpenclawSource,
} from './openclaw-resolve'

const log = createLogger('openclaw-updater')

const WEIXIN_PLUGIN_ID = 'openclaw-weixin'

// ─── 类型定义 ───

export type OpenclawUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'installing'
  | 'done'
  | 'error'

export interface OpenclawUpdateInfo {
  status: OpenclawUpdateStatus
  /** 当前实际解析到的 openclaw 版本（与 Gateway 启动同源） */
  currentVersion: string
  /** 版本来源：本机全局 / 用户升级目录 / 安装包内置 */
  source?: OpenclawSource
  /**
   * 本安装包内置 openclaw 版本（同步目标）。
   * 字段名保留 latestVersion 以兼容现有 UI；语义已不是 npm 线上最新。
   */
  latestVersion?: string
  /** 同 latestVersion，更明确的命名 */
  bundledVersion?: string
  error?: string
  /** 安装/同步日志行 */
  logLines: string[]
}

/**
 * Electron GUI 的 PATH 通常只有 /usr/bin:/bin，不含 Homebrew / nvm。
 * npm lifecycle（`sh -c node scripts/...`）必须能解析到 node。
 */
export function buildNpmInstallEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sep = IS_WIN ? ';' : ':'
  const prev = base.PATH || base.Path || ''
  const extras: string[] = []
  const push = (dir: string | null | undefined): void => {
    if (!dir || extras.includes(dir) || !existsSync(dir)) return
    extras.push(dir)
  }

  push(resolveBundledRuntimeBinDir())
  push(dirname(resolveBundledNodeBin()))
  if (IS_WIN) {
    const pf = base.ProgramFiles || 'C:\\Program Files'
    push(join(pf, 'nodejs'))
    const local = base.LOCALAPPDATA
    if (local) push(join(local, 'Programs', 'nodejs'))
  } else {
    push('/opt/homebrew/bin')
    push('/usr/local/bin')
  }

  const pathEnv = extras.length
    ? prev
      ? `${extras.join(sep)}${sep}${prev}`
      : extras.join(sep)
    : prev
  return {
    ...base,
    PATH: pathEnv,
    ...(IS_WIN ? { Path: pathEnv } : {}),
    npm_config_yes: 'true',
    // 让 npm 把当前 node 所在目录插到脚本 PATH 最前
    npm_config_scripts_prepend_node_path: 'true',
  }
}

// ─── 版本解析 ───

/**
 * 从指定 package.json 读取版本号，读取失败返回 null
 */
function readPackageVersion(pkgJsonPath: string): string | null {
  try {
    if (!existsSync(pkgJsonPath)) return null
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

/**
 * 将应用内置的 extensions 同步到指定 openclaw 包的 extensions/。
 * 默认目标：用户升级目录（兼容旧调用）。
 */
export function syncBundledExtensionsToUserGateway(
  onLog: (line: string) => void,
  targetOpenclawDir?: string
): string[] {
  const bundledExtensionsDir = join(
    resolveResourcesPath(),
    'gateway',
    'node_modules',
    'openclaw',
    'extensions'
  )
  const userOpenclawDir =
    targetOpenclawDir || join(APINICLAW_GATEWAY_DIR, 'node_modules', 'openclaw')
  const userExtensionsDir = join(userOpenclawDir, 'extensions')

  if (!existsSync(bundledExtensionsDir)) {
    const msg = `未找到内置插件目录，跳过同步: ${bundledExtensionsDir}`
    log.warn(msg)
    onLog(`[ApiniClaw] 警告：${msg}`)
    return []
  }

  mkdirSync(userExtensionsDir, { recursive: true })

  const copiedPluginIds: string[] = []
  for (const entry of readdirSync(bundledExtensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const srcDir = join(bundledExtensionsDir, entry.name)
    const manifestPath = join(srcDir, 'openclaw.plugin.json')
    if (!existsSync(manifestPath)) continue

    const destDir = join(userExtensionsDir, entry.name)
    rmSync(destDir, { recursive: true, force: true })
    cpSync(srcDir, destDir, { recursive: true, dereference: true })
    copiedPluginIds.push(entry.name)
  }

  if (copiedPluginIds.length > 0) {
    const msg = `已同步内置插件到 ${userOpenclawDir}: ${copiedPluginIds.join(', ')}`
    log.info(msg)
    onLog(`[ApiniClaw] ${msg}`)
  } else {
    const msg = '内置插件目录存在，但未发现有效插件清单'
    log.warn(msg)
    onLog(`[ApiniClaw] 警告：${msg}`)
  }

  return copiedPluginIds
}

function resolveBundledExtensionsDir(): string {
  return join(resolveResourcesPath(), 'gateway', 'node_modules', 'openclaw', 'extensions')
}

function resolveUserExtensionsDir(): string {
  return join(APINICLAW_GATEWAY_DIR, 'node_modules', 'openclaw', 'extensions')
}

function isPluginInstalled(dir: string, pluginId: string): boolean {
  return existsSync(join(dir, pluginId, 'openclaw.plugin.json'))
}

export function ensureBundledWeixinPluginEnabled(): {
  enabled: boolean
  changed: boolean
  skipped: boolean
} {
  if (!existsSync(CONFIG_PATH)) {
    return { enabled: false, changed: false, skipped: true }
  }

  const cfg = readConfig()
  if (!cfg.plugins) cfg.plugins = {}
  if (!cfg.plugins.entries) cfg.plugins.entries = {}

  const current = cfg.plugins.entries[WEIXIN_PLUGIN_ID] as { enabled?: boolean } | undefined
  if (current?.enabled === false) {
    return { enabled: false, changed: false, skipped: true }
  }

  if (current?.enabled === true) {
    return { enabled: true, changed: false, skipped: false }
  }

  cfg.plugins.entries[WEIXIN_PLUGIN_ID] = { ...(current ?? {}), enabled: true }
  writeConfig(cfg, { source: 'auto', summary: '启用内置微信插件' })
  log.info(`已默认启用内置插件: ${WEIXIN_PLUGIN_ID}`)
  return { enabled: true, changed: true, skipped: false }
}

export function ensureBundledWeixinReady(onLog: (line: string) => void = () => {}): {
  bundled: boolean
  installedToUserDir: boolean
  enabled: boolean
  configMissing: boolean
} {
  syncBundledExtensionsToUserGateway(onLog)
  const enableResult = ensureBundledWeixinPluginEnabled()
  return {
    bundled: isPluginInstalled(resolveBundledExtensionsDir(), WEIXIN_PLUGIN_ID),
    installedToUserDir: isPluginInstalled(resolveUserExtensionsDir(), WEIXIN_PLUGIN_ID),
    enabled: enableResult.enabled,
    configMissing: enableResult.skipped && !existsSync(CONFIG_PATH),
  }
}

export function getBundledWeixinStatus(): {
  bundled: boolean
  installedToUserDir: boolean
  enabled: boolean
  configMissing: boolean
} {
  const cfgExists = existsSync(CONFIG_PATH)
  const cfg = cfgExists ? readConfig() : {}
  const enabled =
    ((cfg.plugins?.entries?.[WEIXIN_PLUGIN_ID] as { enabled?: boolean } | undefined)?.enabled ??
      false) === true

  return {
    bundled: isPluginInstalled(resolveBundledExtensionsDir(), WEIXIN_PLUGIN_ID),
    installedToUserDir: isPluginInstalled(resolveUserExtensionsDir(), WEIXIN_PLUGIN_ID),
    enabled,
    configMissing: !cfgExists,
  }
}

/**
 * 当前实际用于 Gateway 的 openclaw 版本与来源。
 * 必须与 spawn / attach 使用的 resolveOpenclawLaunch 一致：
 * 本机全局（Homebrew/npm）> 用户升级目录 > 安装包内置。
 */
export function getCurrentOpenclawInfo(): { currentVersion: string; source: OpenclawSource } {
  const launch = resolveOpenclawLaunch()
  return { currentVersion: launch.version, source: launch.source }
}

/**
 * 获取当前运行的 openclaw 版本（与 Gateway 启动同源）
 */
export function getCurrentOpenclawVersion(): string {
  return getCurrentOpenclawInfo().currentVersion
}

/**
 * 判断当前版本是否来自用户升级目录（已升级过）
 */
export function isUserUpgraded(): boolean {
  const userPkg = join(APINICLAW_GATEWAY_DIR, 'node_modules', 'openclaw', 'package.json')
  return existsSync(userPkg) && readPackageVersion(userPkg) !== null
}

// ─── 安装包内置版本 ───

/** 读取本安装包 / 开发 targets 内置的 openclaw 版本 */
export function getBundledOpenclawVersion(): string | null {
  const media = resolveBundledOpenclawMediaDir()
  if (!media) return null
  return readPackageVersion(join(media, 'package.json'))
}

// ─── 公开 API ───

/**
 * 检查是否需要把「安装包内置引擎」同步到本机。
 * 不再查询 npm 线上最新版（历史遗留已移除）。
 */
export async function checkOpenclawUpdate(): Promise<OpenclawUpdateInfo> {
  const { currentVersion, source } = getCurrentOpenclawInfo()
  const info: OpenclawUpdateInfo = {
    status: 'checking',
    currentVersion,
    source,
    logLines: [],
  }

  try {
    const bundledVersion = getBundledOpenclawVersion()
    if (!bundledVersion) {
      info.status = 'error'
      info.error = '安装包内未找到 openclaw 引擎介质'
      return info
    }

    info.bundledVersion = bundledVersion
    info.latestVersion = bundledVersion

    if (currentVersion === 'unknown') {
      info.status = 'available'
    } else if (currentVersion === bundledVersion) {
      info.status = 'up-to-date'
    } else {
      // 本机与安装包不一致即可同步（可能升级也可能对齐到包内版本）
      info.status = 'available'
      log.info(
        `engine sync available: current=${currentVersion} (${source}) bundled=${bundledVersion}` +
          ` cmp=${compareOpenclawVersion(bundledVersion, currentVersion)}`
      )
    }
  } catch (err) {
    info.status = 'error'
    info.error = err instanceof Error ? err.message : String(err)
    log.error('checkOpenclawUpdate failed:', info.error)
  }

  return info
}

/**
 * 将安装包内置 openclaw 离线同步到本机全局（brew / npm-global / 降级用户目录）。
 * @param _version 保留参数以兼容旧 IPC/UI（实际始终同步安装包内置版本）
 */
export async function installOpenclawUpdate(
  _version: string,
  onLog: (line: string) => void
): Promise<{ success: boolean; error?: string; installPrefix?: string; packageDir?: string }> {
  const bundledVersion = getBundledOpenclawVersion() || 'bundled'
  log.info(`开始离线同步安装包内置 openclaw@${bundledVersion}`)
  onLog(`[ApiniClaw] 开始离线同步安装包内置引擎 ${bundledVersion}…`)

  const installed = installBundledEngineOffline((line) => onLog(`[ApiniClaw] ${line}`))
  if (!installed.ok || !installed.packageDir) {
    const msg = installed.error || '离线同步失败'
    onLog(`[ApiniClaw] 错误：${msg}`)
    return { success: false, error: msg }
  }

  try {
    syncBundledExtensionsToUserGateway(onLog, installed.packageDir)
  } catch (err) {
    const msg = `同步内置插件失败: ${err instanceof Error ? err.message : String(err)}`
    log.error(msg)
    onLog(`[ApiniClaw] 错误：${msg}`)
    return {
      success: false,
      error: msg,
      installPrefix: installed.prefix?.nodeModulesDir,
      packageDir: installed.packageDir,
    }
  }

  try {
    installCli()
    log.info('CLI wrapper 已更新')
    onLog('[ApiniClaw] CLI wrapper 已更新')
  } catch (err) {
    log.warn('CLI wrapper 更新失败（不影响同步）:', err)
    onLog(
      `[ApiniClaw] 警告：CLI wrapper 更新失败（${err instanceof Error ? err.message : String(err)}）`
    )
  }

  onLog(`[ApiniClaw] 已同步到 ${installed.prefix?.label ?? installed.packageDir}`)
  return {
    success: true,
    installPrefix: installed.prefix?.nodeModulesDir,
    packageDir: installed.packageDir,
  }
}
