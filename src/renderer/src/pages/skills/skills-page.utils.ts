import type { TFunction } from 'i18next'

const OS_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function pathBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
}

export function formatOsList(os: string[]): string {
  return os.map((o) => OS_NAMES[o] ?? o).join(', ')
}

export function resolveSourceTag(skill: InstalledSkillInfo): { label: string; color: string } {
  const rs = skill.rawSource
  if (rs === 'openclaw-bundled') return { label: 'openclaw-bundled', color: 'default' }
  if (rs === 'openclaw-extra') return { label: 'openclaw-extra', color: 'cyan' }
  if (rs === 'agents-skills-personal') return { label: 'workspace', color: 'blue' }
  switch (skill.source) {
    case 'managed':
      return { label: 'managed', color: 'green' }
    case 'workspace':
      return { label: 'workspace', color: 'blue' }
    case 'bundled':
      return { label: 'built-in', color: 'default' }
    default:
      return { label: rs ?? skill.source, color: 'purple' }
  }
}

export function buildMissingHint(missing: InstalledSkillInfo['missing'], t: TFunction): string {
  if (!missing) return ''
  const parts: string[] = []
  if (missing.bins?.length) parts.push(t('skills.missingBins', { list: missing.bins.join(', ') }))
  if (missing.anyBins?.length)
    parts.push(t('skills.missingAnyBins', { list: missing.anyBins.join(', ') }))
  if (missing.env?.length) parts.push(t('skills.missingEnv', { list: missing.env.join(', ') }))
  if (missing.config?.length)
    parts.push(t('skills.missingConfig', { list: missing.config.join(', ') }))
  if (missing.os?.length)
    parts.push(t('skills.missingOs', { list: formatOsList(missing.os) }))
  return parts.join('\n')
}

export function skillHasMissingDeps(skill: InstalledSkillInfo): boolean {
  if (skill.eligible !== false) return false
  const m = skill.missing
  if (!m) return true
  return Boolean(
    m.bins?.length ||
      m.anyBins?.length ||
      m.env?.length ||
      m.config?.length ||
      m.os?.length ||
      skill.primaryEnv
  )
}

/** Common CLI install hints by platform (best-effort). */
const BIN_INSTALL: Record<string, { win32?: string; darwin?: string; linux?: string }> = {
  gh: {
    win32: 'winget install --id GitHub.cli -e',
    darwin: 'brew install gh',
    linux: 'sudo apt install gh  # or see https://cli.github.com',
  },
  git: {
    win32: 'winget install --id Git.Git -e',
    darwin: 'xcode-select --install  # or brew install git',
    linux: 'sudo apt install git',
  },
  node: {
    win32: 'winget install --id OpenJS.NodeJS.LTS -e',
    darwin: 'brew install node',
    linux: 'sudo apt install nodejs npm',
  },
  npm: {
    win32: 'winget install --id OpenJS.NodeJS.LTS -e',
    darwin: 'brew install node',
    linux: 'sudo apt install npm',
  },
  python: {
    win32: 'winget install --id Python.Python.3.12 -e',
    darwin: 'brew install python',
    linux: 'sudo apt install python3',
  },
  python3: {
    win32: 'winget install --id Python.Python.3.12 -e',
    darwin: 'brew install python',
    linux: 'sudo apt install python3',
  },
  docker: {
    win32: 'winget install --id Docker.DockerDesktop -e',
    darwin: 'brew install --cask docker',
    linux: 'https://docs.docker.com/engine/install/',
  },
  ffmpeg: {
    win32: 'winget install --id Gyan.FFmpeg -e',
    darwin: 'brew install ffmpeg',
    linux: 'sudo apt install ffmpeg',
  },
  rg: {
    win32: 'winget install --id BurntSushi.ripgrep.MSVC -e',
    darwin: 'brew install ripgrep',
    linux: 'sudo apt install ripgrep',
  },
  ripgrep: {
    win32: 'winget install --id BurntSushi.ripgrep.MSVC -e',
    darwin: 'brew install ripgrep',
    linux: 'sudo apt install ripgrep',
  },
  jq: {
    win32: 'winget install --id jqlang.jq -e',
    darwin: 'brew install jq',
    linux: 'sudo apt install jq',
  },
  curl: {
    win32: 'winget install --id cURL.cURL -e',
    darwin: 'brew install curl',
    linux: 'sudo apt install curl',
  },
  wget: {
    win32: 'winget install --id JernejSimoncic.Wget -e',
    darwin: 'brew install wget',
    linux: 'sudo apt install wget',
  },
  uv: {
    win32: 'winget install --id astral-sh.uv -e',
    darwin: 'brew install uv',
    linux: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  },
  bun: {
    win32: 'powershell -c "irm bun.sh/install.ps1 | iex"',
    darwin: 'curl -fsSL https://bun.sh/install | bash',
    linux: 'curl -fsSL https://bun.sh/install | bash',
  },
  go: {
    win32: 'winget install --id GoLang.Go -e',
    darwin: 'brew install go',
    linux: 'sudo apt install golang-go',
  },
  cargo: {
    win32: 'winget install --id Rustlang.Rustup -e',
    darwin: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    linux: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
  },
  rustc: {
    win32: 'winget install --id Rustlang.Rustup -e',
    darwin: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    linux: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
  },
}

export function getBinInstallCommand(bin: string, platform?: string): string | null {
  const key = bin.trim().toLowerCase()
  const entry = BIN_INSTALL[key]
  if (!entry) return null
  const p = platform === 'darwin' || platform === 'linux' || platform === 'win32' ? platform : 'win32'
  return entry[p] ?? entry.win32 ?? entry.darwin ?? entry.linux ?? null
}

/** 与主进程 tool-installer 白名单对齐：这些 bin 支持 UI 一键安装 */
const ONE_CLICK_BINS = new Set([
  'gh',
  'git',
  'node',
  'npm',
  'python',
  'python3',
  'docker',
  'ffmpeg',
  'rg',
  'ripgrep',
  'jq',
  'curl',
  'wget',
  'uv',
  'go',
  'cargo',
  'rustc',
  'pnpm',
  'yarn',
  'code',
  'pwsh',
  '7z',
  '7za',
])

export function canOneClickInstallBin(bin: string, platform?: string): boolean {
  const key = bin.trim().toLowerCase()
  if (!ONE_CLICK_BINS.has(key)) return false
  // Linux 暂无统一包管理一键装
  if (platform === 'linux') return false
  // bun 仅部分平台
  if (key === 'bun' && platform === 'win32') return false
  return true
}

/** Env keys to show in the fix form (missing.env + primaryEnv if skill not ready). */
export function resolveEnvKeysToFill(skill: InstalledSkillInfo): string[] {
  const keys = new Set<string>()
  for (const k of skill.missing?.env ?? []) {
    if (k?.trim()) keys.add(k.trim())
  }
  if (skill.eligible === false && skill.primaryEnv?.trim()) {
    keys.add(skill.primaryEnv.trim())
  }
  return [...keys]
}
