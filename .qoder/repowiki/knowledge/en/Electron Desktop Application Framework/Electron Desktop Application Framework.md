---
kind: external_dependency
name: Electron Desktop Application Framework
slug: electron
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### Electron
- **Role in this repo:** Desktop shell wrapping Node.js + Express API + SQLite cache. Runs as packaged Windows EXE (NSIS installer) and macOS DMG.
- **Build system:** electron-builder configured for NSIS installers, portable builds, and macOS targets. App bundles `.env` and credentials via `extraResources`.
- **Update mechanism:** Two channels — GitHub Releases for in-app updates (silent Setup.exe or full app zip), and manual installer distribution for first-time installs.
- **Architecture pattern:** Loopback Express API serves the UI layer; no browser/localhost mode exists — only packaged EXE runs.