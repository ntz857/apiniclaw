/**
 * Runtime — 优先系统/npm 全局 openclaw，回退用户升级目录与安装包内置。
 * 类名保留 BundledRuntime 以兼容现有 import；实际策略见 openclaw-resolve。
 */

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import type { OpenclawRuntime, RuntimeInfo } from './types'
import {
  resolveBundledNpmBin,
  resolveBundledRuntimeBinDir,
  isPackaged,
  IS_WIN,
} from '../constants'
import { resolveOpenclawLaunch } from '../services/openclaw-resolve'
import { createLogger } from '../logger'

const execFileAsync = promisify(execFile)
const log = createLogger('runtime')

export class BundledRuntime implements OpenclawRuntime {
  readonly mode = 'bundled' as const

  getNodePath(): string {
    return resolveOpenclawLaunch().nodePath
  }

  getGatewayEntry(): string {
    return resolveOpenclawLaunch().entryPath
  }

  getGatewayCwd(): string {
    return resolveOpenclawLaunch().cwd
  }

  getEnv(): Record<string, string> {
    const launch = resolveOpenclawLaunch()
    const env: Record<string, string> = {
      OPENCLAW_NO_RESPAWN: '1',
    }

    // 仅旧版内置需要 lenient；系统 2026.7 应按正式 schema 校验
    if (launch.source === 'bundled') {
      env.OPENCLAW_LENIENT_CONFIG = '1'
    }

    env.NODE_OPTIONS = '--dns-result-order=ipv4first'

    const npmBin = resolveBundledNpmBin()
    if (existsSync(npmBin)) {
      env.OPENCLAW_NPM_BIN = npmBin
    }

    // openclaw 内部会 spawn('npm')，必须把内置 runtime 的 bin 放到 PATH 最前
    // （仅 OPENCLAW_NPM_BIN 不够，官方 CLI 仍走 PATH 解析）
    const runtimeBinDir = resolveBundledRuntimeBinDir()
    if (existsSync(runtimeBinDir)) {
      const sep = IS_WIN ? ';' : ':'
      const prev = process.env.PATH || process.env.Path || ''
      env.PATH = prev ? `${runtimeBinDir}${sep}${prev}` : runtimeBinDir
      if (IS_WIN) {
        env.Path = env.PATH
      }
    }

    return env
  }

  async getNodeVersion(): Promise<string> {
    const nodePath = this.getNodePath()
    try {
      const { stdout } = await execFileAsync(nodePath, ['--version'], {
        timeout: 5000,
        env: { ...process.env },
      })
      return stdout.trim().replace(/^v/, '')
    } catch {
      return 'unknown'
    }
  }

  async getOpenclawVersion(): Promise<string> {
    return resolveOpenclawLaunch().version
  }

  async getInfo(): Promise<RuntimeInfo> {
    const launch = resolveOpenclawLaunch()
    log.info(
      `openclaw source=${launch.source} version=${launch.version} entry=${launch.entryPath}`
    )
    const nodeVersion = await this.getNodeVersion()
    return {
      mode: 'bundled',
      nodePath: launch.nodePath,
      nodeVersion,
      openclawVersion: `${launch.version} (${launch.source})`,
      gatewayEntry: launch.entryPath,
      gatewayCwd: launch.cwd,
    }
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    const launch = resolveOpenclawLaunch()
    if (!existsSync(launch.entryPath)) {
      return { valid: false, error: `OpenClaw 入口不存在: ${launch.entryPath}` }
    }
    if (!existsSync(launch.nodePath)) {
      if (!isPackaged() && launch.source === 'bundled') {
        return {
          valid: false,
          error: '内置 Node.js 未下载，请先运行 npm run package-resources，或安装系统 Node/openclaw',
        }
      }
      return { valid: false, error: `Node.js 不存在: ${launch.nodePath}` }
    }
    return { valid: true }
  }
}
