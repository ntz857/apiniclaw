/**
 * 统一解析 OpenClaw 可执行入口。
 *
 * 优先级（与「正在跑的 Gateway 应尽量同版本」一致）：
 *   1. 系统/npm 全局 openclaw（如 2026.7.x）
 *   2. 用户升级目录 ~/.apiniclaw/gateway/...
 *   3. ApiniClaw 安装包内置 openclaw（可能偏旧，如 2026.3.x）
 *
 * 所有 CLI / Gateway spawn 应优先走本模块，避免双轨版本导致 Config invalid、协议不兼容。
 */

import { execFile, spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { createLogger } from '../logger'
import { dirname } from 'path'
import {
  APINICLAW_GATEWAY_DIR,
  IS_WIN,
  resolveBundledGatewayCwd,
  resolveBundledGatewayEntry,
  resolveBundledNodeBin,
  resolveBundledRuntimeBinDir,
} from '../constants'

const execFileAsync = promisify(execFile)
const log = createLogger('openclaw-resolve')

export type OpenclawSource = 'system' | 'user' | 'bundled'

export interface OpenclawLaunch {
  source: OpenclawSource
  /** Node 可执行文件 */
  nodePath: string
  /** openclaw.mjs 入口 */
  entryPath: string
  /** cwd（openclaw 包目录） */
  cwd: string
  /** 解析到的版本号（读 package.json，失败则为 unknown） */
  version: string
}

export interface OpenclawCliInvocation {
  source: OpenclawSource
  cmd: string
  argsPrefix: string[]
  shell: boolean
  cwd: string
  env: Record<string, string>
}

function readVersion(pkgDir: string): string {
  try {
    const pkgPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgPath)) return 'unknown'
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

function resolveSystemNode(): string | null {
  if (IS_WIN) {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const candidates = [
      join(pf, 'nodejs', 'node.exe'),
      join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'node.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    ]
    for (const c of candidates) {
      if (c && existsSync(c)) return c
    }
  } else {
    for (const c of ['/usr/local/bin/node', '/usr/bin/node', '/opt/homebrew/bin/node']) {
      if (existsSync(c)) return c
    }
  }
  // PATH 兜底：调用方 spawn 时由 OS 解析；此处仅在存在时返回 null 让上层用 bundled
  return null
}

function resolveSystemOpenclawEntry(): { entry: string; cwd: string } | null {
  if (IS_WIN) {
    const appData = process.env.APPDATA || ''
    if (appData) {
      const cwd = join(appData, 'npm', 'node_modules', 'openclaw')
      const entry = join(cwd, 'openclaw.mjs')
      if (existsSync(entry)) return { entry, cwd }
    }
  } else {
    const homes = [
      join(process.env.HOME || '', '.npm-global', 'lib', 'node_modules', 'openclaw'),
      '/usr/local/lib/node_modules/openclaw',
      '/usr/lib/node_modules/openclaw',
    ]
    for (const cwd of homes) {
      const entry = join(cwd, 'openclaw.mjs')
      if (existsSync(entry)) return { entry, cwd }
    }
  }
  return null
}

function resolveUserOpenclawEntry(): { entry: string; cwd: string } | null {
  const cwd = join(APINICLAW_GATEWAY_DIR, 'node_modules', 'openclaw')
  const entry = join(cwd, 'openclaw.mjs')
  if (existsSync(entry)) return { entry, cwd }
  return null
}

/**
 * 解析 Node + openclaw.mjs 启动参数（Gateway spawn / CLI 通用）。
 */
export function resolveOpenclawLaunch(): OpenclawLaunch {
  const systemNode = resolveSystemNode()
  const systemOc = resolveSystemOpenclawEntry()
  if (systemOc) {
    const nodePath = systemNode || resolveBundledNodeBin()
    const launch: OpenclawLaunch = {
      source: 'system',
      nodePath,
      entryPath: systemOc.entry,
      cwd: systemOc.cwd,
      version: readVersion(systemOc.cwd),
    }
    log.debug(
      `resolve: system openclaw v${launch.version} entry=${launch.entryPath} node=${launch.nodePath}`
    )
    return launch
  }

  const userOc = resolveUserOpenclawEntry()
  if (userOc) {
    const launch: OpenclawLaunch = {
      source: 'user',
      nodePath: systemNode || resolveBundledNodeBin(),
      entryPath: userOc.entry,
      cwd: userOc.cwd,
      version: readVersion(userOc.cwd),
    }
    log.debug(`resolve: user openclaw v${launch.version} entry=${launch.entryPath}`)
    return launch
  }

  const entryPath = resolveBundledGatewayEntry()
  const cwd = resolveBundledGatewayCwd()
  const launch: OpenclawLaunch = {
    source: 'bundled',
    nodePath: resolveBundledNodeBin(),
    entryPath,
    cwd,
    version: readVersion(cwd),
  }
  log.warn(
    `resolve: falling back to bundled openclaw v${launch.version} (system npm openclaw not found)`
  )
  return launch
}

/**
 * 解析适合 spawn/exec 的 CLI 调用形态。
 * Windows 优先直接 node+entry，避免 .cmd 解析差异。
 */
export function resolveOpenclawCliInvocation(): OpenclawCliInvocation {
  const launch = resolveOpenclawLaunch()
  // 内置 node/npm 目录优先，避免 spawn npm ENOENT（零系统 Node 环境）
  const runtimeBinDir = resolveBundledRuntimeBinDir()
  const nodeDir = dirname(launch.nodePath)
  const sep = IS_WIN ? ';' : ':'
  const pathPrefix = [runtimeBinDir, nodeDir].filter(Boolean).join(sep)
  const prevPath = process.env.PATH || process.env.Path || ''
  const pathEnv = prevPath ? `${pathPrefix}${sep}${prevPath}` : pathPrefix

  return {
    source: launch.source,
    cmd: launch.nodePath,
    argsPrefix: [launch.entryPath],
    shell: false,
    cwd: launch.cwd,
    env: {
      OPENCLAW_NO_RESPAWN: '1',
      FORCE_COLOR: '0',
      PATH: pathEnv,
      ...(IS_WIN ? { Path: pathEnv } : {}),
      // 系统 openclaw 不需要 lenient；bundled 旧版需要
      ...(launch.source === 'bundled' ? { OPENCLAW_LENIENT_CONFIG: '1' } : {}),
    },
  }
}

export interface RunCliResult {
  code: number
  stdout: string
  stderr: string
  source: OpenclawSource
}

/**
 * 执行 openclaw CLI 子命令。
 */
export async function runOpenclawCli(
  args: string[],
  options?: { timeoutMs?: number; cwd?: string }
): Promise<RunCliResult> {
  const inv = resolveOpenclawCliInvocation()
  const fullArgs = [...inv.argsPrefix, ...args]
  const timeout = options?.timeoutMs ?? 60_000
  const cwd = options?.cwd ?? inv.cwd

  log.debug(`cli [${inv.source}]: ${inv.cmd} ${fullArgs.join(' ')}`)

  try {
    const { stdout, stderr } = await execFileAsync(inv.cmd, fullArgs, {
      cwd,
      timeout,
      windowsHide: true,
      env: {
        ...process.env,
        ...inv.env,
      },
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return {
      code: 0,
      stdout: typeof stdout === 'string' ? stdout : String(stdout),
      stderr: typeof stderr === 'string' ? stderr : String(stderr),
      source: inv.source,
    }
  } catch (err: unknown) {
    const e = err as {
      code?: number | string
      status?: number
      stdout?: string
      stderr?: string
      message?: string
      killed?: boolean
    }
    const code =
      typeof e.status === 'number'
        ? e.status
        : typeof e.code === 'number'
          ? e.code
          : e.killed
            ? -1
            : 1
    return {
      code,
      stdout: e.stdout ? String(e.stdout) : '',
      stderr: e.stderr ? String(e.stderr) : e.message || String(err),
      source: inv.source,
    }
  }
}

/**
 * 用 spawn 跑长时间命令（如 gateway run），返回 ChildProcess 构造参数。
 */
export function getOpenclawSpawnSpec(args: string[]): {
  command: string
  args: string[]
  cwd: string
  envExtra: Record<string, string>
  source: OpenclawSource
  entryPath: string
  nodePath: string
  version: string
} {
  const launch = resolveOpenclawLaunch()
  return {
    command: launch.nodePath,
    args: [launch.entryPath, ...args],
    cwd: launch.cwd,
    envExtra: {
      OPENCLAW_NO_RESPAWN: '1',
      ...(launch.source === 'bundled' ? { OPENCLAW_LENIENT_CONFIG: '1' } : {}),
    },
    source: launch.source,
    entryPath: launch.entryPath,
    nodePath: launch.nodePath,
    version: launch.version,
  }
}

/** 供测试 / 调试：当前解析摘要 */
export function describeOpenclawResolve(): string {
  const l = resolveOpenclawLaunch()
  return `${l.source} v${l.version} entry=${l.entryPath}`
}

// re-export spawn for optional long-running use
export { spawn }
