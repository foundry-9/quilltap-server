# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on. Connect to any LLM provider, organize your work into projects with persistent files and context, create characters with real personalities, and build a private AI environment that learns and remembers.

### Spelling **IMPORTANT**

This project is spelled "Quilltap", as in "quill" + "tap", **NOT** "Quilttap", as in "quilt" + "tap". There is a linting rule to keep you from using that word. Please, please, never call anything in this system "quilttap" because that is **WRONG.**

## Technology Stack

- **Frontend Framework**: React via Next.js
- **Build Tools**: Next.js
- **Language**: TypeScript
- **Package Manager**: npm
- **Testing**: Jest and coverage tools (Istanbul/nyc), Playwright
- **Data Storage**: SQLite with zero external dependencies. Uses `better-sqlite3` driver directly. Data models are defined as TypeScript interfaces with Zod schemas.
- **File Storage**: local filesystem only
- **AI and LLM Services**: OpenAI, Anthropic, xAI/Grok, Google, OpenRouter
- **Design Documentation**: Storybook
- **API Structure**: Versioned REST API under `/api/v1/` with action dispatch pattern
- **User Documentation**: Found in `/help/` and maintained and searchable using MessagePack
- **Electron**: Electron front-end to Lima/WSL2 backend is primary way to use app
- **Virtualization**: Lima + VZ (macOS) / WSL2 (Windows) for self-contained app distribution

## API Architecture

All new API routes should be created under `/api/v1/` following the consolidated REST structure:

### Route Structure

- **Collection routes**: `/api/v1/[resource]` (e.g., `/api/v1/characters`)
- **Item routes**: `/api/v1/[resource]/[id]` (e.g., `/api/v1/characters/[id]`)
- **System routes**: `/api/v1/system/[feature]` (e.g., `/api/v1/system/jobs`)

### Action Dispatch Pattern

Instead of creating separate routes for each action, use the `?action=` query parameter:

```ts
// Instead of separate routes:
// /api/characters/[id]/favorite
// /api/characters/[id]/export

// Use action dispatch:
// POST /api/v1/characters/[id]?action=favorite
// GET /api/v1/characters/[id]?action=export

import { createContextHandler, withActionDispatch } from '@/lib/api/middleware';

export const POST = createContextHandler<{ id: string }>(
  withActionDispatch({
    favorite: handleFavorite,
    avatar: handleAvatar,
  }, handleDefaultPost) // fallback for no action param
);
```

### Middleware & Response Utilities

- **Context**: Use `createContextHandler` or `withContext` from `@/lib/api/middleware`
- **Action dispatch**: Use `withActionDispatch` or `withCollectionActionDispatch` from `@/lib/api/middleware/actions`
- **Responses**: Use helpers from `@/lib/api/responses`: `successResponse`, `errorResponse`, `notFound`, `badRequest`, `validationError`, `created`, etc.

### Deprecation

Legacy routes outside `/api/v1/` were removed in v2.8. Only `/api/v1/` routes are supported. A few non-v1 routes remain for specific purposes: `/api/health` (health check), `/api/plugin-routes/[...path]` (plugin dispatcher), and `/api/themes/*` (asset serving).

## Feature Names

- **The Concierge** - the dangerous content tracking/rerouting/hiding system
- **The Commonplace Book** - the memory system that characters have, a self-managed RAG
- **The Lantern** - the story backgrounds subsystem, that can send context to image providers and put them up as backgrounds for chats or projects
- **Prospero** - the agentic and tool-using systems, and the way LLMs work — UI route: `/prospero` (was `/projects`)
- **Aurora** - the complex character model and how it interacts with the prompts — UI route: `/aurora` (was `/characters`)
- **Calliope** - the UX/UI and themes systems
- **The Foundry** - the architecture underneath, plugins and packages and services — UI route: `/settings` (was `/foundry`, `/tools`); all settings now live on a single tabbed page with 7 tabs
- **The Salon** - the chat interface — UI route: `/salon` (was `/chats`)
- **Pascal the Croupier** - the RNG and game state tracking system — merged into Chat tab at `/settings?tab=chat`
- **Saquel Ytzama the Keeper of Secrets** - the encryption, API key management, and secrets system — merged into Data & System tab at `/settings?tab=system`

Note: API routes remain at their original paths (`/api/v1/characters`, `/api/v1/chats`, `/api/v1/projects`). Old UI routes (`/foundry/*`) redirect to the appropriate `/settings` tab.

## Current State

- **Details for things already implemented** are in [the README](README.md)
- **Roadmap for future development** is in the files in the `features/` directory, with completed development in `features/complete/`
- **Documentation for Everything**

  - [help/](help/) - User documentation for every page and every visible feature - **IMPORTANT**: If anything in this directory is updated that we must run `npm run build:help` and add the changes from that process to the list of files to be committed
  - [.githooks/README.md](.githooks/README.md) — Documents the custom Git hook directory, especially the pre-commit script that lints, tests, bumps package versions, and how to configure/disable hooks — Grade: A (current dev workflow) — Last updated: 2025-11-18
  - [DEAD-CODE-REPORT.md](DEAD-CODE-REPORT.md) — Dead code analysis report with cleanup history, known false positives, and remaining low-priority items — Grade: A (reflects cleanup completed 2025-12-27) — Last updated: 2025-12-27
  - [DEVELOPMENT.md](DEVELOPMENT.md) — Contributor guide covering repo structure, prerequisites, running the app (Electron, Docker, and local), Electron/Lima VM development workflow, testing, linting, logging, data storage, and plugin development pointers — Grade: A (primary contributor reference) — Last updated: 2026-02-14
  - [README.md](README.md) — High-level product overview, feature list, tech stack, setup instructions (Electron and Docker), deployment guidance, configuration, troubleshooting, and support links — Grade: A (source of truth for the product) — Last updated: 2026-02-14
  - [features/ROADMAP.md](features/ROADMAP.md) — Planned features and completed work for v2.7 and beyond — Grade: A (active roadmap) — Last updated: 2026-01-23
  - [`__tests__/unit/DELETED_IMAGE_HANDLING_TESTS.md`](__tests__/unit/DELETED_IMAGE_HANDLING_TESTS.md) — Describes the unit tests covering deleted image placeholders, gallery handling, modal behavior, and clean-up flows (31 total tests) — Grade: A (matches implemented tests) — Last updated: 2025-11-27
  - [components/characters/system-prompts-editor/README.md](components/characters/system-prompts-editor/README.md) — Documentation for the reorganized character system prompts editor: structure, hooks, components, APIs, logging, and styling — Grade: A (module-level documentation) — Last updated: 2025-12-17
  - [components/settings/appearance/README.md](components/settings/appearance/README.md) — Documents the appearance settings module structure: hooks, theme selector, display options, and how to use qt-* utility classes — Grade: A (current UI behavior) — Last updated: 2025-12-17
  - [components/settings/chat-settings/README.md](components/settings/chat-settings/README.md) — In-depth description of the chat settings module, its components (avatar, Cheap LLM settings, image descriptions), hook API, types, and backend endpoints — Grade: A (covers implemented settings) — Last updated: 2025-12-17
  - [components/settings/embedding-profiles/README.md](components/settings/embedding-profiles/README.md) — Covers the refactored embedding profiles tab: types, hooks, ProviderBadge, ProfileForm/List components, usage, and benefits — Grade: A (matches shipped refactor) — Last updated: 2025-12-17
  - [components/settings/prompts/README.md](components/settings/prompts/README.md) — Notes on the prompts settings tab after refactor: types, usePrompts hook, prompt cards/lists/modals, and design principles — Grade: A (accurate description) — Last updated: 2025-12-17
  - [components/tools/tasks-queue/README.md](components/tools/tasks-queue/README.md) — Overview of the tasks queue card module: types, hooks, TaskItem/Filters/Details components, API integration, and structure — Grade: A (current tasks queue docs) — Last updated: 2025-12-17
  - [docs/API.md](docs/API.md) — Comprehensive Quilltap API reference for v1 REST routes (characters, chats, messages, memories, api-keys, connection-profiles, system/jobs, system/backup) with action dispatch patterns and response examples — Grade: A (canonical API reference) — Last updated: 2026-01-13
  - [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) — Backup/restore guide covering in-app backups, CRON automation, encryption, disaster recovery, verification, and monitoring tips — Grade: A (operational guidance) — Last updated: 2025-12-10
  - [docs/DATABASE_ABSTRACTION.md](docs/DATABASE_ABSTRACTION.md) — Database abstraction layer documentation: SQLite backend support, configuration, Docker deployment, architecture, interfaces, capabilities comparison, database protection (integrity checks, WAL checkpoints, physical backups), and troubleshooting — Grade: A (architecture reference) — Last updated: 2026-02-19
  - [help/database-protection.md](help/database-protection.md) — User-facing documentation for automatic database protection: integrity checks, WAL checkpoints, physical backups with retention policy, restore instructions, and comparison with logical backups — Grade: A (user documentation) — Last updated: 2026-02-19
  - [help/setup-wizard.md](help/setup-wizard.md) — User-facing documentation for the AI Stack Setup Wizard: 6-step guided flow for provider selection, API key entry, model selection, embedding/image setup, and test-and-confirm; covers first-run and settings re-entry modes — Grade: A (user documentation) — Last updated: 2026-02-22
  - [docs/CHANGELOG.md](docs/CHANGELOG.md) — Detailed changelog through versions 1.0–2.5, listing features, fixes, refactors, tests, themes, and status updates per release — Grade: A (release-of-record) — Last updated: 2025-12-17
  - [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Production deployment guide with prerequisites, Docker/Nginx/SSL setup, env vars, data management, monitoring, backups, and troubleshooting — Grade: A (used for current deployments) — Last updated: 2025-12-06
  - [docs/FILE-SYSTEM-IMPLEMENTATION.md](docs/FILE-SYSTEM-IMPLEMENTATION.md) — Summary of the centralized file system implementation: manager module, repositories, API route, migration utility, docs, and benefits — Grade: A (architecture reference) — Last updated: 2025-11-29
  - [docs/IMAGE_GENERATION.md](docs/IMAGE_GENERATION.md) — Exhaustive documentation for image generation: user workflows, provider profiles, prompt strategy, API reference, architecture, and troubleshooting — Grade: A (reflects shipped pipeline) — Last updated: 2025-11-24
  - [docs/PLUGIN_INITIALIZATION.md](docs/PLUGIN_INITIALIZATION.md) — Describes the plugin initialization architecture: startup flow, API endpoint, provider registry, error handling, and testing — Grade: A (architecture current) — Last updated: 2025-12-02
  - [docs/PLUGIN_MANIFEST.md](docs/PLUGIN_MANIFEST.md) — Complete schema reference for plugin manifests: required fields, capabilities, provider configs, hooks, API routes, UI components, permissions, and examples — Grade: A (schema of record) — Last updated: 2025-12-02
  - [docs/PROMPT_ARCHITECTURE.md](docs/PROMPT_ARCHITECTURE.md) — Outlines the Quilltap prompt architecture with identity/relationship/emotion/voice/boundary blocks — Grade: A (core concept) — Last updated: 2025-12-16
  - [docs/TEMPLATES.md](docs/TEMPLATES.md) — Guide to template variables/system: supported placeholders, future lore support, story string discussion, and migration advice — Grade: B (some forward-looking notes) — Last updated: 2025-11-20
  - [docs/FILE_LLM_ACCESS.md](docs/FILE_LLM_ACCESS.md) — Documentation for the file management LLM tool: actions, permissions, folder organization, API routes, security, and UI components — Grade: A (comprehensive feature docs) — Last updated: 2026-01-05
  - [docs/THEME_PLUGIN_DEVELOPMENT.md](docs/THEME_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building external Quilltap theme plugins: project setup, tokens, CSS overrides, fonts, Storybook development, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2026-01-22
  - [docs/TEMPLATE_PLUGIN_DEVELOPMENT.md](docs/TEMPLATE_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building roleplay template plugins: project setup, system prompts, single and multi-template plugins, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2026-01-22
  - [docs/TOOL_PLUGIN_DEVELOPMENT.md](docs/TOOL_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building tool plugins that provide LLM tools: project setup, tool definition, input validation, execution, security, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2026-01-22
  - [docs/PROVIDER_PLUGIN_DEVELOPMENT.md](docs/PROVIDER_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building LLM provider plugins: project setup, LLMProviderPlugin interface, chat/image/embedding providers, tool formatting, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2026-01-22
  - [docs/SEARCH_PLUGIN_DEVELOPMENT.md](docs/SEARCH_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building search provider plugins: project setup, SearchProviderPlugin interface, search execution, API key integration, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2026-02-10
  - [features/MCP.md](features/MCP.md) — Feature specification for local file CRUD via MCP server: exposes file system operations as LLM tools with token-aware chunked access patterns — Grade: B (feature specification) — Last updated: 2025-12-26
  - [features/qt-docs-auto-embed.md](features/qt-docs-auto-embed.md) — Feature proposal for built-in semantic documentation search: embedded help system with semantic chunking and support for OpenAI/Voyage/Ollama embeddings — Grade: B (proposal) — Last updated: 2026-01-23
  - [features/artifacts.md](features/artifacts.md) — Feature request outlining an "artifacts" side panel concept for rendering AI-generated content with copy/download actions — Grade: B (future concept) — Last updated: 2025-12-10
  - [features/comfy_ui_local_image.md](features/comfy_ui_local_image.md) — Proposal for a ComfyUI image generation plugin: architecture, workflow manager, UI, configuration, and future phases — Grade: B (proposal) — Last updated: 2025-12-06
  - [features/complete/API_MIGRATION.md](features/complete/API_MIGRATION.md) — API v1 migration plan: all 159 legacy routes converted to deprecation stubs, 65 v1 routes implemented — Grade: A (completed migration) — Last updated: 2026-01-30
  - [features/complete/PLAN-PROJECTS.md](features/complete/PLAN-PROJECTS.md) — Projects feature implementation plan: optional categorization for files and chats with focused context, system prompt injection, and character roster management — Grade: A (completed feature) — Last updated: 2026-01-23
  - [features/complete/QUILLTAP-EXPORT-IMPORT.md](features/complete/QUILLTAP-EXPORT-IMPORT.md) — Quilltap native import/export system: selective entity export/import, manifest structure, merge support, and memory association — Grade: A (completed implementation) — Last updated: 2026-01-01
  - [features/distant_future_separate_api.md](features/distant_future_separate_api.md) — Future plan to split the monolith into a Fastify API + React SPA, covering phases, risks, testing, and AWS deployment strategy — Grade: C (distant concept, not scheduled) — Last updated: 2025-12-12
  - [features/random-numbers-plugin.md](features/random-numbers-plugin.md) — Feature request outlining a random number/choice plugin (dice, coin flip, random participant) — Grade: B (idea backlog) — Last updated: 2025-12-12
  - [features/usage-tracking.md](features/usage-tracking.md) — Request for provider usage/balance tracking: per-provider notes, UX requirements, engineering tasks, and open questions — Grade: B (idea backlog) — Last updated: 2025-12-10
  - [lib/llm/ATTACHMENT_SUPPORT.md](lib/llm/ATTACHMENT_SUPPORT.md) — Reference for attachment support utilities: supported MIME types per provider, helper APIs, and usage examples — Grade: A (matches helper behavior) — Last updated: 2025-11-29
  - [packages/plugin-types/README.md](packages/plugin-types/README.md) — Documentation for the @quilltap/plugin-types npm package: installation, usage, type reference, and plugin manifest guide for third-party plugin development — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/plugin-types/CHANGELOG.md](packages/plugin-types/CHANGELOG.md) — Changelog for the @quilltap/plugin-types package — Grade: A (package changelog) — Last updated: 2025-12-30
  - [packages/plugin-utils/README.md](packages/plugin-utils/README.md) — Documentation for the @quilltap/plugin-utils npm package: tool parsing, format conversion, and logger bridge for plugin development — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/plugin-utils/CHANGELOG.md](packages/plugin-utils/CHANGELOG.md) — Changelog for the @quilltap/plugin-utils package — Grade: A (package changelog) — Last updated: 2025-12-30
  - [packages/theme-storybook/README.md](packages/theme-storybook/README.md) — Documentation for the @quilltap/theme-storybook npm package: Storybook preset, default tokens, component classes, and story components for theme plugin development — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/theme-storybook/CHANGELOG.md](packages/theme-storybook/CHANGELOG.md) — Changelog for the @quilltap/theme-storybook package — Grade: A (package changelog) — Last updated: 2025-12-31
  - [packages/create-quilltap-theme/README.md](packages/create-quilltap-theme/README.md) — Documentation for the create-quilltap-theme scaffolding CLI: usage, options, what gets created, and next steps after scaffolding — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/quilltap/README.md](packages/quilltap/README.md) — Documentation for the quilltap npm package: installation via npx, CLI options, data directory defaults, and links to other deployment methods — Grade: A (package documentation) — Last updated: 2026-02-19
  - [packages/create-quilltap-theme/CHANGELOG.md](packages/create-quilltap-theme/CHANGELOG.md) — Changelog for the create-quilltap-theme package — Grade: A (package changelog) — Last updated: 2025-12-31
  - [plugins/dist/qtap-plugin-mcp/README.md](plugins/dist/qtap-plugin-mcp/README.md) — Documentation for the MCP Server Connector plugin: configuration, authentication, tool naming, security, and troubleshooting — Grade: A (plugin documentation) — Last updated: 2026-01-13
  - [migrations/README.md](migrations/README.md) — Documentation for the migration system: architecture, adding new migrations, running migrations, and troubleshooting — Grade: A (migration system docs) — Last updated: 2026-01-22
  - [docs/WINDOWS.md](docs/WINDOWS.md) — Windows/WSL2 troubleshooting guide: prerequisites, common issues, data locations, manual operations — Grade: A (troubleshooting guide) — Last updated: 2026-02-14
  - [.github/workflows/release.yml](.github/workflows/release.yml) — GitHub Actions release workflow: builds rootfs tarballs (amd64/arm64), Electron installers (macOS DMG, Windows NSIS), and creates GitHub Release with all assets on version tags — Grade: A (build automation) — Last updated: 2026-02-17
  - [electron-builder.yml](electron-builder.yml) — Electron Builder packaging config: app ID, macOS ZIP + Windows NSIS targets, resource bundling, Lima binary staging — Grade: A (build configuration) — Last updated: 2026-02-14
  - [lima/quilltap.yaml](lima/quilltap.yaml) — Lima VM template: Alpine Linux 3.21, VZ hypervisor, VirtioFS mounts, OpenRC service provisioning, port forwarding — Grade: A (VM configuration) — Last updated: 2026-02-14
  - [lima/wsl-init.sh](lima/wsl-init.sh) — WSL2 init script: starts Node.js server inside WSL2 distro with data directory resolution — Grade: A (VM configuration) — Last updated: 2026-02-14
  - [electron/tsconfig.json](electron/tsconfig.json) — Electron-specific TypeScript config: ES2022 target, CommonJS modules, outputs to dist-electron/ — Grade: A (build configuration) — Last updated: 2026-02-14

## qt-\* CSS tokens and semantic classes for themes

- Themes and styling should depend primarily on the `qt-*` semantic utility classes that we have defined. When possible, use those and update those with Tailwind and other things. That way the themes will always be able to override changes. **IMPORTANT:** If you add new Tailwind classes, then almost certainly you should be adding them to the `qt-*` utility classes instead, and then apply those classes to the components you want to change.
- qt-* significant changes need to be appropriately reflected in the stylebook, the theme-stylebook package, and maybe in the create-quilltap-theme package, as well as updating the bundled themes as necessary.
  - **packages**: find in `packages/`
  - **plugins**: bundled theme plugins are in `plugins/dist/qtap-plugin-theme-*`

## Claude-specific instructions

- If you have access to Opus and agents, then plan work in Opus for a change of any significant size and delegate it to agents running Haiku with specific instructions. If you can't use Opus then use Sonnet to plan. Feel free to aggressively agentize the work.
- For every new feature and all existing functionality that is updated or touched in the backend, make sure that there are debug logs being fired for everything, and appropriate levels of logging for everything else, using the built-in logging system in this app
- I am developing this in macOS, so take BSD versions of tools into account, and the fact that I have installed homebrew's coreutils and gnu-sed so that you can use GNU versions of things with "g"-prefixed utilities if you need them.
- Default location for files depends on OS and category:
  - OS
    - Linux: ~/.quilltap/
    - macOS: ~/Library/Application Support/Quilltap/
    - Windows: %APPDATA%\Quilltap\
    - Docker: /app/quilltap/
    - Lima VM: /data/quilltap/ (VirtioFS mount of macOS path)
    - WSL2: Accessed via /mnt/c/.../AppData/Roaming/Quilltap/ (Windows path passed as env var)
  - Category
    - `data/`
    - `files/`
    - `logs/`
- I am using "npm run dev" to work on this while we're working, so the base URL is probably `http://localhost:3000/` if you want to try something.
- You should track what's going on with the running "npm run dev" process, which is nearly always running while we're working on this, by tailing or searching the `logs/combined.log` file. You can figure out what time it is (I think it's using universal time, not local time), and then look for things that we just tried by working through that log.
- To access SQLite directly, use: `sqlite3 /path/to/quilltap.db`. Examples:
  - List tables: `sqlite3 /path/to/quilltap.db ".tables"`
  - Check record count: `sqlite3 /path/to/quilltap.db "SELECT COUNT(*) FROM TABLENAME;"`
  - Query with filter: `sqlite3 /path/to/quilltap.db "SELECT * FROM TABLENAME WHERE field = 'value';"`
- This is built in Next.js 15+, so don't look in middleware.ts, but consider proxy.ts, for things you would expect there.
- When creating or modifying API routes, always use the `/api/v1/` structure with action dispatch patterns. Don't create new routes outside `/api/v1/`. Use the middleware from `@/lib/api/middleware` and response helpers from `@/lib/api/responses`.
- If asked to fix linting errors, do not change out HTML `<img>` tags for Next.js `<Image>` tags; there is a reason that we don't use them sometimes, usually related to their being pulled in via APIs so Next.js can't know what it's going to display.
- Every time we change a plugin, let's go ahead and bump the release number (the last of the three numbers in semver) on its package.json, and manifest.json if required, and re-run `npm run build:plugins` before we add things to the commit.
- Check for Typescript errors by running "npx tsc" rather than "npm run build"
- **Important:** Before committing, record basic changes in `docs/CHANGELOG.md` in reverse chronological order
- Keep the documentation above up to date, and update this file if you add more documentation, in the same format.
- Any change to data, particularly the schemas used to read or write data either to files or to the database, should be checked to see if they need to be reflected in .qtap or SillyTavern exports, the [qtap schema](./public/schemas/qtap-export.schema.json), backups, and/or the migrations/ directory.
- Any files that exist in the app source code only because they are necessary for migrations should move to the `migrations/` directory.
- **IMPORTANT**: If we make changes to anything in the `packages/` directory, we need to make sure we update package.json numbers and pause to allow the developer/human user to `npm publish` to push those packages into npmjs. We do *not* just copy things down into the appropriate directories! We wait to publish the new npm package first. You can stop everything, ask me to publish the new version, then install the new one. If that doesn't work, let's fix the NPM problem we're having, **NOT** work around it.
- **Version sync**: The `packages/quilltap/package.json` version must always match the version from the root `package.json` (including prerelease tags like `-dev.72`). The pre-commit hook in `.githooks/pre-commit` syncs this automatically, but if you manually bump the root version, sync `packages/quilltap/package.json` too.
- Commits take a long time because there is a precommit script in `.githooks/pre-commit` that kills the dev server, runs lint, runs the unit tests, does a test compile with `npx tsc`, builds the plugins, and then does a full Next.js build of the app, to ensure that we're committing something that basically works.
- Leave no stubs and "TODO" code behind unless you have agreed on it with me ahead of time
- All user-visible changes must be documented in help files found in `help/*.md`
- All writing for users is to be in the style of "steampunk + roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket"

## Best Practices and Principles

- respect encapsulation and single source of truth
  - If a feature requires duplicate code, consider inheritance
- SRP
- DRY
- KISS
- YAGNI
