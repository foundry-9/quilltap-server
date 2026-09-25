# CLAUDE.md

Guidance for Claude Code when working in this repository. This file is loaded on every turn, so it stays short and points at deeper docs. **The rules in "Standing rules" below are not optional — follow them on every task.**

## Project Overview

Quilltap is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on. Connect to any LLM provider, organize work into projects with persistent files and context, create characters with real personalities, and build a private AI environment that learns and remembers.

- **Already implemented:** see the [README](README.md).
- **Roadmap:** `docs/developer/features/`; completed work in `docs/developer/features/complete/`.

## Standing rules (apply on every task)

### Spelling — non-negotiable

The project is **"Quilltap"** (quill + tap), **never** "Quilttap" (quilt + tap). An ESLint rule enforces this in JS/TS, and `npm run lint` also sweeps every other tracked file — docs included. Never write "quilttap" anywhere.

### Writing voice

- **User-facing** writing (UI, help docs, prompts, migration loading-screen labels) is in the style of *steampunk + Roaring 20s + Great Gatsby + Wodehouse + Lemony Snicket*.
- **`docs/CHANGELOG.md` is the exception:** terse, direct, plain American English. No steampunk voice.

### Before committing

- Record changes in `docs/CHANGELOG.md` (reverse chronological, plain voice — see above).
- **All user-visible changes MUST be documented in `help/*.md`.** Help files need a `url` frontmatter field (with `?tab=`/`&section=` for settings deep-links) and an "In-Chat Navigation" section whose `help_navigate(url: "...")` call matches that `url`.
- Keep the docs listed in [update-documentation](/.claude/commands/update-documentation.md) current; update that file if you add docs.
- Linting, testing, type-checking, and version bumps are handled by the [/commit](/.claude/commands/commit.md) command. The `.githooks/pre-commit` hook kills the dev server, cleans `.next`, stops watchman, and stages dependency artifacts.
- Check TypeScript with **`npx tsc`**, not `npm run build`.

### Filing bugs

Defects worth recording live in the bug catalogue, indexed by
[docs/developer/bugs.md](docs/developer/bugs.md).

- **One bug, one file.** Open: `docs/developer/bugs/bug-<n>-<short-title>.md`.
  Fixed: the same file `git mv`d into `docs/developer/bugs/fixed/`, keeping its
  number. `<short-title>` is a two-or-three-word dashed description of the
  *problem* (`bug-9-store-delete-orphans.md`).
- **Numbers are permanent and sequential** — a new bug takes the next unused one.
- **Each file opens with a metadata table** (Status, Found, Fixed, Severity, Who
  it bites, Provenance, Fix site, v5 status, link back to the index), then states
  symptom, root cause with file and line, why it survived, the fix, and how to
  verify. A fixed entry keeps its full write-up plus a leading
  **`FIXED in v4 (date)`** paragraph.
- **The index's Status table is the register.** Filing or fixing a bug means
  updating *both* the bug's file and its row there. Never delete an entry.

### Hard stops (ask first / never work around)

- **`packages/` changes:** bump the version, then **stop and ask the human to `npm publish`** before installing. Never hand-copy package contents into place. If publish fails, fix the npm problem — don't work around it. **Exception — `packages/quilltap` (the CLI):** still bump its version, but don't ask for a manual `npm publish`; it publishes automatically at release.
- **Plugin changes:** bump the patch version in `package.json` (and `manifest.json` if needed), then re-run `npm run build:plugins` before staging. That build now typechecks each plugin first (`tsc -p tsconfig.json`, extending [`plugins/tsconfig.base.json`](./plugins/tsconfig.base.json)) and fails on any error — the root `npx tsc` excludes `plugins/`, so this is the only thing checking plugin types. A new plugin needs its own `tsconfig.json` extending that base plus a `typecheck` script.
- **Release (`tag-for-release`):** only after the human confirms they've walked the [release checklist](./docs/developer/DEVELOPMENT.md#checklist-before-release). Don't initiate it yourself.
- **No stubs or `TODO` code** unless agreed in advance.
- **Database writes via the CLI** use `--write` (lock-gated). Never use `--lock-override`.

### Code-path chokepoints (don't bypass)

- **Memory deletion** goes through `deleteMemoryWithUnlink(id)` / `deleteMemoriesWithUnlinkBatch(ids)` in `lib/memory/memory-gate.ts` — they scrub deleted IDs from neighbours' `relatedMemoryIds` first. Never call `repos.memories.delete*` directly. (Mirror of `createMemoryWithGate` on the write side.)
- **Tool definitions in `lib/tools/`:** the Zod input schema is the single source of truth. Export `xxxToolInputSchema`, derive `parameters` via `zodToOpenAISchema(...)`, and make `validateXxxInput` a one-line `safeParse(...).success` delegate. **Never hand-write the `parameters` JSON Schema or duplicate validation** — they drift. Field descriptions go on `.describe()`; extra checks on `.refine()`. Register new tools in `lib/tools/__tests__/tool-definitions-snapshot.test.ts` and run `npx jest -u` on it.
- **API routes:** new routes only under `/api/v1/` with the action-dispatch pattern (see below). Use middleware from `@/lib/api/middleware` and helpers from `@/lib/api/responses`.
- **Archived characters are tombstones.** A pruned vault is still live and writable, so the guards are the only thing keeping an archived character from being edited back into existence. `validateCharacterArchivePatch` (`lib/database/repositories/characters.repository.ts`) sanctions exactly one patch on an archived row — `{ archivedAt: null }` — and refuses everything else with `CharacterArchivedError`. Any new path that reaches a character's vault must respect the tombstone the way `resolveSelfVaultMountPointId` (`lib/doc-edit/path-resolver.ts`, returns null) and `resolveWardrobeMount` (`lib/database/repositories/vault-overlay/wardrobe-writes.ts`, throws) already do — never fall back to a legacy DB write path, and never call `ensureCharacterVault` on one. Archive/rehydrate themselves go through `lib/characters/archive-service.ts`; bundle crypto lives in `archive-crypto.ts` and must use the passphrase cache (`lib/startup/passphrase-cache.ts`), never `ENCRYPTION_MASTER_PEPPER`.
- **Realtime hints are parent-process only, and never carry data.** `publishRealtime(topic, id?)` (`lib/realtime/bus.ts`) says *what changed*; the client re-reads through the REST API. Publishing from the forked job child is a no-op by design — a child's changes surface from the parent chokepoints (`dispatchInvalidations`, `topicsForCompletedJob`, the activity mirror). **A new polling site is a bug:** publish a topic and gate the interval with `useRealtimeRefetchInterval` / `useRealtimeTopic` so the poll is only the offline fallback. A new `queryKeys` namespace means considering a row in `REALTIME_TOPICS` (`lib/schemas/realtime.types.ts`) and `lib/realtime/topic-map.ts`. Both WebSocket handlers authenticate through `lib/realtime/upgrade-auth.ts` — never hand-roll upgrade auth, and a new handler module needs its own esbuild line in `scripts/build-standalone-overlay.mjs` or it works in dev and vanishes from the tarball. Design of record: [features/complete/realtime-updates.md](docs/developer/features/complete/realtime-updates.md).
- **Folder rows in the legacy `folders` table** are created through `FoldersRepository.ensureByPath` — never `folders.create` for a path that may already exist. A `(userId, COALESCE(projectId,''), path)` unique index backs it, and it resolves a constraint violation to the row that won. Six hand-rolled `findByPath` → `create` guards is how the table grew 607 rows for 24 folders (bug 114): `findByPath` returns `null` on read *failure* as well as absence, and the check and the insert are not atomic across concurrent jobs. Restore is the one sanctioned `create` caller, because it must preserve ids.
- **A chat's Concierge posture is three states with a provenance note, never raw columns.** `conciergeMode` (`'moderated'` / `'unmoderated'` / `'locked'`, NULL reads as Moderated) plus `conciergeModeSetBy` / `conciergeModeReason` are storage; the legacy `conciergeOverride` column was dropped in 4.10 (old bundles and backups derive through `withConciergeModeFromLegacy`) and `isDangerousChat` is only the classifier's telemetry — no routing or display decision reads it. The *global* half is `conciergeSettings` (the Concierge tab); read its effective policy for a chat through `resolveConciergeSettings` (`resolver.service.ts`) and ask the named question — `failoverAllowed`, `routeDirect`, `preScreen.*`, `summaryClassification`, `autoSwitchAfterRefusals`, `desk.*` — never a raw field; there is no global mode any more. Derive the state with `getConciergeState` / `getConciergeProvenance` (`lib/services/dangerous-content/chat-override.ts`, which also read a server-derived `conciergeState` payload) and ask the specific question with `shouldUseUncensoredRoute` (Unmoderated), `shouldShowDangerStyling` (Unmoderated, whoever set it — provenance goes in the tooltip, never the colour), `isClassifierOnDuty` (Moderated: may the Concierge move it?) or `mayFailOver` (not Locked: may a refusal be rerouted? — the image and text failover chokepoints ask it before the mode). Old data enters through `deriveConciergeModeFromLegacy` / `withConciergeModeFromLegacy` (migration, importer, restore). Every transition goes through `applyConciergeFlip` (`lib/services/dangerous-content/manual-flip.ts`), the one chokepoint that maps the requested state onto its writes and posts the Concierge's announcement. It writes the state only through `ChatsRepository.setConciergeMode` — the three columns are **patch-only** (`patchOnlyFields()`), so a whole-row `update` never carries a stale copy back — and a Concierge-initiated move is a compare-and-set against the state he read (a miss announces nothing), refused outright in the job child. The classifier job records telemetry only (`chats.setDangerClassification`); its switch is decided in the parent by `maybeSwitchAfterClassification` (`classifier-switch.ts`), from the dispatcher's commit hook. Failover decisions read the state at refusal time (`readCurrentConciergeState`, `current-state.ts`), never the request's snapshot. `applyConciergeFlip` it is a no-op when state and provenance already match, re-attributes silently when the operator adopts the Concierge's switch, and refuses any Concierge-initiated move but Moderated → Unmoderated. Chat creation applies it *after* the system-prompt message and *before* the greeting, so the greeting is composed under the chosen state. `applyConciergeFlip` takes `{ by, reason }` (default the operator, `'manual'`); the Concierge's own switches pass `{ by: 'concierge', reason: 'refusals' }` (the ledger) or `{ by: 'concierge', reason: 'classifier', classification }` (the classifier job). The refusal ledger (`chats.moderationRefusalCount` / `lastModerationRefusalAt`, deliberately outside `ChatMetadataSchema` so a whole-row `update` cannot rewind it) is incremented only by `recordModerationRefusal` (`lib/services/dangerous-content/refusal-ledger.ts`), counts stated refusals only (never `inferred`), and is reset only by `applyConciergeFlip`'s `'moderated'` case; the auto-switch (`maybeAutoSwitchAfterRefusal`) runs only in the parent — after an in-parent increment, or from the job dispatcher's commit hook for a child's buffered one. Design of record: [features/concierge-overhaul-phase-3-three-states.md](docs/developer/features/concierge-overhaul-phase-3-three-states.md).
- **Provider fallback is the engine's to build, not a call site's.** Import from `lib/llm/fallback` (never the modules under it) and use `classifyFallbackTrigger` / `buildFallbackChain` / `recordAttempt` / `summarizeFallbackAttempts`. A chain is at most three attempts — the profile, its `fallbackProfileId` understudy, one tier pick when `allowTierFallback` — and **does not recurse**, which is what makes an A→B, B→A configuration harmless rather than an infinite loop. Fallback is never sticky: the next call tries the primary again. Both steps require vision when the turn carries images, since a chain reuses the primary's message array. A new fallback site means calling the engine, not hand-rolling a second chain.
- **Derived progression state comes from `lib/progressions/`, never a call site.** `parseProgressions` / `deriveProgression` / `shouldReportProgression` / `renderProgressionReport` (`engine.ts`, pure and client-safe with an injected clock) are the only place elapsed / remaining / percent are computed; `buildProgressionsSection` (`prompt-section.ts`) is the one prompt-side reader and `flattenProgressions` the one Pascal-side one. **Never re-derive any of it inline.** `progressions` is the single reserved key in a character's vault `metadata.json` — validated at the point of use (`schema.ts` is the Zod source of truth, `public/schemas/qtap-progression.schema.json` its published mirror), never at hydration, and a malformed entry is dropped alone with a `warn` rather than hollowing the character. Cadence is derived from message history (`findLastOwnTurnMs`, beside the Core whisper's own cadence) and **never stored** — no writes on the prompt path. The report is a trailing per-turn section: it must never enter system block 1, and neither builder version is bumped by it. Pascal effect writes fold into the existing single metadata replace, so the job-child contract is untouched. Design of record: [features/character-progressions.md](docs/developer/features/complete/character-progressions.md).
- **What an image costs a model is not what it costs the gallery.** Bytes bound for an LLM go through `shrinkImageForLlmTransport` (`lib/files/llm-image-budget.ts`) — long edge capped at `LLM_TRANSPORT_MAX_EDGE`, quality ladder down to `LLM_TRANSPORT_TARGET_BASE64`, never throwing and never refusing — applied at both load paths in `lib/chat-files-v2.ts`. **Stored files are never touched**: the archive keeps full resolution and quality 90, and no export, backup or gallery read changes. A per-image cap cannot answer an aggregate question, so a walk that collects several images must also spend a byte budget (`LANTERN_IMAGE_BASE64_BUDGET`, as the Lantern walk in `context-builder.service.ts` does) — and note that **the token budget cannot see any of this**, which is how bug 151 put 4.52 MB on the wire under a `compressionNeeded: false` log line. A new path that sends image bytes to a provider calls the budget; it does not re-derive one.
- **A character's default system prompt is one fact stored in two places.** The prompt's `isDefault` flag and the character's `defaultSystemPromptId` column are both real, and every reader consults the column *first*. Writes go through `CharactersRepository.systemPromptsPatch` (add / update / delete) or `setDefaultSystemPrompt` (the picker, via the character PUT handler) — **never write one half by hand**, which is how the star in the prompts editor could move a badge that changed nothing (bug 154). Reads go through `resolveDefaultSystemPrompt` / `resolveDefaultSystemPromptId` (`lib/characters/default-system-prompt.ts`): column when it names a prompt that exists, then flag, then first. A new reader calls it rather than re-deriving the order — two of the five that did used to seed a chat with no prompt at all when the column went stale. One exception is deliberate: a brand-new prompt's id is transient (the vault re-keys it from its file path), so `addSystemPrompt` leaves the column null and lets the flag answer.
- **Inform delivery is `buildInformBlock` (`lib/chat/context/inform-block.ts`), and nothing else reads `chat_informs` on the prompt path.** It selects and never writes: consumption is `repos.chatInforms.markConsumed(rowIds, messageId)` in the finalizer (and on the preserved-partial path), against a **persisted assistant message** — so a provider failure that saves nothing, or a `[NOTHING TO ADD]` pass, leaves the rows pending for the seat's next attempt. A swipe passes `regenerationOfMessageIds` (the target plus its whole swipe group), re-applies exactly what that line's generation saw, gets no pending rows, and **never consumes**. The block is the operator's words verbatim — no preamble, no Host voice, no "do not mention this" — pushed between system blocks 2 and 3, and **empty-is-absent**: with nothing pending the builder pushes nothing, which is what keeps a turn byte-identical. The `inform` *record* is record-only and must never reach a model: it is stripped in `buildMessageContext`, in `extractVisibleConversation` (every cheap-LLM task, including the pre-compression that returns as system block 3), and in the Courier transport.
- **Message search is an index, and the transcript is compressed.** `chat_messages.content` / `opaqueContent` / `description` / `context` are [compressed text columns](lib/database/text-compression.ts): **any raw SQL that reads inside one wraps it in `qt_text()`, and any that writes one goes through the repository or `textToBlob`.** The column type stays `TEXT` — don't "fix" the DDL. Global search is FTS5, not `LIKE`: `lib/database/backends/sqlite/chat-message-fts.ts` is the single source of truth for that DDL, nothing else may spell it, and **nothing outside it writes `chat_messages_fts` / `chat_messages_fts_map`** — three triggers own them (so no write path can bypass the index) and `rebuildChatMessageFtsIndex` is the only bulk writer. The update trigger compares *decoded text*, which is what lets a re-encode pass leave the index untouched. Query translation lives in `lib/database/repositories/fts-query.ts`; the contract (whole words and prefixes, folded diacritics, the exact-scan fallback for punctuation-only queries) is stated in `help/search.md` and must stay true. A query that returns the text must decode it **after** `ORDER BY … LIMIT` — SQLite puts output columns in the sorter, so a `qt_text()` in the outer SELECT decompresses every match (1.2 s vs 86 ms on 142k rows). A table rebuild of `chat_messages` drops the triggers silently; `reconcileChatMessageFts()` heals it at boot. Design of record: [features/complete/chat-message-fts5-and-compression.md](docs/developer/features/complete/chat-message-fts5-and-compression.md).
- **A transcript sent to a cheap LLM is labelled by speaker, never by role.** `resolveSpeakerNames` / `speakerLabel` (`lib/chat/speaker-names.ts`) are the one place a `participantId` becomes a display name: raw reads (`findByIdRaw`) so a broken vault costs a label rather than a throw, **every** seat including removed and silent ones, and a `User` / `Character` fallback the fold prompt is told to keep rather than name. The episode pass had a private copy of this map and was right; the context-summary fold had none, rendered `USER:` / `ASSISTANT:` under a prompt demanding character names, and a model told to name a speaker it had no name for invented "Vivienne" and carried her forward through every later fold (bug 161). A new cheap-LLM pass over conversation turns calls the resolver; it does not re-derive one. `POST /api/v1/chats/[id]?action=rebuild-summary` is the remedy for a summary already poisoned — it clears `contextSummary` / `summaryAnchorMessageIds` / `lastSummaryTurn` and lets the ordinary cadence refold from turn 1, and must **not** zero `lastFullRebuildTurn`, which would route it into the single-shot `forceRegenerate` path it exists to avoid. Design of record: [features/complete/context-summary-speaker-names.md](docs/developer/features/complete/context-summary-speaker-names.md).
- **An automatic chat title goes through `applyAutoTitle` (`lib/chat/auto-title.ts`).** The checkpoint title check, the context-summary fold and `?action=regenerate-title` all call it; it re-reads the chat, refuses a hand-renamed one (`isManuallyRenamed`, overruled only by `clearManualRename`), writes only a changed title, and queues the story background — a retitle is the Lantern's scene-change cue. Never write `chats.title` from an LLM result directly: that is how the fold both overwrote hand-set titles (bug 164) and left the backdrop on the first scene (bug 163).
- **A tool loop that must see "what this chat could see" before the chat exists** passes a `mountPool` built by `resolveScenarioBuilderMountPool` (`lib/scenario-builder/mount-pool.ts`), never `operatorSurface` — the executor refuses a context carrying both. The pool puts the cast's vaults in the *participant* tier; flatten it with `includeParticipants: true` and never `includeCharacterTier: false`, which drops the participant tier with it. Non-persisting tool loops (Brahma-as-Carina, the Scenario Builder) run on `runOneShotToolLoop` (`lib/services/agent-loop/one-shot-loop.ts`); a new one calls it rather than copying the loop.
- **An image call that a provider might refuse goes through `generateImageWithConciergeFailover`** (`lib/services/dangerous-content/image-failover.ts`); refusal is `classifyRefusal` (`refusal.ts`); uncensored understudies come from `understudy.ts` (`resolveUncensoredTextUnderstudy` / `resolveUncensoredImageUnderstudy`, which never read the mode — the caller states its own Auto-Route gate). **Never string-match a provider error at a call site.** Plugins signal a refusal with `code: 'MODERATION_REJECTED'` (`ModerationRejectionError` in `@quilltap/plugin-types`), detected by code, never `instanceof`. Design of record: [features/concierge-overhaul-phase-1-refusal-failover.md](docs/developer/features/concierge-overhaul-phase-1-refusal-failover.md).
- **Excluding files from `.qtap` exports** goes through the one predicate in `lib/export/excluded-files.ts` (`EXPORT_EXCLUDED_FILE_CATEGORIES` / `EXPORT_EXCLUDED_FOLDER_PATHS` / `isFileExcludedFromExport`), used by the writer's file streamer, the export-type id resolver, and the wizard's entity picker. Never hand-roll a category check at a call site — a bundle that escapes one of the three rides inside every export, base64-inflated.

### Conventions

- **Logging:** every new or touched backend path fires debug logs, with appropriate levels elsewhere, via the built-in logging system.
- **Data/schema changes:** check whether they must be reflected in `.qtap`/SillyTavern exports, [`qtap-export.schema.json`](./public/schemas/qtap-export.schema.json), backups, and/or `migrations/`. Update [DDL.md](docs/developer/DDL.md) — it must stay current. Files kept only for migrations belong in `migrations/`.
- **Linting:** don't swap HTML `<img>` for Next.js `<Image>` — `<img>` is deliberate where sources come from APIs Next.js can't pre-resolve.
- **Next.js (16+) — don't reach for old-version patterns:** App Router only (`app/`, no `pages/` dir). There's no `middleware.ts`; cross-cutting request handling (security headers, CORS — *not* auth, which is single-user) lives in `proxy.ts` on the Edge runtime. Request APIs are async: `await cookies()` / `await headers()`, and route `params` / `searchParams` are Promises (`await params`). Don't write the old synchronous forms or look for conventions that moved.
- **Migrations** have extra rules (loading-screen labels + progress reporting) — see [Writing migrations](#writing-migrations).
- **Principles:** encapsulation, single source of truth (prefer inheritance over duplication), SRP, DRY, KISS, YAGNI.

### Working environment

- Dev runs via `npm run dev` (nearly always running, holds the instance lock) at `http://localhost:3000/`. Track it by tailing `logs/combined.log` (UTC timestamps).
- macOS dev: account for BSD tool variants; GNU coreutils and `gnu-sed` are installed under `g`-prefixed names (`gsed`, etc.).
- **Planning large changes:** plan with your most capable model and aggressively delegate well-specified subtasks to cheaper agent models (e.g. plan in Opus, delegate to Haiku). Don't use `git stash` or worktrees with agents — it tends to make a mess.

## Technology Stack

- **Framework / language:** React via Next.js, TypeScript, npm.
- **Testing:** Jest (native coverage) and Playwright.
- **Data:** SQLite + SQLCipher encryption at rest via `better-sqlite3-multiple-ciphers`, **aliased as `better-sqlite3`** in the root `package.json`. Runtime and tests `require('better-sqlite3')`, not the native name (which only resolves where a sub-package declares it directly). Tests needing both should fall back `better-sqlite3-multiple-ciphers` → `better-sqlite3`. Models are TS interfaces with Zod schemas.
- **File storage:** local filesystem only.
- **LLM providers:** OpenAI, Anthropic, Grok (xAI), Google, Ollama, OpenRouter, any OpenAI-compatible endpoint.
- **Design docs:** Storybook. **User docs:** `/help/`, searchable via MessagePack.
- **Electron shell:** separate repo ([quilltap-shell](https://github.com/foundry-9/quilltap-shell)); this repo produces the standalone tarball it consumes.
- **Native modules:** `better-sqlite3` (node-gyp) and `sharp` (platform binaries). Both need special handling in standalone/Docker builds. New native modules → update `next.config.js` (`serverExternalPackages` + `outputFileTracingIncludes`).
- **Background jobs:** forked child process; parent is the only DB writer. See [Background jobs](#background-jobs-summary).

## API Architecture

All new routes live under `/api/v1/`:

- **Collection:** `/api/v1/[resource]` · **Item:** `/api/v1/[resource]/[id]` · **System:** `/api/v1/system/[feature]`

Use the `?action=` query parameter instead of per-action routes:

```ts
import { createContextHandler, withActionDispatch } from '@/lib/api/middleware';

// POST /api/v1/characters/[id]?action=favorite
export const POST = createContextHandler<{ id: string }>(
  withActionDispatch({ favorite: handleFavorite, avatar: handleAvatar }, handleDefaultPost)
);
```

- **Context:** `createContextHandler` / `withContext` (`@/lib/api/middleware`)
- **Action dispatch:** `withActionDispatch` / `withCollectionActionDispatch` for handlers that take `(request, context, params)`; `dispatchAction(req, { verb: () => … }, fallback?)` when the handler has already loaded the entity and its thunks close over it (`@/lib/api/middleware/actions`). **Never read `?action=` by hand** — the primitives are the one place the rule lives: no action → the fallback CRUD verb, a known action → its handler, anything else → 400. An unknown action must never fall through to a default that deletes, creates or restores.
- **Responses:** `successResponse`, `errorResponse`, `notFound`, `badRequest`, `validationError`, `created`, … (`@/lib/api/responses`)

Legacy non-v1 routes were removed in v2.8. Exceptions that remain: `/api/health`, `/api/plugin-routes/[...path]`, `/api/themes/*`. Note content/character/chat **API** paths stay at `/api/v1/characters`, `/api/v1/chats`, `/api/v1/projects` even though their UI routes were renamed (below). Full reference: [API.md](docs/developer/API.md).

## Client data fetching (TanStack Query)

Client server-state runs on **TanStack Query v5** (`@tanstack/react-query`); SWR is fully removed. `<QueryProvider>` (`lib/query/QueryProvider.tsx`) is the top-level provider. See the completed [migration spec](docs/developer/features/complete/tanstack-query-migration.md).

- **Query keys are the single source of truth.** Never pass a raw string/array key to `useQuery`/`useMutation`/`invalidateQueries` — always go through the factory in `lib/query/keys.ts` (e.g. `queryKeys.characters.detail(id)`). Prefix invalidation (`invalidateQueries({ queryKey: queryKeys.characters.all })`) depends on it. Add a block when you introduce a new entity.
- **Fetcher:** `apiFetch<T>(url, init?)` from `lib/query/fetcher.ts` as the `queryFn`, forwarding the signal: `queryFn: ({ signal }) => apiFetch<T>(url, { signal })`. Throws `ApiFetchError` (`status` + parsed `info`) on non-2xx.
- **Mutations** use `useMutation` with `onSuccess`/`onSettled` invalidation; optimistic updates via `onMutate` + `setQueryData` + rollback in `onError`.
- **Tests** wrap with `renderWithQuery` / `createQueryWrapper` from `__tests__/helpers/renderWithQuery.tsx` (fresh client, retries off, `gcTime: 0`); `fetch` stays mocked via `jest-fetch-mock`.
- The Salon's SSE streaming transport is **out of scope** — migrate the reads *around* streaming, never the stream itself.

## Glossary

### Feature names (UI route · settings)

| Name | What it is |
|---|---|
| **The Salon** | chat interface — `/salon` |
| **Aurora** | characters UI (`/aurora`) + roleplay templates (`/settings?tab=templates`) |
| **Prospero** | agentic / tool-use systems — `/prospero`; `/settings?tab=system` |
| **The Scriptorium** | external document stores / mountable knowledge — `/scriptorium` (API stays `/api/v1/mount-points`) |
| **The Foundry** | architecture, plugins, packages — `/settings` (tabs from `lib/foundry/subsystem-defaults.ts`) |
| **Calliope** | UX/UI + themes — `/settings?tab=appearance` |
| **The Commonplace Book** | character memory (self-managed RAG) — `/settings?tab=memory` |
| **The Lantern** | story-background / image subsystem — `/settings?tab=images` |
| **The Concierge** | refusal failover to the uncensored desk, per-chat Moderated / Unmoderated / Locked, opt-in pre-screen — `/settings?tab=concierge` |
| **Pascal the Croupier** | RNG / game-state — `/settings?tab=chat`; custom-tool editor **Pascal's Workbench** — `/custom-tools` |
| **Saquel Ytzama** | encryption / secrets / API keys — `/settings?tab=system` |
| **The Librarian** | synthetic author for Document-Mode events + character `doc_*` calls |
| **The Host** | synthetic author for Salon participation + autonomous-room events, and the Scenario Builder (`/salon/new`) |
| **Carina** | inline LLM queries (`@Name:` / `@Name?` / `ask_carina`) — see [Carina](#carina-summary) |
| **The Almanack** | the system report (formerly "capabilities report") — `/settings?tab=providers&section=capabilities-report`; code in `lib/tools/almanack/`. API actions stay `capabilities-report-*` |

Old UI routes (`/foundry/*`, `/chats`, `/characters`, `/projects`) redirect to their current equivalents.

### Character fields (by vantage point)

Four vantage-point fields plus a foundational one (`manifesto`). **Not interchangeable — never collapse them.** The character optimizer enforces these.

- **manifesto** — axiomatic core; the load-bearing truths every other field stays consistent with. Not a vantage point. Short, declarative. Synced as `manifesto.md` in the vault (case-insensitive lookup).
- **identity** — surface knowledge from outside: name, station, occupation, public reputation. Never internal motivation.
- **description** — what an interlocutor perceives: behaviour, mannerisms, verbal patterns. **NOT** physical appearance (that's `physicalDescriptions`) and not internal monologue.
- **personality** — what the character knows about themselves; the internal driver. Unseen by others unless shared.
- **title** — the user's/character's own private framing (e.g. "the rival"). Not how others refer to them; out of optimizer scope.

**Grammatical person follows the referent:** second person when the referent is the speaking character (`manifesto`, `personality`, system prompts, project/group `instructions` — all delivered inside the character's own prompt), third person when the referent is anyone else or the consumer is not a chat model (`identity`/`description` — read only by *others*; `physicalDescription` — noun phrases, shared with the image pipelines). Prompt-facing wrappers in `buildIdentityStack` fix the referent for author text; hint copy is single-sourced in `lib/services/character-field-semantics.ts` (server) and `components/prompt-fields/field-hints.ts` (client) — change them together. Any edit that changes `buildIdentityStack`'s output must bump `IDENTITY_STACK_BUILDER_VERSION` (same file) and register a golden; CI enforces both directions. Full design: `docs/developer/features/complete/prompt-person-consistency.md`.

### Personified-feature avatars

When a personified feature "speaks" via a synthetic message, its avatar lives at `public/images/avatars/<feature>-avatar.webp` (lowercase, hyphenated; e.g. `lantern-avatar.webp`). Referenced as `/images/avatars/<feature>-avatar.webp`; the `systemSender` → avatar/title table is `STAFF_AVATARS` / `STAFF_TITLES` in `lib/chat/staff-display-names.ts` (looked up by `staffAvatar(sender)` from `getMessageAvatar` in `app/salon/[id]/SalonView.tsx`).

- **Always WebP.** Convert with `cwebp -q 82 -m 6 -mt in.png -o out.webp`, then delete the PNG — every byte ships with the app.
- **Adding a sender** means updating the `systemSender` Zod enum in `lib/schemas/chat.types.ts` **and** the matching `chat_messages` SQLite column, adding a row to `STAFF_AVATARS` (and `STAFF_TITLES` if the sender has an epithet) in `lib/chat/staff-display-names.ts`, and adding the value to `public/schemas/qtap-export.schema.json`.
- **The authoritative `systemSender` list is the enum in `lib/schemas/chat.types.ts`** — read it there rather than trusting a copy here. Per-sender responsibilities: `lantern` (image pipeline), `aurora` (avatar/wardrobe), `librarian` (Document-Mode + `doc_*`), `concierge` (dangerous-content), `host` (participation + autonomous-room), `prospero` (tool-use / connection-profile / Run-Tool bubbles; `private:true` runs hide via `targetParticipantIds`), `commonplaceBook` (memory-recall whispers, targeted), `ariel` (terminal PTY open/close), `carina` (renders with the **answerer's own** avatar — no `carina-avatar.webp`), `suparna` (Suparṇā's Post Office mail-delivery announcements — new letters in a character's vault `Mail/` folder), `pascal` (Pascal the Croupier's custom-tool (pseudo-tool) roll outcomes; the roll record lives in `pascalMeta`, posted server-side so a model cannot fudge a failure into a success).

## Instances and the CLI

An **instance** is a self-contained base directory you point Quilltap at, holding `data/`, `files/`, and `logs/` subdirectories. OS defaults: macOS `~/Library/Application Support/Quilltap/`, Linux `~/.quilltap/`, Windows `%APPDATA%\Quilltap\`, Docker `/app/quilltap/`. Override with `QUILLTAP_DATA_DIR`, `--data-dir`/`-d`, `--instance <name>`, or a Docker volume mount.

> When I say I'm "in the `~/iCloud/Quilltap/Friday` instance," the troubleshooting paths are `~/iCloud/Quilltap/Friday/{data,files,logs}/`. Logs there include `combined.log` / `error.log` (auto-rolled every 2–3 MB) plus `quilltap-{stdout,stderr}.log`, `startup.log`, and sometimes `stdout.log`.

**Databases are SQLCipher-encrypted — the `sqlite3` binary can't open them. Use `npx quilltap`.** Prefer high-level subcommands over raw SQL; they auto-pick the database, resolve names to UUIDs, and are read-only unless you pass `--write`. **Full command reference: [packages/quilltap/README.md](packages/quilltap/README.md)** (developer-only notes — repo scripts, module maps, completion-template internals — in [CLI.md](docs/developer/CLI.md)). Database schema: [DDL.md](docs/developer/DDL.md).

## Themes

- **Bundle format (`.qtap-theme`)** is primary: declarative zip archives (JSON tokens, CSS, fonts, images), no build tools. **Plugin (npm) format is deprecated** — existing ones still work; new themes use bundles. `create-quilltap-theme` defaults to bundles (`--plugin` for legacy npm format).
- 6 bundled themes (Art Deco, Earl Grey, Great Estate, Madman's Box, Old School, Rains) ship as bundle dirs in `themes/bundled/`. Installed bundles live at `<dataDir>/themes/<themeId>/` (index `themes-index.json`). Registries support remote browse/install with Ed25519 verification.
- **Architecture:** registry singleton `lib/themes/theme-registry.ts` (sources `default`/`plugin`/`bundle`); loader `lib/themes/bundle-loader.ts`; registry client `lib/themes/registry-client.ts`; crypto `lib/themes/crypto.ts`; manifest schema `QtapThemeManifestSchema` (`lib/themes/types.ts`) / JSON Schema `public/schemas/qtap-theme.schema.json`; asset/font routes under `app/api/themes/`. CLI: `npx quilltap themes`.
- **`qt-*` semantic classes:** themes depend primarily on these. If you'd add a new Tailwind class, add it to a `qt-*` utility instead, then apply that.
- **A `qt-*` class that resolves to nothing is invisible to every check but a human eye**, so `npm run lint` runs `scripts/check-qt-classes.mjs` as a third gate (after ESLint and the spelling sweep). It fails on an undefined utility in the `qt-bg-`/`qt-text-`/`qt-border-`/`qt-shadow-` families, and on any `qt-*` token carrying a variant prefix: Tailwind generates variants only for utilities it knows about, and anything inside `@layer utilities` is invisible to it, so `hover:qt-bg-muted` is an undefined class name, not "`qt-bg-muted`, on hover." Write every state form out by hand, escaped, in [`app/styles/qt-components/_utilities.css`](/app/styles/qt-components/_utilities.css). Bare component classes (`qt-card`) are deliberately out of scope — many exist only as theme hooks. `lint:fix` does **not** run this gate.
- **Mirroring `qt-*` into theme-storybook is not optional.** *Every* `qt-*` change — new class, new rule, or a fix to an existing one — must be mirrored into [`packages/theme-storybook/src/css/qt-components.css`](/packages/theme-storybook/src/css/qt-components.css) in the same change, de-Tailwinded to plain CSS (that file uses no `@apply`). Mirror the app **faithfully**, including quirks; if the app rule is itself wrong, fix both or neither — never let them diverge. If the class family isn't in the storybook yet, port the whole family, not just your one rule. Then bump the package's patch version and **stop and ask the human to `npm publish` — the publish gates the commit.** (`dist/` is gitignored; `npm run build` in the package keeps the local copy current.) Also consider the stylebook, [create-quilltap-theme](/packages/create-quilltap-theme), and the bundled themes.

## Subsystem pointers

### Background jobs (summary)

All job handlers run in a lazily-forked child process. **The parent (Next.js HTTP) is the only DB writer;** the child reads via a readonly SQLCipher connection, buffers write payloads in an `AsyncLocalStorage`, and ships them over IPC. The parent partitions writes by target DB (main / mount-index / llm-logs) and commits each in its own transaction, so one partition's failure can't roll back others. **In a handler, treat `getRepositories()` as a proxy: reads pass through, writes buffer — never assume read-your-writes within a single job.** Full mechanics (main-primary autonomous turns, folder-conflict id remapping, the two `AsyncLocalStorage` contexts): [BACKGROUND_JOBS_CHILD.md](docs/developer/BACKGROUND_JOBS_CHILD.md).

### Carina (summary)

Inline LLM queries: users/characters address a designated answerer character via `@Name:` (public), `@Name?` (whisper), or the `ask_carina` tool. The answerer builds a fresh minimal call, the result posts as a `systemSender: 'carina'` message rendered with the **answerer's own avatar**, and the answer is surfaced live via a `carinaAnswer` SSE event. Carina answers are kept out of the normal per-turn memory extractor but **do** form memories and receive recall through dedicated paths (`CARINA_MEMORY_EXTRACTION` job; recall injected by `runCarinaQuery`). Failed-query errors are authored by Prospero (`systemKind: 'carina-error'`), not Carina. Full design: [features/carina.md](docs/developer/features/carina.md).

## Writing migrations

Every migration in `migrations/scripts/` (listed in `index.ts`) must satisfy two rules so the startup loading screen can describe it:

1. **A pretty-label entry in [`lib/startup/prettify.ts`](./lib/startup/prettify.ts)** (`PRETTY_LABELS`), in the steampunk-Wodehouse voice — terse, present-continuous, about the user's data, not the implementation. Without it the screen leaks the internal migration ID.
2. **Any loop over a collection calls `reportProgress(...)`** from [`migrations/lib/progress.ts`](./migrations/lib/progress.ts) (throttled to ~250 ms, safe every iteration):

   ```ts
   import { reportProgress } from '../lib/progress';
   reportProgress(i + 1, items.length, 'items');                              // flat
   reportProgress([{ current: p + 1, total: projects.length, unit: 'projects' },
                   { current: f + 1, total: files.length, unit: 'files' }]);   // nested (outer first)
   ```

   For batched/streaming migrations, count totals upfront with `SELECT COUNT(*)` and pass the running `totalScanned`. Synchronous `db.transaction(...)` can't reach the UI mid-transaction — skipping there is fine.

The commit skill enforces both rules and will block a non-compliant migration.
