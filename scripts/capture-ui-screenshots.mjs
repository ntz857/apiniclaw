/**
 * Capture ApiniClaw UI via Playwright Electron API (main window, not tray).
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = process.env.SHOT_OUT || path.join(root, 'screenshot')

const routes = [
  { hash: '/dashboard', file: 'dashboard.png', wait: 2000 },
  { hash: '/chat', file: 'chat.png', wait: 2000 },
  { hash: '/models', file: 'model.png', wait: 1600 },
  { hash: '/channels', file: 'channel.png', wait: 1600 },
  { hash: '/agents', file: 'agents.png', wait: 1600 },
  { hash: '/skills', file: 'skill.png', wait: 1600 },
  { hash: '/cron', file: 'cron.png', wait: 1600 },
  { hash: '/backup', file: 'backup.png', wait: 1600 },
  { hash: '/setup', file: 'setup.png', wait: 1600 },
]

function resolveExe() {
  if (process.env.APINICLAW_EXE && fs.existsSync(process.env.APINICLAW_EXE)) {
    return process.env.APINICLAW_EXE
  }
  for (const c of [
    path.join(root, 'dist-apini', 'win-unpacked', 'ApiniClaw.exe'),
    path.join(root, 'dist', 'win-unpacked', 'ApiniClaw.exe'),
  ]) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function pickLargestWindow(electronApp) {
  const windows = electronApp.windows()
  console.log(
    'windows',
    windows.map((w) => w.url()),
  )
  let best = null
  let bestArea = 0
  for (const w of windows) {
    let area = 0
    try {
      const box = await w.evaluate(() => ({
        w: window.outerWidth || document.documentElement.clientWidth,
        h: window.outerHeight || document.documentElement.clientHeight,
      }))
      area = (box.w || 0) * (box.h || 0)
      console.log('win', w.url(), box.w, box.h)
    } catch (e) {
      console.log('win size fail', w.url(), e.message)
    }
    // skip tiny tray
    if (area > bestArea) {
      bestArea = area
      best = w
    }
  }
  if (!best && windows.length) best = windows[0]
  if (!best) throw new Error('no electron windows')
  console.log('picked', best.url(), 'area', bestArea)
  return best
}

async function ensureMainWindow(electronApp, page) {
  // if tray popup, click open main
  try {
    const openBtn = page.getByText('打开主窗口', { exact: false })
    if (await openBtn.isVisible({ timeout: 1000 })) {
      await openBtn.click()
      await sleep(2000)
      return pickLargestWindow(electronApp)
    }
  } catch {
    // ignore
  }
  return page
}

async function main() {
  const require = createRequire(import.meta.url)
  let _electron
  try {
    ;({ _electron } = require('playwright'))
  } catch {
    console.error('npm i -D playwright')
    process.exit(1)
  }

  const exe = resolveExe()
  if (!exe) {
    console.error('ApiniClaw.exe not found')
    process.exit(1)
  }

  // kill existing
  try {
    spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-Process ApiniClaw -ErrorAction SilentlyContinue | Stop-Process -Force',
      ],
      { stdio: 'ignore' },
    )
  } catch {
    // ignore
  }
  await sleep(1500)

  fs.mkdirSync(outDir, { recursive: true })
  console.log('launching electron app', exe)

  const electronApp = await _electron.launch({
    executablePath: exe,
    args: [],
    cwd: path.dirname(exe),
    timeout: 120000,
  })

  try {
    await sleep(4000)
    let page = await pickLargestWindow(electronApp)
    page = await ensureMainWindow(electronApp, page)
    // wait for more windows after open
    await sleep(1500)
    page = await pickLargestWindow(electronApp)

    try {
      await page.setViewportSize({ width: 1280, height: 800 })
    } catch {
      // electron may not allow
    }

    // dismiss dialogs
    for (const label of ['进入主界面', '使用现有配置', '继续', '确定', '开始使用', '跳过']) {
      try {
        const b = page.getByRole('button', { name: new RegExp(label) })
        if (await b.first().isVisible({ timeout: 400 })) {
          await b.first().click()
          await sleep(500)
        }
      } catch {
        // ignore
      }
    }

    await sleep(1000)

    for (const r of routes) {
      console.log('navigate', r.hash)
      await page.evaluate((hash) => {
        const h = hash.startsWith('/') ? hash.slice(1) : hash.replace(/^#/, '')
        location.hash = `/${h.replace(/^\//, '')}`
      }, r.hash)
      await sleep(r.wait)

      // clear transient UI
      await page
        .evaluate(() => {
          document.querySelectorAll('.ant-message').forEach((el) => el.remove())
        })
        .catch(() => {})

      const dest = path.join(outDir, r.file)
      await page.screenshot({ path: dest, type: 'png', timeout: 60000 })
      console.log('saved', r.file, fs.statSync(dest).size)
    }
  } finally {
    await electronApp.close().catch(() => {})
    try {
      spawn(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-Process ApiniClaw -ErrorAction SilentlyContinue | Stop-Process -Force',
        ],
        { stdio: 'ignore' },
      )
    } catch {
      // ignore
    }
  }

  const webAssets = path.join(root, 'website', 'assets')
  if (fs.existsSync(webAssets)) {
    for (const r of routes) {
      const src = path.join(outDir, r.file)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(webAssets, r.file))
        console.log('website', r.file)
      }
    }
  }
  console.log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
