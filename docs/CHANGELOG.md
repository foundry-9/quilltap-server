# Quilltap Changelog

## Recent Changes

### 4.12-dev

#### Deps: SQLCipher driver to better-sqlite3-multiple-ciphers 13

- `better-sqlite3-multiple-ciphers` 12.11.1 → 13.0.3, in the root `better-sqlite3` alias and in `packages/quilltap`. v13 is a Node-API addon with one prebuilt binary per platform in the npm package (darwin, linux, linuxmusl, win32 × x64, arm64). Nothing compiles on install, and one binary serves every Node ≥ 22 and Electron ≥ 35. SQLite 3.53.4, SQLite3MultipleCiphers 2.4.0. `prebuild-install` and `bindings` left the tree.
- No data migration. Databases written by either version open in the other. A 4.2.x Electron shell, which injects its own v12 build, keeps working; there is no shell/server compatibility gate. Server code must not call v13-only driver API (`db.explain()`, `Statement.prototype.toString()`) until the shell ships v13.
- The CLI no longer rebuilds the driver. `ensureDatabaseNativeModule()` loads the prebuild the driver would pick and, when it won't load, prints why (no prebuild for this platform, glibc older than 2.35, or the loader's error) and what to do. `readCompiledAbi`, `betterSqlite3NeedsRebuild`, `findBinFor` and `rebuildNativePackage` are gone, as is the matching heal in `jest.global-setup.js` and its test; new `native-driver-check.test.js` covers the load check.
- Linux hosts running `npx quilltap` now need glibc 2.35 or newer (Ubuntu 22.04, Debian 12, RHEL 9). Older hosts should use the Docker image.
- The Docker production image keeps only its own architecture's driver prebuild and drops the driver's compile-time sources (`deps/`, `src/`, `binding.gyp`); the build fails if the prebuild is missing. Build tools stay in the build stages for node-pty. `scripts/build-push-docker.ts` no longer runs `npm rebuild better-sqlite3` afterwards.
- The server logs the driver and SQLite versions at info level when it opens the main database (`SQLCipher driver loaded`), so a support thread can tell which binary the shell injected.
- `@types/better-sqlite3` stays: v13's `exports` map has no `types` entry, so TypeScript cannot see the package's own `index.d.ts`.
- `allowScripts` denies `better-sqlite3-multiple-ciphers` (version-less). The package still ships `binding.gyp`, so npm treats it as having a `node-gyp rebuild` install script; the deny stops a pointless node-gyp run in Docker's `npm rebuild`.
