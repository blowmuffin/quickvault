const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

let db = null;
let stmts = {};

function getDbPath() {
  return path.join(app.getPath('userData'), 'quickvault.db');
}

function initialize() {
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('link', 'note')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      encrypted INTEGER DEFAULT 0,
      visitCount INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_items_pinned ON items(pinned);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
    CREATE INDEX IF NOT EXISTS idx_items_created ON items(createdAt DESC);
  `);

  // Prepared statements for hot paths
  stmts = {
    getAll: db.prepare('SELECT * FROM items ORDER BY pinned DESC, createdAt DESC'),
    getById: db.prepare('SELECT * FROM items WHERE id = ?'),
    insert: db.prepare('INSERT INTO items (id,type,title,content,tags,pinned,encrypted,visitCount,createdAt,updatedAt) VALUES (?,?,?,?,?,0,0,0,?,?)'),
    deleteById: db.prepare('DELETE FROM items WHERE id = ?'),
    togglePin: db.prepare('UPDATE items SET pinned = ?, updatedAt = ? WHERE id = ?'),
    incVisit: db.prepare('UPDATE items SET visitCount = visitCount + 1 WHERE id = ?'),
    getTags: db.prepare("SELECT tags FROM items WHERE tags != ''"),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
    countAll: db.prepare('SELECT COUNT(*) as c FROM items'),
    countLinks: db.prepare("SELECT COUNT(*) as c FROM items WHERE type = 'link'"),
    countNotes: db.prepare("SELECT COUNT(*) as c FROM items WHERE type = 'note'"),
    countPinned: db.prepare('SELECT COUNT(*) as c FROM items WHERE pinned = 1'),
    countEncrypted: db.prepare('SELECT COUNT(*) as c FROM items WHERE encrypted = 1'),
    recent: db.prepare('SELECT * FROM items ORDER BY createdAt DESC LIMIT 5'),
    topVisited: db.prepare('SELECT * FROM items WHERE visitCount > 0 ORDER BY visitCount DESC LIMIT 5'),
  };

  migrateFromJSON();

  // Default settings
  const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertDefault.run('theme', 'dark');
  insertDefault.run('viewMode', 'expanded');

  return db;
}

function migrateFromJSON() {
  try {
    const jsonPath = path.join(app.getPath('userData'), 'quickvault-data.json');
    if (!fs.existsSync(jsonPath)) return;
    const items = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (!Array.isArray(items) || items.length === 0) return;
    if (stmts.countAll.get().c > 0) return;

    const migrate = db.transaction((items) => {
      for (const item of items) {
        stmts.insert.run(item.id, item.type, item.title, item.content, '', item.createdAt, item.createdAt);
      }
    });
    migrate(items);
    fs.renameSync(jsonPath, jsonPath + '.bak');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// CRUD
function addItem({ type, title, content, tags = '' }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  stmts.insert.run(id, type, title, content, tags, now, now);
  return { id, type, title, content, tags, pinned: 0, encrypted: 0, visitCount: 0, createdAt: now, updatedAt: now };
}

function updateItem(id, updates) {
  const fields = [], values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (['title', 'content', 'tags', 'pinned', 'encrypted', 'visitCount'].includes(k)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (!fields.length) return null;
  fields.push('updatedAt = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return stmts.getById.get(id);
}

function getItem(id) { return stmts.getById.get(id); }
function deleteItem(id) { stmts.deleteById.run(id); return true; }
function getAllItems() { return stmts.getAll.all(); }

function togglePin(id) {
  const item = getItem(id);
  if (!item) return null;
  const p = item.pinned ? 0 : 1;
  stmts.togglePin.run(p, new Date().toISOString(), id);
  return { ...item, pinned: p };
}

function incrementVisit(id) { stmts.incVisit.run(id); }

function getAllTags() {
  const rows = stmts.getTags.all();
  const tc = {};
  for (const r of rows) {
    for (const t of r.tags.split(',').map(s => s.trim()).filter(Boolean)) {
      tc[t] = (tc[t] || 0) + 1;
    }
  }
  return Object.entries(tc).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function getItemsByTag(tag) {
  return getAllItems().filter(i => i.tags && i.tags.split(',').map(s => s.trim()).includes(tag));
}

// Encryption
function encryptContent(content, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(content, 'utf8', 'hex') + cipher.final('hex');
  return `${salt.toString('hex')}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

function decryptContent(data, password) {
  try {
    const [s, i, a, e] = data.split(':');
    const key = crypto.pbkdf2Sync(password, Buffer.from(s, 'hex'), 100000, 32, 'sha256');
    const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(i, 'hex'));
    dec.setAuthTag(Buffer.from(a, 'hex'));
    return { success: true, content: dec.update(e, 'hex', 'utf8') + dec.final('utf8') };
  } catch { return { success: false, error: 'Wrong password or corrupted data' }; }
}

// Settings
function getSetting(key) { const r = stmts.getSetting.get(key); return r ? r.value : null; }
function setSetting(key, value) { stmts.setSetting.run(key, value); }
function getAllSettings() {
  const rows = db.prepare('SELECT * FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// Stats
function getStats() {
  return {
    total: stmts.countAll.get().c,
    links: stmts.countLinks.get().c,
    notes: stmts.countNotes.get().c,
    pinned: stmts.countPinned.get().c,
    encrypted: stmts.countEncrypted.get().c,
    tags: getAllTags(),
    recentItems: stmts.recent.all(),
    topVisited: stmts.topVisited.all(),
  };
}

// Export
function exportItems(format, filterTag = null) {
  const items = filterTag ? getItemsByTag(filterTag) : getAllItems();
  if (format === 'json') return JSON.stringify(items, null, 2);
  if (format === 'markdown') {
    let md = '# QuickVault Export\n\n> Exported on ' + new Date().toLocaleDateString() + '\n\n';
    const links = items.filter(i => i.type === 'link'), notes = items.filter(i => i.type === 'note');
    if (links.length) { md += '## 🔗 Links\n\n'; links.forEach(l => { md += `- [${l.title}](${l.content})${l.tags ? ' — ' + l.tags.split(',').map(t => '`#' + t.trim() + '`').join(' ') : ''}\n`; }); md += '\n'; }
    if (notes.length) { md += '## 📝 Notes\n\n'; notes.forEach(n => { md += `### ${n.title}\n${n.encrypted ? '🔒 *Encrypted*' : n.content}\n${n.tags ? 'Tags: ' + n.tags.split(',').map(t => '`#' + t.trim() + '`').join(' ') + '\n' : ''}\n`; }); }
    return md;
  }
  if (format === 'html') {
    const links = items.filter(i => i.type === 'link'), notes = items.filter(i => i.type === 'note');
    let h = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>QuickVault Export</title><style>body{font-family:'Segoe UI',sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#0f0f1e;color:#e8e8f0}h1{color:#8b5cf6}h2{color:#818cf8;margin-top:30px}a{color:#818cf8}.tag{background:rgba(139,92,246,.2);color:#a78bfa;padding:2px 8px;border-radius:12px;font-size:12px;margin-left:6px}.item{background:rgba(35,35,65,.6);padding:14px 18px;border-radius:10px;margin:8px 0;border:1px solid rgba(255,255,255,.06)}.pinned{border-left:3px solid #8b5cf6}</style></head><body><h1>📌 QuickVault Export</h1><p style="color:rgba(200,200,220,.6)">Exported on ${new Date().toLocaleDateString()}</p>`;
    if (links.length) { h += '<h2>🔗 Links</h2>'; links.forEach(l => { h += `<div class="item${l.pinned ? ' pinned' : ''}"><div><a href="${l.content}" target="_blank">${l.title}</a></div><div style="color:rgba(200,200,220,.6);font-size:14px;margin-top:6px">${l.content}</div>${l.tags ? '<div>' + l.tags.split(',').map(t => '<span class="tag">#' + t.trim() + '</span>').join('') + '</div>' : ''}</div>`; }); }
    if (notes.length) { h += '<h2>📝 Notes</h2>'; notes.forEach(n => { h += `<div class="item${n.pinned ? ' pinned' : ''}"><div style="font-weight:600">${n.title}</div><div style="color:rgba(200,200,220,.6);font-size:14px;margin-top:6px">${n.encrypted ? '🔒 Encrypted' : n.content}</div>${n.tags ? '<div>' + n.tags.split(',').map(t => '<span class="tag">#' + t.trim() + '</span>').join('') + '</div>' : ''}</div>`; }); }
    return h + '</body></html>';
  }
  return JSON.stringify(items, null, 2);
}

function close() { if (db) db.close(); }

module.exports = { initialize, addItem, updateItem, getItem, deleteItem, getAllItems, togglePin, incrementVisit, getAllTags, getItemsByTag, encryptContent, decryptContent, getSetting, setSetting, getAllSettings, getStats, exportItems, close };
