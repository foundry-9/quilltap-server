# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on. Connect to any LLM provider, organize your work into projects with persistent files and context, create characters with real personalities, and build a private AI environment that learns and remembers.

## Technology Stack

- **Frontend Framework**: React via Next.js
- **Build Tools**: Next.js
- **Language**: TypeScript
- **Package Manager**: npm
- **Testing**: Jest (with native coverage) and Playwright
- **Data Storage**: SQLite with SQLCipher encryption at rest. Uses `better-sqlite3-multiple-ciphers` driver (aliased as `better-sqlite3`). Data models are defined as TypeScript interfaces with Zod schemas.
- **File Storage**: local filesystem only
- **AI and LLM Services**: OpenAI, Anthropic, Grok (xAI), Google, Ollama, OpenRouter, and any OpenAI-compatible endpoint
- **Design Documentation**: Storybook
- **API Structure**: Versioned REST API under `/api/v1/` with action dispatch pattern
- **User Documentation**: Found in `/help/` and maintained and searchable using MessagePack
- **Electron**: Desktop shell lives in a separate repository ([quilltap-shell](https://github.com/foundry-9/quilltap-shell)); this repo produces the standalone tarball it consumes
- **Native Modules**: `better-sqlite3` (compiled via node-gyp) and `sharp` (pre-built platform binaries via `@img/sharp-{platform}-{arch}`). Both require special handling in standalone and Docker builds — sharp's platform-specific binaries must be installed for the target platform. When adding new native modules, update `next.config.js` (`serverExternalPackages` + `outputFileTracingIncludes`).

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

## Current State

- **Details for things already implemented** are in [the README](README.md)
- **Roadmap for future development** is in the files in the `docs/developer/features/` directory, with completed development in `docs/developer/features/complete/`

## Themes

### Theme Distribution

- **Bundle format (.qtap-theme)** is the primary and recommended way to distribute themes — declarative zip archives containing JSON tokens, CSS, fonts, and images with no build tools required
- **Plugin format (npm)** is deprecated — existing plugin themes still work but new themes should use bundles
- All 5 bundled themes (Art Deco, Earl Grey, Great Estate, Old School, Rains) ship as `.qtap-theme` bundle directories in `themes/bundled/` — the old `plugins/dist/qtap-plugin-theme-*` directories have been removed
- Theme bundles are stored at `<dataDir>/themes/<themeId>/` with an index at `<dataDir>/themes/themes-index.json`
- Theme registries allow browsing/installing themes from remote sources with Ed25519 signature verification
- `create-quilltap-theme` v2.0.0+ defaults to bundle format; use `--plugin` for legacy npm plugin format

### Theme Architecture

- Theme registry is a singleton at `lib/themes/theme-registry.ts` with three source types: `'default'`, `'plugin'`, `'bundle'`
- Bundle loader at `lib/themes/bundle-loader.ts` handles validation, install, uninstall, and loading
- Registry client at `lib/themes/registry-client.ts` manages remote sources with caching and signature verification
- Ed25519 crypto at `lib/themes/crypto.ts` for signing/verifying registries and bundles
- Bundle manifest schema: `QtapThemeManifestSchema` in `lib/themes/types.ts`; JSON Schema at `public/schemas/qtap-theme.schema.json`
- Asset/font serving routes at `app/api/themes/assets/` and `app/api/themes/fonts/` handle both plugin and bundle paths (bundle paths use `bundle:<themeId>` prefix)
- CLI: `npx quilltap themes` subcommands (list/install/uninstall/validate/export/create/search/update/registry)

### qt-* CSS tokens and semantic classes

- Themes and styling should depend primarily on the `qt-*` semantic utility classes that we have defined. When possible, use those and update those with Tailwind and other things. That way the themes will always be able to override changes. **IMPORTANT:** If you add new Tailwind classes, then almost certainly you should be adding them to the `qt-*` utility classes instead, and then apply those classes to the components you want to change.
- qt-* significant changes need to be appropriately reflected in the stylebook, the [theme-storybook](/packages/theme-storybook) package, and maybe in the [create-quilltap-theme](/packages/create-quilltap-theme) package, as well as updating the bundled themes as necessary.
  - **packages**: find in [packages/](/packages/)
  - **bundled themes**: shipped in [themes/bundled/](/themes/bundled/)

## Other Quilltap conventions

- "instances" are the self-contained base-level directories to which you point Quilltap when you run it.
  - Default instance for files depends on OS and category:
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
  - Other instances can exist
    - specified by `QUILLTAP_DATA_DIR` environment variable (non-Docker)
    - `QUILLTAP_HOST_DATA_DIR` environment variable passed to Docker so that it can display it in the UI
    - CLI specification of instance directory
      - `npx quilltap --data-dir /custom/path`
      - `npx quilltap -d /custom/path`
      - `docker run -v /custom/path:/app/quilltap foundry9/quilltap`
      - The following can also use `QUILLTAP_DATA_DIR`:
        - `./scripts/start-quilltap.sh -d /custom/path`
        - `.\scripts\start-quilltap.ps1 -DataDir "D:\custom\path"`
  - **IMPORTANT**: If I say I am in an instance in `~/iCloud/Quilltap/Friday`, for example, then this is the critical troubleshooting or development information I need for that instance:
    - **Data**: `~/iCloud/Quilltap/Friday/data/`
    - **Files**: `~/iCloud/Quilltap/Friday/files/`
    - **Logs**: `~/iCloud/Quilltap/Friday/logs/`
      - This includes `combined.log` and `error.log` which are automatically rolled every 2-3 MB
      - This also includes `quilltap-stderr.log` and `quilltap-stdout.log` which are generated by server instances, and `startup.log` generated by the Electron app, and possibly `stdout.log` as well

### Spelling **IMPORTANT**

This project is spelled "Quilltap", as in "quill" + "tap", **NOT** "Quilttap", as in "quilt" + "tap". There is a linting rule to keep you from using that word. Please, please, never call anything in this system "quilttap" because that is **WRONG.**

### Feature Names

- **The Concierge** - the dangerous content tracking/rerouting/hiding system — merged into Chat tab at `/settings?tab=chat`
- **The Commonplace Book** - the memory system that characters have, a self-managed RAG — settings at `/settings?tab=memory`
- **The Lantern** - the story backgrounds subsystem, that can send context to image providers and put them up as backgrounds for chats or projects — settings at `/settings?tab=images`
- **Prospero** - the agentic and tool-using systems, and the way LLMs work — UI route: `/prospero` (was `/projects`); settings tab `/settings?tab=system` (task queue, capabilities, LLM logs)
- **Aurora** - the character model on the UI side (UI route: `/aurora` — was `/characters`) and the roleplay-template / prompt configuration on the settings side (`/settings?tab=templates`)
- **Calliope** - the UX/UI and themes systems — settings at `/settings?tab=appearance`
- **The Foundry** - the architecture underneath, plugins and packages and services — UI route: `/settings` (was `/foundry`, `/tools`); settings live on a single tabbed page (current tabs: providers, chat, system, templates, memory, images, appearance — see `lib/foundry/subsystem-defaults.ts` for the source of truth)
- **The Salon** - the chat interface — UI route: `/salon` (was `/chats`)
- **The Scriptorium** - external document stores / mountable knowledge sources — UI route: `/scriptorium`; API stays at `/api/v1/mount-points`
- **Pascal the Croupier** - the RNG and game state tracking system — merged into Chat tab at `/settings?tab=chat`
- **Saquel Ytzama, the Keeper of Secrets** - the encryption, API key management, and secrets system — merged into Data & System tab at `/settings?tab=system`
- **The Librarian** - synthetic chat-message author for Document Mode events (open/save/rename/delete) and character-driven `doc_*` tool calls; speaks via `systemSender: 'librarian'`
- **The Host** - synthetic chat-message author for Salon participation events (character add/remove/status change); speaks via `systemSender: 'host'`

Note: API routes remain at their original paths (`/api/v1/characters`, `/api/v1/chats`, `/api/v1/projects`). Old UI routes (`/foundry/*`) redirect to the appropriate `/settings` tab.

### Personified-feature avatars

When a personified feature (the Lantern, the Concierge, Prospero, Aurora, Pascal, the Librarian, the Host, etc.) needs to "speak up" in a chat — usually via a synthetic message authored by the system in lieu of a participant — its avatar lives under `public/images/avatars/` as `<feature>-avatar.webp`. The chat UI references these as `/images/avatars/<feature>-avatar.webp` (see `getMessageAvatar` in `app/salon/[id]/page.tsx` for the Lantern case, keyed off `systemSender` on the message).

Rules for adding or updating these assets:

- **Always WebP.** Convert source PNGs with `cwebp -q 82 -m 6 -mt <in>.png -o <out>.webp` (or better) and delete the PNG after verifying the WebP. Don't check multi-MB PNG originals into the repo — these are bundled with the app and every byte ships.
- **Filename pattern:** `<feature>-avatar.webp`, all lowercase, hyphen-separated. The feature name should match how the feature is referred to elsewhere (e.g. `lantern-avatar.webp`, not `the-lantern-avatar.webp`).
- **Pair new avatars with new `systemSender` enum values.** `MessageEventSchema` in `lib/schemas/chat.types.ts` and the matching SQLite column on `chat_messages` both list the allowed senders. Adding a new sender means updating the Zod enum in both places, adding a branch to `getMessageAvatar`, and including the new value in `public/schemas/qtap-export.schema.json`. Current `systemSender` enum (`lib/schemas/chat.types.ts`): `lantern`, `aurora`, `librarian`, `concierge`, `prospero`, `host`. (A `pascal-avatar.webp` exists on disk but Pascal does not currently author synthetic messages — the avatar is reserved for future use.) Sender responsibilities:
  - `lantern` — image-pipeline announcements (background generation, etc.)
  - `aurora` — character avatar refresh / wardrobe announcements
  - `librarian` — Document Mode open/save/rename/delete announcements, plus character `doc_delete_file` / `doc_create_folder` / `doc_delete_folder` / `doc_copy_file` tool calls
  - `concierge` — dangerous-content classification announcements
  - `host` — Salon participation announcements (character add/remove/status change)
  - `prospero` — reserved for upcoming agentic/tool-use announcements

## Claude-specific instructions

- If you have access to Opus and agents, then plan work in Opus for a change of any significant size and delegate it to agents running Haiku with specific instructions. If you can't use Opus then use Sonnet to plan. Feel free to aggressively agentize the work. Don't use git stash or worktrees with agents; you have a tendency to make a mess when you do that.
- For every new feature and all existing functionality that is updated or touched in the backend, make sure that there are debug logs being fired for everything, and appropriate levels of logging for everything else, using the built-in logging system in this app
- I am developing this in macOS, so take BSD versions of tools into account, and the fact that I have installed homebrew's coreutils and gnu-sed so that you can use GNU versions of things with "g"-prefixed utilities if you need them.
- I am using "npm run dev" to work on this while we're working, so the base URL is probably `http://localhost:3000/` if you want to try something.
- You should track what's going on with the running "npm run dev" process, which is nearly always running while we're working on this, by tailing or searching the `logs/combined.log` file. You can figure out what time it is (I think it's using universal time, not local time), and then look for things that we just tried by working through that log.
- Databases are encrypted with SQLCipher. The standard `sqlite3` CLI cannot open them. Use the Quilltap CLI instead:
  - List tables: `npx quilltap db --tables`
  - Check record count: `npx quilltap db "SELECT COUNT(*) FROM TABLENAME;"`
  - Query with filter: `npx quilltap db "SELECT * FROM TABLENAME WHERE field = 'value';"`
  - Interactive REPL: `npx quilltap db --repl`
  - Query LLM logs DB: `npx quilltap db --llm-logs --tables`
  - Custom data dir: `npx quilltap db --data-dir /path/to/data --tables`
  - All information about the databases, including schema and how to query them, can be found in [DDL.md](docs/developer/DDL.md).
- This is built in Next.js 16+, so don't look in middleware.ts, but consider proxy.ts, for things you would expect there.
- When creating or modifying API routes, always use the `/api/v1/` structure with action dispatch patterns. Don't create new routes outside `/api/v1/`. Use the middleware from `@/lib/api/middleware` and response helpers from `@/lib/api/responses`.
- If asked to fix linting errors, do not change out HTML `<img>` tags for Next.js `<Image>` tags; there is a reason that we don't use them sometimes, usually related to their being pulled in via APIs so Next.js can't know what it's going to display.
- Every time we change a plugin, let's go ahead and bump the release number (the last of the three numbers in semver) on its package.json, and manifest.json if required, and re-run `npm run build:plugins` before we add things to the commit.
- Check for Typescript errors by running "npx tsc" rather than "npm run build"
- **Important:** Before committing, record basic changes in `docs/CHANGELOG.md` in reverse chronological order. **The changelog is an exception to the Quilltap writing style described below.** Write entries concisely, in straightforward American English words and spellings — none of the steampunk / Roaring Twenties / Wodehouse / Lemony Snicket voice that applies to user-facing docs and UI. The changelog is a developer-facing record of changes; keep it terse and direct.
- Keep the documentation listed in [update-documentation](/.claude/commands/update-documentation.md) up to date, and update that file if you add more documentation, in the same format.
- Any change to data, particularly the schemas used to read or write data either to files or to the database, should be checked to see if they need to be reflected in .qtap or SillyTavern exports, the [qtap schema](./public/schemas/qtap-export.schema.json), backups, and/or the migrations/ directory. Update [DDL.md](docs/developer/DDL.md) as appropriate; it must be kept up-to-date.
- Any files that exist in the app source code only because they are necessary for migrations should move to the `migrations/` directory.
- **IMPORTANT**: If we make changes to anything in the `packages/` directory, we need to make sure we update package.json numbers and pause to allow the developer/human user to `npm publish` to push those packages into npmjs. We do *not* just copy things down into the appropriate directories! We wait to publish the new npm package first. You can stop everything, ask me to publish the new version, then install the new one. If that doesn't work, let's fix the NPM problem we're having, **NOT** work around it.
- The pre-commit hook in `.githooks/pre-commit` kills the dev server, cleans .next, stops watchman, and stages dependency artifacts. Linting, testing, type-checking, and version updates are handled by the [/commit](/.claude/commands/commit.md) command before the actual commit.
- Leave no stubs and "TODO" code behind unless you have agreed on it with me ahead of time
- All user-visible changes **MUST** be documented in help files found in `help/*.md`
- Help files have a `url` field in their frontmatter and an "In-Chat Navigation" section with an exact `help_navigate` tool call. When creating or modifying help files, ensure the `url` frontmatter points to the correct page (with `?tab=` and `&section=` parameters for settings deep-linking), and that the "In-Chat Navigation" section contains the matching `help_navigate(url: "...")` call.
- All writing for users is to be in the style of "steampunk + roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket"
- **IMPORTANT**: We need the human developer's confirmation that they have walked through the release checklist in [DEVELOPMENT.md](./docs/developer/DEVELOPMENT.md#checklist-before-release) when they are ready to run the command `tag-for-release` in production - if they want to go through them, then go through that list with them. Don't do anything there on your own unless they ask you to; this is up to the developer.

## Best Practices and Principles

- respect encapsulation and single source of truth
  - If a feature requires duplicate code, consider inheritance
- SRP
- DRY
- KISS
- YAGNI
