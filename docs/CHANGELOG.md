# Quilltap Changelog

## Recent Changes

### 3.0-dev

- feat: Phase 2 — Windows/WSL2 support
  - Added VM manager abstraction (`electron/vm-manager.ts`): `IVMManager` interface and `createVMManager()` factory function
  - Added WSL2 manager (`electron/wsl-manager.ts`): imports/starts/stops/unregisters WSL2 distros using `wsl.exe`
  - Added WSL2 init script (`lima/wsl-init.sh`): entry point for Quilttap inside WSL2 with data directory resolution
  - Added `wsl2` Docker stage to `Dockerfile`: bakes in provisioning that Lima YAML does at creation time on macOS
  - Updated `electron/constants.ts` with platform-aware rootfs filename, cache directory, and WSL paths
  - Updated `electron/main.ts` to use VM manager factory and platform-agnostic variable names
  - Updated `electron/lima-manager.ts` to implement `IVMManager` interface
  - Added `checkPrerequisites()` to both managers for startup validation (WSL2 installed, limactl available)
  - Updated `scripts/build-rootfs.sh` with `--platform` flag for multi-arch builds (arm64/amd64)
  - Updated `electron-builder.yml` with Windows NSIS target and mac-only `extraResources`
  - Added Windows icon (`electron/resources/icon.ico`) generated from existing PNG
  - Added npm scripts: `electron:build:mac`, `electron:build:win`
  - Created Windows troubleshooting guide (`docs/WINDOWS.md`)
  - Added `scripts/build-push-docker.ps1`: PowerShell mirror of `build-push-docker.sh` for Windows
- fix: Use `cross-env` for npm scripts with inline env vars (`LOG_LEVEL`, `ELECTRON_DEV`) for Windows compatibility
- fix: Made path assertions in tests cross-platform (use `path.join()` instead of hardcoded `/` separators) for paths.test, config.test, plugin-route-loader.test
- fix: Increased test timeouts for backup-parser and plugin-initialization tests that exceeded the default 5s under slower I/O (WSL2)
- feat: Phase 1.3 — Electron launcher for Lima VM
  - Added Electron main process (`electron/main.ts`): splash screen → Lima boot → health poll → main window orchestration
  - Added Lima manager (`electron/lima-manager.ts`): wraps limactl create/start/stop/delete with env isolation
  - Added download manager (`electron/download-manager.ts`): first-run rootfs download with progress, retries, and caching
  - Added health checker (`electron/health-checker.ts`): polls `/api/health` until server is ready
  - Added splash screen (`electron/splash/`): dark-themed loading UI with progress bar, error/retry states, and IPC bridge
  - Added preload script (`electron/preload.ts`): context bridge for secure splash ↔ main process communication
  - Added Electron Builder config (`electron-builder.yml`): macOS zip packaging (DMG disabled due to framework symlink bug)
  - Added macOS entitlements (`electron/entitlements.mac.plist`): virtualization, unsigned memory, network client
  - Added `scripts/stage-lima.sh`: stages limactl and guest agent binaries into the Electron bundle
  - Generated app icon (`electron/resources/icon.icns`, `icon.png`) from `public/quill.svg`
  - Added npm scripts: `electron:compile`, `electron:dev`, `electron:build`
  - Dev mode (`ELECTRON_DEV=1`) skips Lima and connects directly to `localhost:3000`
- fix: File storage paths are now portable across platforms (Lima, Docker, macOS, Linux) — default local mount point uses runtime-resolved path instead of DB-stored absolute path
- feat: Phase 1a — Lima VM boots Quilltap from the command line
  - Added Lima VM template (`lima/quilltap.yaml`): VZ driver, Alpine Linux arm64, VirtioFS data mount, port forwarding 3000→5050, OpenRC service provisioning
  - Added rootfs build script (`scripts/build-rootfs.sh`): exports Docker production image as a tarball importable by Lima and WSL2
  - Added `isLimaEnvironment()` to `lib/paths.ts` to prevent Docker false-positive when running inside a Lima VM
  - Added `quilltap-linux-*.tar.gz` to `.gitignore` for rootfs build artifacts
- Replaced Firecracker with Lima+VZ (macOS) / Lima+WSL2 (Windows) cross-platform VM strategy
- Updated ROADMAP with phased architecture: shared guest image and orchestration, thin platform-specific VM backends
- Started 3.0 dev branch for Lima/Firecracker virtualization

### 2.12-dev

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
