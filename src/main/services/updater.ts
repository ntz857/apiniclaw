/**
 * 自动更新服务
 *
 * 基于 electron-updater（Generic CDN provider）
 * CDN 地址：https://update.apinibee.com
 *
 * macOS：社区构建未做 Apple Developer 签名，ShipIt 会拒绝安装。
 * 因此 darwin 在「安装」阶段绕过 quitAndInstall/ShipIt，改为：
 *   定位已下载的更新包 → 写 shell 脚本 → 退出 App → 脚本替换 .app 并 relaunch。
 *
 * 更新状态流转：
 *   idle → checking → not-available / available → downloading → downloaded
 *   任意阶段 → error（不影响 app 正常使用）
 */

import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { chmod, mkdtemp } from 'fs/promises'
import { tmpdir, homedir } from 'os'
import { dirname, join } from 'path'
import { pipeline } from 'stream/promises'
import { createLogger } from '../logger'
import { getGatewayProcess } from '../gateway'
import { APINICLAW_UPDATE_BASE_URL } from '../../shared/urls'

const log = createLogger('updater')

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateInfo {
  status: UpdateStatus
  version?: string
  progress?: number
  error?: string
}

let currentInfo: UpdateInfo = { status: 'idle' }
let mainWindow: BrowserWindow | null = null
let installing = false
/** update-downloaded 时记录目标版本，供 mac 自定义安装选用对应 zip */
let pendingUpdateVersion: string | undefined

function pushStatus(info: Partial<UpdateInfo>): void {
  currentInfo = { ...currentInfo, ...info }
  mainWindow?.webContents.send('update:status-changed', currentInfo)
  log.info(`update status: ${currentInfo.status}`, info.version ?? info.error ?? '')
}

export function initUpdater(win: BrowserWindow): void {
  mainWindow = win

  autoUpdater.autoDownload = false
  // mac 未签名包绝不能让 quit 时走 ShipIt
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin'
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => {
    pushStatus({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    pendingUpdateVersion = info.version
    pushStatus({ status: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    pushStatus({ status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    pushStatus({ status: 'downloading', progress: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info.version
    pushStatus({ status: 'downloaded', version: info.version, progress: 100 })
  })

  autoUpdater.on('error', (err) => {
    pushStatus({ status: 'error', error: err.message })
    log.warn('updater error:', err.message)
  })

  setTimeout(() => {
    checkForUpdates()
  }, 10_000)
}

export function checkForUpdates(): void {
  if (currentInfo.status === 'checking' || currentInfo.status === 'downloading') return

  if (!app.isPackaged) {
    pushStatus({ status: 'error', error: 'update check is only available in packaged app' })
    return
  }

  pushStatus({ status: 'checking', error: undefined })

  autoUpdater.checkForUpdates().catch((err) => {
    pushStatus({ status: 'error', error: err.message })
  })
}

export function downloadUpdate(): void {
  if (currentInfo.status !== 'available') return
  autoUpdater.downloadUpdate().catch((err) => {
    pushStatus({ status: 'error', error: err.message })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function stopGatewayBeforeInstall(timeoutMs = 8000): Promise<void> {
  const gw = getGatewayProcess()
  gw.stopStatusPolling()

  if (gw.getState() === 'stopped') return

  try {
    await Promise.race([gw.stop(), sleep(timeoutMs)])
  } catch (err) {
    log.warn('stop gateway before install failed:', err)
  }

  if (gw.getState() !== 'stopped') {
    log.warn('gateway is still not fully stopped before install')
  }
}

/** 当前运行的 .app 包路径 */
function resolveCurrentAppBundle(): string {
  // .../ApiniClaw.app/Contents/MacOS/ApiniClaw
  return join(dirname(process.execPath), '..', '..')
}

/**
 * electron-updater / ShipIt 下载解压后的新 .app
 * 典型路径：~/Library/Caches/com.apiniclaw.app.ShipIt/update.xxx/ApiniClaw.app
 */
function findShipItExtractedApp(): string | null {
  const cacheRoot = join(homedir(), 'Library', 'Caches', 'com.apiniclaw.app.ShipIt')
  if (!existsSync(cacheRoot)) return null

  const candidates = readdirSync(cacheRoot)
    .filter((name) => name.startsWith('update.'))
    .map((name) => join(cacheRoot, name, 'ApiniClaw.app'))
    .filter((appPath) => existsSync(appPath))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  return candidates[0] ?? null
}

/**
 * electron-updater generic 下载缓存的 zip
 * 典型路径：~/Library/Caches/apiniclaw-updater/pending/*.zip
 *         或 ~/Library/Caches/apiniclaw-updater/update.zip
 */
function findCachedUpdateZip(version?: string): string | null {
  const root = join(homedir(), 'Library', 'Caches', 'apiniclaw-updater')
  const pending = join(root, 'pending')
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const candidates: string[] = []

  if (existsSync(pending)) {
    for (const name of readdirSync(pending)) {
      if (!name.endsWith('.zip')) continue
      candidates.push(join(pending, name))
    }
  }
  const legacy = join(root, 'update.zip')
  if (existsSync(legacy)) candidates.push(legacy)

  const scored = candidates
    .filter((p) => existsSync(p) && statSync(p).size > 1024 * 1024)
    .sort((a, b) => {
      const an = a.toLowerCase()
      const bn = b.toLowerCase()
      const aArch = an.includes(`-${arch}.zip`) ? 2 : an.includes('.zip') ? 1 : 0
      const bArch = bn.includes(`-${arch}.zip`) ? 2 : bn.includes('.zip') ? 1 : 0
      if (aArch !== bArch) return bArch - aArch
      if (version) {
        const av = an.includes(version) ? 1 : 0
        const bv = bn.includes(version) ? 1 : 0
        if (av !== bv) return bv - av
      }
      return statSync(b).mtimeMs - statSync(a).mtimeMs
    })

  return scored[0] ?? null
}

async function extractZipToApp(zipPath: string): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'apiniclaw-update-'))
  log.info(`extracting zip: ${zipPath} → ${work}`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ditto', ['-x', '-k', zipPath, work], { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ditto extract failed code=${code}: ${err}`))
    })
  })

  const extracted = join(work, 'ApiniClaw.app')
  if (!existsSync(extracted)) {
    throw new Error(`extracted ApiniClaw.app not found under ${work}`)
  }
  return extracted
}

/** 解析 latest-mac.yml，返回当前 arch 对应 zip 的绝对 URL */
async function resolveMacZipUrl(versionHint?: string): Promise<string> {
  const ymlUrl = `${APINICLAW_UPDATE_BASE_URL}/latest-mac.yml`
  const res = await fetch(ymlUrl)
  if (!res.ok) {
    throw new Error(`failed to fetch latest-mac.yml: HTTP ${res.status}`)
  }
  const text = await res.text()
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const files = [...text.matchAll(/^\s*-\s*url:\s*(\S+)/gm)].map((m) => m[1].replace(/['"]/g, ''))
  const match =
    files.find((u) => u.includes(`-${arch}.zip`)) ||
    files.find((u) => u.endsWith('.zip')) ||
    null
  if (!match) {
    throw new Error(`no zip found in latest-mac.yml for arch=${arch}`)
  }
  if (versionHint && !match.includes(versionHint)) {
    log.warn(`zip name ${match} does not contain version hint ${versionHint}, continuing anyway`)
  }
  if (/^https?:\/\//i.test(match)) return match
  return `${APINICLAW_UPDATE_BASE_URL.replace(/\/$/, '')}/${match.replace(/^\//, '')}`
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status} ${url}`)
  }
  // Node fetch body is a web stream; convert via arrayBuffer for simplicity on large files is bad.
  // Use node:stream web to node conversion:
  const { Readable } = await import('stream')
  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
  await pipeline(nodeStream, createWriteStream(dest))
}

/**
 * 准备新 ApiniClaw.app：
 * 1) ShipIt 已解压的 .app
 * 2) electron-updater 已下载的本地 zip（优先，避免安装时再下 200MB+）
 * 3) 最后才回退 CDN 重新下载
 */
async function prepareNewAppBundle(version?: string): Promise<string> {
  const shipItApp = findShipItExtractedApp()
  if (shipItApp) {
    log.info(`using ShipIt extracted app: ${shipItApp}`)
    return shipItApp
  }

  const cachedZip = findCachedUpdateZip(version)
  if (cachedZip) {
    log.info(`using cached updater zip: ${cachedZip}`)
    return extractZipToApp(cachedZip)
  }

  log.info('no local update cache, downloading mac zip from CDN')
  const zipUrl = await resolveMacZipUrl(version)
  const work = await mkdtemp(join(tmpdir(), 'apiniclaw-update-'))
  const zipPath = join(work, 'update.zip')
  await downloadFile(zipUrl, zipPath)
  return extractZipToApp(zipPath)
}

/**
 * 写替换脚本并脱离启动：等本进程退出后替换 .app、清 quarantine、open 新版本。
 */
async function launchMacReplaceScript(newAppPath: string): Promise<void> {
  const appPath = resolveCurrentAppBundle()
  const logDir = join(homedir(), '.apiniclaw', 'logs')
  mkdirSync(logDir, { recursive: true })
  const updateLog = join(logDir, 'mac-update.log')
  const scriptPath = join(tmpdir(), `apiniclaw-mac-update-${Date.now()}.sh`)

  // 把 newApp 先拷到独立 staging，避免 ShipIt 清缓存时源被删
  const stagingRoot = await mkdtemp(join(tmpdir(), 'apiniclaw-staging-'))
  const stagingApp = join(stagingRoot, 'ApiniClaw.app')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ditto', [newAppPath, stagingApp], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ditto stage failed: ${code}`))))
  })

  const script = `#!/bin/bash
set -euo pipefail
LOG=${JSON.stringify(updateLog)}
APP_PATH=${JSON.stringify(appPath)}
NEW_APP=${JSON.stringify(stagingApp)}
STAGING_ROOT=${JSON.stringify(stagingRoot)}

exec >>"$LOG" 2>&1
echo "$(date '+%F %T') mac unsigned update start"
echo "APP_PATH=$APP_PATH"
echo "NEW_APP=$NEW_APP"

# 等主程序退出（最多 ~60s）
for i in $(seq 1 120); do
  if ! pgrep -f "/ApiniClaw.app/Contents/MacOS/ApiniClaw" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
sleep 1

if [ ! -d "$NEW_APP" ]; then
  echo "missing NEW_APP"
  exit 1
fi

# 替换
rm -rf "$APP_PATH"
ditto "$NEW_APP" "$APP_PATH"
xattr -cr "$APP_PATH" || true
xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null || true

# 清理 staging
rm -rf "$STAGING_ROOT" || true

echo "$(date '+%F %T') launching"
open "$APP_PATH"
echo "$(date '+%F %T') mac unsigned update done"
`

  writeFileSync(scriptPath, script, { encoding: 'utf-8', mode: 0o755 })
  await chmod(scriptPath, 0o755)

  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  log.info(`mac replace script launched: ${scriptPath}`)
}

async function quitAndInstallMacUnsigned(): Promise<void> {
  const version = currentInfo.version || pendingUpdateVersion
  pushStatus({ status: 'installing', progress: 100, version, error: undefined })
  log.info('mac unsigned install: preparing new app bundle')

  const newApp = await prepareNewAppBundle(version)
  log.info(`mac unsigned install: new app ready at ${newApp}`)
  await stopGatewayBeforeInstall()
  await launchMacReplaceScript(newApp)

  log.info('mac unsigned install: quitting for replace script')
  // 给脚本一点时间起来再退出
  setTimeout(() => {
    app.exit(0)
  }, 400)
}

/** 退出并安装（仅 downloaded 状态有效） */
export async function quitAndInstall(): Promise<void> {
  if (currentInfo.status !== 'downloaded') return
  if (installing) return

  installing = true
  try {
    if (process.platform === 'darwin') {
      await quitAndInstallMacUnsigned()
      return
    }
    await stopGatewayBeforeInstall()
    autoUpdater.quitAndInstall(false, true)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('quitAndInstall failed:', message)
    pushStatus({ status: 'error', error: message })
  } finally {
    installing = false
  }
}

export function getUpdateInfo(): UpdateInfo {
  return { ...currentInfo }
}
