# Quilltap Changelog

## Recent Changes

### 4.12-dev

#### Fix: Filesystem store watcher held one file descriptor per watched file

- The mount watcher ran chokidar 5, which has no FSEvents backend and opens a kqueue descriptor for every file and folder it watches on macOS. A store on a 24,000-file `~/Documents` reached 15,770 open descriptors; Next.js then failed every request that needed a compile with `spawn EBADF`.
- Filesystem stores now watch with Node's recursive `fs.watch` (FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux). A 20,000-file test store added no descriptors. `handleNativeEvent` resolves each debounced event against the disk: an existing file is indexed, a missing path is dropped, a folder that arrives by rename has its files indexed (`walkDirectory`, now exported from `scanner.ts`), and a folder that leaves by rename has everything indexed beneath it removed. Symlinks are skipped, as before. An event with no filename (Linux queue overflow) is logged and left to the next startup scan.
- `QUILLTAP_WATCHER_POLLING=1` still polls through chokidar, and the watcher falls back to polling when `fs.watch` refuses a recursive watch. Polling now ignores files the scanner would never index, so they cost no stat timer.
- New `watcher-native.test.ts` covers event resolution, the polling path and the fallback. `lib/file-storage/watcher.ts` (the instance `files/` watcher) still uses chokidar and is unchanged.

#### Fix: Filesystem store scans no longer fault in iCloud files or hold the startup screen

- The document-store scanner hashed every file under a filesystem store's base path, which made iCloud Drive download each evicted placeholder. A V4test store pointed at an iCloud-synced `~/Documents` (23,615 of 24,153 files evicted) indexed about 90 files every five minutes, and the startup screen sat on "At your service" until its five-minute settle cap released it.
- `processMountFile` now stats the file before hashing it and returns `in-cloud` for a fully evicted placeholder (`size > 0`, `blocks === 0`, macOS and Windows only). The scan counts these as `filesInCloud`, keeps their existing index rows, and logs one summary line per store. The watcher ignores the change event an eviction fires; the download that brings a file back fires another and indexes it.
- The detection rules live in new `lib/files/cloud-placeholder.ts`. `isNotFullyMaterialized` (moved from `materialize-cloud-files.ts`, unchanged) is the broad rule for faulting database files in at boot. `isEvictedCloudPlaceholder` is the narrow rule for skipping: it ignores partially downloaded files and never fires on Linux, where compressing filesystems (ZFS, btrfs) report fewer blocks than bytes.
- The boot scan runs in two passes. `scanAllMountPoints({ only: 'database' })` stays inside the startup gate's `backgroundSettled` wait. Filesystem stores scan afterwards with `{ only: 'filesystem', reportStartupProgress: false }`, outside the gate. `ScanResult` gains `filesInCloud`, and `emptyScanResult()` builds the zeroed result the runner used to spell out by hand.

#### Deps: SQLCipher driver to better-sqlite3-multiple-ciphers 13

- `better-sqlite3-multiple-ciphers` 12.11.1 → 13.0.3, in the root `better-sqlite3` alias and in `packages/quilltap`. v13 is a Node-API addon with one prebuilt binary per platform in the npm package (darwin, linux, linuxmusl, win32 × x64, arm64). Nothing compiles on install, and one binary serves every Node ≥ 22 and Electron ≥ 35. SQLite 3.53.4, SQLite3MultipleCiphers 2.4.0. `prebuild-install` and `bindings` left the tree.
- No data migration. Databases written by either version open in the other. A 4.2.x Electron shell, which injects its own v12 build, keeps working; there is no shell/server compatibility gate. Server code must not call v13-only driver API (`db.explain()`, `Statement.prototype.toString()`) until the shell ships v13.
- The CLI no longer rebuilds the driver. `ensureDatabaseNativeModule()` loads the prebuild the driver would pick and, when it won't load, prints why (no prebuild for this platform, glibc older than 2.35, or the loader's error) and what to do. `readCompiledAbi`, `betterSqlite3NeedsRebuild`, `findBinFor` and `rebuildNativePackage` are gone, as is the matching heal in `jest.global-setup.js` and its test; new `native-driver-check.test.js` covers the load check.
- Linux hosts running `npx quilltap` now need glibc 2.35 or newer (Ubuntu 22.04, Debian 12, RHEL 9). Older hosts should use the Docker image.
- The Docker production image keeps only its own architecture's driver prebuild and drops the driver's compile-time sources (`deps/`, `src/`, `binding.gyp`); the build fails if the prebuild is missing. Build tools stay in the build stages for node-pty. `scripts/build-push-docker.ts` no longer runs `npm rebuild better-sqlite3` afterwards.
- The server logs the driver and SQLite versions at info level when it opens the main database (`SQLCipher driver loaded`), so a support thread can tell which binary the shell injected.
- `@types/better-sqlite3` stays: v13's `exports` map has no `types` entry, so TypeScript cannot see the package's own `index.d.ts`.
- `allowScripts` denies `better-sqlite3-multiple-ciphers` (version-less). The package still ships `binding.gyp`, so npm treats it as having a `node-gyp rebuild` install script; the deny stops a pointless node-gyp run in Docker's `npm rebuild`.
