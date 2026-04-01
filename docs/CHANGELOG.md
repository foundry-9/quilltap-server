# Quilltap Changelog

## Recent Changes

### 4.0-dev

- fix: Concierge DETECT_ONLY mode now shows a moderation-aware message when the provider returns an empty response for flagged content, instead of a generic "empty response" error; suggests enabling Auto-Route mode
- refactor: unify all LLM provider interfaces into four canonical shapes — TextProvider (text→text), ImageProvider (text→image), EmbeddingProvider (text→vector), ScoringProvider (text+candidates→scores); move canonical definitions to `@quilltap/plugin-types` providers/ directory; remove `generateImage()` from text provider interface; generalize moderation into ScoringProvider with documented reranking/classification support; update all plugins and lib/ to use new names with backward-compatible aliases
- chore: reduce Commonplace Book memory recap limits from 50/20/10 to 20/10/5 (high/medium/low importance tiers)
- chore: tag-for-release command now uses linear strategy exclusively — removed merge-back strategy and all strategy selection logic
- chore: add `--linear` strategy option to tag-for-release command — tree-copy approach that keeps main linear by skipping merge-back from release; default behavior unchanged
- fix: character optimizer "Refine from Memories" UI — frequency badges in behavioral tendencies now wrap instead of overflowing the dialog; textarea in edit mode is taller and resizable, filling available space
- feat: budget-driven context compression — replace count-based compression trigger with token-budget-aware system; compute `max_available = maxContext - 2 * maxTokens` from connection profile, compress conversation history (Phase 1) when it exceeds 50% of budget and recalled memories (Phase 2) when they exceed 20%; add `maxTokens` field to connection profiles with migration; new `compressMemories()` cheap LLM task; status events for each compression phase shown above ChatComposer
- feat: add model classes (Compact/Standard/Extended/Deep) as capability tier definitions for connection profiles, with optional `maxContext` override for context window size; new `GET /api/v1/model-classes` endpoint, migration adds `modelClass` and `maxContext` columns
- chore: update remove-old-dev-tags command to also delete GitHub releases before tags, filter release list to prereleases/drafts only, and remove csebold/quilltap Docker registry references
- fix: image "copy to clipboard" button in Electron now works via IPC bridge instead of unsupported `navigator.clipboard.write()` API; browser fallback unchanged
- fix: scenario selection ignored when starting chats — selected scenario was not persisted on the chat, so the runtime system prompt builder always used the first scenario in the array; now stores resolved scenario text (`scenarioText`) on the chat at creation and uses it for all subsequent messages; also fixes UI useEffect that reset scenario selection when changing connection profiles or system prompts
- fix: remove proxy rate limiter that caused 429 errors during app startup
- feat: detect quilltap-shell via `QUILLTAP_SHELL` env var (version string) and `QUILLTAP_SHELL_CAPABILITIES` (comma-delimited capability flags); exposed in `/api/v1/system/data-dir` response and capabilities report. Env vars pass through in all modes (direct, Docker `-e`, Lima/WSL2 inherited env).
- feat: footer now shows shell version and composite backend mode (Electron, Electron+Docker, Electron+VM) when running under quilltap-shell
- ci: restore rootfs tarball builds (quilltap-linux-arm64.tar.gz, quilltap-linux-amd64.tar.gz) for Lima/WSL2 VM modes
- ci: restore wsl2 Docker target in Dockerfile.ci and build-rootfs.ts script
- refactor: remove Electron build infrastructure, Lima/WSL VM management from this repository
- refactor: Electron desktop app moved to separate repository (quilltap-shell)
- ci: remove csebold/quilltap Docker registry; only foundry9/quilltap is published
- ci: simplify release workflow to produce standalone tarball, Docker images, rootfs tarballs, and npm package
- ci: make Windows Electron build optional in release workflow
- fix: standalone tarball now includes sharp JS wrapper and @img/colour (only native binaries are stripped)
- chore: update npm dependencies across root, packages, and plugins
