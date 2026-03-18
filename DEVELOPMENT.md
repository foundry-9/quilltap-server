# Development Guide

This document covers the development setup and project structure for Quilltap.

## Project Structure

```text
quilltap/
├── app/                      # Next.js App Router entry point
│   ├── (authenticated)/      # Protected routes (characters, chats, settings, about, tools)
│   ├── api/                  # API route handlers (auth, chats, characters, providers, backups, etc.)
│   ├── auth/                 # Auth flows (legacy routes, single-user session)
│   ├── dashboard/            # Dashboard page
│   ├── styles/               # Qt-* utility class stylesheets
│   ├── globals.css           # Root styles and Tailwind imports
│   ├── layout.tsx            # Root layout (providers, themes, fonts)
│   └── page.tsx              # Public landing page
├── components/               # Reusable UI components
│   ├── chat/                 # Chat-related components (including impersonation UI)
│   ├── character/            # Character management components
│   ├── memory/               # Memory system components
│   ├── settings/             # Settings tab components
│   ├── tags/                 # Tag system components
│   ├── layout/               # Layout wrapper components
│   ├── providers/            # React context providers
│   ├── ui/                   # Generic UI components (Avatar, Badge, Button, etc.)
│   ├── dashboard/            # Dashboard-specific components
│   ├── tools/                # Tools and utilities components
│   ├── images/               # Image handling and gallery components
│   ├── search/               # Search interface components
│   ├── tabs/                 # Tab navigation components
│   ├── profile/              # User profile components
│   ├── files/                # File management components
│   ├── state/                # Client-side state management components
│   ├── clothing-records/     # Character clothing/appearance records
│   ├── physical-descriptions/ # Physical description components
│   ├── homepage/             # Home page components
│   └── character-delete-dialog.tsx # Character deletion confirmation dialog
├── electron/                 # Electron main process (launcher, VM management)
│   ├── main.ts               # Electron entry point, orchestrates boot sequence
│   ├── vm-manager.ts         # IVMManager interface + createVMManager() factory
│   ├── lima-manager.ts       # macOS: Lima VM lifecycle (create, start, stop, status)
│   ├── wsl-manager.ts        # Windows: WSL2 distro lifecycle (import, start, terminate)
│   ├── embedded-manager.ts   # Embedded server using Electron's Node.js (ELECTRON_RUN_AS_NODE=1)
│   ├── docker-manager.ts     # Docker image/container lifecycle management
│   ├── health-checker.ts     # Polls /api/health until app is ready
│   ├── download-manager.ts   # Downloads rootfs tarball with progress/retry
│   ├── disk-utils.ts         # Disk usage checks and free space validation
│   ├── startup-log.ts        # Startup logging and boot diagnostics
│   ├── crash-guard.ts        # Crash recovery and automatic restart handling
│   ├── settings.ts           # Persistent Electron app settings storage
│   ├── constants.ts          # Shared constants (ports, timeouts, platform-aware paths)
│   ├── types.ts              # TypeScript types for Electron IPC
│   ├── preload.ts            # Context-isolated IPC bridge for splash screen
│   ├── splash/               # Splash screen HTML/CSS/JS/images
│   ├── resources/            # App icons (icns, ico, png) and staged Lima binaries
│   ├── entitlements.mac.plist # macOS code signing entitlements
│   ├── notarize.js           # macOS notarization script for release builds
│   └── tsconfig.json         # Electron-specific TypeScript config
├── lima/                     # Lima/WSL2 VM configuration
│   ├── quilltap.yaml         # Lima VM template (macOS: Alpine Linux, VZ hypervisor, mounts)
│   └── wsl-init.sh           # WSL2 init script (Windows: starts Node.js server)
├── lib/                      # Domain logic and utilities
│   ├── auth/                 # Single-user mode and session management
│   ├── chat/                 # Chat logic (context-manager, turn-manager, tool execution)
│   ├── file-storage/         # File storage manager (local, S3, plugin backends)
│   ├── llm/                  # LLM utilities (formatting, pricing, streaming)
│   ├── memory/               # Memory and embedding logic
│   ├── paths.ts              # Platform-aware data directory resolution
│   ├── plugins/              # Plugin registry and loader
│   ├── s3/                   # S3 storage utilities
│   ├── sillytavern/          # SillyTavern import/export
│   ├── tools/                # Tool definitions (image generation, web search, memory)
│   └── backup/               # Backup and restore logic
├── help/                     # User documentation (Markdown, built to MessagePack)
├── migrations/               # Database migration scripts and migration-only files
├── plugins/                  # Plugin source code
│   ├── dist/                 # Built plugins (loaded at runtime)
│   └── src/                  # Plugin source files
├── packages/                 # Published npm packages for plugin development
│   ├── plugin-types/         # TypeScript types (@quilltap/plugin-types)
│   ├── plugin-utils/         # Plugin utilities (@quilltap/plugin-utils)
│   ├── theme-storybook/      # Storybook preset for theme development (@quilltap/theme-storybook)
│   └── create-quilltap-theme/ # Scaffolding CLI for new themes
├── prompts/                  # Sample system prompt templates
├── hooks/                    # Custom React hooks
├── types/                    # TypeScript type augmentations
├── __tests__/                # Jest test files (unit and integration)
├── __mocks__/                # Test mocks for auth, providers, etc.
├── docs/                     # Documentation (API, deployment, backup guides)
├── features/                 # Feature roadmap and spec documents
│   └── complete/             # Completed feature specifications
├── docker/                   # Docker configuration (entrypoint script)
├── scripts/                  # Utility scripts (migrations, cleanup, builds)
│   ├── build-rootfs.ts       # Build Docker image and export rootfs tarball
│   ├── build-electron-server.ts # Stage Next.js standalone output for Electron embedding (native module rebuild)
│   └── stage-lima.ts         # Download and stage Lima binaries into electron/resources/
├── public/                   # Static assets (icons, manifest)
├── website/                  # Website assets (images, splash graphics)
├── certs/                    # Development TLS certificates
├── logs/                     # Application log files (when LOG_OUTPUT includes file)
├── Dockerfile                # Production Docker build (also used for rootfs)
├── electron-builder.yml      # Electron Builder packaging configuration
├── proxy.ts                  # Local HTTPS proxy helper for dev
├── jest.config.ts            # Jest unit test configuration
├── jest.integration.config.ts # Jest integration test configuration
├── tailwind.config.ts        # Tailwind CSS configuration
├── eslint.config.mjs         # ESLint configuration
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies and npm scripts
```

## Development Workflow

### Prerequisites

- **Node.js 22+**
- **SQLite with SQLCipher** (automatic with better-sqlite3-multiple-ciphers) — note that the standard `sqlite3` CLI cannot open Quilltap's encrypted database files; use `npx quilltap db` for direct database access
- **File storage**: Local filesystem (default) or optionally S3-compatible storage

For Electron development:

- **Docker** — Required for building the rootfs tarball (with buildx support)
- **macOS**: **Xcode Command Line Tools** — Install via `xcode-select --install` (Lima is downloaded automatically during build)
- **Windows**: **WSL2** — Run `wsl --install` in PowerShell as Administrator

### Running Locally

```bash
# Install dependencies
npm install

# Build plugins (required before first run)
npm run build:plugins

# Start the development server with HTTPS
npm run devssl

# Or plain HTTP
npm run dev

```

The application will be available at [https://localhost:3000](https://localhost:3000)

### Running with Docker

```bash
# Run from Docker Hub
docker run -d --name quilltap -p 3000:3000 -v ~/.quilltap:/app/quilltap foundry9/quilltap

# View logs
docker logs -f quilltap
```

### Running with Electron (Primary Distribution)

Quilltap's primary distribution is an Electron app with three runtime modes for the backend:

**Runtime Modes:**

| Mode | Backend | Platforms | Notes |
|------|---------|-----------|-------|
| **VM** | Lima (macOS) or WSL2 (Windows) Alpine Linux guest | macOS, Windows | Primary mode — runs in a lightweight VM |
| **Docker** | Docker container | All | Optional — uses local Docker daemon |
| **Embedded** | Electron's bundled Node.js (`ELECTRON_RUN_AS_NODE=1`) | All | Direct mode — no VM or container needed |

```text
# VM mode (macOS)
Electron (host) → Lima VM (Alpine Linux guest) → Node.js + Quilltap (port 3000)
                    ↕ VirtioFS file sharing        ↕ Port forward: 5050 → 3000

# VM mode (Windows)
Electron (host) → WSL2 distro (Alpine Linux)   → Node.js + Quilltap (port 5050)
                    ↕ Plan 9 / /mnt/c/ auto-mount  ↕ WSL2 localhost forwarding

# Embedded mode (all platforms)
Electron (host) → process.execPath with ELECTRON_RUN_AS_NODE=1 → server.js (port 5050)
```

The VM manager interface (`electron/vm-manager.ts`) abstracts the platform differences. `LimaManager` handles macOS, `WSLManager` handles Windows. `EmbeddedManager` (`electron/embedded-manager.ts`) spawns the staged Next.js standalone server using Electron's bundled Node.js. The factory function `createVMManager()` selects the right backend at runtime.

**Per-instance window bounds** are persisted — each data directory remembers its own window size, position, and maximized state across restarts.

**Development mode** (skip the VM, connect to your local dev server):

```bash
# Terminal 1: Start the Next.js dev server
npm run dev

# Terminal 2: Launch Electron pointing at localhost:3000
npm run electron:dev
```

In dev mode (`ELECTRON_DEV=1`), Electron skips all VM operations and connects directly to `http://localhost:3000`.

**Building the full Electron app:**

```bash
# --- macOS ---

# 1. Build the rootfs tarball (Docker image → Alpine guest filesystem)
npm run build:electron:rootfs

# 2. Build the Electron app (downloads Lima from GitHub, compiles + packages)
npm run electron:build:mac

# --- Windows ---

# 1. Build the amd64 rootfs tarball (uses wsl2 Docker target)
npm run build:electron:rootfs -- --platform linux/amd64

# 2. Build the Electron app (compiles + packages NSIS installer)
npm run electron:build:win
```

**Key paths (macOS):**

| What                 | Where                                                               |
| -------------------- | ------------------------------------------------------------------- |
| Lima home directory  | `~/.qtlima/` (short path due to macOS 104-char socket limit)        |
| VM template          | `lima/quilltap.yaml`                                                |
| Rootfs cache         | `~/Library/Caches/Quilltap/lima-images/quilltap-linux-arm64.tar.gz` |
| Lima binary cache    | `~/Library/Caches/Quilltap/lima-binaries/` (downloaded from GitHub) |
| Staged Lima binaries | `electron/resources/lima/`                                          |
| CLT verified marker  | `~/.qtlima/.clt-verified`                                           |
| Compiled Electron JS | `dist-electron/`                                                    |

**Key paths (Windows):**

| What                 | Where                                                           |
| -------------------- | --------------------------------------------------------------- |
| WSL2 distro install  | `~/.qtvm/quilltap/`                                             |
| Rootfs cache         | `%LOCALAPPDATA%\Quilltap\vm-images\quilltap-linux-amd64.tar.gz` |
| App data             | `%APPDATA%\Quilltap\`                                           |
| Compiled Electron JS | `dist-electron/`                                                |

**VM details (macOS):**

- **Guest OS**: Alpine Linux 3.21 (aarch64)
- **Resources**: 2 CPUs, 2GB RAM, 10GB disk
- **Hypervisor**: VZ (Virtualization.framework, no QEMU)
- **File sharing**: VirtioFS — mounts `~/Library/Application Support/Quilltap` into the guest at `/data/quilltap`
- **Port forwarding**: Host 5050 → Guest 3000

**VM details (Windows):**

- **Guest OS**: Alpine Linux 3.21 (x86_64) via WSL2
- **Hypervisor**: Hyper-V (via WSL2, built into Windows 10/11)
- **File sharing**: Plan 9 auto-mount — Windows drives available at `/mnt/c/`, `/mnt/d/`, etc.
- **Port forwarding**: WSL2 automatic localhost forwarding (port 5050)
- **Init script**: `lima/wsl-init.sh` (baked into rootfs, runs Node.js server directly)

### Testing

```bash
# Run all tests (unit + integration)
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run E2E tests with Playwright
npm run test:e2e
```

### Type Checking

```bash
# Check for TypeScript errors (faster than full build)
npx tsc

# Full build including plugins
npm run build
```

### Linting

```bash
# Check for lint errors
npm run lint

# Fix auto-fixable lint errors
npm run lint:fix
```

### Building Plugins

Plugins must be built before running the application:

```bash
# Build all plugins
npm run build:plugins
```

When making changes to a plugin, bump the patch version in its `package.json` and rebuild.

## Data Storage

### SQLite Database

All application data is stored in SQLite, encrypted at rest using **SQLCipher** (via the `better-sqlite3-multiple-ciphers` driver, aliased as `better-sqlite3` throughout the codebase). Every database file is encrypted on disk — the standard `sqlite3` command-line tool cannot open these files. Use the built-in CLI subcommand instead:

```bash
# List tables
npx quilltap db --tables

# Run a SQL query
npx quilltap db "SELECT COUNT(*) FROM characters;"

# Interactive REPL
npx quilltap db --repl

# Query the LLM logs database
npx quilltap db --llm-logs --tables

# Use a custom data directory
npx quilltap db --data-dir /path/to/data --tables
```

The encryption key is stored in a `.dbkey` file in the `data/` subdirectory alongside the database files. **Back up the `.dbkey` file alongside your database** — without it, the database cannot be decrypted. An optional passphrase (locked mode) can be set via environment variable to further protect the key file.

The tables stored in the main database are:

- **users** - User accounts (single-user mode)
- **characters** - Character definitions and metadata (includes `controlledBy: 'llm' | 'user'` for control mode)
- **chats** - Chat metadata, message history, and impersonation state
- **files** - File metadata (actual files on filesystem or S3)
- **tags** - Tag definitions
- **memories** - Character memory data with inter-character relationships (`aboutCharacterId`)
- **connectionProfiles** - LLM connection configurations
- **embeddingProfiles** - Embedding provider configurations
- **imageProfiles** - Image generation configurations
- **promptTemplates** - User-created system prompt templates
- **roleplayTemplates** - Roleplay format templates
- **providerModels** - Cached provider model lists

The SQLite database file location depends on platform:

| Environment | Database Path                                                             |
| ----------- | ------------------------------------------------------------------------- |
| **Linux**   | `~/.quilltap/data/quilltap.db`                                            |
| **macOS**   | `~/Library/Application Support/Quilltap/data/quilltap.db`                 |
| **Windows** | `%APPDATA%\Quilltap\data\quilltap.db`                                     |
| **Docker**  | `/app/quilltap/data/quilltap.db`                                          |
| **Lima VM** | `/data/quilltap/data/quilltap.db` (maps to macOS path via VirtioFS)       |
| **WSL2**    | Accessed via `/mnt/c/Users/.../AppData/Roaming/Quilltap/data/quilltap.db` |

Override with `QUILLTAP_DATA_DIR` (non-Docker environments).

### File Storage

Files are stored on the local filesystem by default, with optional S3-compatible storage:

**Local Filesystem (Default)**:

- Files stored in platform-specific data directory (e.g., `~/.quilltap/files/` on Linux)
- No additional configuration required

**S3-Compatible Storage (Optional)**:

- Configure via mount points in Settings > Storage
- Supports AWS S3, MinIO, Cloudflare R2, etc.

## Plugin Development

Plugins are self-contained modules in `plugins/src/` that provide:

- **LLM Providers** - Connect to AI services (OpenAI, Anthropic, Google, etc.)
- **Storage Backends** - S3-compatible file storage
- **Themes** - Visual theme packs (deprecated as plugins; use `.qtap-theme` bundles instead)
- **Roleplay Templates** - Message formatting templates
- **Tool Providers** - Custom LLM tools (MCP connector, etc.)

See [plugins/README.md](plugins/README.md) for the plugin developer guide.

### Theme Development

Themes are now distributed as `.qtap-theme` bundles — declarative zip archives containing JSON tokens, CSS, fonts, and images. No npm, esbuild, or TypeScript required.

```bash
# Create a new theme (bundle format, recommended)
npx create-quilltap-theme my-theme

# Create a legacy npm plugin theme (deprecated)
npx create-quilltap-theme my-theme --plugin
```

Manage themes via CLI:

```bash
npx quilltap themes list              # List all installed themes
npx quilltap themes validate my.qtap-theme  # Validate a bundle
npx quilltap themes install my.qtap-theme   # Install a bundle
npx quilltap themes export earl-grey        # Export any theme as a bundle
npx quilltap themes search "dark"           # Search registries
```

Bundled themes ship in `themes/bundled/`. User-installed themes go to `<dataDir>/themes/<themeId>/`.

See [docs/THEME_PLUGIN_DEVELOPMENT.md](docs/THEME_PLUGIN_DEVELOPMENT.md) for the legacy plugin format guide.

## Logging

The application uses a centralized logging system configurable via environment variables:

- `LOG_LEVEL` - `error`, `warn`, `info`, `debug` (default: `info`)
- `LOG_OUTPUT` - `console`, `file`, or `both` (default: `console`)
- `LOG_FILE_PATH` - Directory for log files (default: `./logs`)

In development, logs are written to `logs/combined.log` and `logs/error.log`. Use standard logging tools to tail and search these files.

## Checklist before release

1. Unless we're implementing an interface or an instance of a generic provider of some kind, we should never directly access the filesystem in this app; we should be using our generic file provider for that
2. Create unit tests to expand coverage for any new functionality, and test specifically for the bugs that were fixed when we apply bugfixes (to ensure there are no regression issues going forward)
3. Refactor according to best practices, including:
   - respect encapsulation and single source of truth. If a feature requires duplicate code, consider inheritance
   - SRP
   - DRY
   - KISS
   - YAGNI
4. Ensure that API endpoints adhere to the `/api/v{version}/{entityname}` standard to try to streamline and minimize API maintenance
5. Run a test for dead code and refactor that out. Use `npx knip` if it's helpful. We have a [dead code report](DEAD-CODE-REPORT.md) and that should be updated.
6. Ensure that the debug logging we always create for new work has been removed unless we still need it.
7. Verify that new UI components that were created adhere to the standard of using `qt-*` theme utility classes
8. As much as possible, plugins should be self-contained or use `plugin-types` and `plugin-utils` to access Quilltap internals; even distributed plugins in `plugins/dist/` should use these, since these plugins are models to independent plugin developers
9. If we updated any packages (in `packages/`), make sure that those are published to npmjs and properly installed in any NPM package.json files that exist throughout the application, including other packages, plugins, and the primary one at the root level
10. Verify that the backup/restore system includes everything that can be backed up (usually everything but things that are so secret they need to be encrypted, like API keys)
11. Make sure that lint/test/build in Github Actions are working
12. Remove all log.debug calls made during this development cycle (i.e., since the last release)
13. Check the following Markdown files to be sure they are up-to-date:
    - [README](README.md)
    - [Changelog](docs/CHANGELOG.md)
    - [API Documentation](docs/API.md)
    - [Developer Documentation](DEVELOPMENT.md)
    - [Claude instructions](CLAUDE.md)

## Git and Github release instructions

### For dev changes moving to release

**Do NOT just run this script; run the commands one at a time.**

```bash
# Don't just run this script; run the commands one at a time.
git checkout release
# This brings in all the changes without the history
git merge --squash --strategy-option=theirs main
# Remove the detritus after the release
sed -i '' -E 's/("version": "[^"]*)-[^"]*"/\1"/' package.json
# Update package-lock.json to be up-to-date
npm install
# Get new release version for tags
NEWRELEASE=$(sed -n -E 's/.*"version": "([^"]*)".*/\1/p' package.json)
# Change the badge to release version standards
sed -i '' -E 's/(badge\/version-)[^)]+\.svg/\1'"$NEWRELEASE"'-green.svg/' README.md
# Presumably we ran tests and bumped prerelease versions when we committed last time
git add package.json package-lock.json README.md
git commit --no-verify -m "release: $NEWRELEASE"
# We'll tag it so we can handle the release
git tag -s -m "$NEWRELEASE" $NEWRELEASE

# Now we'll start the new dev branch
NEWDEVVERSION=$(echo "$NEWRELEASE" | awk -F. '{print $1"."$2+1".0"}')
git checkout main
# Should just bring over the one updated commit for the release itself
git merge --strategy-option=theirs release
# Make this the new first dev version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWDEVVERSION"'-dev.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWDEVVERSION"'--dev.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "dev: started $NEWDEVVERSION development"
# We'll tag this one too
git tag -s -m "$NEWDEVVERSION-dev" $NEWDEVVERSION-dev

# Let's set up the bugfix version too
git checkout bugfix
# Merge everything that release has
git merge --strategy-option=theirs release
# make this the new first bugfix version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWRELEASE"'-bugfix.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWRELEASE"'--bugfix.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started $NEWRELEASE bug branch"

# Finally, the pushes to Github
git push
git checkout main
git push
git checkout release
git push
git push --tags

# Time to push to Docker
npm run build:docker

# Time to build Electron
npm run build:electron

# Now let's get back to work!
git checkout main
```

### for bugfix changes moving to release

```bash
# Don't just run this script; run the commands one at a time.
git checkout release
# This brings in all the changes without the history
git merge --squash --strategy-option=theirs bugfix
# Remove the detritus after the release
node -e "const p=require('./package.json');const v=p.version.split('-')[0].split('.');v[2]++;p.version=v.join('.');require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
# Update package-lock.json to be up-to-date
npm install
# Get new release version for tags
NEWRELEASE=$(sed -n -E 's/.*"version": "([^"]*)".*/\1/p' package.json)
# Change the badge to release version standards
sed -i '' -E 's/(badge\/version-)[^)]+\.svg/\1'"$NEWRELEASE"'-green.svg/' README.md
# Presumably we ran tests and bumped prerelease versions when we committed last time
git add package.json package-lock.json README.md
git commit --no-verify -m "release: $NEWRELEASE"
# We'll tag it so we can handle the release
git tag -s -m "$NEWRELEASE" $NEWRELEASE

# Let's set up the bugfix version again
git checkout bugfix
# Merge everything that release has
git merge --strategy-option=theirs release
# make this the new first bugfix version
sed -i '' -E 's/("version": ")[^"]*"/\1'"$NEWRELEASE"'-bugfix.0"/' package.json
# Update package-lock.json again
npm install
# Let's fix that badge in the README file too
sed -i '' -E 's/(badge\/version-)[^-]*-[a-z]+/\1'"$NEWRELEASE"'--bugfix.0-yellow/' README.md
# Again, we haven't changed anything substantial, so no pre-commits
git add package.json package-lock.json README.md
git commit --no-verify -m "bugfix: started $NEWRELEASE bug branch"

# Now let's pull this into dev
```

## Testing Your Changes

1. Check for TypeScript errors: `npx tsc`
2. Run relevant tests: `npm run test:unit`
3. Test the UI manually at `https://localhost:3000`
4. Check application logs in `logs/combined.log`

## Contributing

1. Open an issue first to discuss major changes
2. Fork the repository
3. Create a feature branch
4. Make your changes
5. Run tests and type checking
6. Submit a pull request

## Additional Documentation

- [API Documentation](docs/API.md) - REST endpoints and authentication
- [Database Abstraction](docs/DATABASE_ABSTRACTION.md) - SQLite backend and data directory
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment patterns
- [Backup & Restore Guide](docs/BACKUP-RESTORE.md) - Data backup procedures
- [Plugin Developer Guide](plugins/README.md) - Creating plugins
- [Database Encryption](docs/DATABASE_ENCRYPTION.md) - SQLCipher encryption architecture, .dbkey file management, and passphrase handling
- [Roadmap](features/ROADMAP.md) - Planned features including Electron/Lima phases
