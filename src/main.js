const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, net, shell, dialog, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database');

let mainWindow = null;
let tray = null;
let isDialogOpen = false;

// ===== Single Instance Lock (must be before app.whenReady) =====
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) toggleWindow();
  });
}

// Reduce memory: disable GPU compositing
app.commandLine.appendSwitch('disable-gpu-compositing');

// ===== IPC Rate Limiter =====
const ipcCallCounts = new Map();
const IPC_RATE_LIMIT = 60; // calls per second per channel

function checkRateLimit(channel) {
  const now = Date.now();
  const key = channel;
  const entry = ipcCallCounts.get(key);
  if (!entry || now - entry.timestamp > 1000) {
    ipcCallCounts.set(key, { timestamp: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > IPC_RATE_LIMIT) return false;
  return true;
}

// Wrap IPC handler with error boundary and rate limiting
function safeHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!checkRateLimit(channel)) {
      return { success: false, error: 'Rate limit exceeded' };
    }
    try {
      return await handler(event, ...args);
    } catch (err) {
      console.error(`[QuickVault] IPC error on '${channel}':`, err.message);
      return { success: false, error: err.message };
    }
  });
}

// ===== Window =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640, height: 580,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  // Don't hide on blur when a dialog is open
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !isDialogOpen) {
      mainWindow.hide();
    }
  });
}

// ===== Security: CSP & Permissions =====
function setupSecurity() {
  // Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'"
        ],
      },
    });
  });

  // Deny all permission requests (camera, mic, geolocation, etc.)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });

  // Block navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Block new windows
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ===== Toggle Window =====
function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y, width, height } = display.workArea;
    const [winW, winH] = mainWindow.getSize();
    mainWindow.setPosition(
      Math.round(x + (width - winW) / 2),
      Math.round(y + (height - winH) / 2)
    );
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('window-shown');
  }
}

// ===== Tray =====
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('QuickVault — Ctrl+Shift+Space');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show QuickVault', click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; database.close(); app.quit(); } },
  ]));
  tray.on('click', () => toggleWindow());
}

// ===== Hotkey =====
function registerShortcut() {
  const success = globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);
  if (!success) {
    console.error('[QuickVault] Failed to register global shortcut');
    if (Notification.isSupported()) {
      new Notification({
        title: 'QuickVault',
        body: 'Ctrl+Shift+Space is already in use by another app. Right-click the tray icon to open.',
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      }).show();
    }
  }
}

// ===== Fetch Page Title =====
const titleCache = new Map();
const TITLE_CACHE_TTL = 30000; // 30 seconds

async function fetchPageTitle(url) {
  // Check cache
  const cached = titleCache.get(url);
  if (cached && Date.now() - cached.timestamp < TITLE_CACHE_TTL) {
    return cached.title;
  }

  return new Promise((resolve) => {
    try {
      const request = net.request(url);
      let body = '';
      request.on('response', (res) => {
        // Skip non-HTML responses
        const contentType = res.headers['content-type'];
        if (contentType && Array.isArray(contentType)) {
          const ct = contentType[0] || '';
          if (!ct.includes('text/html') && !ct.includes('text/xml')) {
            request.abort();
            resolve(null);
            return;
          }
        }
        res.on('data', (chunk) => {
          body += chunk.toString();
          if (body.length > 16384) request.abort(); // 16KB limit
        });
        res.on('end', () => {
          // Multi-line title regex
          const m = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = m ? m[1].replace(/\s+/g, ' ').trim() : null;
          if (title) titleCache.set(url, { title, timestamp: Date.now() });
          resolve(title);
        });
      });
      request.on('error', () => resolve(null));
      request.setTimeout(5000, () => { request.abort(); resolve(null); });
      request.end();
    } catch {
      resolve(null);
    }
  });
}

// ===== URL Validation =====
function isValidExternalUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// ===== IPC Setup =====
function setupIPC() {
  // Items
  safeHandle('get-items', () => database.getAllItems());
  safeHandle('add-item', (_, item) => database.addItem(item));
  safeHandle('update-item', (_, id, updates) => database.updateItem(id, updates));
  safeHandle('delete-item', (_, id) => database.deleteItem(id));
  safeHandle('restore-item', (_, item) => database.restoreItem(item));
  safeHandle('toggle-pin', (_, id) => database.togglePin(id));
  safeHandle('increment-visit', (_, id) => { database.incrementVisit(id); return true; });

  // Search (FTS5)
  safeHandle('search-items', (_, query) => database.searchItems(query));

  // Tags
  safeHandle('get-tags', () => database.getAllTags());
  safeHandle('get-items-by-tag', (_, tag) => database.getItemsByTag(tag));

  // Encryption (transactional in database layer)
  safeHandle('encrypt-note', (_, id, pw) => {
    const item = database.getItem(id);
    if (!item) return { success: false, error: 'Not found' };
    if (item.encrypted) return { success: false, error: 'Already encrypted' };
    const encrypted = database.encryptContent(item.content, pw);
    database.updateItem(id, { content: encrypted, encrypted: 1 });
    return { success: true };
  });

  safeHandle('decrypt-note', (_, id, pw) => {
    const item = database.getItem(id);
    if (!item) return { success: false, error: 'Not found' };
    if (!item.encrypted) return { success: false, error: 'Not encrypted' };
    const result = database.decryptContent(item.content, pw);
    if (result.success) database.updateItem(id, { content: result.content, encrypted: 0 });
    return result;
  });

  // Settings
  safeHandle('get-settings', () => database.getAllSettings());
  safeHandle('set-setting', (_, k, v) => { database.setSetting(k, v); return true; });

  // Stats
  safeHandle('get-stats', () => database.getStats());

  // Title fetch
  safeHandle('fetch-title', async (_, url) => {
    if (!isValidExternalUrl(url)) return null;
    return fetchPageTitle(url);
  });

  // Export — async file write
  safeHandle('export-items', async (_, format, filterTag) => {
    isDialogOpen = true;
    try {
      const content = database.exportItems(format, filterTag);
      const ext = { json: 'json', markdown: 'md', html: 'html' }[format] || 'json';
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export QuickVault Data',
        defaultPath: `quickvault-export.${ext}`,
        filters: [{ name: `${format.toUpperCase()} File`, extensions: [ext] }],
      });
      if (!result.canceled && result.filePath) {
        await fs.promises.writeFile(result.filePath, content, 'utf-8');
        return { success: true, path: result.filePath };
      }
      return { success: false };
    } finally {
      isDialogOpen = false;
    }
  });

  // Window controls
  ipcMain.on('hide-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });

  ipcMain.on('open-external', (_, url) => {
    if (isValidExternalUrl(url)) shell.openExternal(url);
  });

  ipcMain.on('resize-window', (_, w, h) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Clamp to reasonable bounds
    const cw = Math.max(320, Math.min(1920, w));
    const ch = Math.max(200, Math.min(1080, h));
    mainWindow.setSize(cw, ch, true);
    mainWindow.center();
  });
}

// ===== App Lifecycle =====
app.whenReady().then(() => {
  database.initialize();
  createWindow();
  setupSecurity();
  createTray();
  registerShortcut();
  setupIPC();
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ['--hidden'] });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  database.close();
});

app.on('window-all-closed', () => {});

// ===== Global Error Handlers =====
process.on('uncaughtException', (err) => {
  console.error('[QuickVault] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[QuickVault] Unhandled rejection:', err);
});
