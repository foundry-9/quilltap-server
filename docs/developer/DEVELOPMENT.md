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
├── docs/developer/features/  # Feature roadmap and spec documents
│   └── complete/             # Completed feature specifications
├── docker/                   # Docker configuration (entrypoint script)
├── scripts/                  # Utility scripts (migrations, cleanup, builds)
├── public/                   # Static assets (icons, manifest)
├── website/                  # Website assets (images, splash graphics)
├── certs/                    # Development TLS certificates
├── logs/                     # Application log files (when LOG_OUTPUT includes file)
├── Dockerfile                # Production Docker build
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

### Running with the Desktop App (Electron)

The Quilltap desktop app (Electron shell) lives in a separate repository. This repo produces a standalone tarball that the Electron shell consumes. See `npm run build:standalone` for details.

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

See [THEME_PLUGIN_DEVELOPMENT.md](THEME_PLUGIN_DEVELOPMENT.md) for the legacy plugin format guide.

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
5. Run a test for dead code and refactor that out. Use `npx knip` if it's helpful. We have a [dead code report](DEAD-CODE-REPORT.md) (in the same directory) and that should be updated.
6. Ensure that the debug logging we always create for new work has been removed unless we still need it.
7. Verify that new UI components that were created adhere to the standard of using `qt-*` theme utility classes
8. As much as possible, plugins should be self-contained or use `plugin-types` and `plugin-utils` to access Quilltap internals; even distributed plugins in `plugins/dist/` should use these, since these plugins are models to independent plugin developers
9. If we updated any packages (in `packages/`), make sure that those are published to npmjs and properly installed in any NPM package.json files that exist throughout the application, including other packages, plugins, and the primary one at the root level
10. Verify that the backup/restore system includes everything that can be backed up (usually everything but things that are so secret they need to be encrypted, like API keys)
11. Make sure that lint/test/build in Github Actions are working
12. Remove all log.debug calls made during this development cycle (i.e., since the last release)
13. Check the following Markdown files to be sure they are up-to-date:
    - [README](../../README.md)
    - [Changelog](../CHANGELOG.md)
    - [API Documentation](API.md)
    - [Developer Documentation](DEVELOPMENT.md)
    - [Claude instructions](../../CLAUDE.md)

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

- [API Documentation](API.md) - REST endpoints and authentication
- [Database Abstraction](DATABASE_ABSTRACTION.md) - SQLite backend and data directory
- [Deployment Guide](../DEPLOYMENT.md) - Production deployment patterns
- [Backup & Restore Guide](../BACKUP-RESTORE.md) - Data backup procedures
- [Plugin Developer Guide](../../plugins/README.md) - Creating plugins
- [Database Encryption](DATABASE_ENCRYPTION.md) - SQLCipher encryption architecture, .dbkey file management, and passphrase handling
- [Roadmap](features/ROADMAP.md) - Planned features
