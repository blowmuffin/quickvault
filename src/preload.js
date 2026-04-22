const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vault', {
  // Items
  getItems: () => ipcRenderer.invoke('get-items'),
  addItem: (item) => ipcRenderer.invoke('add-item', item),
  updateItem: (id, updates) => ipcRenderer.invoke('update-item', id, updates),
  deleteItem: (id) => ipcRenderer.invoke('delete-item', id),
  searchItems: (query) => ipcRenderer.invoke('search-items', query),
  togglePin: (id) => ipcRenderer.invoke('toggle-pin', id),
  incrementVisit: (id) => ipcRenderer.invoke('increment-visit', id),

  // Tags
  getTags: () => ipcRenderer.invoke('get-tags'),
  getItemsByTag: (tag) => ipcRenderer.invoke('get-items-by-tag', tag),

  // Encryption
  encryptNote: (id, password) => ipcRenderer.invoke('encrypt-note', id, password),
  decryptNote: (id, password) => ipcRenderer.invoke('decrypt-note', id, password),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),

  // Dashboard
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Export
  exportItems: (format, filterTag) => ipcRenderer.invoke('export-items', format, filterTag),

  // Window
  hideWindow: () => ipcRenderer.send('hide-window'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  fetchTitle: (url) => ipcRenderer.invoke('fetch-title', url),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),

  // Events
  onWindowShown: (callback) => ipcRenderer.on('window-shown', callback),
});
