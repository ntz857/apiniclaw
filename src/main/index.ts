import { app, shell, BrowserWindow, protocol, net, nativeImage } from 'electron'
import { join, isAbsolute, normalize } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { detect } from './runtime'
import { registerIpcHandlers } from './ipc-handlers'
import { getGatewayProcess } from './gateway'
import { createLogger } from './logger'
import { createTray, destroyTray } from './tray'
import { loadAppState, saveAppState } from './config/app-cache'
import { initUpdater } from './services/updater'
import { fetchPresetsInBackground } from './services/remote-presets'
import { ensureBundledWeixinReady } from './services/openclaw-updater'
import { getSettings } from './settings'
import { applyElectronProxy } from './utils/proxy'
import { installCli } from './services/cli-integration'
import { OPENCLAW_HOME } from './constants'
import { cancelAllWeixinQrScans } from './services/weixin-qr'

// ─── 注册自定义协议（必须在 app.whenReady() 之前调用） ───
//
// 使用 app:// 替代 file:// 加载 renderer，目的：
// - 打包后 WebSocket 握手 Origin 头为 "app://localhost"（而非 file:// 的 "null"）
// - 可将 "app://localhost" 写入 gateway.controlUi.allowedOrigins，只允许 ApiniClaw 自身连接
// - 比 "null" 更安全：任意本地 HTML 文件无法冒充此 origin
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true, // 视为标准 URL（支持相对路径解析）
      secure: true, // 视为安全上下文（等同 https://）
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

const log = createLogger('main')

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function focusExistingMainWindow(): void {
  const win =
    BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && !window.isAlwaysOnTop()
    ) ?? null

  if (!win) {
    mainWindow = null
    return
  }

  mainWindow = win

  try {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } catch (err) {
    log.warn('focusExistingMainWindow failed:', err)
    if (win.isDestroyed()) {
      mainWindow = null
    }
  }
}

function createWindow(): void {
  // 恢复上次保存的窗口位置和尺寸
  const savedBounds = loadAppState().windowBounds

  const isMac = process.platform === 'darwin'

  // 开发模式：从源码 assets/ 目录读取；打包模式：从 extraResources 注入的 resources/ 读取
  // Windows 任务栏/窗口图标优先用 .ico（多尺寸），PNG 作回退
  const iconPath = is.dev
    ? process.platform === 'win32'
      ? join(__dirname, '../../assets/icon.ico')
      : join(__dirname, '../../assets/icon-256.png')
    : process.platform === 'win32'
      ? join(process.resourcesPath, 'icon.ico')
      : join(process.resourcesPath, 'icon-256.png')

  mainWindow = new BrowserWindow({
    ...(savedBounds
      ? { x: savedBounds.x, y: savedBounds.y, width: savedBounds.width, height: savedBounds.height }
      : { width: 1200, height: 800 }),
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'ApiniClaw',
    autoHideMenuBar: true,
    icon: iconPath,
    // macOS：隐藏标题栏保留红绿灯；Windows/Linux：完全无边框，由渲染层 TitleBar 接管
    ...(isMac
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 13 } }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  // Windows：显式 setIcon，避免任务栏仍用 exe 内嵌旧图标缓存
  if (process.platform === 'win32') {
    const winIcon = nativeImage.createFromPath(iconPath)
    if (!winIcon.isEmpty()) {
      mainWindow.setIcon(winIcon)
    } else {
      log.warn('window icon load failed:', iconPath)
    }
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 关闭窗口时最小化到托盘，而非退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // 保存窗口位置和尺寸（节流：resize/moved 均触发）
  const saveBounds = (): void => {
    if (!mainWindow) return
    try {
      if (mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) return
      const b = mainWindow.getBounds()
      saveAppState({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } })
    } catch (err) {
      log.warn('saveBounds skipped due to window state error:', err)
    }
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('moved', saveBounds)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const target = details.url || ''
    // 本地文件：用系统默认应用打开，而不是 openExternal（对 file/app 协议无效）
    if (target.startsWith('app://local-file') || target.startsWith('file://')) {
      try {
        let fsPath = ''
        if (target.startsWith('app://local-file')) {
          const u = new URL(target)
          fsPath = decodeURIComponent(u.searchParams.get('path') || '')
        } else {
          const u = new URL(target)
          fsPath = decodeURIComponent(u.pathname || '')
          if (/^\/[A-Za-z]:\//.test(fsPath)) fsPath = fsPath.slice(1)
        }
        if (fsPath) {
          void shell.openPath(normalize(fsPath))
        }
      } catch (err) {
        log.warn('open local path from windowOpen failed:', err)
      }
      return { action: 'deny' }
    }
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    // 使用自定义协议加载，Origin 头为 "app://localhost"
    mainWindow.loadURL('app://localhost')
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusExistingMainWindow()
  })

  app.whenReady().then(() => {
    // macOS 开发态默认会显示 "Electron"，这里强制应用名与 About 信息使用产品名
    app.setName('ApiniClaw')
    app.setAboutPanelOptions({
      applicationName: 'ApiniClaw',
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
    })
    if (process.platform === 'darwin' && is.dev) {
      const dockIconPath = join(__dirname, '../../assets/icon.icns')
      const dockIcon = nativeImage.createFromPath(dockIconPath)
      if (!dockIcon.isEmpty()) {
        app.dock?.setIcon(dockIcon)
      } else {
        log.warn('dock icon load failed:', dockIconPath)
      }
    }

    // AUMID 与 electron-builder appId 一致；变更后可刷新任务栏图标缓存
    electronApp.setAppUserModelId('com.apiniclaw.app')

    // 注册 app:// 协议处理器，将请求映射到 renderer 静态文件
    // 打包后：Origin 头固定为 "app://localhost"，写入 allowedOrigins 即可
    protocol.handle('app', async (request) => {
      const url = new URL(request.url)
      if (url.host === 'local-file') {
        const rawPath = url.searchParams.get('path')
        const decodedPath = rawPath ? decodeURIComponent(rawPath) : ''
        // Windows：统一比较用小写；normalize 保留真实盘符路径
        const normalizedPath = normalize(decodedPath)
        const openclawRoot = normalize(OPENCLAW_HOME)
        const mediaRoot = join(openclawRoot, 'media')

        // 允许读取范围：
        // 1) ~/.openclaw/media（历史媒体）
        // 2) 整个 ~/.openclaw（workspace / agents 产物，agent 生成文件常见于此）
        // 点击「打开文件」走 shell.openPath IPC，不经过此 handler。
        const allowed =
          decodedPath &&
          isAbsolute(normalizedPath) &&
          (normalizedPath.toLowerCase().startsWith(mediaRoot.toLowerCase()) ||
            normalizedPath.toLowerCase().startsWith(openclawRoot.toLowerCase()))

        if (!allowed) {
          log.warn('Blocked local-file request:', decodedPath)
          return new Response('Forbidden', { status: 403 })
        }

        log.debug('local-file request:', normalizedPath)
        return net.fetch(pathToFileURL(normalizedPath).toString())
      }

      const { pathname } = url
      // pathname='/' → index.html；其余去掉前导 /
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
      const filePath = join(__dirname, '../renderer', relative)
      return net.fetch(`file://${filePath}`)
    })

    // 注册所有 IPC handlers
    registerIpcHandlers()

    try {
      const weixinStatus = ensureBundledWeixinReady((line) => log.info(line))
      log.info('bundled weixin status:', weixinStatus)
    } catch (err) {
      log.warn('bundled weixin prepare failed:', err)
    }

    // 启动时应用已保存的代理设置到 Electron session
    applyElectronProxy(getSettings()).catch((err) => {
      log.warn('启动时代理设置应用失败:', err)
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    // 创建系统托盘
    if (mainWindow) {
      createTray(mainWindow)
      // 初始化自动更新（注册事件 + 延迟 10s 静默检查）
      initUpdater(mainWindow)
    }

    // 后台静默拉取远程预设（延迟 3s，不阻塞启动）
    fetchPresetsInBackground()

    // 后台自动安装 CLI wrapper（首次启动 / 应用路径变更时更新）
    // 使用 setTimeout 延迟 2s，避免与启动流程争抢资源
    setTimeout(() => {
      try {
        installCli()
        log.info('CLI wrapper 自动安装完成')
      } catch (err) {
        log.warn('CLI wrapper 自动安装失败（不影响主功能）:', err)
      }
    }, 2000)

    // 启动时执行环境检测
    detect()
      .then((result) => {
        log.info('===== Environment Detection =====')
        log.info(
          'Existing config:',
          result.existingConfig.found
            ? `valid=${result.existingConfig.valid}, providers=${result.existingConfig.hasProviders}, agents=${result.existingConfig.agentCount}`
            : 'none'
        )
        log.info(
          'Gateway:',
          result.existingGateway.running
            ? `running (port=${result.existingGateway.port}, pid=${result.existingGateway.pid})`
            : `stopped (port=${result.existingGateway.port})`
        )
        log.info('Bundled version:', result.bundledOpenclaw.version)
        log.info('=================================')
      })
      .catch((err) => {
        log.error('Environment detection failed:', err)
      })

    // macOS：点击 Dock 图标会触发 activate。
    // 点窗口关闭按钮时我们是 hide（不是 destroy），所以 getAllWindows() 仍 > 0；
    // 必须主动 show/focus 已有主窗口，否则 Dock 点击会「没反应」。
    app.on('activate', () => {
      const hasMain = BrowserWindow.getAllWindows().some(
        (w) => !w.isDestroyed() && !w.isAlwaysOnTop()
      )
      if (hasMain) {
        focusExistingMainWindow()
      } else {
        createWindow()
      }
    })
  })

  app.on('before-quit', async (e) => {
    if (isQuitting) return
    isQuitting = true

    destroyTray()
    cancelAllWeixinQrScans()

    const gw = getGatewayProcess()
    gw.stopStatusPolling()
    if (gw.getState() !== 'stopped') {
      e.preventDefault()
      log.info('stopping gateway before quit...')
      try {
        await gw.stop()
      } catch (err) {
        log.error('gateway stop on quit failed:', err)
      }
      app.quit()
    }
  })

  // macOS：所有窗口关闭时不退出（托盘驻留）
  // Windows/Linux：窗口关闭已通过 close 事件拦截，保持托盘
  app.on('window-all-closed', () => {
    // 有托盘时不退出，由托盘"退出"菜单项控制
    // macOS 例外：无托盘时遵循系统惯例
    if (process.platform === 'darwin') {
      // macOS: 保持 app 运行（Dock 图标仍在）
    }
    // Windows/Linux: 已最小化到托盘，不退出
  })
}
