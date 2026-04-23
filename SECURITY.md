# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.1.x   | ✅ Current |
| 2.0.x   | ⚠️ Critical fixes only |
| < 2.0   | ❌ End of life |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities by emailing the maintainers directly or using GitHub's private vulnerability reporting feature.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within **48 hours** and will coordinate disclosure with you.

## Security Architecture

QuickVault is designed with defense-in-depth:

### Process Isolation
- **Sandboxed renderer** — `sandbox: true`, `contextIsolation: true`
- **No Node.js in renderer** — all system access goes through validated IPC
- **Navigation blocked** — renderer cannot navigate to external URLs
- **Permission denial** — camera, mic, geolocation, MIDI all blocked

### Data Protection
- **AES-256-GCM encryption** with PBKDF2 key derivation (100,000 iterations)
- **Local-only storage** — no data is sent to any server
- **Automatic backups** — `quickvault.db.bak` created on each launch

### Input Validation
- **IPC rate limiting** — 60 calls/sec per channel
- **Type validation** in preload.js (strings, numbers, allowed formats)
- **Business logic validation** in main process handlers
- **HTML escaping** in renderer for all user-generated content

### Content Security Policy
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'
```

### Dependencies
- Minimal dependency tree (3 runtime deps: `better-sqlite3`, `uuid`, `@electron/rebuild`)
- Regular dependency audits via `npm audit`
