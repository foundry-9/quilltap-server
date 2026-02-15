# Quilltap Changelog

## Recent Changes

### 2.12-dev

- fix: SQLite null hydration now converts null to undefined for Zod `.optional()` compatibility — fixes Docker validation errors on `dangerFlags`, `context`, `description`, and other nullable columns
- fix: Corrupted JSON columns no longer crash chat loading — hydration uses `fromJsonSafe` instead of `fromJson`, logging warnings for corrupted data instead of throwing
- fix: Corrupted individual chat messages are now skipped instead of failing the entire chat load — `getMessages` uses `safeParse` per message with warning logs for invalid rows
- fix: Empty strings in JSON columns (`rawResponse`, `attachments`, `debugMemoryLogs`) no longer crash chat loading — `fromJson`/`fromJsonSafe` now guard against empty strings, added missing `renderedHtml` and `dangerFlags` columns to `ChatMessageRowSchema`, and added migration to fix existing data
- fix: Story backgrounds and images now work in Docker — `getFilePath()` always returns API route (`/api/v1/files/{id}`) instead of legacy `data/files/storage/` paths that are unreachable in Docker's standalone build
- fix: Legacy files without `storageKey` are now served via the API download handler with a fallback to `public/data/files/storage/`
- feat: Added migration `migrate-legacy-jsonl-files-v1` to import legacy JSONL file entries into SQLite and copy physical files to the centralized files directory
- fix: Google Gemini 3 models no longer fail with tool-calling errors — `supportsToolCalling()` now excludes `gemini-3*`, `gemini-pro-latest`, and `gemini-flash-latest`; model metadata reports `missingCapabilities: ['function-calling']` for these models
- fix: Orchestrator automatically retries without tools when any provider returns a "tool use unsupported" error, preventing hard failures on models that don't support function calling
- Documented the new game-and-state subsystem incarnation, "Pascal the Croupier"
- Started 2.12 dev branch

### 2.11.0

- build: Removed dead Docker infrastructure (docker-compose files, Dockerfile.allinone, Nginx/Certbot/MinIO configs)
  - Deleted `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.test.yml`, `Dockerfile.allinone`
  - Removed `docker/start-allinone.sh`, `docker/init-letsencrypt.sh`, `docker/nginx.conf`
  - Removed `build:docker:rebuild`, `start:docker`, `stop:docker` npm scripts
- build: Added `HOST_REDIRECT_PORTS` support to Docker image for transparent host port forwarding
  - New `docker/entrypoint.sh` script sets up socat forwarders for comma-separated port list
  - Enables Docker users to reach host services (Ollama, LM Studio, MCP servers) at `localhost` URLs
  - Installed socat in the production Docker image
- feat: Added Docker startup scripts (`scripts/start-quilltap.sh` and `scripts/start-quilltap.ps1`)
  - Platform detection sets correct default data directory (macOS, Linux, Windows)
  - Auto-detects Ollama on port 11434 and adds it to `HOST_REDIRECT_PORTS`
  - Supports `--data-dir`, `--port`, `--redirect-ports`, `--tag`, `--env`, `--restart`, `--dry-run`
  - Checks for existing containers before creating duplicates
  - `--no-auto-detect` flag to skip service detection
- chore: Removed all authentication infrastructure (JWT, OAuth, Google sign-in)
  - Removed `JWT_SECRET`, `AUTH_DISABLED`, `OAUTH_DISABLED`, `GOOGLE_CLIENT_*` from .env.example and docs
  - Removed authentication sections from DEPLOYMENT.md
  - Simplified README.md Quick Start — no configuration required for local use
- docs: Rewrote all Docker documentation around `docker run` and startup scripts
  - README.md Quick Start now recommends startup scripts with `docker run` as fallback
  - Updated DEVELOPMENT.md, docs/DEPLOYMENT.md, docs/DATABASE_ABSTRACTION.md, docs/BACKUP-RESTORE.md
  - Added reverse proxy examples (Nginx, Caddy) to DEPLOYMENT.md
  - Added Docker user notes to help files (startup-wizard, connection-profiles, embedding-profiles)
  - Cleaned up stale references in .env.example, package.json, knip.json, lib/paths.ts, DataDirectorySection component
- build: Updated Docker build process to make sure Windows and macOS were covered
- fix: Import of large .qtap files (>10MB) now works correctly
  - Added `proxyClientMaxBodySize: '100mb'` to next.config.js to prevent proxy body truncation
  - Frontend import now sends the original file via FormData instead of re-serializing JSON
  - Backend import-execute endpoint now supports FormData uploads (matching import-preview)
- fix: Corrected table names in user ID migration
  - `prompts` → `prompt_templates`, `messages` → `chat_messages` to match actual SQLite schema
  - Removed `memories` from migration list (no `userId` column in that table)
- fix: Participants sidebar now always shows in chat conversation page
  - Removed `isMultiChar` gate so sidebar renders even with zero participants
  - Users can now add characters to chats that have no participants
  - Updated empty state message to "Add a character to get started"
- fix: Story background files now correctly stored in `/story-backgrounds/` folder
  - Added `projectId` and `folderPath` to file metadata when saving generated story backgrounds
  - Auto-create `/story-backgrounds/` folder record in database on first background generation per scope
  - Fixed project `list-files` API response missing `folderPath` and other fields needed by FileBrowser UI
- Started 2.11 dev branch
