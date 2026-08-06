/**
 * 一键安装技能依赖的命令行工具（Windows winget / macOS brew）
 *
 * 仅允许白名单内的 bin → 包映射，避免任意命令执行。
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '../logger'
import { getGatewayProcess } from '../gateway'

const execFileAsync = promisify(execFile)
const log = createLogger('tool-installer')

export interface ToolInstallResult {
  success: boolean
  bin: string
  method?: 'winget' | 'brew' | 'manual'
  /** 实际执行的命令（便于日志/UI） */
  command?: string
  stdout?: string
  stderr?: string
  error?: string
  /** 是否触发了 Gateway 重启（刷新 PATH） */
  gatewayRestarted?: boolean
}

interface WingetPackage {
  id: string
  /** winget 源里的精确匹配 */
  exact?: boolean
}

interface BrewPackage {
  formula: string
  cask?: boolean
}

/** 白名单：bin 名 → 各平台包 */
const TOOL_PACKAGES: Record<
  string,
  {
    label: string
    win32?: WingetPackage
    darwin?: BrewPackage
    /** 无法自动装时的说明 */
    manualHint?: string
  }
> = {
  gh: {
    label: 'GitHub CLI',
    win32: { id: 'GitHub.cli', exact: true },
    darwin: { formula: 'gh' },
  },
  git: {
    label: 'Git',
    win32: { id: 'Git.Git', exact: true },
    darwin: { formula: 'git' },
  },
  node: {
    label: 'Node.js LTS',
    win32: { id: 'OpenJS.NodeJS.LTS', exact: true },
    darwin: { formula: 'node' },
  },
  npm: {
    label: 'Node.js LTS (含 npm)',
    win32: { id: 'OpenJS.NodeJS.LTS', exact: true },
    darwin: { formula: 'node' },
  },
  python: {
    label: 'Python 3.12',
    win32: { id: 'Python.Python.3.12', exact: true },
    darwin: { formula: 'python' },
  },
  python3: {
    label: 'Python 3.12',
    win32: { id: 'Python.Python.3.12', exact: true },
    darwin: { formula: 'python' },
  },
  docker: {
    label: 'Docker Desktop',
    win32: { id: 'Docker.DockerDesktop', exact: true },
    darwin: { formula: 'docker', cask: true },
  },
  ffmpeg: {
    label: 'FFmpeg',
    win32: { id: 'Gyan.FFmpeg', exact: true },
    darwin: { formula: 'ffmpeg' },
  },
  rg: {
    label: 'ripgrep',
    win32: { id: 'BurntSushi.ripgrep.MSVC', exact: true },
    darwin: { formula: 'ripgrep' },
  },
  ripgrep: {
    label: 'ripgrep',
    win32: { id: 'BurntSushi.ripgrep.MSVC', exact: true },
    darwin: { formula: 'ripgrep' },
  },
  jq: {
    label: 'jq',
    win32: { id: 'jqlang.jq', exact: true },
    darwin: { formula: 'jq' },
  },
  curl: {
    label: 'curl',
    win32: { id: 'cURL.cURL', exact: true },
    darwin: { formula: 'curl' },
  },
  wget: {
    label: 'wget',
    win32: { id: 'JernejSimoncic.Wget', exact: true },
    darwin: { formula: 'wget' },
  },
  uv: {
    label: 'uv',
    win32: { id: 'astral-sh.uv', exact: true },
    darwin: { formula: 'uv' },
  },
  go: {
    label: 'Go',
    win32: { id: 'GoLang.Go', exact: true },
    darwin: { formula: 'go' },
  },
  cargo: {
    label: 'Rust (rustup)',
    win32: { id: 'Rustlang.Rustup', exact: true },
    darwin: { formula: 'rustup' },
  },
  rustc: {
    label: 'Rust (rustup)',
    win32: { id: 'Rustlang.Rustup', exact: true },
    darwin: { formula: 'rustup' },
  },
  bun: {
    label: 'Bun',
    // winget 可能无稳定包，给 manual
    win32: undefined,
    darwin: { formula: 'oven-sh/bun/bun' },
    manualHint: '请访问 https://bun.sh 安装',
  },
  pnpm: {
    label: 'pnpm',
    win32: { id: 'pnpm.pnpm', exact: true },
    darwin: { formula: 'pnpm' },
  },
  yarn: {
    label: 'Yarn',
    win32: { id: 'Yarn.Yarn', exact: true },
    darwin: { formula: 'yarn' },
  },
  code: {
    label: 'VS Code',
    win32: { id: 'Microsoft.VisualStudioCode', exact: true },
    darwin: { formula: 'visual-studio-code', cask: true },
  },
  pwsh: {
    label: 'PowerShell 7',
    win32: { id: 'Microsoft.PowerShell', exact: true },
    darwin: { formula: 'powershell' },
  },
  '7z': {
    label: '7-Zip',
    win32: { id: '7zip.7zip', exact: true },
    darwin: { formula: 'p7zip' },
  },
  '7za': {
    label: '7-Zip',
    win32: { id: '7zip.7zip', exact: true },
    darwin: { formula: 'p7zip' },
  },
}

export function isBinInstallable(bin: string, platform = process.platform): boolean {
  const entry = TOOL_PACKAGES[bin.trim().toLowerCase()]
  if (!entry) return false
  if (platform === 'win32') return Boolean(entry.win32)
  if (platform === 'darwin') return Boolean(entry.darwin)
  return false
}

export function listInstallableBins(bins: string[], platform = process.platform): string[] {
  return bins.filter((b) => isBinInstallable(b, platform))
}

function normalizeBin(bin: string): string {
  return bin.trim().toLowerCase()
}

async function runWinget(packageId: string, exact = true): Promise<{ stdout: string; stderr: string; command: string }> {
  const args = [
    'install',
    '--id',
    packageId,
    ...(exact ? ['-e'] : []),
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--disable-interactivity',
  ]
  const command = `winget ${args.join(' ')}`
  log.info(`running: ${command}`)
  // winget 安装可能较久
  const { stdout, stderr } = await execFileAsync('winget', args, {
    timeout: 15 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      // 减少交互/颜色
      WINGET_DISABLE_INTERACTIVITY: '1',
    },
  })
  return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', command }
}

async function runBrew(formula: string, cask = false): Promise<{ stdout: string; stderr: string; command: string }> {
  const args = cask ? ['install', '--cask', formula] : ['install', formula]
  const command = `brew ${args.join(' ')}`
  log.info(`running: ${command}`)
  const { stdout, stderr } = await execFileAsync('brew', args, {
    timeout: 15 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  })
  return { stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', command }
}

/**
 * 安装成功后重启 Gateway，使新 PATH 生效（技能门控重新探测 bins）
 */
async function restartGatewayIfRunning(): Promise<boolean> {
  try {
    const gw = getGatewayProcess()
    if (gw.getState() !== 'running') return false
    log.info('restarting gateway to refresh PATH after tool install')
    await gw.restart()
    return true
  } catch (err) {
    log.warn('gateway restart after tool install failed:', err)
    return false
  }
}

/**
 * 一键安装指定 bin 对应的工具
 */
export async function installToolBin(
  bin: string,
  opts?: { restartGateway?: boolean }
): Promise<ToolInstallResult> {
  const key = normalizeBin(bin)
  const entry = TOOL_PACKAGES[key]
  if (!entry) {
    return {
      success: false,
      bin: key,
      error: `暂不支持一键安装「${bin}」，请手动安装后重新检查`,
    }
  }

  const platform = process.platform
  try {
    if (platform === 'win32') {
      if (!entry.win32) {
        return {
          success: false,
          bin: key,
          method: 'manual',
          error: entry.manualHint ?? `「${entry.label}」暂不支持 Windows 一键安装，请手动安装`,
        }
      }
      const { stdout, stderr, command } = await runWinget(entry.win32.id, entry.win32.exact !== false)
      // winget exit 0 even when already installed; non-zero throws
      const combined = `${stdout}\n${stderr}`
      // 已安装也算成功
      const already =
        /already installed/i.test(combined) ||
        /No available upgrade found/i.test(combined) ||
        /已安装/.test(combined)
      log.info(`winget done for ${key}: already=${already}`)
      const gatewayRestarted =
        opts?.restartGateway === false ? false : await restartGatewayIfRunning()
      return {
        success: true,
        bin: key,
        method: 'winget',
        command,
        stdout,
        stderr,
        gatewayRestarted,
      }
    }

    if (platform === 'darwin') {
      if (!entry.darwin) {
        return {
          success: false,
          bin: key,
          method: 'manual',
          error: entry.manualHint ?? `「${entry.label}」暂不支持 macOS 一键安装`,
        }
      }
      const { stdout, stderr, command } = await runBrew(entry.darwin.formula, entry.darwin.cask)
      const gatewayRestarted =
        opts?.restartGateway === false ? false : await restartGatewayIfRunning()
      return {
        success: true,
        bin: key,
        method: 'brew',
        command,
        stdout,
        stderr,
        gatewayRestarted,
      }
    }

    return {
      success: false,
      bin: key,
      method: 'manual',
      error: `当前系统（${platform}）暂不支持一键安装，请手动安装「${entry.label}」`,
    }
  } catch (err) {
    const e = err as { message?: string; stdout?: string | Buffer; stderr?: string | Buffer; code?: number }
    const stdout = e.stdout?.toString() ?? ''
    const stderr = e.stderr?.toString() ?? ''
    const msg = e.message ?? String(err)
    // winget: 已安装有时以非 0 退出
    if (
      /already installed/i.test(stdout + stderr + msg) ||
      /No newer package versions are available/i.test(stdout + stderr)
    ) {
      const gatewayRestarted =
        opts?.restartGateway === false ? false : await restartGatewayIfRunning()
      return {
        success: true,
        bin: key,
        method: platform === 'win32' ? 'winget' : 'brew',
        stdout,
        stderr,
        gatewayRestarted,
      }
    }
    log.error(`installToolBin(${key}) failed:`, msg, stderr)
    return {
      success: false,
      bin: key,
      method: platform === 'win32' ? 'winget' : platform === 'darwin' ? 'brew' : 'manual',
      stdout,
      stderr,
      error: stderr.trim() || msg || `安装「${key}」失败`,
    }
  }
}

/**
 * 批量安装（顺序执行；最后统一重启一次 Gateway）
 */
export async function installToolBins(bins: string[]): Promise<{
  results: ToolInstallResult[]
  gatewayRestarted: boolean
}> {
  const unique = [...new Set(bins.map(normalizeBin).filter(Boolean))]
  const results: ToolInstallResult[] = []
  for (const bin of unique) {
    // 批量时先不重启，最后统一重启
    const r = await installToolBin(bin, { restartGateway: false })
    results.push(r)
  }
  const anyOk = results.some((r) => r.success)
  let gatewayRestarted = false
  if (anyOk) {
    gatewayRestarted = await restartGatewayIfRunning()
    for (const r of results) {
      if (r.success) r.gatewayRestarted = gatewayRestarted
    }
  }
  return { results, gatewayRestarted }
}
