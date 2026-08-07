/**
 * Capture ApiniClaw UI via Playwright Electron API.
 * Waits until Gateway is fully running before taking any product shots.
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = process.env.SHOT_OUT || path.join(root, 'screenshot')
const GATEWAY_TIMEOUT_MS = Number(process.env.GATEWAY_WAIT_MS || 180000)

const routes = [
  { hash: '/dashboard', file: 'dashboard.png', wait: 2200 },
  { hash: '/chat', file: 'chat.png', wait: 2500 },
  { hash: '/models', file: 'model.png', wait: 1800 },
  { hash: '/channels', file: 'channel.png', wait: 1800 },
  { hash: '/agents', file: 'agents.png', wait: 1800 },
  { hash: '/skills', file: 'skill.png', wait: 1800 },
  { hash: '/cron', file: 'cron.png', wait: 1800 },
  { hash: '/backup', file: 'backup.png', wait: 1800 },
  // setup last - optional, not dependent on gateway content as much
  { hash: '/setup', file: 'setup.png', wait: 1500 },
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

function killApp() {
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

async function dismissDialogs(page) {
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
}

async function goHash(page, hash) {
  await page.evaluate((h) => {
    const path = h.startsWith('/') ? h : `/${String(h).replace(/^#\/?/, '')}`
    location.hash = path
  }, hash)
  await sleep(400)
}

/**
 * UI text probe: Gateway is ready when status shows 运行中 and not 启动中/未运行.
 */
function gatewayStatusFromText(text) {
  const t = text.replace(/\s+/g, ' ')
  if (/运行中/.test(t) && !/启动中/.test(t) && !/未运行/.test(t)) return 'running'
  if (/启动中/.test(t)) return 'starting'
  if (/停止中/.test(t)) return 'stopping'
  return 'other'
}

async function tryStartGateway(page) {
  // Prefer dashboard start controls
  const candidates = [
    page.getByRole('button', { name: /启动服务/ }),
    page.getByRole('button', { name: /立即启动/ }),
    page.getByRole('button', { name: /^启动$/ }),
    page.locator('button').filter({ hasText: /^启动/ }),
  ]
  for (const loc of candidates) {
    try {
      const btn = loc.first()
      if (await btn.isVisible({ timeout: 600 })) {
        const disabled = await btn.isDisabled().catch(() => false)
        if (!disabled) {
          console.log('click start gateway')
          await btn.click()
          await sleep(800)
          return true
        }
      }
    } catch {
      // try next
    }
  }
  return false
}

async function waitForGatewayReady(page, timeoutMs = GATEWAY_TIMEOUT_MS) {
  console.log('waiting for Gateway running (timeout', timeoutMs, 'ms)...')
  await goHash(page, '/dashboard')
  await sleep(1200)
  await dismissDialogs(page)

  const start = Date.now()
  let lastStatus = ''
  let startClicked = false

  while (Date.now() - start < timeoutMs) {
    const text = await page.evaluate(() => document.body?.innerText || '')
    const status = gatewayStatusFromText(text)
    if (status !== lastStatus) {
      console.log('gateway ui status:', status)
      lastStatus = status
    }

    if (status === 'running') {
      // extra settle: stats / channels / agents often load after process up
      console.log('Gateway running - settle 8s for page data...')
      await sleep(8000)
      // re-check still running
      const text2 = await page.evaluate(() => document.body?.innerText || '')
      if (gatewayStatusFromText(text2) === 'running') {
        console.log('Gateway ready for screenshots')
        return true
      }
    }

    if (status !== 'starting' && status !== 'running' && !startClicked) {
      startClicked = await tryStartGateway(page)
      if (!startClicked) {
        // try once more after a moment (auto-start may be pending)
        await sleep(1500)
        startClicked = await tryStartGateway(page)
      }
    }

    await sleep(1500)
  }

  throw new Error(`Gateway did not become running within ${timeoutMs}ms (last=${lastStatus})`)
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

  killApp()
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
    await sleep(1500)
    page = await pickLargestWindow(electronApp)

    try {
      await page.setViewportSize({ width: 1280, height: 800 })
    } catch {
      // ignore
    }

    await dismissDialogs(page)
    await sleep(800)

    // Critical: wait until gateway is fully up before any product shots
    await waitForGatewayReady(page)

    for (const r of routes) {
      console.log('navigate', r.hash)
      await goHash(page, r.hash)
      await sleep(r.wait)

      // for dashboard, ensure still running badge visible
      if (r.hash === '/dashboard') {
        await page
          .waitForFunction(
            () => {
              const t = document.body?.innerText || ''
              return /运行中/.test(t) && !/启动中/.test(t)
            },
            { timeout: 30000 },
          )
          .catch(() => console.warn('dashboard running badge not confirmed'))
        await sleep(1000)
      }

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
    killApp()
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
