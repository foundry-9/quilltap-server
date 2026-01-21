# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quilltap is a repository from Foundry-9 LLC being actively developed for general use and hopefully as a basis for web hosting in the cloud someday, to use AI to chat, solve problems, and generally be an LLM front end.

## Technology Stack

- **Frontend Framework**: React via Next.js
- **Build Tools**: Next.js
- **Language**: TypeScript
- **Package Manager**: npm
- **Testing**: Jest and coverage tools (Istanbul/nyc), Playwright
- **Data Storage**: MongoDB (required) - uses the native MongoDB driver directly, NOT Prisma or Mongoose. Data models are defined as TypeScript interfaces.
- **File Storage**: S3-compatible storage (embedded MinIO for development, external S3 for production)
- **AI and LLM Services**: OpenAI, Anthropic, xAI/Grok, Google, OpenRouter
- **Cloud Services**: AWS first
- **Design Documentation**: Storybook
- **API Structure**: Versioned REST API under `/api/v1/` with action dispatch pattern

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

import { createAuthenticatedParamsHandler, withActionDispatch } from '@/lib/api/middleware';

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  withActionDispatch({
    favorite: handleFavorite,
    avatar: handleAvatar,
  }, handleDefaultPost) // fallback for no action param
);
```

### Middleware & Response Utilities

- **Authentication**: Use `createAuthenticatedHandler` or `createAuthenticatedParamsHandler` from `@/lib/api/middleware`
- **Action dispatch**: Use `withActionDispatch` or `withCollectionActionDispatch` from `@/lib/api/middleware/actions`
- **Responses**: Use helpers from `@/lib/api/responses`: `successResponse`, `errorResponse`, `notFound`, `badRequest`, `validationError`, `created`, etc.

### Deprecation

Legacy routes outside `/api/v1/` have deprecation headers and will be removed after 2026-04-15. Use `withDeprecationHeaders` or `deprecatedRedirect` from `@/lib/api/responses` when maintaining legacy routes.

## Current State

- **Details for things already implemented** are in [the README](README.md)
- **Roadmap for future development** is in the files in the `features/` directory, with completed development in `features/complete/`
- **Documentation for Everything**

  - [.githooks/README.md](.githooks/README.md) — Documents the custom Git hook directory, especially the pre-commit script that lints, tests, bumps package versions, and how to configure/disable hooks — Grade: A (current dev workflow) — Last updated: 2025-11-18
  - [DEAD-CODE-REPORT.md](DEAD-CODE-REPORT.md) — Dead code analysis report with cleanup history, known false positives, and remaining low-priority items — Grade: A (reflects cleanup completed 2025-12-27) — Last updated: 2025-12-27
  - [DEVELOPMENT.md](DEVELOPMENT.md) — Contributor guide covering repo structure, prerequisites, running the app (Docker and local), testing, linting, logging, data storage, and plugin development pointers — Grade: A (primary contributor reference) — Last updated: 2026-01-01
  - [README.md](README.md) — High-level product overview, feature list, tech stack, setup instructions, deployment guidance, configuration, troubleshooting, roadmap, and support links — Grade: A (source of truth for the product) — Last updated: 2026-01-01
  - [`__tests__/unit/DELETED_IMAGE_HANDLING_TESTS.md`](__tests__/unit/DELETED_IMAGE_HANDLING_TESTS.md) — Describes the unit tests covering deleted image placeholders, gallery handling, modal behavior, and clean-up flows (31 total tests) — Grade: A (matches implemented tests) — Last updated: 2025-11-27
  - [components/characters/system-prompts-editor/README.md](components/characters/system-prompts-editor/README.md) — Documentation for the reorganized character system prompts editor: structure, hooks, components, APIs, logging, and styling — Grade: A (module-level documentation) — Last updated: 2025-12-17
  - [components/settings/appearance/README.md](components/settings/appearance/README.md) — Documents the appearance settings module structure: hooks, theme selector, display options, and how to use qt-* utility classes — Grade: A (current UI behavior) — Last updated: 2025-12-17
  - [components/settings/chat-settings/README.md](components/settings/chat-settings/README.md) — In-depth description of the chat settings module, its components (avatar, Cheap LLM settings, image descriptions), hook API, types, and backend endpoints — Grade: A (covers implemented settings) — Last updated: 2025-12-17
  - [components/settings/embedding-profiles/README.md](components/settings/embedding-profiles/README.md) — Covers the refactored embedding profiles tab: types, hooks, ProviderBadge, ProfileForm/List components, usage, and benefits — Grade: A (matches shipped refactor) — Last updated: 2025-12-17
  - [components/settings/prompts/README.md](components/settings/prompts/README.md) — Notes on the prompts settings tab after refactor: types, usePrompts hook, prompt cards/lists/modals, and design principles — Grade: A (accurate description) — Last updated: 2025-12-17
  - [components/tools/tasks-queue/README.md](components/tools/tasks-queue/README.md) — Overview of the tasks queue card module: types, hooks, TaskItem/Filters/Details components, API integration, and structure — Grade: A (current tasks queue docs) — Last updated: 2025-12-17
  - [docs/API.md](docs/API.md) — Comprehensive Quilltap API reference for v1 REST routes (characters, chats, messages, memories, api-keys, connection-profiles, system/jobs, system/backup) with action dispatch patterns and response examples — Grade: A (canonical API reference) — Last updated: 2026-01-13
  - [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) — Backup/restore guide covering in-app backups, manual MongoDB/S3 scripts, CRON automation, encryption, disaster recovery, verification, and monitoring tips — Grade: A (operational guidance) — Last updated: 2025-12-10
  - [docs/CHANGELOG.md](docs/CHANGELOG.md) — Detailed changelog through versions 1.0–2.5, listing features, fixes, refactors, tests, themes, and status updates per release — Grade: A (release-of-record) — Last updated: 2025-12-17
  - [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Production deployment guide with prerequisites, Docker/Nginx/SSL setup, env vars, data management, monitoring, backups, and troubleshooting — Grade: A (used for current deployments) — Last updated: 2025-12-06
  - [docs/FILE-SYSTEM-IMPLEMENTATION.md](docs/FILE-SYSTEM-IMPLEMENTATION.md) — Summary of the centralized file system implementation: manager module, repositories, API route, migration utility, docs, and benefits — Grade: A (architecture reference) — Last updated: 2025-11-29
  - [docs/IMAGE_GENERATION.md](docs/IMAGE_GENERATION.md) — Exhaustive documentation for image generation: user workflows, provider profiles, prompt strategy, API reference, architecture, and troubleshooting — Grade: A (reflects shipped pipeline) — Last updated: 2025-11-24
  - [docs/JSON-STORE-API.md](docs/JSON-STORE-API.md) — Reference for the JSON store API: JsonStore core methods, repositories, schemas, types, error handling, and configuration — Grade: A (API documentation) — Last updated: 2025-11-24
  - [docs/PLUGIN_INITIALIZATION.md](docs/PLUGIN_INITIALIZATION.md) — Describes the plugin initialization architecture: startup flow, API endpoint, provider registry, error handling, and testing — Grade: A (architecture current) — Last updated: 2025-12-02
  - [docs/PLUGIN_MANIFEST.md](docs/PLUGIN_MANIFEST.md) — Complete schema reference for plugin manifests: required fields, capabilities, provider configs, hooks, API routes, UI components, permissions, and examples — Grade: A (schema of record) — Last updated: 2025-12-02
  - [docs/PROMPT_ARCHITECTURE.md](docs/PROMPT_ARCHITECTURE.md) — Outlines the Quilltap prompt architecture with identity/relationship/emotion/voice/boundary blocks — Grade: A (core concept) — Last updated: 2025-12-16
  - [docs/TEMPLATES.md](docs/TEMPLATES.md) — Guide to template variables/system: supported placeholders, future lore support, story string discussion, and migration advice — Grade: B (some forward-looking notes) — Last updated: 2025-11-20
  - [docs/FILE_LLM_ACCESS.md](docs/FILE_LLM_ACCESS.md) — Documentation for the file management LLM tool: actions, permissions, folder organization, API routes, security, and UI components — Grade: A (comprehensive feature docs) — Last updated: 2026-01-05
  - [docs/THEME_PLUGIN_DEVELOPMENT.md](docs/THEME_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building external Quilltap theme plugins: project setup, tokens, CSS overrides, fonts, Storybook development, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2025-12-31
  - [docs/TEMPLATE_PLUGIN_DEVELOPMENT.md](docs/TEMPLATE_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building roleplay template plugins: project setup, system prompts, single and multi-template plugins, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2025-12-31
  - [docs/TOOL_PLUGIN_DEVELOPMENT.md](docs/TOOL_PLUGIN_DEVELOPMENT.md) — Complete user's guide for building tool plugins that provide LLM tools: project setup, tool definition, input validation, execution, security, and npm publishing — Grade: A (step-by-step tutorial) — Last updated: 2026-01-07
  - [features/PLAN-AUTH-AND-MULTIUSER.md](features/PLAN-AUTH-AND-MULTIUSER.md) — Implementation plan for no-auth mode, per-user data storage, plugin directories, local auth completion, and Google OAuth pluginization — Grade: B (planning doc) — Last updated: 2025-12-10
  - [features/PLAN-LLM-PLUGIN-MIGRATION.md](features/PLAN-LLM-PLUGIN-MIGRATION.md) — Plan tracking the LLM provider migration to plugins, status per phase, components created, and recovery instructions — Grade: B (planning doc) — Last updated: 2025-12-10
  - [features/PLUGIN_SYSTEM_IMPLEMENTATION.md](features/PLUGIN_SYSTEM_IMPLEMENTATION.md) — Summary of the completed plugin system: capabilities, registry, provider migration, upgrade plugin, and future enhancements — Grade: A (captures completed implementation) — Last updated: 2025-12-10
  - [features/QUILLTAP-EXPORT-IMPORT.md](features/QUILLTAP-EXPORT-IMPORT.md) — Specification for a native Quilltap export/import format, manifest structure, API routes, UI flows, conflict handling, and testing — Grade: B (spec awaiting implementation) — Last updated: 2025-12-17
  - [features/artifacts.md](features/artifacts.md) — Feature request outlining an “artifacts” side panel concept for rendering AI-generated content with copy/download actions — Grade: B (future concept) — Last updated: 2025-12-10
  - [features/comfy_ui_local_image.md](features/comfy_ui_local_image.md) — Proposal for a ComfyUI image generation plugin: architecture, workflow manager, UI, configuration, and future phases — Grade: B (proposal) — Last updated: 2025-12-06
  - [features/complete/CHEAP-LLM.md](features/complete/CHEAP-LLM.md) — Notes on cheap LLM selection, embedding profiles, and fallback heuristics when embeddings are unavailable — Grade: A (implemented behavior) — Last updated: 2025-11-29
  - [features/complete/FILE_ATTACHMENT_FALLBACK.md](features/complete/FILE_ATTACHMENT_FALLBACK.md) — Documentation describing the file attachment fallback system for providers lacking native support (text/image handling) — Grade: A (shipping behavior) — Last updated: 2025-11-29
  - [features/complete/FILE_ATTACHMENT_TROUBLESHOOTING.md](features/complete/FILE_ATTACHMENT_TROUBLESHOOTING.md) — Troubleshooting guide for attachment fallback issues, common errors, and solutions — Grade: A (operational fix guide) — Last updated: 2025-11-29
  - [features/complete/IMAGE-PROMPT-EXPANSION.md](features/complete/IMAGE-PROMPT-EXPANSION.md) — Details the prompt expansion pipeline that uses character descriptions, cheap LLM crafting, and examples — Grade: A (describes implemented pipeline) — Last updated: 2025-11-29
  - [features/complete/characters_not_personas.md](features/complete/characters_not_personas.md) — Documents the migration from personas to user-controlled characters, including impersonation, all-LLM pause logic, and inter-character memories — Grade: A (completed implementation) — Last updated: 2025-12-30
  - [features/complete/LOCAL_USER_AUTH.md](features/complete/LOCAL_USER_AUTH.md) — Comprehensive spec for local email/password auth with TOTP 2FA, implementation phases, code samples, and testing — Grade: A (implemented auth flow) — Last updated: 2025-12-10
  - [features/complete/ROADMAP.md](features/complete/ROADMAP.md) — Extensive roadmap detailing tech stack choices, phases to v1.1, database schema, testing, Docker setup, and FAQs — Grade: A (roadmap delivered) — Last updated: 2025-11-29
  - [features/complete/plugin_installation.md](features/complete/plugin_installation.md) — npm-based plugin installation system: search, install/uninstall APIs, site/user scopes, manifest validation, and Docker configuration — Grade: A (implemented feature) — Last updated: 2025-12-30
  - [features/complete/plugins.md](features/complete/plugins.md) — Summary of the plugin system status (provider plugins, upgrade plugin, planned themes/backend extensions) and documentation references — Grade: A (implementation summary) — Last updated: 2025-12-10
  - [features/complete/context_compression.md](features/complete/context_compression.md) — Sliding window context compression for long conversations: reduces token costs by compressing older messages, configurable window size and targets, request_full_context tool for AI to reload full context — Grade: A (implemented feature) — Last updated: 2026-01-08
  - [features/complete/theme-utility-classes.md](features/complete/theme-utility-classes.md) — Migration plan for qt-* semantic class system, phase breakdown, new CSS tokens, and status tracking — Grade: A (matches delivered tokens) — Last updated: 2025-12-10
  - [features/complete/theming-plugin-system.md](features/complete/theming-plugin-system.md) — Implementation blueprint for the theming plugin system: token schemas, registry, provider, settings UI, and example theme — Grade: A (implemented system) — Last updated: 2025-12-10
  - [features/complete/new_ui_layout.md](features/complete/new_ui_layout.md) — Documents the new UI layout with left sidebar navigation, collapsible sidebar, mobile overlay drawer, and simplified header — Grade: A (implemented layout) — Last updated: 2026-01-01
  - [features/distant_future_separate_api.md](features/distant_future_separate_api.md) — Future plan to split the monolith into a Fastify API + React SPA, covering phases, risks, testing, and AWS deployment strategy — Grade: C (distant concept, not scheduled) — Last updated: 2025-12-12
  - [features/random-numbers-plugin.md](features/random-numbers-plugin.md) — Feature request outlining a random number/choice plugin (dice, coin flip, random participant) — Grade: B (idea backlog) — Last updated: 2025-12-12
  - [features/sync_api.md](features/sync_api.md) — Comprehensive specification for bidirectional sync between Quilltap instances: data models, API endpoints, sync algorithm, conflict resolution, and Settings UI — Grade: B (planning doc) — Last updated: 2025-12-23
  - [features/usage-tracking.md](features/usage-tracking.md) — Request for provider usage/balance tracking: per-provider notes, UX requirements, engineering tasks, and open questions — Grade: B (idea backlog) — Last updated: 2025-12-10
  - [lib/llm/ATTACHMENT_SUPPORT.md](lib/llm/ATTACHMENT_SUPPORT.md) — Reference for attachment support utilities: supported MIME types per provider, helper APIs, and usage examples — Grade: A (matches helper behavior) — Last updated: 2025-11-29
  - [packages/plugin-types/README.md](packages/plugin-types/README.md) — Documentation for the @quilltap/plugin-types npm package: installation, usage, type reference, and plugin manifest guide for third-party plugin development — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/plugin-types/CHANGELOG.md](packages/plugin-types/CHANGELOG.md) — Changelog for the @quilltap/plugin-types package — Grade: A (package changelog) — Last updated: 2025-12-30
  - [packages/plugin-utils/README.md](packages/plugin-utils/README.md) — Documentation for the @quilltap/plugin-utils npm package: tool parsing, format conversion, and logger bridge for plugin development — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/plugin-utils/CHANGELOG.md](packages/plugin-utils/CHANGELOG.md) — Changelog for the @quilltap/plugin-utils package — Grade: A (package changelog) — Last updated: 2025-12-30
  - [packages/theme-storybook/README.md](packages/theme-storybook/README.md) — Documentation for the @quilltap/theme-storybook npm package: Storybook preset, default tokens, component classes, and story components for theme plugin development — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/theme-storybook/CHANGELOG.md](packages/theme-storybook/CHANGELOG.md) — Changelog for the @quilltap/theme-storybook package — Grade: A (package changelog) — Last updated: 2025-12-31
  - [packages/create-quilltap-theme/README.md](packages/create-quilltap-theme/README.md) — Documentation for the create-quilltap-theme scaffolding CLI: usage, options, what gets created, and next steps after scaffolding — Grade: A (package documentation) — Last updated: 2025-12-31
  - [packages/create-quilltap-theme/CHANGELOG.md](packages/create-quilltap-theme/CHANGELOG.md) — Changelog for the create-quilltap-theme package — Grade: A (package changelog) — Last updated: 2025-12-31
  - [plugins/dist/qtap-plugin-mcp/README.md](plugins/dist/qtap-plugin-mcp/README.md) — Documentation for the MCP Server Connector plugin: configuration, authentication, tool naming, security, and troubleshooting — Grade: A (plugin documentation) — Last updated: 2026-01-13
  - [migrations/README.md](migrations/README.md) — Documentation for the migration system: architecture, adding new migrations, running migrations, and troubleshooting — Grade: A (migration system docs) — Last updated: 2026-01-21

## Claude-specific instructions

- If you have access to Opus and agents, then plan work in Opus and delegate it to agents running Haiku with specific instructions. If you can't use Opus then use Sonnet to plan. Feel free to aggressively agentize the work.
- If you are asked to work on a large change (adding a significant feature, a refactor that does a lot of things, or something else that touches a lot of files), then plan it in Opus and delegate the work to Haiku agents.
- For every new feature and all existing functionality that is updated or touched in the backend, make sure that there are debug logs being fired for everything, and appropriate levels of logging for everything else, using the built-in logging system in this app
- I am developing this in macOS, so take BSD versions of tools into account, and the fact that I have installed homebrew's coreutils and gnu-sed so that you can use GNU versions of things with "g"-prefixed utilities if you need them.
- I am using "npm run devssl" to work on this while we're working, so the base URL is probably `https://localhost:3000/` if you want to try something.
- You should track what's going on with the running "npm run devssl" process, which is nearly always running while we're working on this, by tailing or searching the `logs/combined.log` file. You can figure out what time it is (I think it's using universal time, not local time), and then look for things that we just tried by working through that log.
- To access MongoDB directly via Docker, use: `docker exec f9-quilltap-mongo-1 mongosh quilltap --quiet --eval "YOUR_QUERY_HERE"`. Examples:
  - List documents: `docker exec f9-quilltap-mongo-1 mongosh quilltap --quiet --eval "db.COLLECTION.find().toArray()"`
  - Delete documents: `docker exec f9-quilltap-mongo-1 mongosh quilltap --quiet --eval "db.COLLECTION.deleteMany({})"`
  - Query with filter: `docker exec f9-quilltap-mongo-1 mongosh quilltap --quiet --eval "db.COLLECTION.find({field: 'value'}).toArray()"`
- This is built in Next.js 15+, so don't look in middleware.ts, but consider proxy.ts, for things you would expect there.
- When creating or modifying API routes, always use the `/api/v1/` structure with action dispatch patterns. Don't create new routes outside `/api/v1/`. Use the middleware from `@/lib/api/middleware` and response helpers from `@/lib/api/responses`.
- If asked to fix linting errors, do not change out HTML `<img>` tags for Next.js `<Image>` tags; there is a reason that we don't use them sometimes, usually related to their being pulled in via APIs so Next.js can't know what it's going to display.
- Every time we change a plugin, let's go ahead and bump the release number (the last of the three numbers in semver) on its package.json, and re-run `npm run build:plugins` before we add things to the commit.
- Check for Typescript errors by running "npx tsc" rather than "npm run build"
- When committing, record basic changes in `docs/CHANGELOG.md` in reverse chronological order
- Themes and styling should depend primarily on the qt-* utility classes that we have defined. When possible, use those and update those with Tailwind and other things. That way the themes will always be able to override changes.
- Keep the documentation above up to date, and update this file if you add more documentation, in the same format.
- Any change to data, particularly the schemas used to read or write data either to files or to the database, should be checked to see if they need to be reflected in exports, backups, and/or the migrations/ directory.
- Any files that exist in the app source code only because they are necessary for migrations should move to the `migrations/` directory.
- If we make changes to anything in the `packages/` directory, we need to pause make sure we update package.json numbers and pause to allow `npm publish` to push those packages into npmjs. We do *not* just copy things down into the appropriate directories! We wait to publish the new npm package first. You can stop everything, ask me to publish the new version, then install the new one. If that doesn't work, lets fix the NPM problem we're having, **NOT** work around it.
- Commits take a long time because there is a precommit script in `.githooks/pre-commit` that kills the dev server, runs lint, runs the unit tests, does a test compile with `npx tsc`, builds the plugins, and then does a full Next.js build of the app, to ensure that we're committing something that basically works.

## Best Practices and Principles

- respect encapsulation and single source of truth. If a feature requires duplicate code, consider inheritance
- SRP
- DRY
- KISS
- YAGNI
