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
- **Saquel Ytzama, the Keeper of Secrets** - the encryption, API key management, and secrets system — merged into Data & System tab at `/settings?tab=system`

Note: API routes remain at their original paths (`/api/v1/characters`, `/api/v1/chats`, `/api/v1/projects`). Old UI routes (`/foundry/*`) redirect to the appropriate `/settings` tab.

## Current State

- **Details for things already implemented** are in [the README](README.md)
- **Roadmap for future development** is in the files in the `features/` directory, with completed development in `features/complete/`

## qt-\* CSS tokens and semantic classes for themes

- Themes and styling should depend primarily on the `qt-*` semantic utility classes that we have defined. When possible, use those and update those with Tailwind and other things. That way the themes will always be able to override changes. **IMPORTANT:** If you add new Tailwind classes, then almost certainly you should be adding them to the `qt-*` utility classes instead, and then apply those classes to the components you want to change.
- qt-* significant changes need to be appropriately reflected in the stylebook, the [theme-stylebook](/packages/theme-storybook) package, and maybe in the [create-quilltap-theme](/packages/create-quilltap-theme) package, as well as updating the bundled themes as necessary.
  - **packages**: find in [packages/](/packages/)
  - **plugins**: bundled theme plugins are in [plugins/dist/qtap-plugin-theme-*](/plugins/dist/)

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
- This is built in Next.js 16+, so don't look in middleware.ts, but consider proxy.ts, for things you would expect there.
- When creating or modifying API routes, always use the `/api/v1/` structure with action dispatch patterns. Don't create new routes outside `/api/v1/`. Use the middleware from `@/lib/api/middleware` and response helpers from `@/lib/api/responses`.
- If asked to fix linting errors, do not change out HTML `<img>` tags for Next.js `<Image>` tags; there is a reason that we don't use them sometimes, usually related to their being pulled in via APIs so Next.js can't know what it's going to display.
- Every time we change a plugin, let's go ahead and bump the release number (the last of the three numbers in semver) on its package.json, and manifest.json if required, and re-run `npm run build:plugins` before we add things to the commit.
- Check for Typescript errors by running "npx tsc" rather than "npm run build"
- **Important:** Before committing, record basic changes in `docs/CHANGELOG.md` in reverse chronological order
- Keep the documentation listed in [update-documentation](/.claude/commands/update-documentation.md) up to date, and update that file if you add more documentation, in the same format.
- Any change to data, particularly the schemas used to read or write data either to files or to the database, should be checked to see if they need to be reflected in .qtap or SillyTavern exports, the [qtap schema](./public/schemas/qtap-export.schema.json), backups, and/or the migrations/ directory.
- Any files that exist in the app source code only because they are necessary for migrations should move to the `migrations/` directory.
- **IMPORTANT**: If we make changes to anything in the `packages/` directory, we need to make sure we update package.json numbers and pause to allow the developer/human user to `npm publish` to push those packages into npmjs. We do *not* just copy things down into the appropriate directories! We wait to publish the new npm package first. You can stop everything, ask me to publish the new version, then install the new one. If that doesn't work, let's fix the NPM problem we're having, **NOT** work around it.
- The pre-commit hook in `.githooks/pre-commit` kills the dev server, cleans .next, stops watchman, and stages dependency artifacts. Linting, testing, type-checking, and version updates are handled by the [/commit](/.claude/commands/commit.md) command before the actual commit.
- Leave no stubs and "TODO" code behind unless you have agreed on it with me ahead of time
- All user-visible changes **MUST** be documented in help files found in `help/*.md`
- All writing for users is to be in the style of "steampunk + roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket"

## Best Practices and Principles

- respect encapsulation and single source of truth
  - If a feature requires duplicate code, consider inheritance
- SRP
- DRY
- KISS
- YAGNI
