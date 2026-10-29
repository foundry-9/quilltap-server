# Quilltap Changelog

## Recent Changes

### 4.12-dev

#### Deps: Packages and plugins brought up to the root's dependency levels

- `npm update -S` in the root, every `packages/*` and every `plugins/dist/*`. Main movements: `@quilltap/plugin-types` ^2.9.1 and `@quilltap/plugin-utils` ^2.7.2 everywhere (root included), `openai` ^7.45.1, `@openrouter/sdk` ^1.5.21, `@modelcontextprotocol/sdk` ^1.32.2, `sharp` ^0.35.5 in `packages/quilltap`, Storybook ^10.6.5 and `react` ^19.3.1 in `theme-storybook`, `@types/node` ^24.19.2 in `create-quilltap-theme` and `plugin-types`.
- Major bumps:
  - `@google/genai` 1.52 → 2.32 (google plugin). 2.0's breaking changes are confined to the Interactions API, which the plugin doesn't use. Two default changes do reach it. The SDK no longer applies Undici's 300 s timeouts when `httpOptions.timeout` is unset, so a call with no `requestTimeoutMs` now runs until the server's limit (10 min unary, 20 min streaming). Automatic continuation is on, so a long decode that checkpoints is resumed by the SDK within one call, and summed `usageMetadata` can then count the prompt more than once.
  - `zod` ^3.25.76 → ^4.6.7 (mcp plugin). The plugin doesn't import zod. It's external in the bundle, so the plugin already ran against the app's zod 4 at runtime, and `@modelcontextprotocol/sdk` accepts `^3.25 || ^4.0`.
  - `html-to-text` 9 → 10 (curl plugin). A maintenance release (htmlparser2 10, selderee 0.12, Node ≥ 20.19); the plugin's options are unchanged and produce the same output. `@types/html-to-text` stays at 9.0.4, the latest.
  - `@anthropic-ai/sdk` 0.115 → 1.3 (anthropic plugin). SDK 1.0 defaults to `anthropic-version: 2026-10-21`, which returns 400 for any request carrying `temperature`, `top_p` or `top_k`, or a `document` block in an assistant message. The plugin sends sampling parameters on every non-thinking request to models that still accept them. It now pins `anthropic-version: 2023-06-01` through `defaultHeaders` on all four clients (`clientHeaders()` in `provider.ts`), which overrides the SDK's value, so requests go out as before. One visible difference: the SDK now sends the API key as `Authorization: Bearer` instead of `X-Api-Key`. The API accepts either, but a proxy that reads `X-Api-Key` would need changing.
- TypeScript 7, `@types/node` 26 and `emojibase-data` 18 remain held back, as in the root.
- Removed `fsevents@2.3.2` from the root `allowScripts`. That version is no longer installed; `fsevents@2.3.3` stays.
- Patch bumps: `@quilltap/plugin-types` 2.9.2, `@quilltap/plugin-utils` 2.7.3, `@quilltap/theme-storybook` 1.0.92, `create-quilltap-theme` 2.0.23, and every plugin in `plugins/dist/`.

#### Deps: TypeScript 6

- `typescript` 5.9.3 → 6.0.3 in the root project, `packages/plugin-utils`, `packages/plugin-types`, `packages/theme-storybook`, `packages/create-quilltap-theme` and `qtap-plugin-default-system-prompts`. The root project and all plugins type-check under 6 with no source or tsconfig changes, and `npm run lint` and the unit suite are unchanged.
- TypeScript 7 (the native Go compiler) also type-checks the root project cleanly, but it can't be adopted yet: `typescript-eslint` 8.x caps its `typescript` peer at `<6.1.0` and needs the JavaScript compiler API, which `typescript@7` no longer ships. Next 16.4 already handles 7. Revisit once `typescript-eslint` supports 7.
- `tsup` 8.5.1 → 9.0.0 in `plugin-utils`, `plugin-types` and `theme-storybook`. tsup 8 forces `baseUrl` into its declaration build, and TypeScript 6 rejects that with TS5101 (deprecated, removed in 7). tsup 9 no longer does. Published `dist/` contents are the same apart from hashed chunk filenames.
- `theme-storybook`: TypeScript 6 turns on `noUncheckedSideEffectImports` by default, so `src/preview.tsx`'s side-effect `.css` imports failed type-checking. Added `src/css-modules.d.ts` declaring `*.css` modules.
- Patch bumps: `@quilltap/plugin-utils` 2.7.2, `@quilltap/plugin-types` 2.9.1, `@quilltap/theme-storybook` 1.0.91, `create-quilltap-theme` 2.0.22, `qtap-plugin-default-system-prompts` 1.1.28.

#### Deps: ESLint 10

- `eslint` 9.39.5 → 10.13.0. `eslint.config.mjs` was already flat config and needs no changes. `npm run lint` reports the same results as on 9 (zero findings across 4,290 files), and a probe file with deliberate violations tripped the same rules under both versions.
- `eslint-plugin-react` 7.37.5, `eslint-plugin-jsx-a11y` 6.10.2 and `eslint-plugin-import` 2.32.0 (all pulled in by `eslint-config-next`) still cap their `eslint` peer range at `^9`, and none has released since ESLint 10 shipped. `package.json` `overrides` now point their `eslint` peer at the root version (`$eslint`). Remove those overrides once the plugins publish `^10` ranges. Until then `npm install` will not flag an incompatibility; a breakage would show up as a crash in `npm run lint`.

#### Deps: Lexical 0.53

- `lexical` and all `@lexical/*` packages 0.52.0 → 0.53.0. No code changes. 0.53's breaking changes (removed `*ImportExtension`s, removed unchecked type arguments on `getParent<T>()` / `$getNodeByKey<T>()` and similar, `@lexical/mdast` table alignment) touch no Quilltap code; `npx tsc` is clean and the composer and Lexical test suites pass.
- Fixes relevant to the Salon composer: IME and dead-key composition into a `TextNode` subclass keeps its type; Chromium keeps spellcheck underlines when a text node is rewritten; Markdown export escapes literal brackets, `<` and `&`; links opened in a new tab no longer get `window.opener`; a read-only `ContentEditable` no longer renders an unnamed `role="textbox"`.

#### Deps: croner 11, jest-fetch-mock 4.2

- `croner` 10.0.1 → 11.0.0. Quilltap only calls `new Cron(expr).nextRun(date)` (autonomous-room schedules and the room card's next-run preview), so none of 11's `startAt` / `dayOffset` / `previousRun()` changes apply. DST behavior changed: a fixed-time schedule that falls in a spring-forward gap now runs at the first valid time after the gap (3:00, not 3:30), and interval schedules run through both copies of the repeated fall-back hour. 11 also fixes `?` behaving like `*` in day fields and stack overflows on patterns that never match.
- `jest-fetch-mock` 3.2.0 → 4.2.0. All 3.x APIs are unchanged; `jest.setup.ts` still calls `enableMocks()`. Under jsdom it still fills missing fetch globals from cross-fetch. Under `@jest-environment node` mocked responses are now native `Response` objects.
- `jest-fetch-mock` and `@types/yauzl` moved from `dependencies` to `devDependencies`. Neither is used at runtime; production installs (`npm ci --omit=dev` in the Docker images) no longer pull them or `cross-fetch`.
- `emojibase-data` stays at 17: version 18 changes the emoji characters themselves, which requires a new `emoji-index.v2.json` under the dataset's versioning contract.

#### Deps: chokidar removed; the files-directory watcher uses `fs.watch`

- `lib/file-storage/watcher.ts` (the instance `files/` watcher) now uses Node's recursive `fs.watch`, like the mount watcher. `handleNativeEvent` resolves each debounced event against the disk: an existing file goes through `handleFileChange` (which adds a record when there is none), a missing path is defer-deleted, a folder that leaves by rename defer-deletes every record beneath it, and a folder that arrives by rename is recorded with its contents (`scanDirectory`). Symlinks are skipped, matching the startup scan. Event paths are normalized to `/`-separated storage keys.
- If `fs.watch` cannot start (missing directory, no recursive notifications), the watcher logs a warning and stays off; startup reconciliation and Sync Now still work.
- A file move matched through `findBySha256` now cancels any deferred delete still pending for the same record. Before, the old path's delete could fire after the move and remove the moved record.
- The mount watcher's `QUILLTAP_WATCHER_POLLING=1` mode (and its fallback when `fs.watch` refuses a recursive watch) no longer uses chokidar. It walks the store every 2 seconds, stats each indexable file, and diffs mtime and size against the previous walk. The first walk is the baseline. No descriptors are held between walks.
- `chokidar` is removed from `package.json`. New `__tests__/unit/lib/file-storage/watcher-native.test.ts`; the bug 69 digest test and the mount watcher polling tests now drive `fs.watch` and the walker instead of a chokidar mock.

#### Fix: Filesystem store watcher held one file descriptor per watched file

- The mount watcher ran chokidar 5, which has no FSEvents backend and opens a kqueue descriptor for every file and folder it watches on macOS. A store on a 24,000-file `~/Documents` reached 15,770 open descriptors; Next.js then failed every request that needed a compile with `spawn EBADF`.
- Filesystem stores now watch with Node's recursive `fs.watch` (FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux). A 20,000-file test store added no descriptors. `handleNativeEvent` resolves each debounced event against the disk: an existing file is indexed, a missing path is dropped, a folder that arrives by rename has its files indexed (`walkDirectory`, now exported from `scanner.ts`), and a folder that leaves by rename has everything indexed beneath it removed. Symlinks are skipped, as before. An event with no filename (Linux queue overflow) is logged and left to the next startup scan.
- `QUILLTAP_WATCHER_POLLING=1` still polls, and the watcher falls back to polling when `fs.watch` refuses a recursive watch. Polling ignores files the scanner would never index.
- New `watcher-native.test.ts` covers event resolution, the polling path and the fallback.

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
