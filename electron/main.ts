import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { MainRuntime } from './rpc/runtime';

/**
 * In development the Angular dev server is used so we get HMR and source maps.
 * In production the app loads the static build from `dist/renderer`.
 */
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];
const isDev = Boolean(DEV_SERVER_URL);
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

/** Keeps the first paint close to the app background (see src/styles.css). */
const FALLBACK_BACKGROUND = '#0b0d12';
/** Transparent page background so the OS material (Mica / vibrancy) can show through. */
const TRANSPARENT_BACKGROUND = '#00000000';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false, // avoid the white flash, show once the renderer is ready
    title: 'Timmy',
    // The icon is only needed while running from source; packaged apps use the
    // executable / bundle icon configured in electron-builder.yml.
    icon: app.isPackaged ? undefined : path.join(__dirname, '../docs/assets/img/icon.png'),
    backgroundColor: isWindows || isMac ? TRANSPARENT_BACKGROUND : FALLBACK_BACKGROUND,
    // Windows 11 (22H2+) system backdrop. Ignored on older Windows versions.
    ...(isWindows ? { backgroundMaterial: 'mica' as const } : {}),
    // macOS translucent material behind the window.
    ...(isMac
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const, transparent: true }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security defaults: renderer has no Node access and runs in its own context.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in the user's default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block navigation away from the renderer we control.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigin = DEV_SERVER_URL ?? 'file://';
    if (!url.startsWith(allowedOrigin)) {
      event.preventDefault();
    }
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }
}

// Only a single instance of the app may run; focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    // Groups the app under one taskbar entry and enables Windows notifications.
    if (isWindows) {
      app.setAppUserModelId('com.timmy.app');
    }

    registerIpc();

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('before-quit', () => {
    void MainRuntime.dispose();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
