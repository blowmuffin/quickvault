const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, net, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database');

let mainWindow = null;
let tray = null;
let isDialogOpen = false;

// Reduce memory: disable GPU if not needed
app.commandLine.appendSwitch('disable-gpu-compositing');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640, height: 580,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  // BUG-6 FIX: Don't hide on blur when a dialog is open
  mainWindow.on('blur', () => {
    if (mainWindow.isVisible() && !isDialogOpen) mainWindow.hide();
  });
}

// BUG-10 FIX: Center on the monitor where cursor is
function toggleWindow() {
  if (!mainWindow) return;
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

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let trayIcon;
  try { trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }); }
  catch { trayIcon = nativeImage.createEmpty(); }

  tray = new Tray(trayIcon);
  tray.setToolTip('QuickVault — Ctrl+Shift+Space');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show QuickVault', click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; database.close(); app.quit(); } },
  ]));
  tray.on('click', () => toggleWindow());
}

// BUG-1 FIX: Notify user if hotkey fails
function registerShortcut() {
  const success = globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);
  if (!success) {
    console.error('Failed to register global shortcut');
    if (Notification.isSupported()) {
      new Notification({
        title: 'QuickVault',
        body: 'Ctrl+Shift+Space is already in use by another app. Right-click the tray icon to open.',
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      }).show();
    }
  }
}

async function fetchPageTitle(url) {
  return new Promise((resolve) => {
    try {
      const request = net.request(url);
      let body = '';
      request.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); if (body.length > 10240) request.abort(); });
        res.on('end', () => { const m = body.match(/<title[^>]*>([^<]+)<\/title>/i); resolve(m ? m[1].trim() : null); });
      });
      request.on('error', () => resolve(null));
      request.setTimeout(5000, () => { request.abort(); resolve(null); });
      request.end();
    } catch { resolve(null); }
  });
}

function setupIPC() {
  ipcMain.handle('get-items', () => database.getAllItems());
  ipcMain.handle('add-item', (_, item) => database.addItem(item));
  ipcMain.handle('update-item', (_, id, updates) => database.updateItem(id, updates));
  ipcMain.handle('delete-item', (_, id) => database.deleteItem(id));
  ipcMain.handle('toggle-pin', (_, id) => database.togglePin(id));
  ipcMain.handle('increment-visit', (_, id) => { database.incrementVisit(id); return true; });
  ipcMain.handle('get-tags', () => database.getAllTags());
  ipcMain.handle('get-items-by-tag', (_, tag) => database.getItemsByTag(tag));

  ipcMain.handle('encrypt-note', (_, id, pw) => {
    const item = database.getItem(id);
    if (!item) return { success: false, error: 'Not found' };
    database.updateItem(id, { content: database.encryptContent(item.content, pw), encrypted: 1 });
    return { success: true };
  });

  ipcMain.handle('decrypt-note', (_, id, pw) => {
    const item = database.getItem(id);
    if (!item) return { success: false, error: 'Not found' };
    const result = database.decryptContent(item.content, pw);
    if (result.success) database.updateItem(id, { content: result.content, encrypted: 0 });
    return result;
  });

  ipcMain.handle('get-settings', () => database.getAllSettings());
  ipcMain.handle('set-setting', (_, k, v) => { database.setSetting(k, v); return true; });
  ipcMain.handle('get-stats', () => database.getStats());
  ipcMain.handle('fetch-title', async (_, url) => fetchPageTitle(url));

  // BUG-6 FIX: Flag dialog open to prevent blur-hide
  ipcMain.handle('export-items', async (_, format, filterTag) => {
    isDialogOpen = true;
    const content = database.exportItems(format, filterTag);
    const ext = { json: 'json', markdown: 'md', html: 'html' }[format] || 'json';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export QuickVault Data',
      defaultPath: `quickvault-export.${ext}`,
      filters: [{ name: `${format.toUpperCase()} File`, extensions: [ext] }],
    });
    isDialogOpen = false;
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  ipcMain.on('hide-window', () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.on('open-external', (_, url) => {
    if (url && /^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('resize-window', (_, w, h) => {
    if (mainWindow) { mainWindow.setSize(w, h, true); mainWindow.center(); }
  });
}

app.whenReady().then(() => {
  database.initialize();
  createWindow();
  createTray();
  registerShortcut();
  setupIPC();
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ['--hidden'] });
  }
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); database.close(); });
app.on('window-all-closed', () => {});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }
else { app.on('second-instance', () => { if (mainWindow) toggleWindow(); }); }
