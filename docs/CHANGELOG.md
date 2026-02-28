# Quilltap Changelog

## Recent Changes

### 3.2-dev

- fix: Remove dead mount-points references from legacy JSONL files migration — the INSERT used `mountPointId`, `s3Key`, and `s3Bucket` columns that no longer exist on fresh databases (mount-points system was removed in v2.9), causing first-startup migration failure
- chore: Started dev version 3.2.0

### 3.1.1

- fix: npm `quilltap` package now publishes with the correct release version — the release workflow was publishing whatever version was already in `packages/quilltap/package.json` (e.g., `3.1.0-dev.36`) instead of the git tag version (e.g., `3.1.0`), causing the CLI to look for a non-existent GitHub Release asset; added `npm version` step to sync package version to the release tag before publishing
