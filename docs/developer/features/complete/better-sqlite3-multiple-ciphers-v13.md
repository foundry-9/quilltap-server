# better-sqlite3-multiple-ciphers 13 (Node-API) — upgrade spec

**Status:** implemented 2026-10-28 (see [As built](#as-built)) · **Target release:** 4.12.0 · **Written:** 2026-10-28 (facts below verified that day on macOS arm64) · **Companion:** [better-sqlite3-multiple-ciphers-v13-shell-notes.md](../better-sqlite3-multiple-ciphers-v13-shell-notes.md) (for the quilltap-shell repo; nothing in it blocks this spec)

This spec is written to be executed by Claude Code. Plan it in Opus; the steps marked **(delegable)** are mechanical enough for a cheaper agent once the plan is settled. Do not use `git stash` or worktrees for the delegated pieces.

## Summary

Move the SQLCipher driver from `better-sqlite3-multiple-ciphers@^12.11.1` to `^13.0.3` in both places it is declared (the root `better-sqlite3` alias and `packages/quilltap`). v13 is a complete re-port of the addon to Node-API: the npm tarball carries one prebuilt binary per platform under `prebuilds/`, selects it at runtime, has **no install script**, and no longer depends on `prebuild-install` or `bindings`. Nothing is compiled on `npm ci`, and one binary serves every Node ≥ 22 and every Electron ≥ 35.

That removes a whole class of machinery from this repo: the CLI's "rebuild the binding when the Node ABI changes" heal, the Jest global-setup copy of the same heal, and the tests for both. It also changes what the Docker build does (nothing, for this module) and what the Electron shell has to do (nothing at build time either, see the companion note). The JavaScript API this codebase uses is unchanged.

**Decision of record (user, 2026-10-28): there is no shell/server compatibility gate.** No capability flag, no health-payload field, no `.dbkey` field, no refusal on either side. A 4.2.x shell injecting its v12 build under a 4.12 server is a supported configuration; a future v13 shell running an older server is too. See "Known state" for why that is safe.

## Goals

1. Both manifests on `^13.0.3`; lockfiles refreshed; `prebuild-install` and `bindings` gone from the root tree (nothing else here depended on them — verify with `npm ls` before assuming).
2. `npx quilltap`, `npm run dev`, the standalone tarball, and the Docker image all open an encrypted database on v13 with no compile step anywhere.
3. The CLI no longer tries to rebuild the driver. When the prebuilt binary will not load it says why (unsupported platform, glibc too old, or the raw loader error) and what to do, and never throws.
4. Docker production images carry only their own architecture's prebuilt binary.
5. Every comment, doc and checklist that describes the old `build/Release/better_sqlite3.node` world is corrected.

## Non-goals

- **No compatibility handshake** between shell and server (see decision above).
- **No build-from-source fallback** in the CLI for hosts the prebuilds do not cover (user decision: detect and explain). The toolchain requirement in Docker stays only because `node-pty` has no Linux prebuild.
- No change to the encryption scheme, the key pragma, or any migration. v13 does not need one.
- `13.0.4-beta.0` is not a target. Pin `^13.0.3`.
- Shell repo changes (companion note).

## Known state (verified 2026-10-28)

| Fact | Evidence |
|---|---|
| v13.0.3 ships `prebuilds/{darwin,linux,linuxmusl,win32}-{x64,arm64}.node` (8 files, ~2.3–2.8 MB each), `gypfile: false`, no `install` script, dependency only `node-addon-api@^8`. `engines.node >= 22`. | `npm pack better-sqlite3-multiple-ciphers@13.0.3`; `package.json` in the tarball. Unpacked size 34.4 MB (v12: 14.3 MB); ~22 MB of that is other platforms' binaries and ~10 MB is `deps/sqlite3/sqlite3.c`. |
| The binary is Node-API: exports `napi_register_module_v1` / `node_api_module_get_api_version_v1`, no `node_register_module_v<ABI>` symbol. | `nm -gU prebuilds/darwin-arm64.node`. This is why `readCompiledAbi()` in `packages/quilltap/lib/native-modules.js` returns `null` against it. |
| The published `darwin-arm64` prebuild loads and runs encrypted queries under plain Node 24.13.1 (ABI 137) **and** under quilltap-shell's Electron 41.10.7 (`ELECTRON_RUN_AS_NODE`, ABI 145) with no rebuild. | Probe script: open `:memory:`, `select sqlite_version()` → `3.53.4`; `pragma cipher` → `chacha20`; `rekey`/`key` round trip on a file; reopen without key → `SQLITE_NOTADB`. |
| Databases interoperate in both directions. A WAL database written by v12 (SQLite 3.53.2) with our raw-hex `key = "x'…'"` pragma, an FTS5 table and a plain table was read, written and `quick_check`ed by v13, then reopened by v12; and the reverse. | Same probe, both orders. Default cipher is `chacha20` in both; the key pragma bypasses the KDF, so the SQLite3MultipleCiphers 2.3.5 → 2.4.0 move changes nothing on disk. |
| SQLite3MultipleCiphers 2.4.0 changes: rekey now supported in WAL mode; value-level-encryption SQL functions added. Neither matters here: the only `rekey` in the codebase (`lib/startup/db-encryption-converter.ts:90-96`) switches to `journal_mode = DELETE` first. | utelle/SQLite3MultipleCiphers release notes v2.3.6, v2.4.0. |
| Upstream better-sqlite3 13.0.0–13.0.3 API delta: **additions only** — `db.explain()`, `Statement.prototype.toString()`; `SqliteError` cross-realm fix; `table()` parameter validation tightened (we never call `db.table()`; the ten `.table(` hits are `console.table`). 13.0.1 fixed over-strict binding of plain objects from other realms (Jest). | WiseLibs/better-sqlite3 releases v13.0.0–v13.0.3; `diff` of `index.d.ts` v12→v13 shows only `explain` added. |
| Runtime loader: `lib/index.js` → `lib/binding.js#getBinding()` → `getPrebuildPath()` = `prebuilds/<platform>-<arch>.node` (musl detected via `process.report.getReport().header.glibcVersionRuntime`), falling back to `build/Debug|Release/better_sqlite3.node`. The `exports` map exposes only `.`, `./<platform>-<arch>`, `./package.json`; `require('better-sqlite3-multiple-ciphers/lib/binding.js')` throws, **but `require(path.join(pkgDir, 'lib', 'binding.js'))` by absolute path works** and `getPrebuildPath()` is exported from it. | Read from the tarball; probed. |
| Linux prebuilds require glibc ≥ 2.35. x86 Windows and armv7 Linux prebuilds are discontinued. Electron < 35 unsupported. | m4heshd v13.0.3 release notes. Docker `node:24-bookworm-slim` has glibc 2.36. |
| The prior hold on this upgrade and its reasons are recorded in [dependency-upgrade-safe-batch.md § Holds](dependency-upgrade-safe-batch.md). Everything in that row is addressed here except the shell (companion note). | — |
| `@types/better-sqlite3@9.6.0` is already shadowed: the package's own `types: index.d.ts` wins for the bare specifier `better-sqlite3`. | package.json `types` field in both v12 and v13. |

### Where the old layout is assumed (the blast radius)

Every reference to `build/Release/better_sqlite3.node`, `prebuild-install` or `node-gyp` outside changelogs and closed bug write-ups, as of this writing:

| File | What it assumes |
|---|---|
| `packages/quilltap/lib/native-modules.js` | `betterSqlite3BindingPath()` → `build/Release/better_sqlite3.node`; `readCompiledAbi()` scans for `node_register_module_v`; `betterSqlite3NeedsRebuild()`; `findBinFor()` looks for `prebuild-install`/`node-gyp`; `rebuildNativePackage()`; `ensureDatabaseNativeModule()`. Unchanged against v13 this would report "needs rebuild" on **every** CLI start (the file does not exist), find neither tool, and print a warning each time. |
| `packages/quilltap/bin/quilltap.js:18, :199-201, :351, :1207-1209` | Imports and calls the above. The alias link (`linkModule('better-sqlite3', …)`) is fine as is. |
| `jest.global-setup.js:1-68` | Same heal, for two candidate copies. Lines 70–103 (the `--no-sparkplug` guard) are unrelated and stay. |
| `__tests__/unit/packages/quilltap/native-rebuild.test.js` | Tests `findBinFor` / `rebuildNativePackage`. |
| `Dockerfile`, `Dockerfile.ci` | Comments say build tools are for "better-sqlite3, node-pty"; `npm rebuild` in `deps-prod` / `development` (harmless for v13, still needed for node-pty). |
| `scripts/build-push-docker.ts:97-99` | Runs `npm rebuild better-sqlite3` after a Docker build to restore the host binary. A no-op on v13. |
| `scripts/build-standalone-tarball.mjs:9-10, 241-245` | Comments ("compiled for the target platform"). The strip list itself (`better-sqlite3`) is still correct. |
| `.github/workflows/release.yml` ~81, ~170-171, ~214 | Comments about compiling the module in `Dockerfile.ci`. |
| `CLAUDE.md:112` | "`better-sqlite3` (node-gyp)". |
| `packages/quilltap/README.md:68` | "compiled for your platform when you install the npm package". |
| `README.md:64, :135` | Node 24+ prerequisite rows; need the Linux glibc floor. |
| `.claude/commands/release-checklist-12-cli.md:23` | "fine to `cd packages/quilltap && npm rebuild` on an ABI mismatch". |
| `docs/developer/features/complete/dependency-upgrade-safe-batch.md` | The Holds row. |
| `package-lock.json` | `node_modules/bindings`, `node_modules/prebuild-install` entries (check nothing else still needs them). |

Unaffected and should stay as they are: `next.config.js` (`serverExternalPackages` + `outputFileTracingIncludes` for `better-sqlite3`), `scripts/build-standalone-overlay.mjs` (child externals), `scripts/assert-standalone-portable.mjs`, `jest.config.ts` moduleNameMapper (both names → the mock), `__mocks__/better-sqlite3.ts`, `knip.json:27`, every `import Database from 'better-sqlite3'`.

## Steps

### 1. Manifests and lockfiles

- `package.json:84` → `"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@^13.0.3"`.
- `package.json:132` → remove `@types/better-sqlite3` (shadowed; confirm with `npx tsc` after the install — if anything breaks it will be an import of `better-sqlite3`'s namespace types, and the fix is the package's own `index.d.ts`, not re-adding the stub).
- `package.json:164` → remove `"better-sqlite3-multiple-ciphers@12.11.1": true` from `allowScripts` (v13 has no install script; a stale key is noise and a future-reader trap). Do not add a 13.x key.
- `packages/quilltap/package.json:40` → `"better-sqlite3-multiple-ciphers": "^13.0.3"`. Leave the version field to the release tooling (it is synced, not hand-bumped). The `postinstall` stays — it still services sharp and node-pty.
- `npm install` at the root and in `packages/quilltap` (it has its own `package-lock.json` and `node_modules`). Confirm:
  - `node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); console.log(require('better-sqlite3/package.json').version, d.prepare('select sqlite_version() v').get().v)"` prints `13.0.3 3.53.4`.
  - `ls node_modules/better-sqlite3/prebuilds` lists the eight files; `node_modules/better-sqlite3/build` does not exist.
  - `npm ls prebuild-install bindings` at the root reports neither (if something else pulls them in, leave them and note it in the CHANGELOG entry).
  - No compiler output appeared during either install.

### 2. CLI: replace the ABI heal with a load check **(delegable once the contract below is agreed)**

File: `packages/quilltap/lib/native-modules.js`. Keep the module's public names where call sites use them; change what they do.

**Remove** (and their exports): `readCompiledAbi`, `betterSqlite3NeedsRebuild`, `findBinFor`, `rebuildNativePackage`. Remove the sqlite branch from `ensureNativeModules()` (the `npm rebuild` it feeds does nothing for a package with no install script; sharp and node-pty keep their existing branches and `rebuildModules()` is unchanged). `reconcileNodePtySpawnHelper()` is untouched.

**Rewrite** `betterSqlite3BindingPath()` to answer "which file would the loader pick":

- resolve the package dir as today (`resolveModuleDir('better-sqlite3-multiple-ciphers') || resolveModuleDir('better-sqlite3')`);
- `require(path.join(pkgDir, 'lib', 'binding.js')).getPrebuildPath()` — absolute path on purpose, the `exports` map blocks the subpath form; guard the require in try/catch (a v12 copy has no `lib/binding.js`) and fall back to `build/Release/better_sqlite3.node` so the function still describes an older or from-source install truthfully;
- return the path, or `null` when neither exists.

**Add** a pure classifier, exported for tests, that turns a failed load into a reason:

```js
// classifyDriverLoadFailure({ platform, arch, prebuildPath, error }) → { kind, message, hint }
//   kind 'unsupported-platform' when prebuildPath is null (name the eight supported targets)
//   kind 'glibc-too-old'        when /GLIBC_(\d+\.\d+)/.test(error.message)  (floor is 2.35; hint: Docker image, or Ubuntu 22.04 / Debian 12 / RHEL 9 or newer)
//   kind 'load-failed'          otherwise (first line of the error; hint: reinstall the package, then file an issue with the line)
```

**Rewrite** `ensureDatabaseNativeModule()` on that: locate the path; if null → explain and `return false`; else `try { require(path) } catch (err)` → classify, print the message and hint, `return false`; else `return true`. It prints nothing when healthy, never rebuilds, never throws. Call sites (`bin/quilltap.js:351` via `ensureNativeModules()`, `:1207-1209` before subcommands, and the `require.main === module` postinstall entry) need no change; keep the `file-verify` exclusion.

Message tone: match the file's existing plain CLI style ("  Warning: …" / "  Try: …"), not the steampunk voice — this file has never used it.

Rewrite the header comment: the module keeps native modules *usable*, not *compiled*; the driver is Node-API and the only failure modes are a missing prebuild for this platform or a host libc older than the binary.

### 3. Jest global setup and tests **(delegable)**

- `jest.global-setup.js`: delete lines 1–68 (the `COPIES` / `healCopy` heal and the import from `native-modules.js`); keep `armSparkplugGuard()` and its comment block intact; `globalSetup` becomes just the guard. Update the file header to say the real-binding suites load a Node-API prebuild that needs no healing.
- Delete `__tests__/unit/packages/quilltap/native-rebuild.test.js`.
- Add `__tests__/unit/packages/quilltap/native-driver-check.test.js` (node docblock, global `jest`, mock-free, see the Jest conventions in `CLAUDE.md`): `betterSqlite3BindingPath()` returns an existing file ending in `<platform>-<arch>.node` on this machine; `classifyDriverLoadFailure` maps a synthetic `` `GLIBC_2.35' not found `` error to `glibc-too-old` with "2.35" in the message, a `null` path to `unsupported-platform`, and anything else to `load-failed`; `ensureDatabaseNativeModule()` returns `true` here and writes nothing to the console (spy on `console.error`/`console.log`).
- The real-binding suites (`db-backup`, `db-helpers`, `db-raw-sql-qt-text`, `graph-integrity`, `memories-commands` integration tests and the migration / content-hash / run-sql-handler suites) keep their `loadDriver()` fallback chains untouched; both copies they try are now v13 and need no rebuild. They must stay green.

### 4. Docker **(delegable; keep `Dockerfile` and `Dockerfile.ci` in lockstep as their comments demand)**

- Comments: build tools (`python3 make g++`) are now for **node-pty only** (no Linux prebuild). `npm rebuild` in `deps-prod` and `development` stays for the same reason. Fix the `Dockerfile.ci` header, which still says "compiles native modules (better-sqlite3, sharp)".
- **Prune to the image's architecture** in the `production` stage, immediately after `COPY --from=deps-prod /app/node_modules ./node_modules` and before `USER nextjs` (the files are root-owned): a single `RUN node -e …` that keeps `node_modules/better-sqlite3/prebuilds/linux-${process.arch}.node`, **fails the build if that file is absent**, deletes the other seven, and also deletes `node_modules/better-sqlite3/{deps,src,binding.gyp}` (compile-time sources, ~11 MB, unreferenced at runtime — the loader only ever reads `lib/` and `prebuilds/`). `node` is still present at that point; `npm` is removed later. The release workflow builds each arch on a native runner (no QEMU), so `process.arch` is the image's arch. Do not touch the `development` stage.
- `scripts/build-push-docker.ts:97-99`: delete the post-build `npm rebuild better-sqlite3` step and its comment.
- Verify with the local image build from `docs/developer/docker-test-plan.md` against V4test (never Friday): `ls node_modules/better-sqlite3/prebuilds` inside the container shows exactly one file, `quilltap db --tables` works in-container, and the server boots.

### 5. Standalone tarball and release workflow comments **(delegable)**

- `scripts/build-standalone-tarball.mjs:9-10` and `:241-245`: the module is stripped because it is platform-specific and **re-supplied** by `npx quilltap`'s install or the shell's injection — not "compiled". Strip list unchanged.
- `.github/workflows/release.yml` comment lines (~81, ~170-171, ~214): same correction. No step changes.
- Run `npm run build:standalone` locally (it ends with `assert-standalone-portable.mjs`) and confirm the assertion still passes — v13 puts eight `.node` files in the package, and the webpack build + strip must still leave none under `.next/`.

### 6. Boot diagnostic

In `lib/database/backends/sqlite/client.ts`, after the main database is opened and keyed (around line 86), log once at **info**: the driver package version (`require('better-sqlite3/package.json').version` — the `exports` map allows `./package.json`) and `select sqlite_version()`. Reason: the shell may inject a driver other than the one `package.json` declares, and this line is how a support thread learns which one actually ran. Guard for the Jest mock (its `prepare().get()` returns `undefined`). Parent process only; do not add it to the child client. Debug-level logs elsewhere per the logging convention.

### 7. Docs and records

- `CLAUDE.md:112` — describe `better-sqlite3` as a Node-API package with bundled per-platform prebuilds, no compile, and **add the one standing rule this decision needs:** *until the Electron shell ships v13, server code must not call v13-only driver API (`db.explain()`, `Statement.prototype.toString()`), because a 4.2.x shell injects a v12 build under this server.* Put it where the native-modules bullet is; it is a Technology Stack fact, not a chokepoint.
- `packages/quilltap/README.md:68` — prebuilt, not compiled; add the Linux floor (glibc ≥ 2.35: Ubuntu 22.04, Debian 12, RHEL 9 or newer; older hosts should run the Docker image) beside the Node 24+ requirement.
- `README.md:64` and `:135` — same glibc note, one clause each.
- `help/` — no help page states install prerequisites today (`grep -rl "npx quilltap" help/` hits data-retention, database-protection and themes only, none about installing). If that is still true, nothing to add; if an install page has appeared since, the glibc floor goes there in the house voice.
- `.claude/commands/release-checklist-12-cli.md:23` — drop the "fine to `npm rebuild` on an ABI mismatch" aside.
- `docs/developer/features/complete/dependency-upgrade-safe-batch.md` — turn the Holds row into a pointer to this spec.
- `docs/CHANGELOG.md` under `### 4.12-dev`: plain voice. Driver 12.11.1 → 13.0.3 (Node-API, bundled prebuilds, no compile, SQLite 3.53.4, SQLite3MultipleCiphers 2.4.0); CLI no longer rebuilds the driver and now explains a failed load; Docker image carries one prebuild; Linux glibc 2.35 floor for `npx quilltap`; `@types/better-sqlite3` removed; no data migration; databases written by either version open in the other.
- Finish by moving this file to `docs/developer/features/complete/` with an "As built" section (date, final versions, anything that deviated).

## Constraints the implementer must respect

- **Chokepoints are untouched.** Nothing in `lib/database/` beyond the one log line; no change to `applySqlcipherKey`, the text-codec function, FTS DDL, or any migration.
- **Friday is off limits.** Live checks run on V4test (`~/iCloud/Quilltap/V4test`, dev on :3005). Do not restart the user's dev server.
- **No `--lock-override`.** CLI checks are read-only unless a step says otherwise.
- **Spelling:** Quilltap, never the other thing — `npm run lint` sweeps every tracked file.
- **Commit** via `/commit` when the user asks, on `main`, no self-attribution trailer.

## Acceptance

All of the following, in this order:

1. `npm ci` from a clean `node_modules` at the root and in `packages/quilltap` runs with no compiler invocation and no network fetch of a prebuilt (the binary is in the tarball).
2. `npx tsc` clean with `@types/better-sqlite3` gone; `npm run lint` clean.
3. `npm run test:unit` and `npm run test:integration` green, with no `[jest] Native ABI mismatch` lines in the output and the new `native-driver-check` suite passing.
4. `node packages/quilltap/bin/quilltap.js --data-dir ~/iCloud/Quilltap/V4test db --tables` lists tables with **no** native-module warning printed first.
5. `npm run build:standalone` succeeds and the portability assertion passes.
6. Docker local build per the test plan: one prebuild in the image; in-container `quilltap db --tables`; server healthy.
7. V4test dev server boots on v13 and the new info line reads driver `13.0.3`, SQLite `3.53.4`; a chat round-trips; global search (FTS5) returns results; a backup runs.
8. `git grep -n "build/Release/better_sqlite3\|prebuild-install\|node-gyp"` returns hits only in `docs/CHANGELOG*.md`, `docs/releases/`, `docs/developer/bugs/fixed/`, and `package-lock.json` (if something else still needs those packages).

## Rollback

Revert the two manifest lines and both lockfiles; the v12 package reinstalls and compiles as before. Databases touched by v13 open under v12 (verified above), so there is no data step.

## As built

**Date:** 2026-10-28 · **Versions:** `better-sqlite3-multiple-ciphers` 13.0.3, SQLite 3.53.4, npm 11.21.0, Node 24.13.1.

Steps 1–7 were done as written, with three deviations, all from facts the spec had wrong:

1. **`@types/better-sqlite3` stays.** v13's `exports` map has no `types` condition, so under `moduleResolution: "bundler"` TypeScript cannot reach the package's own `index.d.ts` (TS7016 at every `import … from 'better-sqlite3'`). [dependency-upgrade-safe-batch.md](dependency-upgrade-safe-batch.md) had already noted this; 13.0.4 adds the entry. Keeping the v12-shaped `@types` also has an upside: it has no `explain()`, so the "no v13-only API until the shell ships v13" rule is compile-checked. Revisit when the driver ships a `types` export *and* the shell is on v13.
2. **npm still sees an install script.** The package keeps `binding.gyp`, so npm synthesizes `install: node-gyp rebuild` despite `gypfile: false`. Locally it only produced an `allowScripts` warning; in Docker, `npm rebuild` actually ran node-gyp, which compiled nothing but left a `build/` directory of stamp files. Instead of omitting the key, `package.json` `allowScripts` now **denies** it, version-less (`"better-sqlite3-multiple-ciphers": false`, via `npm install-scripts deny`), so it carries over to later 13.x versions. After that, the Docker build logs no install-scripts warning and the image's driver directory holds only `lib/`, `prebuilds/linux-<arch>.node`, `node_modules/node-addon-api`, `index.d.ts` and package metadata (3.0 MB, down from 34 MB).
3. **`ensureNativeModules()` calls `ensureDatabaseNativeModule()`.** The spec removed the sqlite branch but expected the main-launch call site to keep checking the driver. It now runs the explain-only check, and its result is ANDed into the return value. Nothing rebuilds.

`prebuild-install` and `bindings` left the root tree (`npm ls` empty) and the `packages/quilltap` tree.

### Acceptance results

| # | Result |
|---|---|
| 1 | Root and `packages/quilltap` installs: no compiler output; `prebuilds/` holds 8 files, no `build/`. (Run as `npm install` on the existing trees rather than a from-scratch `npm ci`.) |
| 2 | `npx tsc` clean (with `@types` kept, see 1 above); `npm run lint` clean. |
| 3 | `npm run test:unit`: 1245 suites / 17787 tests pass, including `native-driver-check`. `npm run test:integration` with `.claude/worktrees/` ignored: 25 suites / 269 tests pass. No ABI-mismatch lines. An unfiltered run also sweeps up stale agent worktrees under `.claude/worktrees/`, whose migration suites fail on each other's instance locks; that is unrelated to this change. |
| 4 | `quilltap --data-dir V4test db --tables`: lists tables with no warning. |
| 5 | `npm run build:standalone`: succeeds, and the portability assertion passes. |
| 6 | Local `docker build --target production` (arm64): prune step logs `kept linux-arm64.node`; one prebuild in the image; in-container `quilltap db --tables` works; server `healthy` on V4test. |
| 7 | Run as the production image on V4test (rather than the :3005 dev server): boot line `SQLCipher driver loaded` reads `driverVersion: 13.0.3, sqliteVersion: 3.53.4`; global search returned chat-title and message (FTS5) hits; a compact backup succeeded. **A chat round-trip was not run** (it would spend real provider calls). |
| 8 | `git grep` for the old layout terms hits only the changelogs, closed bug write-ups, this spec and the shell notes. |
