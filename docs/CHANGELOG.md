# Quilltap Changelog

## Recent Changes

### 4.0-dev

- refactor: continue decomposing `lib/services/chat-message/orchestrator.service.ts` by extracting assistant response persistence, completion events, token tracking, RNG follow-up, and memory/summary triggers into `message-finalizer.service.ts`, with targeted coverage for the new finalization flow
- refactor: begin decomposing `lib/services/chat-message/orchestrator.service.ts` by extracting multi-character turn chaining into `turn-orchestrator.service.ts`, adding targeted chain execution tests while preserving the existing message streaming API
- refactor: split `lib/memory/cheap-llm-tasks` into domain-focused modules for shared execution, memory work, chat summarization/titles, image/scene handling, and compression while preserving the original import path as a compatibility entrypoint
- refactor: move ZodError and unhandled error catching into API middleware; remove ~97 try-catch blocks from 60 route files (~1,084 lines of boilerplate eliminated)
- style: convert 1,314 raw Tailwind visual classes to `qt-*` semantic theme classes across 234 files — backgrounds, text colors, border colors, and shadows now use theme-overridable CSS variables
- refactor: remove vestigial `userId` ownership checks from 45 API route files (single-user app); flatten `app/(authenticated)/` route group into `app/` to eliminate shell-escaping issues with parenthesized directory names
- docs: add 4.0.0 release notes
- docs: update README with Desktop App–first installation, model classes, auto-configure, budget compression, Non-Quilltap Prompt generator; update API.md to v4.0-dev with 20 new route groups; remove stale S3/mount points from DEVELOPMENT.md
- fix: add missing `scenarioText`, `modelClass`, `maxContext`, `maxTokens` fields to `.qtap` export schema; bump `@quilltap/theme-storybook` to 1.0.28 for chat message width variable update
- chore: remove 8 development `logger.debug` calls from 4 files (chats route, characters repository, prompt-templates repository, auto-configure service)
- refactor: remove dead code (`lib/image-gen/base.ts`, `@quilltap/theme-storybook` dependency), replace raw `NextResponse.json()` with response helpers in 9 API routes for conformance
- test: add unit and regression tests for 4.0-dev features — model classes, system prompt registry, memory recap, external prompt generator, auto-configure service, scenario persistence, orphaned file cleanup safety, Character Optimizer JSON repair and frequency guards, greeting content filter detection, Concierge DETECT_ONLY empty response handling, and gatekeeper category mapping/caching (~189 new tests)
- ci: release workflow puts Desktop App first in installation section and pins link to the quilltap-shell release that was current at build time
- ci: release workflow now includes release notes from `docs/releases/{version}.md` in GitHub releases; production releases from the release branch require this file to exist
- fix: `--qt-*` CSS variable defaults now apply to all themes via `[data-theme]` selector instead of `[data-theme="default"]` — fixes missing textarea padding, button styles, and other tokens on non-default themes after redundant declarations were stripped from bundled themes
- refactor: strip redundant `--qt-*` CSS variables from all bundled themes — variables matching `_variables.css` defaults are removed so themes only declare overrides; reduces theme file sizes 6-34%; update `create-quilltap-theme` bundle template with complete variable reference (all ~250 `--qt-*` vars commented out with defaults)
- style: widen chat message row default from 800px to 900px and increase row width from 90% to 95% for more readable message widths closer to modern chat UIs; fix code blocks inside list items not wrapping text by adding explicit wrap rules in `_chat.css`
- feat: auto-configure connection profiles — new button on profile cards and in the edit/create modal that performs web searches for model specifications and recommended settings, sends results to the default LLM for structured analysis, and applies optimal maxContext, maxTokens, temperature, topP, modelClass, and isDangerousCompatible settings; falls back to cheap LLM for JSON cleanup if needed
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
