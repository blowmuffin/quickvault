const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

let db = null;
let stmts = {};

const SCHEMA_VERSION = 2;
const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 51200; // 50KB
const MAX_TAGS_LENGTH = 500;
const VALID_TYPES = ['link', 'note'];

// ===== Paths =====
function getDbPath() {
  return path.join(app.getPath('userData'), 'quickvault.db');
}

// ===== Backup =====
function backupDatabase() {
  try {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) return;
    const backupPath = dbPath + '.bak';
    fs.copyFileSync(dbPath, backupPath);
  } catch (err) {
    console.error('[QuickVault] Backup failed:', err.message);
  }
}

// ===== Validation Helpers =====
function validateString(val, maxLen, fieldName) {
  if (typeof val !== 'string') throw new Error(`${fieldName} must be a string`);
  if (val.length > maxLen) throw new Error(`${fieldName} exceeds max length of ${maxLen}`);
  return val.trim();
}

function validateType(type) {
  if (!VALID_TYPES.includes(type)) throw new Error(`Invalid type: ${type}`);
  return type;
}

function ensureDb() {
  if (!db) throw new Error('Database not initialized');
}

// ===== Schema Versioning =====
function getSchemaVersion() {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
  if (!tableExists) return 0;
  const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
  return row ? row.version : 0;
}

function runMigrations() {
  const currentVersion = getSchemaVersion();

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
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
      CREATE INDEX IF NOT EXISTS idx_items_tags ON items(tags);
      INSERT INTO schema_version (version, applied_at) VALUES (1, '${new Date().toISOString()}');
    `);
  }

  if (currentVersion < 2) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        title, content, tags, content=items, content_rowid=rowid
      );
      -- Populate FTS from existing data
      INSERT OR IGNORE INTO items_fts(rowid, title, content, tags)
        SELECT rowid, title, content, tags FROM items;

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, title, content, tags)
          VALUES (new.rowid, new.title, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, content, tags)
          VALUES ('delete', old.rowid, old.title, old.content, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, content, tags)
          VALUES ('delete', old.rowid, old.title, old.content, old.tags);
        INSERT INTO items_fts(rowid, title, content, tags)
          VALUES (new.rowid, new.title, new.content, new.tags);
      END;
      INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, '${new Date().toISOString()}');
    `);
  }
}

// ===== Initialize =====
function initialize() {
  backupDatabase();

  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  runMigrations();
  prepareStatements();
  migrateFromJSON();

  // Default settings
  const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertDefault.run('theme', 'dark');
  insertDefault.run('viewMode', 'expanded');

  return db;
}

function prepareStatements() {
  stmts = {
    getAll: db.prepare('SELECT * FROM items ORDER BY pinned DESC, createdAt DESC'),
    getById: db.prepare('SELECT * FROM items WHERE id = ?'),
    insert: db.prepare(`INSERT INTO items (id, type, title, content, tags, pinned, encrypted, visitCount, createdAt, updatedAt)
      VALUES (@id, @type, @title, @content, @tags, @pinned, @encrypted, @visitCount, @createdAt, @updatedAt)`),
    deleteById: db.prepare('DELETE FROM items WHERE id = ?'),
    togglePin: db.prepare('UPDATE items SET pinned = ?, updatedAt = ? WHERE id = ?'),
    incVisit: db.prepare('UPDATE items SET visitCount = visitCount + 1 WHERE id = ?'),
    getTags: db.prepare("SELECT tags FROM items WHERE tags != '' AND tags IS NOT NULL"),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
    getAllSettings: db.prepare('SELECT key, value FROM settings'),
    countAll: db.prepare('SELECT COUNT(*) as c FROM items'),
    countLinks: db.prepare("SELECT COUNT(*) as c FROM items WHERE type = 'link'"),
    countNotes: db.prepare("SELECT COUNT(*) as c FROM items WHERE type = 'note'"),
    countPinned: db.prepare('SELECT COUNT(*) as c FROM items WHERE pinned = 1'),
    countEncrypted: db.prepare('SELECT COUNT(*) as c FROM items WHERE encrypted = 1'),
    recent: db.prepare('SELECT * FROM items ORDER BY createdAt DESC LIMIT 5'),
    topVisited: db.prepare('SELECT * FROM items WHERE visitCount > 0 ORDER BY visitCount DESC LIMIT 5'),
    // Prepared update statements (avoids dynamic SQL)
    updateTitle: db.prepare('UPDATE items SET title = ?, updatedAt = ? WHERE id = ?'),
    updateContent: db.prepare('UPDATE items SET content = ?, updatedAt = ? WHERE id = ?'),
    updateTags: db.prepare('UPDATE items SET tags = ?, updatedAt = ? WHERE id = ?'),
    updateEncrypted: db.prepare('UPDATE items SET encrypted = ?, updatedAt = ? WHERE id = ?'),
    updateContentAndEncrypted: db.prepare('UPDATE items SET content = ?, encrypted = ?, updatedAt = ? WHERE id = ?'),
    // FTS search
    search: db.prepare(`
      SELECT items.* FROM items
      JOIN items_fts ON items.rowid = items_fts.rowid
      WHERE items_fts MATCH ?
      ORDER BY rank
      LIMIT 50
    `),
    // Tag-based query (SQL instead of JS filter)
    getByTagLike: db.prepare("SELECT * FROM items WHERE ',' || tags || ',' LIKE '%,' || ? || ',%' ORDER BY pinned DESC, createdAt DESC"),
  };
}

// ===== JSON Migration =====
function migrateFromJSON() {
  try {
    const jsonPath = path.join(app.getPath('userData'), 'quickvault-data.json');
    if (!fs.existsSync(jsonPath)) return;
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    let items;
    try { items = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(items) || items.length === 0) return;
    if (stmts.countAll.get().c > 0) return;

    const migrate = db.transaction((list) => {
      for (const item of list) {
        if (!item.id || !item.type || !item.title || !item.content) continue;
        stmts.insert.run({
          id: item.id, type: item.type, title: item.title,
          content: item.content, tags: '', pinned: 0, encrypted: 0,
          visitCount: 0, createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.createdAt || new Date().toISOString(),
        });
      }
    });
    migrate(items);
    fs.renameSync(jsonPath, jsonPath + '.bak');
  } catch (err) {
    console.error('[QuickVault] Migration failed:', err.message);
  }
}

// ===== CRUD =====
function addItem({ type, title, content, tags = '' }) {
  ensureDb();
  type = validateType(type);
  title = validateString(title, MAX_TITLE_LENGTH, 'title');
  content = validateString(content, MAX_CONTENT_LENGTH, 'content');
  tags = validateString(tags, MAX_TAGS_LENGTH, 'tags');

  if (!title) throw new Error('Title is required');
  if (!content) throw new Error('Content is required');

  const id = uuidv4();
  const now = new Date().toISOString();
  const item = { id, type, title, content, tags, pinned: 0, encrypted: 0, visitCount: 0, createdAt: now, updatedAt: now };
  stmts.insert.run(item);
  return item;
}

function updateItem(id, updates) {
  ensureDb();
  if (typeof id !== 'string' || !id) return null;

  const now = new Date().toISOString();
  const item = stmts.getById.get(id);
  if (!item) return null;

  const txn = db.transaction(() => {
    if ('title' in updates) {
      const t = validateString(updates.title, MAX_TITLE_LENGTH, 'title');
      stmts.updateTitle.run(t, now, id);
    }
    if ('content' in updates && 'encrypted' in updates) {
      const c = validateString(updates.content, MAX_CONTENT_LENGTH, 'content');
      stmts.updateContentAndEncrypted.run(c, updates.encrypted, now, id);
    } else {
      if ('content' in updates) {
        const c = validateString(updates.content, MAX_CONTENT_LENGTH, 'content');
        stmts.updateContent.run(c, now, id);
      }
      if ('encrypted' in updates) {
        stmts.updateEncrypted.run(updates.encrypted ? 1 : 0, now, id);
      }
    }
    if ('tags' in updates) {
      const t = validateString(updates.tags, MAX_TAGS_LENGTH, 'tags');
      stmts.updateTags.run(t, now, id);
    }
  });
  txn();
  return stmts.getById.get(id);
}

function getItem(id) {
  ensureDb();
  if (typeof id !== 'string') return null;
  return stmts.getById.get(id);
}

function deleteItem(id) {
  ensureDb();
  if (typeof id !== 'string') return false;
  stmts.deleteById.run(id);
  return true;
}

// Proper undo: re-insert with original ID and all metadata
function restoreItem(item) {
  ensureDb();
  if (!item || !item.id) return null;
  try {
    stmts.insert.run({
      id: item.id,
      type: item.type || 'note',
      title: item.title || '',
      content: item.content || '',
      tags: item.tags || '',
      pinned: item.pinned || 0,
      encrypted: item.encrypted || 0,
      visitCount: item.visitCount || 0,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    });
    return stmts.getById.get(item.id);
  } catch (err) {
    console.error('[QuickVault] Restore failed:', err.message);
    return null;
  }
}

function getAllItems() {
  ensureDb();
  return stmts.getAll.all();
}

function togglePin(id) {
  ensureDb();
  const item = getItem(id);
  if (!item) return null;
  const p = item.pinned ? 0 : 1;
  stmts.togglePin.run(p, new Date().toISOString(), id);
  return { ...item, pinned: p };
}

function incrementVisit(id) {
  ensureDb();
  if (typeof id !== 'string') return;
  stmts.incVisit.run(id);
}

// ===== Tags (SQL-based) =====
function getAllTags() {
  ensureDb();
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
  ensureDb();
  if (typeof tag !== 'string' || !tag.trim()) return [];
  return stmts.getByTagLike.all(tag.trim());
}

// ===== FTS5 Search =====
function searchItems(query) {
  ensureDb();
  if (typeof query !== 'string' || !query.trim()) return [];

  // Sanitize FTS5 query — escape special chars and add prefix matching
  const sanitized = query.trim()
    .replace(/['"{}()*:^~\-+]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `"${term}"*`)
    .join(' ');

  if (!sanitized) return [];

  try {
    return stmts.search.all(sanitized);
  } catch {
    // Fallback to LIKE search if FTS fails
    const like = `%${query.trim()}%`;
    return db.prepare('SELECT * FROM items WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? ORDER BY pinned DESC, createdAt DESC LIMIT 50')
      .all(like, like, like);
  }
}

// ===== Encryption =====
function encryptContent(content, password) {
  ensureDb();
  if (typeof content !== 'string' || !content) throw new Error('Content required');
  if (typeof password !== 'string' || !password) throw new Error('Password required');

  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(content, 'utf8', 'hex') + cipher.final('hex');
  return `${salt.toString('hex')}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

function decryptContent(data, password) {
  if (typeof data !== 'string' || typeof password !== 'string') {
    return { success: false, error: 'Invalid input' };
  }
  try {
    const parts = data.split(':');
    if (parts.length !== 4) return { success: false, error: 'Corrupted data format' };

    const [s, i, a, e] = parts;
    // Validate hex strings
    if (!/^[0-9a-f]+$/i.test(s) || !/^[0-9a-f]+$/i.test(i) || !/^[0-9a-f]+$/i.test(a)) {
      return { success: false, error: 'Corrupted data format' };
    }

    const key = crypto.pbkdf2Sync(password, Buffer.from(s, 'hex'), 100000, 32, 'sha256');
    const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(i, 'hex'));
    dec.setAuthTag(Buffer.from(a, 'hex'));
    return { success: true, content: dec.update(e, 'hex', 'utf8') + dec.final('utf8') };
  } catch {
    return { success: false, error: 'Wrong password or corrupted data' };
  }
}

// ===== Settings =====
function getSetting(key) {
  ensureDb();
  const r = stmts.getSetting.get(key);
  return r ? r.value : null;
}

function setSetting(key, value) {
  ensureDb();
  if (typeof key !== 'string' || !key) return;
  stmts.setSetting.run(key, String(value));
}

function getAllSettings() {
  ensureDb();
  const rows = stmts.getAllSettings.all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ===== Stats =====
function getStats() {
  ensureDb();
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

// ===== Export =====
function exportItems(format, filterTag = null) {
  ensureDb();
  const items = filterTag ? getItemsByTag(filterTag) : getAllItems();

  if (format === 'json') return JSON.stringify(items, null, 2);

  if (format === 'markdown') {
    const lines = ['# QuickVault Export', '', `> Exported on ${new Date().toLocaleDateString()}`, ''];
    const links = items.filter(i => i.type === 'link');
    const notes = items.filter(i => i.type === 'note');
    if (links.length) {
      lines.push('## 🔗 Links', '');
      links.forEach(l => {
        const tagStr = l.tags ? ' — ' + l.tags.split(',').map(t => '`#' + t.trim() + '`').join(' ') : '';
        lines.push(`- [${l.title}](${l.content})${tagStr}`);
      });
      lines.push('');
    }
    if (notes.length) {
      lines.push('## 📝 Notes', '');
      notes.forEach(n => {
        lines.push(`### ${n.title}`);
        lines.push(n.encrypted ? '🔒 *Encrypted*' : n.content);
        if (n.tags) lines.push('Tags: ' + n.tags.split(',').map(t => '`#' + t.trim() + '`').join(' '));
        lines.push('');
      });
    }
    return lines.join('\n');
  }

  if (format === 'html') {
    const links = items.filter(i => i.type === 'link');
    const notes = items.filter(i => i.type === 'note');
    const tagsHtml = (tags) => tags ? tags.split(',').map(t => `<span class="tag">#${t.trim()}</span>`).join('') : '';
    let h = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>QuickVault Export</title><style>body{font-family:'Segoe UI',system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#0f0f1e;color:#e8e8f0}h1{color:#8b5cf6}h2{color:#818cf8;margin-top:30px}a{color:#818cf8}.tag{background:rgba(139,92,246,.2);color:#a78bfa;padding:2px 8px;border-radius:12px;font-size:12px;margin-left:6px}.item{background:rgba(35,35,65,.6);padding:14px 18px;border-radius:10px;margin:8px 0;border:1px solid rgba(255,255,255,.06)}.pinned{border-left:3px solid #8b5cf6}</style></head><body><h1>📌 QuickVault Export</h1><p style="color:rgba(200,200,220,.6)">Exported on ${new Date().toLocaleDateString()}</p>`;
    if (links.length) {
      h += '<h2>🔗 Links</h2>';
      links.forEach(l => { h += `<div class="item${l.pinned ? ' pinned' : ''}"><a href="${l.content}" target="_blank">${l.title}</a><div style="color:rgba(200,200,220,.6);font-size:14px;margin-top:6px">${l.content}</div>${tagsHtml(l.tags) ? '<div>' + tagsHtml(l.tags) + '</div>' : ''}</div>`; });
    }
    if (notes.length) {
      h += '<h2>📝 Notes</h2>';
      notes.forEach(n => { h += `<div class="item${n.pinned ? ' pinned' : ''}"><div style="font-weight:600">${n.title}</div><div style="color:rgba(200,200,220,.6);font-size:14px;margin-top:6px">${n.encrypted ? '🔒 Encrypted' : n.content}</div>${tagsHtml(n.tags) ? '<div>' + tagsHtml(n.tags) + '</div>' : ''}</div>`; });
    }
    return h + '</body></html>';
  }

  return JSON.stringify(items, null, 2);
}

// ===== Lifecycle =====
function close() {
  if (db) {
    try { db.close(); } catch (err) { console.error('[QuickVault] DB close error:', err.message); }
    db = null;
    stmts = {};
  }
}

function getDatabaseSize() {
  try {
    const stat = fs.statSync(getDbPath());
    return stat.size;
  } catch { return 0; }
}

module.exports = {
  initialize, addItem, updateItem, getItem, deleteItem, restoreItem,
  getAllItems, togglePin, incrementVisit, getAllTags, getItemsByTag,
  searchItems, encryptContent, decryptContent,
  getSetting, setSetting, getAllSettings, getStats,
  exportItems, close, getDatabaseSize,
};
