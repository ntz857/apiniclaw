/**
 * 引擎就绪编排：
 * 1. 本机 Gateway /ready 可连 → attach
 * 2. 本机已有 openclaw 包 → 交给 GatewayProcess 用 resolve 拉起
 * 3. 否则离线复制内置引擎到用户全局，再拉起
 */

import http from 'http'
import { createLogger } from '../logger'
import { DEFAULT_PORT } from '../constants'
import { resolveOpenclawLaunch } from './openclaw-resolve'
import { hasLocalOpenclawPackage, installBundledEngineOffline } from './engine-offline-install'
import { installCli } from './cli-integration'
import { detectExistingGateway } from '../runtime/detector'

const log = createLogger('engine-bootstrap')

export type EngineReadyMode = 'attached' | 'local-install' | 'installed' | 'bundled-fallback'

export interface EngineReadyResult {
  mode: EngineReadyMode
  port: number
  message?: string
  /** 若检测到 root/ClawPanel 等冲突 */
  conflict?: string
}

function probeReady(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/ready`, { timeout: timeoutMs }, (res) => {
      res.resume()
      resolve((res.statusCode ?? 500) < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

function describeOwnerConflict(processName: string | null, pid: number | null): string | undefined {
  if (!processName && !pid) return undefined
  const name = (processName || '').toLowerCase()
  if (name.includes('clawpanel') || name === 'openclaw-gateway') {
    return `检测到可能由 ClawPanel/系统服务启动的 Gateway（pid=${pid ?? '?'} name=${processName}）。若出现权限或目录错乱，请停用 root 守护进程，改由当前用户运行。`
  }
  return undefined
}

export interface EnsureEngineReadyOptions {
  /** 默认 true。升级/强制重启后应设为 false，避免附着旧进程 */
  allowAttach?: boolean
}

/**
 * 在启动 / 使用引擎前调用。
 * - attached：已有可连 Gateway，调用方不应再 spawn
 * - local-install / installed：本机包可用（或刚装好），调用方按 resolve 正常 spawn
 * - bundled-fallback：安装失败，仍可能走包内旁路（过渡期）
 */
export async function ensureEngineReady(
  port = DEFAULT_PORT,
  opts: EnsureEngineReadyOptions = {}
): Promise<EngineReadyResult> {
  const allowAttach = opts.allowAttach !== false
  const ready = allowAttach ? await probeReady(port) : false
  if (ready) {
    const existing = await detectExistingGateway(port)
    const conflict = describeOwnerConflict(existing.processName, existing.pid)
    if (conflict) log.warn(conflict)
    log.info(`engine ready: attached to local gateway :${port}`)
    return { mode: 'attached', port, conflict, message: '已连接本机 Gateway' }
  }
  if (!allowAttach) {
    log.info('engine ready: attach disabled (force respawn with resolved openclaw)')
  }

  if (hasLocalOpenclawPackage()) {
    const launch = resolveOpenclawLaunch()
    log.info(`engine ready: local package source=${launch.source} v${launch.version}`)
    return {
      mode: 'local-install',
      port,
      message: `将使用本机 openclaw（${launch.source} v${launch.version}）启动 Gateway`,
    }
  }

  log.info('no local openclaw package; installing bundled engine offline…')
  const installed = installBundledEngineOffline()
  if (installed.ok) {
    try {
      installCli()
      log.info('CLI wrapper refreshed after offline install')
    } catch (err) {
      log.warn('CLI wrapper refresh failed after offline install:', err)
    }
    const launch = resolveOpenclawLaunch()
    log.info(
      `offline install ok → resolve source=${launch.source} v${launch.version} dir=${installed.packageDir}`
    )
    return {
      mode: 'installed',
      port,
      message: `已离线安装 openclaw 到 ${installed.prefix?.label ?? installed.packageDir}`,
    }
  }

  log.warn(`offline install failed: ${installed.error}; falling back to bundled runtime`)
  return {
    mode: 'bundled-fallback',
    port,
    message: installed.error || '离线安装失败，将暂时使用安装包内置引擎',
  }
}
