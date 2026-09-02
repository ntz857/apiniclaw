/**
 * 离线将安装包内置 openclaw 复制到本机 brew/npm 用户可写全局目录。
 *
 * 不访问 npm registry；禁止 sudo。
 *
 * 落点优先级（mac）：Homebrew → ~/.npm-global → ~/.apiniclaw/gateway
 * Windows：%APPDATA%\npm → ~/.apiniclaw/gateway
 */

import {
  accessSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { execFileSync } from 'child_process'
import { createLogger } from '../logger'
import {
  APINICLAW_HOME,
  IS_WIN,
  resolveBundledNodeBin,
  resolveBundledRuntimeBinDir,
  resolveResourcesPath,
} from '../constants'
import { listSystemOpenclawPackageCandidates } from './openclaw-resolve'

const log = createLogger('engine-offline-install')

export interface GlobalPrefixInfo {
  /** 全局 node_modules 目录（其下将放置 openclaw/） */
  nodeModulesDir: string
  /** PATH bin 目录 */
  binDir: string
  /** 人类可读标签 */
  label: string
}

export interface OfflineInstallResult {
  ok: boolean
  packageDir?: string
  binPath?: string
  prefix?: GlobalPrefixInfo
  error?: string
}

export function canWriteDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

function tryExec(cmd: string, args: string[]): string | null {
  try {
    return (
      execFileSync(cmd, args, {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: process.env,
      })
        .toString()
        .trim() || null
    )
  } catch {
    return null
  }
}

/**
 * 按产品约定列出全局安装前缀候选（尚未过滤可写性）。
 * mac：brew → ~/.npm-global →（其它 npm prefix）
 * win：%APPDATA%\npm
 */
export function listGlobalPrefixCandidates(): GlobalPrefixInfo[] {
  const candidates: GlobalPrefixInfo[] = []
  const push = (info: GlobalPrefixInfo): void => {
    if (candidates.some((c) => c.nodeModulesDir === info.nodeModulesDir)) return
    candidates.push(info)
  }

  if (IS_WIN) {
    const appData = process.env.APPDATA || ''
    if (appData) {
      push({
        nodeModulesDir: join(appData, 'npm', 'node_modules'),
        binDir: join(appData, 'npm'),
        label: '%APPDATA%\\npm',
      })
    }
    return candidates
  }

  const brewPrefix = tryExec('brew', ['--prefix'])
  if (brewPrefix) {
    push({
      nodeModulesDir: join(brewPrefix, 'lib', 'node_modules'),
      binDir: join(brewPrefix, 'bin'),
      label: `brew:${brewPrefix}`,
    })
  }
  push({
    nodeModulesDir: '/opt/homebrew/lib/node_modules',
    binDir: '/opt/homebrew/bin',
    label: 'homebrew-arm',
  })
  push({
    nodeModulesDir: '/usr/local/lib/node_modules',
    binDir: '/usr/local/bin',
    label: 'usr-local',
  })

  const home = process.env.HOME || ''
  if (home) {
    push({
      nodeModulesDir: join(home, '.npm-global', 'lib', 'node_modules'),
      binDir: join(home, '.npm-global', 'bin'),
      label: 'npm-global-home',
    })
  }

  const npmPrefix = tryExec('npm', ['config', 'get', 'prefix'])
  if (npmPrefix && npmPrefix !== 'undefined') {
    push({
      nodeModulesDir: join(npmPrefix, 'lib', 'node_modules'),
      binDir: join(npmPrefix, 'bin'),
      label: `npm-prefix:${npmPrefix}`,
    })
  }

  return candidates
}

/** 从候选中挑第一个 node_modules + bin 均可写的前缀 */
export function pickWritableGlobalPrefix(
  candidates: GlobalPrefixInfo[],
  isWritable: (dir: string) => boolean = canWriteDir
): GlobalPrefixInfo | null {
  for (const c of candidates) {
    if (isWritable(c.nodeModulesDir) && isWritable(c.binDir)) return c
  }
  return null
}

function apiniclawGatewayFallbackPrefix(): GlobalPrefixInfo {
  return {
    nodeModulesDir: join(APINICLAW_HOME, 'gateway', 'node_modules'),
    binDir: join(APINICLAW_HOME, 'bin'),
    label: 'apiniclaw-gateway-fallback',
  }
}

/** 解析用户可写的全局安装前缀（按平台约定顺序） */
export function resolveWritableGlobalPrefix(
  isWritable: (dir: string) => boolean = canWriteDir
): GlobalPrefixInfo | null {
  const picked = pickWritableGlobalPrefix(listGlobalPrefixCandidates(), isWritable)
  if (picked) return picked

  const fallback = apiniclawGatewayFallbackPrefix()
  if (isWritable(fallback.nodeModulesDir) && isWritable(fallback.binDir)) {
    return fallback
  }
  return null
}

/**
 * 把 GlobalPrefixInfo 转成 `npm install --prefix` 根目录。
 * - win: …/npm
 * - mac brew/npm-global: …（lib 的上一级）
 * - apiniclaw fallback: ~/.apiniclaw/gateway
 */
export function resolveNpmInstallPrefix(info: GlobalPrefixInfo): string {
  if (info.label === 'apiniclaw-gateway-fallback') {
    return join(APINICLAW_HOME, 'gateway')
  }
  if (IS_WIN) {
    return dirname(info.nodeModulesDir)
  }
  return dirname(dirname(info.nodeModulesDir))
}

/**
 * 只读安装介质：安装包 / 开发 targets 内的 openclaw。
 * 绝不使用 ~/.apiniclaw/gateway（避免把残缺用户目录再拷到全局）。
 */
export function resolveBundledOpenclawMediaDir(): string | null {
  const resources = resolveResourcesPath()
  const media = join(resources, 'gateway', 'node_modules', 'openclaw')
  if (existsSync(join(media, 'openclaw.mjs'))) return media
  return null
}

function writePosixShim(binPath: string, nodePath: string, entryPath: string): void {
  const script = `#!/bin/sh
exec "${nodePath}" "${entryPath}" "$@"
`
  writeFileSync(binPath, script, { encoding: 'utf-8', mode: 0o755 })
}

function writeWinShim(cmdPath: string, nodePath: string, entryPath: string): void {
  const script = `@echo off\r\n"${nodePath}" "${entryPath}" %*\r\n`
  writeFileSync(cmdPath, script, 'utf-8')
}

function resolveShimNodePath(): string {
  const bundled = resolveBundledNodeBin()
  const candidates = IS_WIN
    ? [
        join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
        join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
      ]
    : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']

  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return bundled
}

/**
 * 将内置 openclaw 复制到本机全局（或 ApiniClaw fallback 目录）。
 */
export function installBundledEngineOffline(
  onProgress?: (msg: string) => void
): OfflineInstallResult {
  const progress = (msg: string): void => {
    log.info(msg)
    onProgress?.(msg)
  }

  const source = resolveBundledOpenclawMediaDir()
  if (!source) {
    return { ok: false, error: '安装包内未找到 openclaw 引擎介质（gateway/node_modules/openclaw）' }
  }

  const prefix = resolveWritableGlobalPrefix()
  if (!prefix) {
    return {
      ok: false,
      error: '没有可写的用户级全局目录（brew/npm）。请检查 Homebrew/Node 权限，勿使用 sudo。',
    }
  }

  const dest = join(prefix.nodeModulesDir, 'openclaw')
  progress(`准备安装到 ${prefix.label}: ${dest}`)

  try {
    if (existsSync(dest)) {
      progress('移除旧的全局 openclaw 目录…')
      rmSync(dest, { recursive: true, force: true })
    }
    mkdirSync(prefix.nodeModulesDir, { recursive: true })
    progress('正在复制内置 openclaw（离线）…')
    cpSync(source, dest, { recursive: true, dereference: true })

    const entry = join(dest, 'openclaw.mjs')
    if (!existsSync(entry)) {
      return { ok: false, error: `复制后缺少入口文件: ${entry}`, prefix }
    }

    const nodePath = resolveShimNodePath()
    mkdirSync(prefix.binDir, { recursive: true })
    const binPath = IS_WIN ? join(prefix.binDir, 'openclaw.cmd') : join(prefix.binDir, 'openclaw')
    progress(`写入 CLI shim: ${binPath}`)
    if (IS_WIN) {
      writeWinShim(binPath, nodePath, entry)
    } else {
      try {
        if (existsSync(binPath)) rmSync(binPath, { force: true })
        symlinkSync(entry, binPath)
      } catch {
        writePosixShim(binPath, nodePath, entry)
      }
    }

    const runtimeBin = resolveBundledRuntimeBinDir()
    if (existsSync(runtimeBin)) {
      progress(`内置 Node 可用: ${runtimeBin}`)
    }

    const hit = listSystemOpenclawPackageCandidates().some((p) => p === dest)
    progress(hit ? '安装完成，全局探测应可命中' : '安装完成（可能需刷新 PATH 后探测）')

    return { ok: true, packageDir: dest, binPath, prefix }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('offline install failed:', message)
    return { ok: false, error: message, prefix }
  }
}

/** 本机是否已有可读的全局/用户 openclaw 包（不含 bundled 安装包介质） */
export function hasLocalOpenclawPackage(): boolean {
  for (const cwd of listSystemOpenclawPackageCandidates()) {
    if (existsSync(join(cwd, 'openclaw.mjs')) && canRead(join(cwd, 'openclaw.mjs'))) return true
  }
  const user = join(APINICLAW_HOME, 'gateway', 'node_modules', 'openclaw', 'openclaw.mjs')
  return existsSync(user) && canRead(user)
}

function canRead(path: string): boolean {
  try {
    accessSync(path, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}
