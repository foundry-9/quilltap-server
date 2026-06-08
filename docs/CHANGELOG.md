# Quilltap Changelog

## Recent Changes

### 4.7-dev

#### Docs: Groups feature handoff plan

Added `docs/developer/features/groups.md`, a build-ready specification for a future Groups feature (a cross-section of characters that owns a designated document store and exposes Description/Scenarios/Knowledge like Projects do, scoped per responding character). Planning document only — no code, schema, or behavior changes.

#### Projects collapsed into their document store

The `projects` table is now a slim identity row — only `id`, `name`, `officialMountPointId`, `createdAt`, and `updatedAt` remain as columns. Everything else moves into the project's official document store as top-level files, mirroring the 4.6 character-vault cutover:

- `description` → `description.md`, `instructions` → `instructions.md`, `state` → `state.json`
- the 14 settings fields (`allowAnyCharacter`, `characterRoster`, `color`, `icon`, `defaultDisabledTools`, `defaultDisabledToolGroups`, `defaultAgentModeEnabled`, `defaultAvatarGenerationEnabled`, `defaultImageProfileId`, `defaultAlertCharactersOfLanternImages`, `storyBackgroundsEnabled`, `staticBackgroundImageId`, `storyBackgroundImageId`, `backgroundDisplayMode`) → one flat `properties.json`

`userId` is dropped entirely — projects are global to the instance (single-user-per-instance).

- **Overlay** (`lib/projects/project-store/`): `applyProjectStoreOverlay[One]` re-assembles the hydrated `Project` from the slim row plus the store files on every read; `applyProjectStoreWriteOverlay` routes store-resident fields back to the files on write (per-mount-point promise-chain serialization for `properties.json`/`state.json`). The hydrated `Project` shape is unchanged, so callers, resolvers, and UI are untouched.
- **Read failure is asymmetric and store-only (no DB-column fallback).** `findById` throws `ProjectStoreUnavailableError` when a project's store is missing/unreadable; list/roster reads (`findAll`, `findByCharacterId`) log at `error` and drop the offending project so one bad row can't take down the whole list.
- **Provisioning is airtight:** `repos.projects.create` provisions and populates the store before returning (fails hard otherwise); a new startup backfill (`backfill-project-stores.ts`, Phase 3.4a) populates the files for any storeless project from the still-present columns; the import path provisions + writes the files from the imported payload. `findByCharacterId` now filters in memory.
- **Repository** drops `UserOwnedBaseRepository` for the plain base; the user-scoped projects wrapper is now a global pass-through. Per-user ownership checks on projects were removed (`checkOwnership` is an existence check now); `project.userId` reads in the project-info / state tool handlers and the chat/file state actions are gone.
- **Migration** `cutover-projects-to-store-v1` (backup-first, count guard, per-project write + verify, blocking gate, single-transaction column drop including `DROP INDEX idx_projects_userId`). Depends on `add-project-official-mount-point-v1`.
- **Export/import** keep the flat, hydrated `ExportedProject` (minus `userId`) so `.qtap` files stay portable; export reads the store, import writes it. `public/schemas/qtap-export.schema.json` and `docs/developer/DDL.md` updated.
- **Error handling for a degraded store:** since `findById` can now throw `ProjectStoreUnavailableError`, the global route error handler maps it to a deliberate 503 (with `projectId`) instead of an opaque 500. Reads that only need a project's existence (file move/promote target validation, chat-creation scenario-path resolution) use `findByIdRaw`, which never throws; chat get-state degrades to empty project state when the project store is unavailable so the chat's own state still returns.
- **Fix — provisioning reads the raw row.** `ensureProjectOfficialStore` now reads the project via `findByIdRaw`, not `findById`. Provisioning runs before the store files exist (project creation, startup backfill, the cutover migration), so the store-only overlay would throw. This also fixes `POST /api/v1/projects`, which provisions the store right after writing a fileless row. The cutover migration no longer calls `ensureProjectOfficialStore` at all — it provisions from the raw-loaded row (using the existing `officialMountPointId`, or creating a store via mount-index ops + a raw-SQL FK stamp) so a legacy wide row, which the schema-validating repository read rejects this early in startup, can't block the migration.
- **Fix — migration opens the mount-index DB explicitly.** The cutover writes each project's overlay files into its mount-index-backed document store, but migrations run in Phase 1, before the app backend's `connect()` (which opens the mount-index connection). The doc-mount repositories read that connection from a global singleton and never trigger the lazy `getDatabaseAsync()` init that a main-DB repository access would, so the migration's first store write threw "Mount index database not initialized" and blocked every project. The migration now calls `getMountIndexSQLiteClient(loadMountIndexConfig())` up front (and aborts cleanly before any destructive work if the connection can't be opened); the app's later `connect()` reuses the same connection.

#### Fix: new characters now keep the identity field typed into the create form

The character create handler (`app/api/v1/characters/handlers/post.ts`) silently dropped the `identity` field on the way to the repository: `createCharacterSchema` never declared `identity`, so Zod stripped it from the request body, and the `repos.characters.create({...})` call omitted it too. The typed-in identity was discarded and the vault's `identity.md` was written empty, while every other vantage-point field (description, manifesto, personality) persisted normally. Added `identity` to both the create schema and the create call.

The AI-wizard path had the same gap in `wizardRequestSchema`: `existingData` didn't carry `identity` (so a pre-typed identity wasn't passed to the generator as context) and `fieldsToGenerate` didn't allow `'identity'` (so the wizard couldn't be asked to generate one). The wizard service already supported identity end to end; only these validators blocked it. Added `identity` to both.

No schema, migration, or export change — `identity` is a vault-backed field already handled by the update path and exports. Editing an existing character's identity was unaffected; only creation lost it.

#### Carina answers appear immediately

Carina reference answers now surface in the Salon the instant they return, instead of waiting for the post-turn `fetchChat()` refresh (previously the answer only appeared after the responding character(s) had finished reacting to it).

- `runCarinaQuery` (`lib/services/carina/carina.service.ts`) gained an optional `onPosted(message)` callback, invoked the moment `postCarinaResponse` persists the answer (before the memory-extraction enqueue). A thrown callback is logged and swallowed — a failed emit never undoes a posted answer.
- New `carinaAnswer` SSE event (`encodeCarinaAnswerEvent` in `streaming.service.ts`) carries the full posted message. Wired at all three in-stream call sites: user `@Name:`/`@Name?` markup (orchestrator), a character's `@Name:` markup in a response (finalizer), and the `ask_carina` tool (threaded via `ToolExecutionContext.emitCarinaAnswer`, set by the orchestrator after `createToolContext`). The forked-child/autonomous path leaves `onPosted` undefined (no client stream) and is unchanged.
- Client (`app/salon/[id]/hooks/useSSEStreaming.ts`): `readSSEStream` routes `carinaAnswer` to a new `onCarinaAnswer` handler that inserts the message optimistically, deduped by `id`. The end-of-turn `fetchChat()` reconciles it to the authoritative, pre-rendered copy; whisper visibility uses the same render-time filter, so there is no flash and no duplicate.
- Token-by-token streaming of the answer text remains deferred. No schema, migration, or export change — `carinaAnswer` is transport-only and the message is already persisted.

#### Fix: embedding failures and memory-housekeeping thrash no longer pile up or stall rooms

- **Embeddings — deterministic failures no longer retry to DEAD.** `EMBEDDING_GENERATE` jobs that fail for reasons that recur on retry (empty/whitespace input, NaN/non-finite vectors, over-context input, dimension mismatch) are now marked failed and dropped instead of retrying three times each and accumulating as DEAD rows — `isPermanentEmbeddingError` in `embedding-generate.ts`. Transient errors (`fetch failed`, timeouts) still retry. `skipIfOversize` also now skips empty input up front.
- **Ollama plugin (1.0.30 → 1.0.31).** Rejects empty/whitespace input before calling the server, and validates the returned vector for NaN/Inf (`assertFiniteEmbedding`) on both the `/api/embed` and legacy `/api/embeddings` paths, so a non-finite vector can't poison cosine similarity or break downstream JSON serialization.
- **Memory housekeeping — durable watermark-sweep throttle.** The de-thrash backoff was process-local: the watermark enqueue and the sweep run in different forked job children (and the cache is wiped on restart), so a character sitting at its cap kicked off an expensive `mergeSimilar` sweep on nearly every turn, starving the turn queue. Added a durable, DB-backed throttle (`WATERMARK_SWEEP_THROTTLE_MS`, 15 min/character, via `backgroundJobs.findRecentByType`) layered on top of the existing in-memory cache. The daily scheduled sweep is unaffected. No schema change.

#### Carina now forms memories and receives memory recall

Reversed Carina's original "no memory" design (the feature is still unreleased this cycle). Carina answerers now both remember their consultations and draw on what they remember:

- **Recall in the call** — `runCarinaQuery` runs a semantic search of the answerer's own memories against the question (`searchMemoriesSemantic`, default embedding profile) and injects the formatted result into the isolated call's system prompt via `buildCommonplaceLLMContext`. Recall only — still no live conversation, project, or core context. A recall miss or error never blocks the answer.
- **Memory formation** — after the answer posts, `runCarinaQuery` enqueues a new `CARINA_MEMORY_EXTRACTION` background job. Its handler (`lib/background-jobs/handlers/carina-memory-extraction.ts`) loads the posted carina message, builds a one-slice `TurnTranscript` (question = turn opener, answer = the answerer's sole contribution, no user-controlled character), and runs `processTurnForMemory`. With no user character in the transcript the OTHER pass self-skips, so only SELF memories form — the answerer remembers what it was asked and what it answered.
- **Global, both directions** — applies to every `canBeCarina` answerer (no new flag, no migration). Public and whispered exchanges both form memories.
- The `systemSender: 'carina'` tag still excludes the answer from the *normal* per-turn extractor (`buildTurnTranscript` skips every systemSender message); the dedicated job is what forms Carina's memories instead. Enqueue works from both the markup path (main process) and the `ask_carina` tool during an autonomous-room turn (forked child), the same way per-turn extraction already enqueues from the child.
- Help (`help/carina.md`) and the Carina feature doc updated.

#### Fix: autonomous-room renames no longer fire nearly every turn

The auto-rename (`TITLE_UPDATE`) and summarization-gate cadence keys off `calculateInterchangeCount`, which for autonomous rooms counted every ASSISTANT message — including staff whispers (host, prospero, aurora, commonplaceBook, librarian). Each autonomous turn emits one character message plus several whispers, so the interchange counter climbed ~5 per turn instead of ~1. The title-check gate fires once per multiple-of-10 crossed, so the inflated counter crossed a decade boundary almost every turn and enqueued a rename job nearly every turn.

`calculateInterchangeCount` (`lib/chat/context-summary.ts`) now skips messages with `systemSender` set in both the autonomous and regular-chat paths, counting only genuine user/character turns. This restores the intended roughly-every-10-interchanges cadence. No schema change; `systemSender` already exists on chat messages.

#### Tri-tier wardrobe + shared mount-tier resolver

Wardrobe is now tri-tier, matching knowledge, scenarios, and document search: a character's wearable garments are drawn from the character's own vault, the active chat's project document stores, and Quilltap General — in that precedence order (nearer tier wins on id collision). Previously wardrobe was two-tier (character vault + Quilltap General archetypes only); project stores were never consulted.

- **New `lib/mount-index/tiered-mount-pool.ts`** is the single source of truth for the `{character, participant, project, global}` mount-tier resolution that was previously re-derived (with subtly divergent dedup rules) in the knowledge injector, the scriptorium search tool, and the doc-edit path resolver. Exposes `resolveTieredMountPool`, `dedupeTierTriple`, `flattenTierPool`, `classifyMountTier`, and the lightweight `resolveProjectMountPointIds` / `resolveProjectMountPointIdsForChat`.
- **Adopted the helper everywhere**: `knowledge-injector.ts` (via `context-manager.ts`), `search-scriptorium-handler.ts`, and `path-resolver.ts`'s `collectAccessibleMountPointIds` all now delegate to it. Behavior is unchanged for those features (ownership gate, participant vaults, and operator override are preserved); the duplication is gone.
- **Wardrobe reads** (`findArchetypes`, `findArchetypeById`, `findByIdForCharacter`, `findByIdsForCharacter`) accept an optional `projectMountPointIds`, and `resolveEquippedOutfitForCharacter` threads it through. Equipped-outfit resolution in the chat context, scene-state tracking, story backgrounds, avatars, image generation, the wardrobe tool handlers, the outfit API actions, and chat creation now all pass the active project's stores. Call sites with no project context fall back to the prior two-tier behavior.
- **New `lib/mount-index/project-wardrobe.ts`** reads/ensures a project store's `Wardrobe/` folder (reusing the generic vault reader, same as `general-wardrobe.ts`).
- **Project wardrobe writes + CRUD**: generalized the vault writer (`wardrobe-writes.ts`) with an explicit project location and `scope` discriminator; cycle peers now include Quilltap General archetypes for project composites. New `/api/v1/projects/[id]/wardrobe` and `/api/v1/projects/[id]/wardrobe/[itemId]` routes (GET/POST/PUT/DELETE), mirroring project scenarios. New **Wardrobe** card on the Prospero project page (`WardrobeCard` + `ProjectWardrobeManager` + `useProjectWardrobe`).
- **Wardrobe pickers surface the project tier**: `useCharacterWardrobeItems` now merges personal + project + Quilltap General (precedence personal > project > general). The in-chat Wardrobe Control dialog resolves the project from its `chatId`; the chat-start and add-participant outfit selectors pass `projectId`/`chatId`. Project items appear as wear-only in the dialog (no edit/delete there — they're managed on the project page, like project scenarios), and equipping them is validated through the tri-tier resolution.
- **Create-destination selector in the wardrobe editor**: when adding a new item from the Wardrobe dialog, an "Add to" selector chooses where it's written — **This character** (personal, default), **Shared — everywhere** (Quilltap General), or **Shared — this project** (offered only when the dialog has a project context). The editor's composite-component picker also folds in project items so project composites can bundle project pieces. Replaces the old shared-only routing (which always wrote to Quilltap General). The redundant "Available to all characters" checkbox was removed — the "Add to" selector is now the single control for an item's tier (and editing keeps an item in its existing tier).
- No database schema or migration change — project wardrobe items are Markdown files in an existing project document store, the same storage path as project scenarios.
- Help: new `help/project-wardrobe.md`; `help/wardrobe.md` gains a "three tiers" section.

#### Carina — inline LLM queries

Added Carina, an inline query system that lets users and LLM characters ask quick questions of a designated answerer character without derailing the conversation.

- **`@Name:` / `@Name?` markup** — place at the start of a line in any Salon message to route a question to the named character publicly (`:`) or as a whisper back to the asker only (`?`). Quoted forms (`"…"` / `'…'`) accept multi-sentence questions; smart quotes are supported. One query fires per message (first match wins).
- **`ask_carina` tool** — programmatic equivalent for LLM characters; same public/whisper semantics via a `whisper` boolean parameter. Offered only when at least one `canBeCarina` answerer exists, and withheld from the answerer's own tool slate to prevent recursion.
- **Per-character `canBeCarina` flag** — opt-in on the character edit page in Aurora; off by default. Answerers need not be participants in the chat to answer.
- **Isolated calls** — the answerer sees its own identity/personality/scenario, its own recalled memories, and any prior Carina exchanges in the chat, but no full chat history and no project context. The answerer has access to the chat's tools and runs the normal tool-call loop. (Memory recall and memory formation were added later in this same dev cycle — see "Carina now forms memories and receives memory recall" above; the original spec had neither.)
- **Attribution** — answers are posted as `systemSender: 'carina'` / `systemKind: 'carina-response'` messages attributed to the answerer character and rendered with that character's own avatar (not a dedicated staff avatar), as a full-row reference card rather than a collapsed chip. Errors are reported by Prospero with `systemKind: 'carina-error'`.
- **Delivery** — answers are generated server-side and surfaced via the existing post-turn chat refresh (not live-streamed in this version). A public `@Name:` answer is spliced into the current turn so the first character to respond in the same cycle also sees it; a `@Name?` whisper is scoped to the asker and is not relayed to other characters.
- Migrations: `add-carina-flag-v1` adds `canBeCarina INTEGER DEFAULT NULL` to `characters`; `add-carina-message-meta-v1` adds `carinaMeta TEXT DEFAULT NULL` to `chat_messages` (JSON `{ answererId, question }`, drives avatar resolution and exchange continuity).
- `systemSender` enum gains `'carina'` (Zod, message-ops schema, and the `.qtap` export schema); `canBeCarina` and `carinaMeta` round-trip through `.qtap` export/import via full-record serialization.
- Help: new `help/carina.md`.

### 4.6.1

#### Removed development debug logging from the autonomous-room work

Stripped the seven `logger.debug` tracing statements added during the autonomous-room debugging push, plus the small bits of scaffolding that existed only to feed them. No behavior change.

- `context-builder.service.ts`: removed the "Tool result elision summary" log (fired on every context build) and its dead `elided`/`kept` counters.
- `autonomous-room-turn.ts`: removed the two context-summary fold trace logs (and the now-empty `else` branch).
- `autonomous-room.service.ts`: removed the "flipping row to running" and "edit no-op (empty patch)" logs.
- `text-handlers.ts`: removed the `doc_list_files` "filtered entries from results" log and its `cruftDropped`/`autoImageDropped` counters; the filtering itself is unchanged.
- `ai-import.service.ts`: removed the "Re-stamped structural fields" log; kept the in-place `restampStructuralFields` call, dropped the unused return capture.

Operational `info`/`warn`/`error` logging and client-side error handling are left intact.

#### Autonomous rooms grant a final "grace" turn when the budget is hit without warning

The near-end (90%) Host nudge is only sampled at turn boundaries, so a single turn whose spend exceeds 10% of a small budget vaults the entire [90%, 100%) band — the run exhausts with the company never having been told to wrap up. (This is exactly what happened on a 100k-token room: turns of ~25k stepped the budget 75% → 100% in one go, so `nearing-end` never fired.) Now, when a run reaches its budget and the near-end nudge never fired, the Host announces a grace round and the run is allowed exactly **one** more turn (over budget) so the scene can close gracefully. If the near-end nudge *did* fire earlier in the run, it ends with no grace turn — the company was already warned.

Implemented in `autonomous-room-turn.ts` with a new `MILESTONE_GRACE` bit on the existing `runMilestonesAnnounced` bitmask (no schema change). On budget exhaustion at either the pre-turn or post-turn checkpoint: if neither the near-end nor grace bit is set, the handler sets the grace bit, posts an `autonomous-room-grace` Host announcement, and re-enqueues one turn instead of ending. That turn runs over budget (the pre-turn check lets it through because the grace bit is set) and ends the run at its own post-turn check. Exactly one grace turn per run.

The budget-caps form (`AutonomousRoomCard`, shown in both the New Room flow and the Edit Enclave modal) now explains that a cap is a soft boundary, not a hard wall: a run that overruns its allowance without a near-end warning is granted one last grace turn to close gracefully.

#### Fix: autonomous-room conversation summaries now actually persist

Autonomous rooms run their turns in the forked job child, where repository writes are buffered and flushed only at the end of the job. The rolling-window context-summary fold was fired fire-and-forget, so its writes settled after the flush and were silently dropped — the fold anchor (`lastSummaryTurn`) never advanced past its first value, and a long room re-sent nearly its entire history on every turn. (Observed: a room at 429 character turns still pinned to `lastSummaryTurn=5`, `compactionGeneration=1`.)

- The finalizer (`message-finalizer.service.ts`) now skips the fire-and-forget summary check for `chatType: 'autonomous'`.
- The turn handler (`autonomous-room-turn.ts`) instead runs the fold inline and **awaited**, after the `runWithAutonomousRunId` scope closes and before enqueuing the next turn. Awaiting keeps the fold's writes inside the job's write buffer so they reach the parent; running it outside the run-id scope means the fold's cheap-LLM tokens are **not** billed against the per-run token budget (housekeeping, not turn spend). The next turn then sees the freshly compacted room.
- `checkAndGenerateSummaryIfNeeded` gains an `{ awaitFold }` option; interactive chats keep the fire-and-forget path unchanged.

#### Long chats no longer re-bill stale tool results every turn

Persisted tool-result messages (e.g. `read_conversation`, `doc_list_files`) were re-injected into the LLM context verbatim on every turn, and the rolling summary never folded them out (the fold anchors only USER/character messages). A single large result — a 587 KB conversation dump, a 1,100-file listing — was re-sent and re-billed indefinitely, which is what blew an autonomous room's per-run token budget in one turn.

`buildConversationMessages` (`context-builder.service.ts`) now stubs any tool result older than 3 turns (counted by ASSISTANT messages after it), keeping the tool name and a short arguments preview: `[Tool Result: <tool>] (args: …) — result elided (>3 turns old); call again to re-read.` The most recent 3 turns stay verbatim. This is a context-assembly transform only: the stored message is untouched, the Salon UI still shows the full result, and summary/memory inputs (which skip tool rows) are unaffected. Applies to all chat types.

#### doc_list_files now hides auto-generated images and OS cruft

`doc_list_files` listings filtered nothing, so they surfaced `.DS_Store` and similar, plus every auto-generated avatar/background image — bloating the tool result (and, re-billed every turn, the budget).

- Hidden OS files (`.`-prefixed names, plus `Thumbs.db` / `desktop.ini` / `__MACOSX`) are now always filtered out.
- Auto-generated images (image files under a `character-avatars` or `story-backgrounds` path segment) are filtered out by default. A new `includeAutomaticImages` flag (default `false`) on the tool brings them back. Saved images live elsewhere (character photo albums) and are unaffected.
- The filter is a shared post-collection pass covering both filesystem- and database-backed stores (`text-handlers.ts`); the helpers and folder/extension constants live in `lib/files/folder-utils.ts`. The Projects file API has its own image categorization and is unchanged.

#### Autonomous-room start/resume now reflect "running" immediately

Starting or resuming an autonomous room ("enclave") now flips the room to **running** the instant you click the control, instead of lagging until the first turn job comes around. Previously a manual or scheduled start parked the room at `idle` and let the turn handler promote it to `running` on the first turn — so if a turn for another room was already in flight, the badge/header could sit on the play icon (looking like nothing happened) for up to a minute.

- Server: `startAutonomousRoomManually` and the schedule tick now write `runState: 'running'` (counters zeroed, `runStartedAt` stamped) synchronously at request time and post the Host "run begun" banner, via a shared run-start contract in the new `lib/background-jobs/handlers/autonomous-room-announce.ts` (`runStartPatch` + `postRunStartAnnouncement`). The turn handler keeps a defensive `idle → running` fallback for any pre-upgrade turn job still carrying an `idle` row. `runStartedAt` now anchors the wall-clock budget from the button press (including any brief queue wait before the first turn).
- If the turn enqueue fails after the row has flipped, the manual path rolls the row to `error` and the scheduled path rolls it back to `idle`, so the badge never falsely shows `running` with nothing in flight.
- Client: the global autonomous-room badges and the Settings → Chat management card now update optimistically (SWR `optimisticData` + `rollbackOnError`), so the icon/label flip on click rather than after the POST + revalidation round-trip.

#### Fix: autonomous-room token counter now resets on a fresh run

A manually-started or scheduled autonomous-room run now starts its per-run token tally from zero, instead of carrying over the previous run's total. A *resumed* (paused → running) run still keeps the count it had, as intended.

The post-turn token bookkeeping in `autonomous-room-turn.ts` floored `runTokensConsumed` against `post.runTokensConsumed` — a re-read served from the forked job child's readonly connection. On the first turn of a fresh run, the idle→running `runTokensConsumed: 0` reset is still buffered in the child, so that re-read returned the *previous* run's total; `Math.max(thisRunTokens, previousRunTokens)` then carried the stale count forward. A room with `budgetMaxTokens` set would trip `budgetExhausted` on the first turn of its second-or-later run. Fixed by flooring against the local `chat` snapshot (reset to 0 on idle→running for a fresh run, preserved for a resumed run) — the same pin the turn counter already used. No schema change; same monotonic-floor and cache-hit-counting behavior otherwise.

#### Autonomous rooms ("enclaves") can now be edited after creation

The autonomous-settings form from the New Room flow can now be reused to edit an existing autonomous room. Editable: title, schedule cron, catch-up freshness window, the four budget caps (turns/tokens/wall-clock/spend), the "count only the dear tokens" cache-hit toggle, visibility, and destructive-tool authorization. The participant roster and per-character connection profiles/system prompts are not edited here — those stay on the Participants sidebar card.

Two entry points open the same **Edit Enclave** modal:

- An **Edit** button per room in the *Scheduled Autonomous Rooms* card at `/settings?tab=chat`.
- An **Edit Enclave** button in the *Organize* card of the Salon chat sidebar, shown only when the open chat is an autonomous room.

Edits apply instantly: a running run honors new budget caps / cache mode / destructive flag on its next turn (the turn handler reads them fresh each turn), and visibility applies on the next Salon list fetch — no run restart. Changing the cron recomputes `scheduleNextRunAt`; clearing it returns the room to manual-only; an invalid cron is rejected (400) and leaves the schedule untouched. Lowering a cap below current consumption ends a running run on its next turn (intended). Setting a title also pins `isManuallyRenamed` so the auto-titler leaves it alone.

Implementation:

- New `updateAutonomousRoomSettings(chatId, userId, patch)` in `lib/services/chat-message/autonomous-room.service.ts`: guards `chatType === 'autonomous'`, recomputes the cron next-run, clamps `runDestructiveToolsAllowed` to 0 when the user-level policy is `always_refuse`, writes via `repos.chats.update` (never touches run-state/counters), debug-logs the change. Tri-state patch semantics: `undefined` = leave, `null` = clear, value = set.
- New `?action=update-settings` POST on `app/api/v1/chats/[id]/autonomous-room/route.ts` with a Zod schema mirroring the autonomous block of `createChatSchema` (caps/cron/visibility made `.nullish()` so they can be cleared). Values are in milliseconds, like the create payload.
- `chatType` added to the `GET /api/v1/chats/[id]` response (and the Salon `Chat` type) to gate the sidebar button.
- `AutonomousRoomCard` extracted from `NewChatForm.tsx` into `components/new-chat/AutonomousRoomCard.tsx` and reused by the new `components/new-chat/EditEnclaveModal.tsx`. The modal converts ms ⇄ hours/minutes at its API boundary.
- Settings card (`components/tools/autonomous-rooms-card.tsx`) refreshes its SWR list after a save; the Salon page refetches the chat so the header title updates.

#### Autonomous rooms now get Host pacing announcements at the halfway and near-end marks

An autonomous-room run now posts two Host announcements as it approaches its budget, so the characters can pace themselves and wrap up before the run stops:

- **Halfway** — when the binding budget crosses 50%, the Host notes that the gathering has reached its midpoint and nudges the conversation toward what matters most.
- **Near the end** — when 10% of the budget remains (90% consumed), the Host warns that the gathering will soon close and asks the participants to say what most needs saying.

The "binding" budget is whichever configured cap is closest to exhaustion (the one that will halt the run first) — turns, tokens, wall-clock, or the cross-room daily user-token cap; the announcement phrasing adapts to it. Each milestone fires at most once per run. The daily cap *pauses* the room rather than ending the run, so its near-end nudge is framed as "finish for now — the company will reconvene" instead of a final close; the characters are still told to wrap up the present scene. The estimated-spend cap is not counted (it is not enforced in the run loop today).

Each announcement carries both a Host-voiced body (shown to the operator in the Salon) and a persona-free `opaqueContent` body that is swapped into the characters' LLM context in opaque-anywhere rooms — so the steering reaches the characters whether or not they can see the Host by name.

Implementation:

- New `runMilestonesAnnounced` column on `chats` (`INTEGER DEFAULT 0`), a per-run bitmask (bit 0 = halfway, bit 1 = near-end), added by migration `add-autonomous-run-milestones-v1`. Reset to 0 at each run start. Added to `ChatMetadataSchema`/`ChatMetadataBaseSchema`, the qtap export schema, and DDL.
- `autonomous-room-turn` computes the binding-budget fraction post-turn (across the per-run turns/tokens/wall-clock caps and the daily user-token cap) and fires the appropriate milestone once, recording it in the bitmask. A turn that vaults straight past 50% to ≥90% fires only the near-end nudge and marks both bits. When the daily cap is the binding budget the nudge uses pause-framed phrasing.
- `postAutonomousRoomAnnouncement` now accepts an `opaqueContent` body; the milestone messages populate it.
- Salon UI: display labels and importance tiers added for the `autonomous-room-*` system-message kinds (`start`, `end`, `paused`, `halfway`, `nearing-end`).

#### Fix: wall-clock-budgeted autonomous rooms could falsely exhaust after one turn on a repeat run

The post-turn budget check read the wall-clock anchor (`runStartedAt`) from a re-read of the chat row. On the first turn of a fresh run, the idle→running reset that stamps `runStartedAt = now` is still buffered in the forked job child, so the re-read returned the *previous* run's start — yielding a huge elapsed time that tripped `budget:wall_clock` and ended the run after a single turn. The check now pins `runStartedAt` and `runPausedAccumMs` from the local in-handler snapshot (which carries the fresh reset), mirroring how the turn/token counters are already pinned. The pre-turn check was already correct.

#### Autonomous-room token budgets can now optionally count all tokens (including prompt-cache hits)

The exclusion of prompt-cache hits from the autonomous-room token budget (see below) is now a per-room choice rather than a fixed rule. A new **Count only the dear tokens** checkbox in the autonomous-room creation card controls how the per-run token cap (`budgetMaxTokens` / `runTokensConsumed`) is tallied:

- **Checked (default):** count only the billable cache-miss input + completion tokens — the expensive ones. This preserves the cache-excluding behavior.
- **Unchecked:** count every token, including prompt-cache hits, the way budgets behaved before cache-read normalization.

Implementation:

- New `budgetExcludeCacheHits` column on `chats` (`INTEGER DEFAULT 1`), added by migration `add-autonomous-budget-cache-mode-v1`. Existing rooms default to 1 (exclude cache hits). Added to `ChatMetadataSchema`/`ChatMetadataBaseSchema`, the chat-creation API, the autonomous-room status response, the qtap export schema, and DDL.
- `LLMLogsRepository.getTotalTokenUsageForRun` takes a new `{ includeCacheHits }` option. The provider plugins strip cache reads from `usage.totalTokens`, so when a room opts into counting all tokens the repository adds them back from each row's `cacheUsage.cacheReadInputTokens`.
- `autonomous-room-turn` reads the per-room flag and passes `includeCacheHits` accordingly. The daily user-token cap remains cache-excluded (it is a cross-room aggregate with no single per-room flag governing it).
- New-chat form: `budgetExcludeCacheHits` added to the autonomous form state, defaulting to checked.

#### Fix: AI character import ("Summon From Lore") could fail to save the generated character

A character generated by AI import would assemble and validate but then fail at import time with `systemPrompts.0.createdAt: expected string, received undefined`, leaving nothing saved. Three compounding causes in `lib/services/ai-import.service.ts`:

1. **Assembly wrote `null` for optional text fields.** `personality`, `firstMessage`, `exampleDialogues`, `title`, `identity`, `description`, and `manifesto` were assigned an explicit `null` when a step omitted them (or failed). The qtap export schema types these as non-nullable strings, so a present-but-`null` value failed validation. These fields are now omitted entirely when there is no usable string (the DB schema treats them as nullable/optional, so the imported character is identical).
2. **The LLM repair loop stripped structural scaffolding.** When validation failed, the repair step re-sent the whole `characters` section to the model and replaced it wholesale; the model dropped the `id`/`createdAt`/`updatedAt` on nested `systemPrompts` (and could do the same to `scenarios`, `physicalDescription`, `wardrobeItems`, and memories). The qtap schema does not enforce those nested fields but the DB schemas require them. A new `restampStructuralFields` pass now re-applies that scaffolding after assembly/repair so a repaired export still imports cleanly.
3. **`parseLLMJson` rejected raw control characters.** Models routinely emit a literal newline (or tab) inside a JSON string instead of `\n`, which made the `first_message` and `chats` steps fail with "Bad control character in string literal." `parseLLMJson` now escapes in-string control characters as a repair step before re-parsing.

Net effect: AI import succeeds where it previously died, and a character whose individual sub-steps fail still imports with the fields that did generate.

#### Fix: AI-imported wardrobe items failed to import ("Cannot read properties of undefined (reading 'length')")

Even after the character itself imported, every AI-generated wardrobe item was rejected. `assembleQtapExport` built wardrobe items without `componentItemIds`/`replace`, and `wardrobeRepository.create` spread the caller's data into the new item without applying the schema's array/flag defaults — so `undefined` reached the vault writer's `componentItemIds.length` check and threw.

- `lib/database/repositories/wardrobe.repository.ts`: `create` now defaults `componentItemIds` (`[]`) and `replace` (`false`) at the construction chokepoint, so any caller handing it a partial item is safe.
- `lib/services/ai-import.service.ts`: assembled wardrobe items now include `componentItemIds: []` and `replace: false`, matching the wardrobe schema.

#### Background-job writes are now isolated per database, and concurrent doc-store folder creates reconcile instead of failing

Completes the deferred hardening from the autonomous-room poison-write fix below. A background job buffers all of its repository writes into one batch the parent applies, but those writes can target three separate SQLite databases (the main DB, the dedicated mount-index/doc-store DB, and the llm-logs DB). The applier used to wrap the whole batch in a single transaction on the *main* connection, so a doc-store write failure rolled back unrelated main-DB chat/run-state writes while any doc-store rows already written leaked (they auto-committed outside that transaction).

- **Per-database partitioned apply.** The parent now splits each batch by target database and commits each partition in its own transaction on its own connection (`lib/background-jobs/host/write-partition.ts` + the rewritten applier in `job-dispatcher.ts`). A failure in one database can no longer roll back or leak into another.
- **Ordering and failure policy by job type.** Idempotent handlers apply secondary partitions (mount-index, llm-logs) before main so a secondary failure prevents the main commit (e.g. a mount-chunk embedding write that fails won't let the chunk be marked embedded), and any partition failure fails the job so the existing retry path re-runs it. Autonomous-room turns are not idempotent, so their main-DB chat/run-state partition commits first and authoritatively; secondary doc-store writes are then applied best-effort, and a genuine doc-store failure is rolled back, logged, and dropped rather than discarding the committed turn.
- **Cross-job concurrent folder create.** When two jobs concurrently create the same doc-store folder path, the second create now hits the `(mountPointId, parentId, name)` unique index at apply time. The applier catches that, resolves to the already-committed folder, and remaps the discarded buffered folder id across the rest of that batch's writes (file links, child folders) so they point at the surviving row. Applies are serialized, so this lookup is race-free. The earlier fix only de-duplicated folder creates *within* a single job.

#### Cache-read (prompt-cache hit) tokens no longer count against autonomous-room budgets

Prompt-cache hits are now excluded from the normalized token usage every provider plugin reports. Cached input therefore no longer counts toward an autonomous room's per-run token cap (`budgetMaxTokens`), the daily user-token cap (`dailyTokenBudget`), or the per-chat token/cost aggregates.

The reconciliation lives in the provider plugins, not the app. Each provider reports usage differently — Anthropic reports `input_tokens` separately from `cache_read_input_tokens`, while the OpenAI family folds `cached_tokens` into the prompt-token count — so each plugin subtracts cache reads at the source according to its own convention. The app's budget code is unchanged: it already sums `usage.totalTokens`, which now excludes cache reads everywhere.

- `qtap-plugin-anthropic` (1.0.43): already excluded cache reads from `promptTokens`/`totalTokens` (input_tokens is reported separately from cache reads); only a clarifying comment was added so the convention isn't "fixed" away later.
- `qtap-plugin-openai` (1.0.49), `qtap-plugin-grok` (1.0.40), `qtap-plugin-z-ai` (1.1.11): subtract `input_tokens_details.cached_tokens` / `prompt_tokens_details.cached_tokens` from prompt and total.
- `qtap-plugin-google` (1.1.37): subtract `cachedContentTokenCount` from prompt and total.
- `qtap-plugin-deepseek` (1.0.10): subtract `prompt_cache_hit_tokens` from prompt and total.
- `qtap-plugin-openrouter` (1.0.45): subtract cache-read tokens across all three usage paths (non-streaming, Responses streaming, and chat-completions streaming — the last previously surfaced no cache data at all and now does).
- `cacheUsage` (the cache-read / cache-creation token counts) and `rawProviderUsage` are reported unchanged for display and diagnostics; only `usage.promptTokens` / `usage.totalTokens` changed.
- Caveat: the cost estimator has no cache-discount tier, so for the OpenAI-family providers the estimated cost and per-chat token totals now omit cache-read tokens entirely, rather than charging them at the full input rate as before.
- Docs: schema doc-comments in `lib/schemas/chat.types.ts` (`budgetMaxTokens`, `runTokensConsumed`) and `lib/schemas/settings.types.ts` (`dailyTokenBudget`); user help in `help/autonomous-rooms.md`.

#### Fix: autonomous rooms could freeze mid-run, and per-run token budgets over-counted

Two related bugs in autonomous rooms. A scheduled room would stop advancing and sit in `running` forever, and its per-run token budget was being charged for spend that wasn't part of the run.

Root causes:
1. **Poison write wedged the room.** Each autonomous turn runs in the forked job child, which buffers all of its writes — the assistant message, the turn/token counters, and the run-state transition — into one batch the parent applies atomically. When a character created a document-store folder that already existed within the same turn, the duplicate `docMountFolders.create` hit a unique constraint at apply time and rolled back the *entire* batch, including the run-state transition. The single-attempt job was marked DEAD and the chat stayed `running` with no turn in flight. `ensureFolderPath` was already written to be idempotent, but its existence-check and conflict-catch are both defeated in the child: reads use a readonly connection (no read-your-writes) and the real INSERT (and its conflict) is deferred to the parent.
2. **Per-run token budget counted the wrong tokens.** The post-turn budget check summed *all* `llm_logs` for the chat since the run started (a timestamp window), which folded in overlapping activity and fire-and-forget housekeeping (memory extraction, scene-state tracking, danger classification, title/summary generation) on top of the run's own turns. A long-running chat could blow past its per-run token cap after a single turn.

Fixes:
- `lib/mount-index/folder-paths.ts` + `lib/background-jobs/child/child-repositories-proxy.ts`: `ensureFolderPath` now consults a per-job memo (carried on the job scope) so a folder ensured earlier in the same job is never buffered for creation twice. Removes the poison write.
- `lib/services/chat-message/autonomous-room.service.ts` + `lib/background-jobs/host/job-dispatcher.ts`: when an `AUTONOMOUS_ROOM_TURN` job fails terminally, the dispatcher now reconciles the room to a resumable `paused` state (mirroring the startup reconcile) with the cause recorded in `runStateMessage`, instead of leaving it silently `running`.
- New `autonomousRunId` column + index on `llm_logs` (migration `add-llm-logs-autonomous-run-id-column-v1`). Every LLM call made within a turn is tagged with the run id via an `AsyncLocalStorage` context (`lib/background-jobs/autonomous-run-context.ts`); the turn handler now sums per-run spend by run id (`getTotalTokenUsageForRun`) instead of by timestamp window. This isolates the run's own turn spend (turns + agent-mode sub-calls) and excludes background housekeeping.
