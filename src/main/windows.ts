import { BrowserWindow, nativeTheme, screen, shell, systemPreferences } from 'electron'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null
const confirmWindows = new Map<string, BrowserWindow>()

/** 系统关闭透明效果时，窗口与内容层使用相同的实色底。 */
function ground(): string {
  return nativeTheme.shouldUseDarkColors ? '#202022' : '#f5f5f7'
}

function baseOptions(): Electron.BrowserWindowConstructorOptions {
  const glass = process.platform === 'darwin' && !nativeTheme.prefersReducedTransparency
  return {
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: glass ? '#00000000' : ground(),
    vibrancy: glass ? 'under-window' : undefined,
    visualEffectState: 'followWindow',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  }
}

/** 系统外观及「减少透明度」变更时，也更新已经打开的窗口。 */
export function syncWindowMaterials(): void {
  const glass = process.platform === 'darwin' && !nativeTheme.prefersReducedTransparency
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (process.platform === 'darwin') win.setVibrancy(glass ? 'under-window' : null)
    win.setBackgroundColor(glass ? '#00000000' : ground())
  }
}

function load(win: BrowserWindow, route: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(`${devUrl}#${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())
}

/** 设置窗口：默认 780×560，可自由缩放 */
export function showMainWindow(route = '/history'): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('nav', route)
    return mainWindow
  }
  mainWindow = new BrowserWindow({
    ...baseOptions(),
    width: 780,
    height: 560,
    minWidth: 640,
    minHeight: 440,
    title: '递话',
  })
  load(mainWindow, route)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  return mainWindow
}

export function showConfirmWindow(jobId: string): BrowserWindow {
  const existing = confirmWindows.get(jobId)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }
  const win = new BrowserWindow({
    ...baseOptions(),
    width: 560,
    height: 430,
    minWidth: 520,
    minHeight: 420,
    title: '递话',
  })
  load(win, `/confirm/${jobId}`)
  win.on('closed', () => confirmWindows.delete(jobId))
  confirmWindows.set(jobId, win)
  return win
}

export function resizeConfirmWindow(win: BrowserWindow | null, view: string): void {
  if (!win || win.isDestroyed() || !win.webContents.getURL().includes('#/confirm/')) return
  const sizes: Record<string, [number, number]> = { compact: [560, 430], conversation: [560, 620], content: [760, 600], options: [560, 580], done: [560, 440] }
  const size = sizes[view]
  if (!size) return
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(size[0], area.width)
  const height = Math.min(size[1], area.height)
  const x = Math.max(area.x, Math.min(bounds.x + (bounds.width - width) / 2, area.x + area.width - width))
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  win.setBounds({ x: Math.round(x), y, width, height }, !systemPreferences.getAnimationSettings().prefersReducedMotion)
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

export function hasVisibleWindows(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible())
}
