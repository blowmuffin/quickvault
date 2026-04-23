# Contributing to QuickVault

Thank you for your interest in contributing to QuickVault! This guide will help you get started.

---

## 📋 Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Code Style & Conventions](#code-style--conventions)
- [Making Changes](#making-changes)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)

---

## 🛠️ Development Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | v18+ | Runtime |
| npm | v9+ | Package manager |
| Git | Latest | Version control |
| Python | 3.x | Required by `node-gyp` for native module builds |
| VS Build Tools | 2019+ | Windows only — C++ compilation for `better-sqlite3` |

### Getting Started

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/quickvault.git
cd quickvault

# 2. Install dependencies (also runs electron-builder install-app-deps)
npm install

# 3. Start in development mode (opens DevTools)
npm run dev

# 4. Start in production mode (no DevTools)
npm start
```

### Environment Notes

- The app uses **better-sqlite3**, a native Node.js addon. If `npm install` fails on your platform, ensure you have the required C++ build toolchain:
  - **Windows**: `npm install --global windows-build-tools` or install Visual Studio Build Tools
  - **macOS**: `xcode-select --install`
  - **Linux**: `sudo apt install build-essential python3`

- The database file is created at `%APPDATA%/quickvault/quickvault.db` (Windows) / `~/.config/quickvault/quickvault.db` (Linux) / `~/Library/Application Support/quickvault/quickvault.db` (macOS).

---

## 🏗️ Project Architecture

```
quickvault/
├── src/
│   ├── main.js            # Electron main process
│   │                      # - BrowserWindow management
│   │                      # - System tray integration
│   │                      # - Global hotkey (Ctrl+Shift+Space)
│   │                      # - IPC handler registration
│   │                      # - Security: CSP, sandbox, permission denial
│   │                      # - Single instance lock
│   │
│   ├── preload.js         # Context bridge (contextIsolation: true)
│   │                      # - Exposes window.vault API to renderer
│   │                      # - Input validation layer
│   │                      # - IPC channel whitelist
│   │
│   ├── database.js        # Data layer (better-sqlite3)
│   │                      # - Schema versioning & auto-migration
│   │                      # - FTS5 virtual table + triggers
│   │                      # - CRUD operations
│   │                      # - AES-256-GCM encryption/decryption
│   │                      # - Export (Markdown, JSON, HTML)
│   │                      # - Automatic backups
│   │
│   └── renderer/
│       ├── index.html     # UI markup — semantic HTML5
│       ├── app.js         # Renderer logic
│       │                  # - DOM event delegation (single listener on itemsList)
│       │                  # - IPC-based FTS5 search (no client-side Fuse.js)
│       │                  # - Debounced action buttons
│       │                  # - Keyboard navigation (arrow keys, Enter, Delete)
│       │                  # - Undo with full object restoration
│       │                  # - Error/undo toast system
│       │
│       └── styles.css     # Theming & animations
│                          # - CSS custom properties for light/dark themes
│                          # - Transition system for smooth theme switches
│                          # - Reduced-motion media query
│                          # - Firefox scrollbar compatibility
│
├── assets/
│   ├── icon.png           # App icon (1024x1024)
│   ├── screenshot-dark.png
│   ├── social-preview.png
│   └── features-showcase.png
│
├── package.json
├── LICENSE                # MIT
├── README.md              # Developer documentation
└── CONTRIBUTING.md        # This file
```

### Process Model

```
┌─────────────────────────────────────────────────┐
│                  Main Process                    │
│   main.js                                       │
│   ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│   │ Tray     │  │ Hotkey    │  │ IPC        │  │
│   │ Manager  │  │ Listener  │  │ Handlers   │  │
│   └──────────┘  └───────────┘  └─────┬──────┘  │
│                                      │          │
│   ┌──────────────────────────────────┤          │
│   │ database.js                      │          │
│   │ SQLite + FTS5 + Encryption       │          │
│   └──────────────────────────────────┘          │
└────────────────────┬────────────────────────────┘
                     │ IPC (validated)
┌────────────────────┴────────────────────────────┐
│              Renderer Process                    │
│   (sandboxed, contextIsolation: true)           │
│   ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│   │ preload  │  │ app.js    │  │ styles.css │  │
│   │ (bridge) │  │ (logic)   │  │ (themes)   │  │
│   └──────────┘  └───────────┘  └────────────┘  │
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **SQLite FTS5 over Fuse.js** | Server-side search is faster, supports ranking, and doesn't load all data into renderer memory |
| **Event delegation** | Single click listener on `itemsList` prevents memory leaks from per-card listeners |
| **Debounced actions** | Prevents duplicate operations from rapid clicks |
| **Full-object undo** | Stores the complete deleted item object, restores with original ID via `restoreItem` IPC |
| **Schema versioning** | `user_version` pragma tracks DB schema version; migrations run automatically |
| **Rate limiting** | 60 calls/sec per IPC channel prevents renderer from flooding main process |

---

## 📝 Code Style & Conventions

### General

- **No frameworks** — Vanilla JS in the renderer. Keep it lean.
- **No `require()` in renderer** — Everything goes through `window.vault` API.
- **ES Module style** — Use `const`/`let` (never `var`), arrow functions, template literals.
- **Single responsibility** — Each function does one thing.

### Naming

| Type | Convention | Example |
|------|-----------|---------|
| Functions | `camelCase` | `loadAllItems()` |
| Constants | `UPPER_SNAKE` | `TAG_COLORS` |
| DOM elements | `camelCase` with `$()` helper | `const mainInput = $('mainInput')` |
| IPC channels | `kebab-case` | `'get-items'`, `'add-item'` |
| CSS custom properties | `--kebab-case` | `--bg-primary`, `--accent` |

### IPC Channels

All IPC channels must be:
1. **Registered** in `main.js` with `ipcMain.handle()`
2. **Exposed** in `preload.js` through `contextBridge.exposeInMainWorld()`
3. **Validated** — both preload (type checks) and main process (business logic)

### CSS

- Use CSS custom properties for all colors, radii, and transitions
- Both light and dark theme values must be defined
- Add `transition: var(--transition-theme)` to properties that change between themes
- Include `@media (prefers-reduced-motion: reduce)` overrides for animations

---

## 🔀 Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/bug-description
   ```

2. **Make your changes** — keep commits focused and atomic.

3. **Test locally**:
   ```bash
   npm run dev    # opens with DevTools
   ```

4. **Build and verify** (if changing packaging):
   ```bash
   npm run build:win   # or build:mac / build:linux
   ```

---

## 💬 Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

| Type | When to use |
|------|------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `style` | CSS/formatting changes (no logic change) |
| `docs` | Documentation only |
| `chore` | Build, tooling, dependencies |

**Examples:**
```
feat(search): add FTS5 snippet highlighting
fix(undo): restore original item ID on undo
refactor(renderer): migrate to event delegation
docs: add contributing guide
```

---

## 📬 Pull Request Process

1. **Update your branch** with the latest `main`:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Open a PR** with:
   - Clear title following commit convention
   - Description of what changed and why
   - Screenshots for UI changes
   - Note any breaking changes

3. **Respond to review feedback** — all PRs require at least one approval.

4. **Squash and merge** — PRs are squash-merged to keep history clean.

---

## 🐛 Issue Reporting

When opening an issue, please include:

- **OS and version** (e.g., Windows 11 23H2, macOS 15.1, Ubuntu 24.04)
- **QuickVault version** (shown in `package.json` or About)
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Console errors** (open DevTools with `Ctrl+Shift+I` in dev mode)

### Labels

| Label | Meaning |
|-------|---------|
| `bug` | Confirmed bug |
| `enhancement` | Feature request |
| `good first issue` | Suitable for newcomers |
| `help wanted` | Community contribution welcome |
| `security` | Security-related |

---

<p align="center">
  Thank you for helping make QuickVault better! 🎉
</p>
