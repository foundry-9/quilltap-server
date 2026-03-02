# Quilltap Changelog

## Recent Changes

### 3.2-dev

- feat: Connection profile custom sort order — profiles now have a persistent `sortIndex` field with drag-and-drop reordering in Settings via @dnd-kit, a "Reset Sort Order" button to restore default ordering (default first, cheap last, alphabetical), and all profile dropdowns/selectors across the app honor the custom sort order; includes database migration to initialize existing profiles with smart default ordering
- fix: Chat composer textarea now auto-focuses when it's the user's turn — the page's `inputRef` was never connected to the actual textarea DOM element (ChatComposer created its own internal ref), so all post-generation focus calls were no-ops; now the page passes its ref into ChatComposer via a new `inputRef` prop, enabling focus on page load, after AI responses, and after multi-character turn cycles
- docs: Clarify workspace path semantics in shell tool descriptions — LLMs now see explicit guidance that paths are relative to the current workspace directory, that absolute paths (leading `/`) refer to the VM root filesystem and will be rejected, and that `workspace:` prefixes in `cp_host` should use relative paths
- feat: Shell interactivity — LLMs can execute shell commands inside Lima VM and Docker sandbox environments. Six tools: `chdir`, `exec_sync`, `exec_async`, `async_result`, `sudo_sync`, and `cp_host`. Includes workspace acknowledgement modal, sudo approval modal, Electron workspace file watcher with binary detection and OS quarantine markers, command warning system for suspicious commands, and async process registry for background commands
- docs: Shell tools help page documents that packages installed via `apk add`/`apt-get` inside Docker containers are ephemeral and lost on restart; suggests keeping a setup script in the workspace or building a custom Docker image
- ci: Add Discord commit notification webhook to CI workflow — sends commit message, branch, link, and author to Discord on push via `tristanbudd/discord-commit-github-action`
- fix: First-startup race condition — page rendered without sidebar and didn't redirect to setup wizard; session provider now keeps "loading" status on 503 instead of "unauthenticated", and PepperVaultGate retries on failure instead of silently giving up
- feat: Seed avatar images for Lorian & Riya on first startup — avatar `.webp` files ship in `first-startup/avatars/`, are uploaded to file storage, and set as `defaultImageId` on the corresponding characters after `.qtap` import
- fix: Remove legacy JSONL file records and storage from source tree — `public/data/files/files.jsonl` and `public/data/files/storage/` contained old development artifacts (14 file records, 1 physical image) that the `migrate-legacy-jsonl-files-v1` migration was importing into every fresh database, polluting new installs with orphaned records
- feat: Add Lorian & Riya as seed characters with 42 memories via `.qtap` import — new `first-startup/imports/` directory holds `.qtap` bundles that are imported with `skip` conflict strategy on first startup, reusing the existing import service
- fix: Seed data files now resolve via `process.cwd()` instead of `__dirname` — Next.js rewrites `__dirname` to `.next/dev/server/` so the JSON character files and `.qtap` imports were never found; also added `first-startup/` to `outputFileTracingIncludes` for standalone builds
- chore: Started dev version 3.2.0

### 3.1.2

- fix: Remove dead mount-points references from legacy JSONL files migration — the INSERT used `mountPointId`, `s3Key`, and `s3Bucket` columns that no longer exist on fresh databases (mount-points system was removed in v2.9), causing first-startup migration failure

### 3.1.1

- fix: npm `quilltap` package now publishes with the correct release version — the release workflow was publishing whatever version was already in `packages/quilltap/package.json` (e.g., `3.1.0-dev.36`) instead of the git tag version (e.g., `3.1.0`), causing the CLI to look for a non-existent GitHub Release asset; added `npm version` step to sync package version to the release tag before publishing
