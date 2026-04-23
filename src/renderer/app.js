// ===== DOM =====
const $ = (s) => document.getElementById(s);
const mainInput = $('mainInput');
const inputBadge = $('inputBadge');
const itemsList = $('itemsList');
const emptyState = $('emptyState');
const itemCount = $('itemCount');
const tagBar = $('tagBar');
const appContainer = $('appContainer');
const dashboardView = $('dashboardView');
const itemsView = $('itemsView');
const dashGrid = $('dashGrid');
const exportModal = $('exportModal');
const passwordModal = $('passwordModal');
const passwordInput = $('passwordInput');
const passwordHint = $('passwordHint');
const passwordModalTitle = $('passwordModalTitle');
const editModal = $('editModal');
const editTitle = $('editTitle');
const editContent = $('editContent');
const editTags = $('editTags');
const undoToast = $('undoToast');
const errorToast = $('errorToast');
const loadingSkeleton = $('loadingSkeleton');

// ===== State =====
let allItems = [];
let filteredItems = [];
let activeTag = 'all';
let searchTimeout = null;
let isSearchMode = false;
let isDashboardView = false;
let currentTheme = 'dark';
let viewMode = 'expanded';
let pendingEncryptId = null;
let pendingDecryptId = null;
let editingId = null;
let selectedIndex = -1;
let undoItem = null;
let undoTimer = null;
let errorToastTimer = null;
let cleanupWindowShown = null;
const actionDebounce = new Map();

const TAG_COLORS = 8;

// ===== Error Toast =====
function showError(msg) {
  if (!errorToast) return;
  errorToast.querySelector('.error-toast-msg').textContent = msg;
  errorToast.classList.remove('hidden');
  clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(hideError, 4000);
}
function hideError() {
  if (errorToast) errorToast.classList.add('hidden');
  clearTimeout(errorToastTimer);
}

// ===== Debounce helper for action buttons =====
function debounceAction(key, fn, ms = 500) {
  if (actionDebounce.has(key)) return;
  actionDebounce.set(key, true);
  setTimeout(() => actionDebounce.delete(key), ms);
  fn();
}

// BUG-8 FIX: Hash-based stable tag color
function getTagColor(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  return Math.abs(hash) % TAG_COLORS;
}

// ===== Init =====
async function init() {
  try {
    if (loadingSkeleton) loadingSkeleton.classList.remove('hidden');
    const settings = await window.vault.getSettings();
    currentTheme = settings.theme || 'dark';
    viewMode = settings.viewMode || 'expanded';
    applyTheme(currentTheme);
    applyViewMode(viewMode);
    await loadAllItems();
    await loadTags();
  } catch (err) {
    showError('Failed to initialize: ' + err.message);
  } finally {
    if (loadingSkeleton) loadingSkeleton.classList.add('hidden');
    mainInput.focus();
  }
}

// ===== Theme =====
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  currentTheme = theme;
  $('themeIcon').innerHTML = theme === 'dark'
    ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}
function applyViewMode(mode) {
  viewMode = mode;
  appContainer.classList.toggle('compact', mode === 'compact');
}

// ===== URL Detection =====
function isURL(t) { return /^https?:\/\//i.test(t.trim()) || /^www\./i.test(t.trim()); }
function normalizeURL(t) { t = t.trim(); return /^www\./i.test(t) ? 'https://' + t : t; }

// ===== Tags =====
function parseTags(text) {
  const tags = [];
  const clean = text.replace(/#([a-zA-Z][\w-]*)/g, (_, t) => { tags.push(t.toLowerCase()); return ''; });
  return { text: clean.trim(), tags: [...new Set(tags)] };
}

async function loadTags() {
  try {
    const tags = await window.vault.getTags();
    tagBar.innerHTML = '<button class="tag-pill active" data-tag="all">All</button>';
    tags.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'tag-pill';
      btn.dataset.tag = t.name;
      btn.innerHTML = `#${t.name}<span class="tag-count">${t.count}</span>`;
      tagBar.appendChild(btn);
    });
    tagBar.querySelectorAll('.tag-pill').forEach(p => p.addEventListener('click', () => filterByTag(p.dataset.tag)));
  } catch (err) {
    showError('Failed to load tags: ' + err.message);
  }
}

function filterByTag(tag) {
  activeTag = tag;
  selectedIndex = -1;
  tagBar.querySelectorAll('.tag-pill').forEach(p => p.classList.toggle('active', p.dataset.tag === tag));
  filteredItems = tag === 'all' ? [...allItems] : allItems.filter(i => i.tags && i.tags.split(',').map(s => s.trim()).includes(tag));
  renderItems(filteredItems);
}

// ===== Badge =====
function updateInputBadge(v) {
  if (!v.trim()) { inputBadge.classList.remove('visible'); inputBadge.innerHTML = ''; return; }
  inputBadge.classList.add('visible');
  inputBadge.innerHTML = isURL(v) ? '<span class="badge badge-link">Link</span>' : '<span class="badge badge-note">Note</span>';
}

// ===== Time =====
function formatTime(iso) {
  const ms = Date.now() - new Date(iso);
  const m = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), d = Math.floor(ms / 86400000);
  if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`; if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ===== Render =====
function renderItems(items) {
  itemCount.textContent = allItems.length;
  selectedIndex = -1;
  if (!items.length && !isSearchMode) { emptyState.classList.remove('hidden'); itemsList.innerHTML = ''; return; }
  emptyState.classList.add('hidden');
  if (!items.length && isSearchMode) { itemsList.innerHTML = '<div class="search-no-results">No matching items</div>'; return; }

  const pinned = items.filter(i => i.pinned), unpinned = items.filter(i => !i.pinned);
  let html = '';
  if (pinned.length) {
    html += '<div class="section-divider">📌 Pinned</div>';
    html += pinned.map(renderCard).join('');
    if (unpinned.length) html += '<div class="section-divider">All Items</div>';
  }
  html += unpinned.map(renderCard).join('');
  itemsList.innerHTML = html;
}

function renderCard(item) {
  const isLink = item.type === 'link';
  const linkSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  const noteSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

  const cls = ['item-card', isLink ? 'link-card' : 'note-card'];
  if (item.pinned) cls.push('pinned-card');
  if (item.encrypted) cls.push('encrypted-card');

  const titleText = item.encrypted ? '🔒 Encrypted note' : esc(item.title);
  let tagsHtml = '';
  if (item.tags) {
    tagsHtml = `<div class="item-tags">${item.tags.split(',').filter(Boolean).map(t =>
      `<span class="item-tag tag-color-${getTagColor(t.trim())}" data-tag-click="${esc(t.trim())}">#${esc(t.trim())}</span>`
    ).join('')}</div>`;
  }

  const urlHtml = isLink && !item.encrypted ? `<div class="item-url">${esc(item.content)}</div>` : '';
  const encBadge = item.encrypted ? '<span class="encrypted-badge">🔒 encrypted</span>' : '';
  const visits = item.visitCount > 0 ? `<span class="item-visits">${item.visitCount} visits</span>` : '';
  const pinFill = item.pinned ? 'var(--pin-color)' : 'none';

  return `<div class="${cls.join(' ')}" data-id="${item.id}">
    <div class="item-type-icon ${item.type}">${isLink ? linkSvg : noteSvg}</div>
    <div class="item-content">
      <div class="item-title" ${isLink ? `data-url="${esc(item.content)}"` : ''}>${titleText}</div>
      ${urlHtml}${tagsHtml}
      <div class="item-meta"><div class="item-time">${formatTime(item.createdAt)}</div>${visits}${encBadge}</div>
    </div>
    <div class="item-actions">
      <button class="action-btn pin ${item.pinned ? 'is-pinned' : ''}" data-action="pin" aria-label="Pin item" title="Pin">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${pinFill}" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </button>
      <button class="action-btn edit" data-action="edit" aria-label="Edit item" title="Edit">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      ${item.type === 'note' ? `<button class="action-btn encrypt" data-action="encrypt" aria-label="${item.encrypted ? 'Decrypt' : 'Encrypt'}" title="${item.encrypted ? 'Decrypt' : 'Encrypt'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </button>` : ''}
      <button class="action-btn copy" data-action="copy" aria-label="Copy item" title="Copy">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="action-btn delete" data-action="delete" aria-label="Delete item" title="Delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  </div>`;
}

// ===== Event Delegation (BUG-3 FIX) =====
itemsList.addEventListener('click', (e) => {
  const card = e.target.closest('.item-card');
  if (!card) return;
  const id = card.dataset.id;
  const tagEl = e.target.closest('[data-tag-click]');
  if (tagEl) { filterByTag(tagEl.dataset.tagClick); return; }
  const titleEl = e.target.closest('.item-title[data-url]');
  if (titleEl) {
    window.vault.openExternal(titleEl.dataset.url);
    window.vault.incrementVisit(id);
    return;
  }
  const actionBtn = e.target.closest('[data-action]');
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  debounceAction(`${action}-${id}`, () => {
    if (action === 'pin') togglePin(id);
    else if (action === 'edit') openEditModal(id);
    else if (action === 'encrypt') handleEncrypt(id);
    else if (action === 'copy') copyItem(id, actionBtn);
    else if (action === 'delete') deleteItem(id);
  });
});

// ===== Actions =====
async function loadAllItems() {
  try {
    allItems = await window.vault.getItems();
    filteredItems = activeTag === 'all' ? [...allItems] : allItems.filter(i => i.tags && i.tags.split(',').map(s => s.trim()).includes(activeTag));
    renderItems(filteredItems);
  } catch (err) {
    showError('Failed to load items: ' + err.message);
  }
}

async function addNewItem() {
  const raw = mainInput.value.trim();
  if (!raw) return;
  const { text, tags } = parseTags(raw);
  let type, title, content;

  try {
    if (isURL(text || raw)) {
      type = 'link'; content = normalizeURL(text || raw); title = content;
      mainInput.value = ''; autoResize(); updateInputBadge('');
      const newItem = await window.vault.addItem({ type, title, content, tags: tags.join(',') });
      allItems.unshift(newItem);
      filterByTag(activeTag);
      try {
        const fetched = await window.vault.fetchTitle(content);
        if (fetched) {
          await window.vault.updateItem(newItem.id, { title: fetched });
          const idx = allItems.findIndex(i => i.id === newItem.id);
          if (idx >= 0) allItems[idx].title = fetched;
          filterByTag(activeTag);
        }
      } catch { /* title fetch is best-effort */ }
    } else {
      type = 'note'; content = text || raw;
      title = content.length > 150 ? content.substring(0, 150) + '...' : content;
      mainInput.value = ''; autoResize(); updateInputBadge('');
      const newItem = await window.vault.addItem({ type, title, content, tags: tags.join(',') });
      allItems.unshift(newItem);
      filterByTag(activeTag);
    }
    await loadTags();
  } catch (err) {
    showError('Failed to add item: ' + err.message);
  }
}

// Proper undo: store full deleted item, restore with original ID
async function deleteItem(id) {
  const item = allItems.find(i => i.id === id);
  const card = document.querySelector(`.item-card[data-id="${id}"]`);
  if (card) { card.classList.add('removing'); await new Promise(r => setTimeout(r, 250)); }

  try {
    await window.vault.deleteItem(id);
    allItems = allItems.filter(i => i.id !== id);
    filteredItems = filteredItems.filter(i => i.id !== id);
    renderItems(filteredItems);
    await loadTags();

    if (item) {
      undoItem = item;
      clearTimeout(undoTimer);
      undoToast.classList.remove('hidden');
      undoTimer = setTimeout(() => { undoToast.classList.add('hidden'); undoItem = null; }, 5000);
    }
  } catch (err) {
    showError('Failed to delete item: ' + err.message);
  }
}

async function undoDelete() {
  if (!undoItem) return;
  clearTimeout(undoTimer);
  undoToast.classList.add('hidden');
  try {
    await window.vault.restoreItem(undoItem);
    undoItem = null;
    await loadAllItems();
    await loadTags();
  } catch (err) {
    showError('Failed to undo: ' + err.message);
    undoItem = null;
  }
}

async function copyItem(id, btn) {
  const item = allItems.find(i => i.id === id);
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.type === 'link' ? item.content : item.title);
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => { btn.innerHTML = orig; }, 1000);
    }
  } catch (err) {
    showError('Failed to copy: ' + err.message);
  }
}

async function togglePin(id) {
  try {
    const result = await window.vault.togglePin(id);
    if (result) {
      const idx = allItems.findIndex(i => i.id === id);
      if (idx >= 0) allItems[idx].pinned = result.pinned;
      allItems.sort((a, b) => (b.pinned || 0) - (a.pinned || 0));
      filterByTag(activeTag);
    }
  } catch (err) {
    showError('Failed to toggle pin: ' + err.message);
  }
}

// Edit modal
function openEditModal(id) {
  const item = allItems.find(i => i.id === id);
  if (!item || item.encrypted) return;
  editingId = id;
  editTitle.value = item.title;
  editContent.value = item.content;
  editTags.value = item.tags || '';
  editModal.classList.remove('hidden');
  editTitle.focus();
}

async function saveEdit() {
  if (!editingId) return;
  const updates = { title: editTitle.value.trim(), content: editContent.value.trim(), tags: editTags.value.trim() };
  if (!updates.title || !updates.content) return;
  try {
    await window.vault.updateItem(editingId, updates);
    editModal.classList.add('hidden');
    editingId = null;
    await loadAllItems();
    await loadTags();
  } catch (err) {
    showError('Failed to save: ' + err.message);
  }
}

// Encryption
function handleEncrypt(id) {
  const item = allItems.find(i => i.id === id);
  if (!item) return;
  if (item.encrypted) { pendingDecryptId = id; pendingEncryptId = null; passwordModalTitle.textContent = 'Decrypt Note'; }
  else { pendingEncryptId = id; pendingDecryptId = null; passwordModalTitle.textContent = 'Encrypt Note'; }
  passwordInput.value = '';
  passwordHint.textContent = item.encrypted ? 'Enter the password used to encrypt' : 'This password is NOT stored. Remember it!';
  passwordHint.classList.remove('error');
  passwordModal.classList.remove('hidden');
  passwordInput.focus();
}

async function submitPassword() {
  const pw = passwordInput.value;
  if (!pw) { passwordHint.textContent = 'Password required'; passwordHint.classList.add('error'); return; }
  try {
    if (pendingEncryptId) {
      const r = await window.vault.encryptNote(pendingEncryptId, pw);
      if (r.success) { passwordModal.classList.add('hidden'); await loadAllItems(); }
    } else if (pendingDecryptId) {
      const r = await window.vault.decryptNote(pendingDecryptId, pw);
      if (r.success) { passwordModal.classList.add('hidden'); await loadAllItems(); }
      else { passwordHint.textContent = 'Wrong password'; passwordHint.classList.add('error'); }
    }
  } catch (err) {
    showError('Encryption error: ' + err.message);
  }
}

// ===== FTS5 Search via IPC (replaces Fuse.js) =====
function handleInput() {
  const v = mainInput.value;
  updateInputBadge(v);
  autoResize();
  clearTimeout(searchTimeout);
  if (!v.trim()) { isSearchMode = false; filterByTag(activeTag); return; }
  if (!allItems.length || isURL(v)) return;
  searchTimeout = setTimeout(async () => {
    isSearchMode = true;
    selectedIndex = -1;
    try {
      const results = await window.vault.searchItems(v.trim());
      renderItems(results);
    } catch {
      // Fallback to local filter
      const q = v.toLowerCase();
      renderItems(allItems.filter(i =>
        (i.title && i.title.toLowerCase().includes(q)) ||
        (i.content && i.content.toLowerCase().includes(q)) ||
        (i.tags && i.tags.toLowerCase().includes(q))
      ));
    }
  }, 150);
}

// Auto-resize textarea
function autoResize() {
  mainInput.style.height = 'auto';
  mainInput.style.height = Math.min(mainInput.scrollHeight, 80) + 'px';
}

// Dashboard
async function showDashboard() {
  isDashboardView = !isDashboardView;
  $('dashboardBtn').classList.toggle('active', isDashboardView);
  if (isDashboardView) {
    itemsView.classList.add('hidden'); dashboardView.classList.remove('hidden');
    try {
      const s = await window.vault.getStats();
      dashGrid.innerHTML = `
        <div class="dash-card"><div class="dash-value">${s.total}</div><div class="dash-label">Total Items</div></div>
        <div class="dash-card"><div class="dash-value">${s.links}</div><div class="dash-label">Links</div></div>
        <div class="dash-card"><div class="dash-value">${s.notes}</div><div class="dash-label">Notes</div></div>
        <div class="dash-card"><div class="dash-value">${s.pinned}</div><div class="dash-label">Pinned</div></div>
        ${s.tags.length ? `<div class="dash-card full-width"><div class="dash-label" style="margin-bottom:6px">TOP TAGS</div><div class="dash-tag-bar">${s.tags.slice(0, 8).map(t => `<span class="dash-tag"><span class="dash-tag-count">${t.count}</span> #${t.name}</span>`).join('')}</div></div>` : ''}
        ${s.recentItems.length ? `<div class="dash-card full-width"><div class="dash-label" style="margin-bottom:4px">RECENT</div><div class="dash-list">${s.recentItems.map(i => `<div class="dash-list-item"><span class="dash-list-title">${i.type === 'link' ? '🔗' : '📝'} ${esc(i.title)}</span><span class="dash-list-meta">${formatTime(i.createdAt)}</span></div>`).join('')}</div></div>` : ''}
        ${s.topVisited.length ? `<div class="dash-card full-width"><div class="dash-label" style="margin-bottom:4px">MOST VISITED</div><div class="dash-list">${s.topVisited.map(i => `<div class="dash-list-item"><span class="dash-list-title">🔗 ${esc(i.title)}</span><span class="dash-list-meta">${i.visitCount} visits</span></div>`).join('')}</div></div>` : ''}`;
    } catch (err) {
      showError('Failed to load dashboard: ' + err.message);
    }
  } else { dashboardView.classList.add('hidden'); itemsView.classList.remove('hidden'); }
}

// Export
async function handleExport(format) {
  exportModal.classList.add('hidden');
  try {
    await window.vault.exportItems(format, activeTag === 'all' ? null : activeTag);
  } catch (err) {
    showError('Export failed: ' + err.message);
  }
}

// ===== Keyboard =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!editModal.classList.contains('hidden')) { editModal.classList.add('hidden'); return; }
    if (!exportModal.classList.contains('hidden')) { exportModal.classList.add('hidden'); return; }
    if (!passwordModal.classList.contains('hidden')) { passwordModal.classList.add('hidden'); return; }
    window.vault.hideWindow();
  }
  // Enter = save new item (or open selected card)
  if (e.key === 'Enter' && !e.shiftKey && document.activeElement === mainInput) {
    e.preventDefault();
    if (mainInput.value.trim()) { isSearchMode = false; addNewItem(); }
  }
  if (e.key === 'Enter' && document.activeElement === passwordInput) submitPassword();

  // Enter on selected card: open link or show note
  if (e.key === 'Enter' && selectedIndex >= 0 && document.activeElement !== mainInput && document.activeElement !== passwordInput && document.activeElement !== editTitle && document.activeElement !== editContent && document.activeElement !== editTags) {
    const cards = document.querySelectorAll('.item-card');
    const card = cards[selectedIndex];
    if (card) {
      const id = card.dataset.id;
      const item = allItems.find(i => i.id === id);
      if (item) {
        if (item.type === 'link' && !item.encrypted) {
          window.vault.openExternal(item.content);
          window.vault.incrementVisit(id);
        } else if (!item.encrypted) {
          openEditModal(id);
        }
      }
    }
  }

  // Delete key on selected card
  if (e.key === 'Delete' && selectedIndex >= 0 && document.activeElement !== mainInput && document.activeElement !== passwordInput && document.activeElement !== editTitle && document.activeElement !== editContent && document.activeElement !== editTags) {
    const cards = document.querySelectorAll('.item-card');
    const card = cards[selectedIndex];
    if (card) deleteItem(card.dataset.id);
  }

  // Arrow navigation
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const cards = document.querySelectorAll('.item-card');
    if (!cards.length) return;
    e.preventDefault();
    cards.forEach(c => c.classList.remove('selected'));
    selectedIndex = e.key === 'ArrowDown' ? Math.min(selectedIndex + 1, cards.length - 1) : Math.max(selectedIndex - 1, 0);
    cards[selectedIndex]?.classList.add('selected');
    cards[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }
});

// ===== Event Listeners =====
mainInput.addEventListener('input', handleInput);
$('closeBtn').addEventListener('click', () => window.vault.hideWindow());
$('dashboardBtn').addEventListener('click', showDashboard);
$('exportBtn').addEventListener('click', () => exportModal.classList.remove('hidden'));
$('closeExportModal').addEventListener('click', () => exportModal.classList.add('hidden'));
$('closePasswordModal').addEventListener('click', () => passwordModal.classList.add('hidden'));
$('passwordSubmit').addEventListener('click', submitPassword);
$('closeEditModal').addEventListener('click', () => editModal.classList.add('hidden'));
$('editSave').addEventListener('click', saveEdit);
$('undoBtn').addEventListener('click', undoDelete);

const errorDismiss = $('errorDismiss');
if (errorDismiss) errorDismiss.addEventListener('click', hideError);

document.querySelectorAll('.export-option').forEach(o => o.addEventListener('click', () => handleExport(o.dataset.format)));

$('themeBtn').addEventListener('click', async () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  try { await window.vault.setSetting('theme', currentTheme); } catch (err) { showError('Failed to save theme: ' + err.message); }
});

$('viewModeBtn').addEventListener('click', async () => {
  viewMode = viewMode === 'expanded' ? 'compact' : 'expanded';
  applyViewMode(viewMode);
  try { await window.vault.setSetting('viewMode', viewMode); } catch (err) { showError('Failed to save view: ' + err.message); }
});

// Window shown event with cleanup
cleanupWindowShown = window.vault.onWindowShown(() => {
  mainInput.focus();
  mainInput.select();
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (typeof cleanupWindowShown === 'function') cleanupWindowShown();
});

window.addEventListener('DOMContentLoaded', init);
