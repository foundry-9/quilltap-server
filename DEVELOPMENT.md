# Development Guide

This document covers the development setup and project structure for Quilltap.

## Project Structure

```text
quilltap/
├── app/                      # Next.js App Router entry point
│   ├── (authenticated)/      # Protected routes (characters, chats, settings, about, tools)
│   ├── api/                  # API route handlers (auth, chats, characters, providers, backups, etc.)
│   ├── auth/                 # Auth flows (sign-in, OAuth callbacks, session)
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
│   ├── nav/                  # Navigation components
│   ├── providers/            # React context providers
│   └── ui/                   # Generic UI components (Avatar, Badge, Button, etc.)
├── lib/                      # Domain logic and utilities
│   ├── auth/                 # Authentication (session, adapters, post-login migrations)
│   ├── chat/                 # Chat logic (context-manager, turn-manager, tool execution)
│   ├── llm/                  # LLM utilities (formatting, pricing, streaming)
│   ├── memory/               # Memory and embedding logic
│   ├── plugins/              # Plugin registry and loader
│   ├── s3/                   # S3 storage utilities
│   ├── sillytavern/          # SillyTavern import/export
│   ├── tools/                # Tool definitions (image generation, web search, memory)
│   └── backup/               # Backup and restore logic
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
├── docker/                   # Docker configuration (nginx, scripts, cert helpers)
├── scripts/                  # Utility scripts (migrations, cleanup, builds)
├── public/                   # Static assets (icons, manifest)
├── website/                  # Website assets (images, splash graphics)
├── certs/                    # Development TLS certificates
├── logs/                     # Application log files (when LOG_OUTPUT includes file)
├── docker-compose*.yml       # Docker Compose configurations
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
- **SQLite** (automatic with better-sqlite3)
- **MinIO or S3-compatible storage** (embedded MinIO for development)

### Running Locally

```bash
# Install dependencies
npm install

# Build plugins (required before first run)
npm run build:plugins

# Start MinIO via Docker (recommended for file storage)
docker-compose -f docker-compose.yml up -d minio createbuckets

# Start the development server with HTTPS
npm run devssl

# Or plain HTTP
npm run dev
```

The application will be available at [https://localhost:3000](https://localhost:3000)

### Running with Docker

```bash
# Start everything (app + MinIO + SQLite)
docker-compose -f docker-compose.yml up

# View logs
docker-compose -f docker-compose.yml logs -f app
```

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

All application data is stored in SQLite:

- **users** - User accounts and authentication
- **characters** - Character definitions and metadata (includes `controlledBy: 'llm' | 'user'` for control mode)
- **chats** - Chat metadata, message history, and impersonation state
- **files** - File metadata (actual files in S3)
- **tags** - Tag definitions
- **memories** - Character memory data with inter-character relationships (`aboutCharacterId`)
- **connectionProfiles** - LLM connection configurations
- **embeddingProfiles** - Embedding provider configurations
- **imageProfiles** - Image generation configurations
- **promptTemplates** - User-created system prompt templates
- **roleplayTemplates** - Roleplay format templates
- **providerModels** - Cached provider model lists

The SQLite database file is stored at `~/.quilltap/data/quilltap.db` on local systems or `/app/quilltap/data/quilltap.db` in Docker.

### S3 Storage (Required)

All files are stored in S3-compatible storage:

- `users/{userId}/files/` - User-uploaded files
- `users/{userId}/images/` - Generated and uploaded images
- `users/{userId}/backups/` - Full-account backups

For development, Docker Compose provides embedded MinIO with auto-created buckets.

## Plugin Development

Plugins are self-contained modules in `plugins/src/` that provide:

- **LLM Providers** - Connect to AI services (OpenAI, Anthropic, Google, etc.)
- **Auth Providers** - Authentication methods (Google OAuth, no-auth)
- **Themes** - Visual theme packs
- **Upgrade Scripts** - Data migration utilities

See [plugins/README.md](plugins/README.md) for the plugin developer guide.

For theme plugin development, use the scaffolding CLI and Storybook:

```bash
# Create a new theme plugin
npm init quilltap-theme my-theme

# Run Storybook to preview theme changes
npm run storybook
```

See [docs/THEME_PLUGIN_DEVELOPMENT.md](docs/THEME_PLUGIN_DEVELOPMENT.md) for the complete theme development guide.

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
12. Check the following Markdown files to be sure they are up-to-date:
    - [README](README.md)
    - [Changelog](docs/CHANGELOG.md)
    - [API Documentation](docs/API.md)
    - [Developer Documentation](DEVELOPMENT.md)
    - [Claude instructions](CLAUDE.md)

## Git and Github release instructions

**Do NOT just run this script; run the commands one at a time.**

```bash
# Don't just run this script; run the commands one at a time.
git checkout release
# This brings in all the changes without the history
git merge --squash --strategy-option=theirs main
# This then makes sure that the history is linked, in case we need to look back
git merge -s ours main
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
git merge release
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
git tag -s -m "$NEWDEVVERSION" $NEWDEVVERSION

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
# Now let's get back to work!
git checkout main
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
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment patterns
- [Backup & Restore Guide](docs/BACKUP-RESTORE.md) - Data backup procedures
- [Plugin Developer Guide](plugins/README.md) - Creating plugins
- [Theme Utility Classes](features/complete/theme-utility-classes.md) - Qt-* CSS system
