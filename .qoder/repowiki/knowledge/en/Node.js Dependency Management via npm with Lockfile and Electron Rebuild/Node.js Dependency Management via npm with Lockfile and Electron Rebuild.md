---
kind: dependency_management
name: Node.js Dependency Management via npm with Lockfile and Electron Rebuild
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - scripts/electron-after-pack.js
---

The Hang-Up HR Desktop Application manages its Node.js dependencies using npm, declared in package.json and locked down by a committed package-lock.json. There is no vendoring strategy (no vendor/ directory), no private registry configuration (no .npmrc found), and no Go tooling (go.mod/go.sum absent). The dependency surface is small and focused on the Electron runtime plus a handful of server-side libraries.

System and approach
- Package manager: npm (lockfileVersion 3 in package-lock.json).
- Runtime: Electron 33.x packaged via electron-builder 25.x.
- Native addon rebuild: @electron/rebuild is used to compile better-sqlite3 for each target platform; the build script scripts/electron-after-pack.js also flips Electron fuses via @electron/fuses to disable ASAR integrity validation so in-app updates can replace app.asar at runtime.
- No private npm registry or proxy configuration was found in the repository.

Key files
- package.json — declares all runtime and dev dependencies, scripts, and electron-builder config.
- package-lock.json — deterministic lockfile pinned to exact resolved versions and SHA integrity hashes.
- scripts/electron-after-pack.js — post-build hook that disables Electron's embedded ASAR integrity fuse so the updater can swap app.asar without launching failures.
- .github/workflows/release.yml — CI step runs npx @electron/rebuild -f -w better-sqlite3 before packaging.

Architecture and conventions
- Dependencies are split into dependencies (runtime) and devDependencies (Electron toolchain); only adm-zip is explicitly included in the asar bundle while better-sqlite3 is listed under asarUnpack because it ships native binaries.
- The app uses a single flat node_modules tree (no workspaces, no monorepo layout).
- Version ranges use caret (^) semantics in package.json, but the lockfile pins every transitive dependency to an exact version with integrity checksums, ensuring reproducible builds across machines.
- Native modules (better-sqlite3, bcrypt) require platform-specific rebuilds; the project relies on @electron/rebuild rather than prebuilt binaries.

Rules developers should follow
- Always run npm install (which reads package-lock.json) instead of npm ci alone when building locally, since the workflow expects node_modules to exist for the electron-after-pack hook.
- After changing any dependency with native addons (especially better-sqlite3), run npm run rebuild:native (npx @electron/rebuild -f -w better-sqlite3) before packaging.
- Do not commit changes to node_modules; rely on the lockfile for determinism.
- Keep package.json ranges narrow enough to avoid accidental major bumps; verify package-lock.json reflects intended versions before committing.
- If adding new native modules, add them to the asarUnpack list in package.json's build section so their binaries ship unpacked.