const { contextBridge, ipcRenderer } = require('electron');

// ===== Input Validation Helpers =====
function validateId(id) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid ID');
  return id.trim();
}

function validateItemInput(item) {
  if (!item || typeof item !== 'object') throw new Error('Invalid item');
  if (typeof item.type !== 'string') throw new Error('Invalid type');
  if (typeof item.title !== 'string') throw new Error('Invalid title');
  if (typeof item.content !== 'string') throw new Error('Invalid content');
  return item;
}

function validateString(val, name) {
  if (typeof val !== 'string') throw new Error(`Invalid ${name}`);
  return val;
}

// ===== Exposed API =====
contextBridge.exposeInMainWorld('vault', {
  // Items
  getItems: () => ipcRenderer.invoke('get-items'),
  addItem: (item) => ipcRenderer.invoke('add-item', validateItemInput(item)),
  updateItem: (id, updates) => ipcRenderer.invoke('update-item', validateId(id), updates),
  deleteItem: (id) => ipcRenderer.invoke('delete-item', validateId(id)),
  restoreItem: (item) => ipcRenderer.invoke('restore-item', item),
  togglePin: (id) => ipcRenderer.invoke('toggle-pin', validateId(id)),
  incrementVisit: (id) => ipcRenderer.invoke('increment-visit', validateId(id)),

  // Search (FTS5)
  searchItems: (query) => ipcRenderer.invoke('search-items', validateString(query, 'query')),

  // Tags
  getTags: () => ipcRenderer.invoke('get-tags'),
  getItemsByTag: (tag) => ipcRenderer.invoke('get-items-by-tag', validateString(tag, 'tag')),

  // Encryption
  encryptNote: (id, password) => ipcRenderer.invoke('encrypt-note', validateId(id), validateString(password, 'password')),
  decryptNote: (id, password) => ipcRenderer.invoke('decrypt-note', validateId(id), validateString(password, 'password')),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', validateString(key, 'key'), validateString(String(value), 'value')),

  // Dashboard
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Export
  exportItems: (format, filterTag) => ipcRenderer.invoke('export-items', validateString(format, 'format'), filterTag || null),

  // Window
  hideWindow: () => ipcRenderer.send('hide-window'),
  openExternal: (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      ipcRenderer.send('open-external', url);
    }
  },
  fetchTitle: (url) => ipcRenderer.invoke('fetch-title', validateString(url, 'url')),
  resizeWindow: (width, height) => {
    if (typeof width === 'number' && typeof height === 'number') {
      ipcRenderer.send('resize-window', width, height);
    }
  },

  // Events — with cleanup support
  onWindowShown: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    ipcRenderer.on('window-shown', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('window-shown', handler);
  },
});
