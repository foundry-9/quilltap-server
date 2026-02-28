# Quilltap Changelog

## Recent Changes

### 3.2-dev

- feat: Add Lorian & Riya as seed characters with 42 memories via `.qtap` import — new `first-startup/imports/` directory holds `.qtap` bundles that are imported with `skip` conflict strategy on first startup, reusing the existing import service
- fix: Seed data files now resolve via `process.cwd()` instead of `__dirname` — Next.js rewrites `__dirname` to `.next/dev/server/` so the JSON character files and `.qtap` imports were never found; also added `first-startup/` to `outputFileTracingIncludes` for standalone builds
- chore: Started dev version 3.2.0

### 3.1.2

- fix: Remove dead mount-points references from legacy JSONL files migration — the INSERT used `mountPointId`, `s3Key`, and `s3Bucket` columns that no longer exist on fresh databases (mount-points system was removed in v2.9), causing first-startup migration failure

### 3.1.1

- fix: npm `quilltap` package now publishes with the correct release version — the release workflow was publishing whatever version was already in `packages/quilltap/package.json` (e.g., `3.1.0-dev.36`) instead of the git tag version (e.g., `3.1.0`), causing the CLI to look for a non-existent GitHub Release asset; added `npm version` step to sync package version to the release tag before publishing
