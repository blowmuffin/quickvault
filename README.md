<p align="center">
  <img src="assets/icon.png" alt="QuickVault Logo" width="80" />
</p>

<h1 align="center">QuickVault</h1>

<p align="center">
  <strong>Ultra-fast bookmark & notes overlay for your desktop</strong><br/>
  Press <code>Ctrl+Shift+Space</code> from anywhere to instantly save links, jot notes, and stay organized.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.1.0-8b5cf6?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/electron-35-blue?style=flat-square" alt="Electron" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
</p>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🚀 **Instant Access** | Global hotkey `Ctrl+Shift+Space` — opens an overlay from any app |
| 🔗 **Smart Links** | Paste a URL and QuickVault auto-fetches the page title |
| 📝 **Quick Notes** | Type anything to save a note — multi-line with `Shift+Enter` |
| 🔍 **Full-Text Search** | FTS5-powered search finds items instantly as you type |
| 🏷️ **Tags** | Use `#tags` inline to organize — filter by tag with one click |
| 📌 **Pinning** | Pin important items to the top |
| 🔒 **Encryption** | AES-256-GCM encryption for sensitive notes |
| 📊 **Dashboard** | Stats overview — total items, top tags, most visited links |
| 📤 **Export** | Export to Markdown, JSON, or HTML |
| 🌙 **Themes** | Dark and light mode with smooth transitions |
| ⌨️ **Keyboard-first** | Arrow keys to navigate, Enter to open, Delete to remove |

---

## 📸 Quick Look

1. **Press `Ctrl+Shift+Space`** — the overlay appears
2. **Paste a link** — it's saved instantly with the page title auto-fetched
3. **Type a note** — press Enter to save, use `#tags` to organize
4. **Search** — just start typing to find anything
5. **Press `Esc`** — the overlay hides, your workflow continues

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Git](https://git-scm.com/)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/blowmuffin/quickvault.git
cd quickvault

# Install dependencies
npm install

# Run in development mode
npm start
```

### Build Portable Executable

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux

# All platforms
npm run build:all
```

The portable `.exe` (Windows) will be at `dist/QuickVault-Portable.exe`.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Toggle QuickVault overlay |
| `Enter` | Save new item / Open selected link |
| `Shift+Enter` | New line in input |
| `Esc` | Hide overlay / Close modal |
| `↑` `↓` | Navigate items |
| `Delete` | Delete selected item |

---

## 🏗️ Architecture

```
quickvault/
├── src/
│   ├── main.js          # Electron main process — window, tray, IPC, security
│   ├── preload.js       # Context bridge — safe API exposed to renderer
│   ├── database.js      # SQLite (better-sqlite3) — FTS5, migrations, encryption
│   └── renderer/
│       ├── index.html   # UI markup
│       ├── app.js       # Renderer logic — all interactions via window.vault API
│       └── styles.css   # Theming, animations, responsive design
├── assets/
│   └── icon.png         # App icon
├── package.json
└── LICENSE
```

### Key Design Decisions

- **SQLite + FTS5** — Full-text search with automatic triggers, no external search library needed
- **Sandboxed renderer** — `contextIsolation: true`, `sandbox: true`, no `require()` in renderer
- **IPC-only communication** — All data flows through validated IPC channels with rate limiting
- **Schema versioning** — Database migrations run automatically on startup
- **Single instance lock** — Only one QuickVault can run at a time

---

## 🔒 Security

- **Content Security Policy (CSP)** enforced on all pages
- **Sandboxed renderer** — no Node.js access in the frontend
- **Input validation** on all IPC channels (preload + main process)
- **IPC rate limiting** — 60 calls/sec per channel
- **AES-256-GCM encryption** with PBKDF2 key derivation (100K iterations) for notes
- **Navigation blocking** — renderer cannot navigate to external URLs
- **Permission denial** — camera, mic, geolocation requests are all blocked

---

## 📦 Tech Stack

| Component | Technology |
|---|---|
| Framework | [Electron](https://www.electronjs.org/) v35 |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) with FTS5 |
| Search | SQLite FTS5 (full-text search) |
| Encryption | Node.js `crypto` — AES-256-GCM |
| Build | [electron-builder](https://www.electron.build/) |
| IDs | [uuid](https://github.com/uuidjs/uuid) v4 |

---

## 🗂️ Data Storage

Your data is stored locally — nothing is sent to any server.

| Item | Location |
|---|---|
| Database | `%APPDATA%/quickvault/quickvault.db` (Windows) |
| Settings | Stored in the same SQLite database |
| Backups | `quickvault.db.bak` — auto-created on each launch |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'feat: add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ☕ and Electron<br/>
  <strong>QuickVault</strong> — Your desktop command palette for bookmarks and notes
</p>
