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

<p align="center">
  <img src="assets/screenshot-dark.png" alt="QuickVault Screenshot" width="600" />
</p>

> **📢 Looking to just download and use QuickVault?** Head over to the user guide repo: [**QuickVault App**](https://github.com/blowmuffin/quickvault-app)

---

## 🧑‍💻 Developer Documentation

This repository contains the **source code** for QuickVault. It is intended for developers who want to understand, build, modify, or contribute to the project.

For the end-user download & usage guide, see [quickvault-app](https://github.com/blowmuffin/quickvault-app).

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

## 🚀 Getting Started (Development)

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | v18+ | LTS recommended |
| [Git](https://git-scm.com/) | Latest | — |
| Python | 3.x | Required by `node-gyp` |
| C++ Build Tools | — | Windows: VS Build Tools 2019+, macOS: `xcode-select --install`, Linux: `build-essential` |

### Install & Run

```bash
# Clone the repository
git clone https://github.com/blowmuffin/quickvault.git
cd quickvault

# Install dependencies
npm install

# Run in development mode (with DevTools)
npm run dev

# Run in production mode
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
├── CONTRIBUTING.md      # Contribution guide
├── SECURITY.md          # Security policy
└── LICENSE
```

### Process Model

```
┌──────────────────────────────────────────┐
│            Main Process (main.js)        │
│  ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │  Tray    │ │ Hotkey │ │   IPC     │  │
│  │  Manager │ │ Ctrl+  │ │  Handlers │  │
│  │          │ │ Shift+ │ │  (rate-   │  │
│  │          │ │ Space  │ │  limited) │  │
│  └──────────┘ └────────┘ └─────┬─────┘  │
│                                │         │
│  ┌─────────────────────────────┴──────┐  │
│  │  database.js                       │  │
│  │  SQLite + FTS5 + AES-256-GCM      │  │
│  │  Schema Versioning + Auto-Backup   │  │
│  └────────────────────────────────────┘  │
└─────────────────┬────────────────────────┘
                  │ IPC (validated channels)
┌─────────────────┴────────────────────────┐
│       Renderer Process (sandboxed)       │
│  contextIsolation: true  sandbox: true   │
│  ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │ preload  │ │ app.js │ │styles.css │  │
│  │ (bridge) │ │ (UI)   │ │ (themes)  │  │
│  └──────────┘ └────────┘ └───────────┘  │
└──────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **SQLite FTS5 over Fuse.js** | Server-side search is faster and doesn't load all data into renderer memory |
| **Event delegation** | Single click listener on `itemsList` prevents memory leaks from per-card listeners |
| **Debounced actions** | Prevents duplicate operations from rapid double-clicks |
| **Full-object undo** | Stores the complete deleted item, restores with original ID |
| **Schema versioning** | `user_version` pragma tracks DB version; migrations run on startup |
| **IPC rate limiting** | 60 calls/sec per channel prevents renderer from flooding main process |
| **Sandbox + CSP** | Defense-in-depth: no Node.js in renderer, strict content security policy |

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

## 🔒 Security

- **Content Security Policy (CSP)** enforced on all pages
- **Sandboxed renderer** — no Node.js access in the frontend
- **Input validation** on all IPC channels (preload + main process)
- **IPC rate limiting** — 60 calls/sec per channel
- **AES-256-GCM encryption** with PBKDF2 key derivation (100K iterations) for notes
- **Navigation blocking** — renderer cannot navigate to external URLs
- **Permission denial** — camera, mic, geolocation requests are all blocked

For full details, see [SECURITY.md](SECURITY.md).

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

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Code style & conventions
- Commit message format
- Pull request process

Quick start:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes: `git commit -m 'feat: add my feature'`
4. Push to the branch: `git push origin feat/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ☕ and Electron<br/>
  <strong>QuickVault</strong> — Your desktop command palette for bookmarks and notes
</p>
