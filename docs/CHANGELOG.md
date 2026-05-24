# Quilltap Changelog

## Recent Changes

### 4.6-dev

#### Fix: Autonomous-room turns are one-job-per-character-turn

The autonomous-room handler was calling `handleSendMessage` with `neverPauseForUser: true` but no other chain-control flag, so the orchestrator's `executeTurnChain` looped up to 20 character turns inside a single background job before returning. Three observable problems fell out of that:

- **Same character every iteration.** The forked job child buffers all repository writes in `AsyncLocalStorage` until the job ends. `shouldChainNext` re-reads `repos.chats.getMessages()` mid-chain, so on every iteration it saw the same pre-job message history, `lastSpeakerId` stayed frozen at whoever spoke *before* the job started, and `selectNextSpeaker` re-picked the same participant. In a two-character Friday-instance run, Friday spoke 20 consecutive times; Amy was never picked.
- **Per-turn budget check bypassed.** `handleAutonomousRoomTurn`'s pre-turn budget enforcement only fires between jobs, so a 20-deep chain overshot the configured 250K-token room cap by ~7× before the next job's check caught it.
- **Long turn latency.** One "autonomous turn" was actually 20 character responses (+ 20× commonplace whispers + 20× host time-stamp whispers); ~3-4 minutes of LLM time per job.

`SendMessageOptions.singleTurn` and `ExecuteTurnChainOptions.singleTurn` are new flags; `executeTurnChain` early-returns when set. The autonomous-room handler now passes `singleTurn: true` alongside the existing `neverPauseForUser` / `suppressAutomaticImages` flags, and the existing self-re-enqueue at the bottom of `handleAutonomousRoomTurn` handles the next turn — one job per character turn, buffered writes flush at job end, budget check fires every turn. `neverPauseForUser` is now defensive (the chain it gates no longer runs in this path), kept for code clarity. Other chat types are unaffected — the flag defaults to `false`.

#### Fix: Skip async pre-compression in autonomous-room chains

`lib/services/chat-message/message-finalizer.service.ts` no longer calls `triggerAsyncCompression` after each assistant message when `chat.chatType === 'autonomous'`. The async pre-compression path exists to make the next human message feel fast; autonomous-room chains have no human, and each chain step appends enough messages (character + host + commonplace whispers) to trip the staleness threshold within ~2 iterations — so the post-message trigger was firing the cheap-LLM compression call dozens of times per turn for a cache that no one inside the turn ever read. Observed in a Friday-instance turn: 59 compression starts for 20 chain iterations, 0 cache hits within the turn. Skipping the trigger drops autonomous-room cheap-LLM compression calls from dozens per turn to 0–2 (only when the next turn's first chain step misses the cache and falls back to sync compression in-line). Other chat types are unaffected.

#### Fix: Child-process readonly DB writes + autonomous-room startup reconcile

Three correctness fixes uncovered while investigating a stuck autonomous room in development. All three were silent failures masked by surrounding code.

- **Repository factory routing in child-executed code.** `lib/services/chat-message/compression-cache.service.ts` (3 dynamic-import sites), `lib/tools/handlers/doc-edit-handler.ts`, `lib/photos/save-image-to-album.ts`, and `lib/photos/photo-link-summary.ts` were importing `getRepositories` from `@/lib/database/repositories` (the raw container) instead of `@/lib/repositories/factory` (the proxy-aware wrapper that returns the buffered-write proxy when `QUILLTAP_JOB_CHILD === '1'`). When those code paths ran inside the forked job-runner child, repository write methods went straight to the readonly SQLCipher connection and threw `attempt to write a readonly database`. The compression cache's fire-and-forget wrapper swallowed the error, so it manifested as silent cache misses — every turn re-paid the compression cost without persisting the result.
- **Roleplay-templates seed moved to startup.** `lib/database/repositories/roleplay-templates.repository.ts` was lazy-seeding `BUILT_IN_TEMPLATES` from inside four read methods (`findById`, `findAll`, `findBuiltIn`, `findAllForUser`) via direct `collection.insertOne` / `updateOne` calls — bypassing the repository proxy entirely (proxies wrap repository methods, not the underlying SQLite collection). The four inline seed calls are removed; `lib/startup/seed-initial-data.ts` now invokes `repos.roleplayTemplates.seedBuiltInTemplates()` unconditionally near the top of `seedInitialData`, before the first-startup gate, so code-side template changes still propagate on every boot.
- **Autonomous-room startup reconcile.** When the server is killed mid-turn, the autonomous chat's `runState` stays at `'running'` forever and `startAutonomousRoomManually` refuses to re-engage. New `reconcileAutonomousRunsAtStartup()` in `lib/services/chat-message/autonomous-room.service.ts` runs from `instrumentation.ts` Phase 3.5 before `scheduleAutonomousRooms()` starts ticking: finds `chatType='autonomous'` rows with `runState='running'`, transitions each to `'idle'`, stamps `runEndedAt`, bumps `currentRunId` so any zombie `AUTONOMOUS_ROOM_TURN` job re-claimed by `resetOrphanedJobs()` exits cleanly via the stale-run guard on its next tick, and records `runStateMessage: 'restart:reconciled'`. Idempotent — no writes when nothing is stuck.

#### Feature: Private Character Rooms — Salon creation flow + chat-list toggle (Sub-task G complete)

Closes out the 4.6 UI: owners can now create autonomous rooms from the Salon and the homepage without dropping to SQL, and autonomous rooms are hidden from `/salon` by default with a per-user toggle to bring them back in.

- `app/api/v1/chats/route.ts`: `createChatSchema` accepts `chatType: 'autonomous'` plus the autonomous-room fields (`scheduleCron`, `scheduleFreshnessWindowMs`, `budgetMaxTurns`/`Tokens`/`MaxWallClockMs`, `budgetEstimatedSpendCapUSD`, `runVisibility`, `runDestructiveToolsAllowed`). Autonomous creation requires at least two LLM characters and refuses user-controlled participants. `scheduleCron` is parsed with `croner` at the route layer; bad expressions 400 with the offending text. Initial `scheduleNextRunAt` is computed at create time. Autonomous chats are seeded with system-prompt + scenario/Host whispers but no auto first-message. `handleList` accepts `?includeAutonomous=true`; per-room `runVisibility: 'household' | 'open'` still surfaces autonomous rooms regardless of the flag.
- `lib/services/chat-enrichment.service.ts`: `EnrichedChatSummary` carries `chatType` so the client can render an "Autonomous" badge on ChatCard.
- `lib/chat-utils.ts`: `SalonChatShape` gains `chatType`; `transformSalonChatToCardData` maps it to `isAutonomous`.
- `components/chat/ChatCard.tsx`: new "Autonomous" pill next to the title.
- `components/providers/quick-hide-provider.tsx`: third localStorage-backed boolean `includeAutonomousRooms` (`quilltap.quickHide.includeAutonomousRooms`), with matching toggle in `components/dashboard/nav-user-menu-quick-hide.tsx` under Content Filters.
- `app/salon/page.tsx`: reads `chat_settings.autonomousRoomSettings.visibilityDefault`. When `'owner_only'`, the listing fetch omits autonomous rooms unless the toggle is on; for `'household' | 'open'`, autonomous rooms always come through. An inline hint surfaces when at least one autonomous room owned by the user is currently hidden. Header gains a "New Autonomous Room" button next to "New Chat".
- `components/new-chat/{types,hooks/useNewChat,NewChatForm}.tsx`: `NewChatFormState` adds an `autonomous` slice (cron, freshness hours, four budget caps, visibility, destructive-tools). `useNewChat` prefetches `/api/v1/settings/chat` to seed defaults (freshness window) and ceiling (`destructiveToolPolicy === 'always_refuse'` disables the per-room checkbox); accepts `initialAutonomous`. `handleCreateChat` branches: autonomous rooms suppress the user-character participant and the avatar-generation flag, send `chatType: 'autonomous'` + the autonomous fields, and redirect to `/settings?tab=system&section=autonomous-rooms` (where the operator can Start the run) rather than the chat transcript.
- `app/salon/new/page.tsx`: reads `?autonomous=1`, passes through, flips the heading and submit-button copy, and disables submit when autonomous-mode constraints (≥2 LLM, no user) aren't met.
- `components/homepage/QuickActionsRow.tsx`: new "Start Autonomous Room" link next to "Start a Chat", same `/salon/new?autonomous=1` destination.

#### Feature: Private Character Rooms — turn driver, scheduler, API, help doc (Sub-tasks B-E, partial F-G, H)

Builds the runtime, scheduler, API surface, and help documentation for 4.6 autonomous character-to-character chat rooms.

**Sub-task B — turn driver core.** SendMessageOptions gains `neverPauseForUser` (bypasses the all-LLM pause threshold so the autonomous-room runner can drive its own lifecycle) and `suppressAutomaticImages` (skips automatic Lantern + avatar-refresh triggers; deliberate character image-tool calls still work). New handler `lib/background-jobs/handlers/autonomous-room-turn.ts` drives one turn of an autonomous chat — stale-run guard against `payload.runId !== chat.currentRunId`, idle→running transition with counter reset, pre-turn budget check, speaker selection via `selectNextSpeaker`, message via `handleSendMessage` with the new flags, post-turn bookkeeping, self-re-enqueue. Avatar-refresh gate in `lib/wardrobe/avatar-generation.ts:143` and story-background gate in `lib/background-jobs/handlers/title-update.ts` short-circuit on `chatType === 'autonomous'`.

**Sub-task C — tool filtering + daily user-token cap.** `lib/services/chat-message/orchestrator.service.ts` filters `DESTRUCTIVE_TOOL_NAMES` from the per-turn tool list when the chat is autonomous and either `runDestructiveToolsAllowed === 0` or the user-level `destructiveToolPolicy === 'always_refuse'` (the user policy is a ceiling). New `lib/database/repositories/llm-logs.repository.ts:getTotalTokenUsageSince()` powers the daily user-token budget; the rollover boundary is instance-local midnight. The cap transitions the run to `paused` (resumed by the scheduler at the next midnight), not `budgetExhausted`.

**Sub-task D — memory attribution.** `lib/memory/memory-processor.ts:TurnMemoryExtractionContext` gains `inAutonomousRoom`. The SELF and OTHER extraction prompt builders in `lib/memory/cheap-llm-tasks/memory-tasks.ts` prepend a user-absence clause when set; memories are written with `witnessedContext: 'autonomous_room'`. Ordinary chats write `'user_present'`. The memory-extraction handler reads `chat.chatType === 'autonomous'` and forwards.

**Sub-task E — scheduler + manual-start service + Host announcements.** `lib/background-jobs/scheduled-autonomous-rooms.ts` (new) is a parent-process `setInterval(60_000)` that enqueues per-user `AUTONOMOUS_ROOM_SCHEDULE_TICK` jobs; started from `instrumentation.ts` Phase 3.5 alongside the existing schedulers. `lib/background-jobs/handlers/autonomous-room-schedule-tick.ts` (new) scans autonomous rooms with cron + non-terminal state; for each due row within the freshness window, generates a `runId`, atomically transitions to `'idle'`, advances `scheduleNextRunAt`, enqueues a turn. Stale slots are logged + skipped, never caught up. Cron evaluation via `croner ^10.0.1` (new dependency). `lib/services/chat-message/autonomous-room.service.ts` (new) houses `startAutonomousRoomManually` / `pauseAutonomousRoom` / `stopAutonomousRoom` / `resumeAutonomousRoom`. Manual start refuses on `runState === 'running'` and consumes any cron slot inside the current freshness window. The turn handler posts Host-authored `autonomous-room-start` / `autonomous-room-end` / `autonomous-room-paused` system messages at lifecycle transitions and recomputes `scheduleNextRunAt` from the cron when a run ends cleanly.

**API surface (partial F-G).** `app/api/v1/chats/[id]/autonomous-room/route.ts` exposes the management endpoints — POST with `?action=start|pause|stop|resume` and GET for a status snapshot — wired to the manual-start service. UI scaffolding for `/settings?tab=chat&section=autonomous-rooms`, `/settings?tab=system&section=autonomous-rooms`, and the Salon room-creation flow remain TODO; the backend is ready for them.

**Sub-task H — help doc.** `help/autonomous-rooms.md` walks the household through budgets, scheduling, freshness windows, tool restrictions, automatic-image suppression, the Concierge's adjusted behavior, memory provenance, and the settings surfaces, in the project's Wodehouse-steampunk voice.

#### Feature: Private Character Rooms — schema substrate (Sub-task A)

Schema-only first slice of 4.6 Private Character Rooms (autonomous character-to-character chats). No runtime behavior yet; this slice only widens the schema so subsequent sub-tasks have something to write to.

- New migration `add-autonomous-rooms-fields-v1` (`migrations/scripts/add-autonomous-rooms-fields.ts`): adds nullable columns to `chats` (`budgetMaxTurns`, `budgetMaxTokens`, `budgetMaxWallClockMs`, `budgetEstimatedSpendCapUSD`, `scheduleCron`, `scheduleFreshnessWindowMs`, `scheduleNextRunAt`, `scheduleLastRunAt`, `runState`, `currentRunId`, `runStateMessage`, `runStartedAt`, `runEndedAt`, `runTurnsConsumed`, `runTokensConsumed`, `runDestructiveToolsAllowed`, `runVisibility`); adds partial indexes `idx_chats_autonomous_nextRunAt` and `idx_chats_autonomous_runState`; adds `autonomousRoomSettings` JSON column to `chat_settings`; adds `witnessedContext` TEXT column to `memories`.
- `lib/schemas/chat.types.ts`: `ChatTypeEnum` extended to include `'autonomous'`; new `AutonomousRunStateEnum` and `AutonomousRunVisibilityEnum`; the new autonomous-room fields added to both `ChatMetadataSchema` and `ChatMetadataBaseSchema`.
- `lib/schemas/job.types.ts`: `BackgroundJobTypeEnum` extended with `'AUTONOMOUS_ROOM_TURN'` and `'AUTONOMOUS_ROOM_SCHEDULE_TICK'`.
- `lib/schemas/memory.types.ts`: new `WitnessedContextEnum` and a nullable `witnessedContext` field on `MemorySchema`. Existing rows stay NULL; the memory-extraction path will start writing this in Sub-task D.
- `lib/schemas/settings.types.ts`: new `AutonomousRoomSettingsSchema` (with `dailyTokenBudget`, `defaultFreshnessWindowMs`, `visibilityDefault`, `destructiveToolPolicy`) added to `ChatSettingsSchema`.
- `lib/tools/destructive-tools.ts` (new): exports `DESTRUCTIVE_TOOL_NAMES` (`'doc_delete_file'`, `'doc_delete_folder'`) and an `isDestructiveTool()` predicate. Not consumed yet; the per-turn filter in Sub-task C will read from this set.
- `lib/startup/prettify.ts`: added the migration's pretty label ("Preparing the autonomous salon quarters").
- `docs/developer/DDL.md`: `chats`, `chat_settings`, `memories` sections updated; partial indexes documented.
- `public/schemas/qtap-export.schema.json`: extended `Chat` properties with all new autonomous-room fields after `conciergeOverride`.

#### Fix: Suppress react-hooks/set-state-in-effect lint error in DescriptionsTab

`app/aurora/[id]/view/components/DescriptionsTab.tsx`: added the standard `// eslint-disable-next-line react-hooks/set-state-in-effect` directive to the fetch-on-mount effect, matching the pattern used in `useCharacterEdit.ts` and other Aurora hooks.

#### Change: Always inline `[Name]` prefix on user-role turns in multi-character chats

In `lib/llm/message-formatter.ts`, `formatMessagesForProvider` now prepends a `[Name]` tag to every user-role message that carries a participant name, regardless of whether the provider supports the OpenAI-style `name` field. When the provider supports `name`, we send both. Assistant-role turns are unchanged (native `name` field when supported, prefix fallback otherwise).

Why: in multi-character chats, every other character's previous turn is downgraded from `ASSISTANT` → `user` and given `name: <CharacterName>`. The `name` field is a weak attribution signal on OpenAI-compatible providers — the model attends much more strongly to role + content. With multiple characters speaking in first person under the `user` role, the responding character would sometimes echo the immediately-preceding "I"-voice (e.g. Amy parroting Friday's `*I feel her.*` opening word-for-word). Inlining `[Friday] *I feel her.*` gives the model a strong in-content anchor for cross-speaker attribution.

Response-side `stripCharacterNamePrefix` is unchanged — it already only strips the responding character's own name, so a mirrored `[Amy]` at the start of Amy's reply still gets removed.

Test updated: `__tests__/unit/lib/llm/message-formatter.test.ts` OPENAI case now expects both `name: 'Alicia_Keys'` and `content: '[Alicia Keys] Hello'`; added a no-double-prefix case.

#### Change: Aurora UI follow-up to the character vault cutover

Tore out the dead multi-`physicalDescription` and `readPropertiesFromDocumentStore` UI left over from the Phase 3 cutover, and migrated callers off the deleted `/api/v1/characters/[id]/descriptions/*` and `/clothing/*` routes.

- `app/aurora/[id]/view/types.ts` and `edit/types.ts`: `physicalDescriptions: CharacterPhysicalDescription[]` → `physicalDescription: CharacterPhysicalDescription | null`; dropped `readPropertiesFromDocumentStore` from both.
- `app/aurora/[id]/view/hooks/useCharacterView.ts`: template-count loop and the template-replace flow collapsed from `physicalDescriptions.map(...)` to a single-record check; writes the singular `physicalDescription` field on PUT.
- `app/aurora/[id]/view/components/DescriptionsTab.tsx`: rewritten as a self-contained single-record editor. No longer mounts `PhysicalDescriptionList` or `ClothingRecordList`; PUTs `{ physicalDescription: {...} }` to `/api/v1/characters/[id]` directly. Same field set as the old editor (name, usageContext, four prompt sizes, fullDescription).
- `app/aurora/[id]/view/components/ExternalPromptDialog.tsx`: dropped the clothing branch entirely and the physical-description picker. `generateExternalPromptSchema` on the server side already accepts neither; the dropdowns were dead.
- `app/aurora/[id]/view/page.tsx`: dropped the `overlayActive` prop and the `readPropertiesFromDocumentStore` half of `CharacterOptimizerModal`'s `vaultAvailable` — vault availability is now just `!!character?.characterDocumentMountPointId`.
- `app/aurora/[id]/edit/page.tsx`: dropped `physicalDescriptionsRefreshKey` and the two `handleSyncProperties*AndRefreshLists` wrappers; descriptions tab now uses the new `DescriptionsTab`; wizard's physical-description save migrated from POST `/descriptions` to PUT `/characters/[id]` with `{ physicalDescription: ... }`.
- `app/aurora/[id]/edit/hooks/useCharacterEdit.ts`: dropped `readPropertiesFromDocumentStore` from form state and removed `handleReadFromDocStoreToggle`, `handleSyncPropertiesFromVault`, `handleSyncPropertiesToVault`.
- `app/aurora/[id]/edit/components/CharacterBasicInfo.tsx`: removed the Scriptorium-overlay toggle card, the Copy-vault/Copy-database buttons, the `hasLinkedVault` prop, and the `overlayOn` conditional copy in the Scenarios section.
- `app/aurora/new/page.tsx`: wizard's physical-description save migrated from POST `/descriptions` to PUT `/characters/[id]` with `{ physicalDescription: ... }`.

Server-side: extended `updateCharacterSchema` in `app/api/v1/characters/[id]/route.ts` to accept the singular `physicalDescription` (nullable) and normalize missing id/createdAt/updatedAt via `PhysicalDescriptionSchema.parse`. Without this the UI's PUT was being silently stripped by Zod.

Stale comments scrubbed: `lib/database/repositories/wardrobe.repository.ts`, `lib/database/repositories/characters.repository.ts`, `lib/export/ndjson-writer.ts`, `lib/startup/refresh-vault-wardrobe.ts` no longer mention `readPropertiesFromDocumentStore`.

Out of scope for this pass (still calls the deleted routes and will 404 at runtime): `components/physical-descriptions/*`, `components/clothing-records/*`, `components/chat/CreateNPCDialog.tsx`, and the suggestion-category keys `physicalDescriptions` / `clothingRecords` in `components/characters/optimizer/*`.

Verification: `grep -rn "physicalDescriptions\b\|readPropertiesFromDocumentStore\|clothingRecords" app/aurora` is clean. `npx tsc --noEmit` is clean.

#### Change: Character vault cutover — Phase 3 (Feature 0)

Completed the multi-phase move of character content fields into the per-character document vault. After the `cutover-characters-to-vault-v1` migration runs, the `characters` table holds only identity, the vault pointer (`characterDocumentMountPointId`), default-reference fields, behavior flags, `systemTransparency`, and `sillyTavernData`. Every content field is now read from and written to the vault unconditionally.

Dropped columns from the `characters` table: `identity`, `description`, `manifesto`, `personality`, `exampleDialogues`, `firstMessage`, `scenarios`, `systemPrompts`, `physicalDescriptions`, `title`, `talkativeness`, `aliases`, `pronouns`, `clothingRecords`, `avatarUrl`, `readPropertiesFromDocumentStore`. `systemTransparency` is NOT dropped — it remains as application-state access control on the DB row.

`physicalDescriptions` (array) reshaped to `physicalDescription` (singular `PhysicalDescription | null`). The vault file shape is unchanged — `physical-description.md` for the fullDescription, `physical-prompts.json` for the short/medium/long/complete prompts. The migration logs a per-character warning when a pre-cutover record had more than one entry; only index 0 is preserved.

The overlay (`lib/database/repositories/character-properties-overlay.ts`) no longer branches on `readPropertiesFromDocumentStore`; vault routing is unconditional whenever `characterDocumentMountPointId` is set. The overlay also stops mirroring `systemTransparency` into `properties.json`; the migration's per-character pass scrubs the residual key from any existing file.

Backup safeguard: before per-character work, the migration calls the existing `createPhysicalBackup` / `createMountIndexPhysicalBackup` / `createLLMLogsPhysicalBackup` functions in `lib/database/backends/sqlite/physical-backup.ts` — the same `VACUUM INTO`-based snapshot path the server already runs at every startup. Those functions skip if a backup younger than 24h is on disk, so the typical "already started this morning" path is a no-op. After each call, the migration verifies a recent backup actually exists on disk (the create-functions return null both on "skipped" and on "silent failure"); if the main DB has no recent backup, the migration aborts before destructive work. The refusal gate: if any character's vault can't be verified complete after the per-character pass, the schema mutations are skipped and the operator can re-run after fixing the underlying issue.

Pre-flight inspection: new `npx quilltap db characters status` CLI verb reports per-character vault readiness — vault present, `readPropertiesFromDocumentStore` flag value, files present (`N/8`), Prompts/Scenarios/Wardrobe counts, and any divergence between DB columns and vault files. Supports `--json`, `--id <name|uuid>`, `--diverged`, `--blocked`, `--limit N`. Schema-probes the `characters` table so it works both pre- and post-cutover.

API surface: deleted `/api/v1/characters/[id]/clothing/*` (clothing has been wardrobe-managed since 4.5) and `/api/v1/characters/[id]/descriptions/*` (no longer an array). Character creates/updates with `clothingRecords`, `avatarUrl`, or `readPropertiesFromDocumentStore` payloads are silently dropped by the Zod schema.

`.qtap` export schema (`public/schemas/qtap-export.schema.json`) drops `readPropertiesFromDocumentStore`; `avatarUrl` and the legacy `physicalDescriptions` array are kept on the schema as deprecated-but-tolerated for backwards compatibility with older `.qtap` files. New `physicalDescription` singular field documented. `lib/backup/restore-service.ts` folds legacy `physicalDescriptions[0]` into the singular form on import and silently drops `clothingRecords`.

Files: new migration at `migrations/scripts/cutover-characters-to-vault.ts` (registered, PRETTY_LABELS entry added). `populateVaultWithCharacterData` exported from `lib/mount-index/character-vault.ts`. DDL.md updated with the post-cutover schema plus a vault-managed-fields cross-reference.

Known follow-ups (tracked in session chips): Aurora UI multi-physicalDescription tear-down (the edit/view tabs still iterate on the array form; they compile but render dead controls). The AI-import / character-wizard services have been cleaned up (`lib/services/ai-import.service.ts` and `lib/services/character-wizard.service.ts` now emit the singular `physicalDescription` and no longer write `clothingRecords`).

#### Change: Composer text replacement (Layer 1.5 of the spellcheck/autocorrect plan)

Salon composer and Document Mode rich editor now apply user-defined word-boundary text replacements as you type (e.g. `teh ` → `the `, `Aris ` → `Aristarchus the Wise `). Cross-platform substitute for OS autocorrect, which Chromium does not run on contentEditable. Literal-string matching only; no snippets, no regex.

New table `text_replacement_rules` (`migrations/scripts/add-text-replacement-rules-table.ts`): per-rule `fromText`, `toText`, `caseSensitive`, `enabled`, `sortOrder`, timestamps. Global per instance (no userId — single-user model). New `chat_settings.textReplacementsEnabled` boolean (default 1; `migrations/scripts/add-text-replacements-enabled-field.ts`) is the master toggle, kept separate from the rule list so the feature can be A/B'd without losing rules. Both migrations registered in `migrations/scripts/index.ts` with pretty labels in `lib/startup/prettify.ts`. DDL.md updated.

Zod schemas at `lib/schemas/text-replacement.types.ts` (rule + input + patch shapes). Repository at `lib/database/repositories/text-replacement-rules.repository.ts`: standard CRUD plus `list({ enabledOnly })`, `bulkReplace(rules)`, and a `TextReplacementRuleConflictError` that the API translates to 409. Conflict detection on `(fromText, caseSensitive)` — two case-insensitive rules with the same lower-cased trigger are rejected; case-sensitive vs case-insensitive rules with the same `fromText` are legal (case-sensitive wins at lookup time). Repository registered in `lib/database/repositories/index.ts` as `repos.textReplacementRules`.

REST endpoints under `app/api/v1/settings/text-replacements/`: `GET` lists, `POST` creates, `POST?action=bulk-replace` swaps the full list, `PATCH /[id]` updates, `DELETE /[id]` removes. Master toggle persisted via the existing `PUT /api/v1/settings/chat` route (extended to accept `textReplacementsEnabled`).

Renderer hook at `lib/text-replacement/useTextReplacementRules.ts` fetches via SWR and memoises two lookup maps (`caseSensitive`, `caseInsensitive`) plus an `empty` short-circuit flag. Lexical plugin at `components/chat/lexical/plugins/TextReplacementPlugin.tsx` registers a `KEY_DOWN_COMMAND` listener at `COMMAND_PRIORITY_LOW`, bails on IME composition / master-toggle-off / empty rules, and only fires when the cursor sits at the end of a `TextNode`. Trigger characters: ASCII space, NBSP, tab, and `. , ; : ! ? )`. Newline is intentionally excluded so submit/paragraph-break handlers own that key. Replacement is wrapped in `editor.update(..., { tag: 'text-replacement' })` so one Cmd-Z reverts to the literal typed text. Plugin mounted in both `components/chat/lexical/LexicalComposerWrapper.tsx` and `app/salon/[id]/components/DocumentPane.tsx`'s `DocumentEditorPlugins`. Source-mode textareas keep their explicit `spellCheck={false}` and are unaffected.

Settings UI at `components/settings/chat-settings/TextReplacementSettings.tsx`: master toggle, add-rule form (trigger + replacement + case-sensitive), editable rule list (in-place edits commit on blur/Enter, plus per-row Enabled and Delete), and a scratch "Try it" textarea. Mounted in a new "Text Replacement" `CollapsibleCard` (`sectionId="text-replacements"`) on the Chat tab in `components/settings/tabs/ChatTabContent.tsx`. New `handleTextReplacementsEnabledChange` handler in `useChatSettings` mirrors the spellcheck-toggle pattern. `ChatSettings` interface in `components/settings/chat-settings/types.ts` gains `textReplacementsEnabled?`.

Help docs: new **Text Replacement** section in `help/chat-settings.md` (Quilltap voice).

Not in qtap-export: chat_settings and text_replacement_rules are global per-instance state, not per-entity. SQLCipher backup via `npx quilltap db backup` captures both automatically.

#### Change: LLM logs now record the provider's reported finish reason

The streaming chat-message path captures `finish_reason` / `stop_reason` / `finishReason` / `status` from the provider's raw response and stores it on the log row.

- `LLMLogResponseSummarySchema` (`lib/schemas/llm-log.types.ts`) gains an optional `finishReason: string | null` field. JSON blob, no migration needed.
- New helper `lib/llm/extract-finish-reason.ts` sniffs the well-known raw-response shapes (OpenAI `choices[0].finish_reason`, Anthropic `stop_reason`, Google `candidates[0].finishReason`, OpenAI Responses `status`). Pure, provider-agnostic.
- `streamMessage` in `lib/services/chat-message/streaming.service.ts` calls the helper on the `done` chunk's `rawResponse` and passes the value through `logLLMCall`.
- `LogLLMCallParams.response` and `summarizeResponse()` in `lib/services/llm-logging.service.ts` thread the field through to the stored row.
- `npx quilltap db log <id>` (`packages/quilltap/lib/db-commands.js`) surfaces `finishReason` as a top-line field alongside `durationMs`, `usage`, and `cacheUsage`. Old rows display nothing (printRecord skips null), new rows show e.g. `stop`, `length`, `tool_calls`, `content_filter`, `end_turn`, `STOP`, `completed`.

Motivation: diagnosing a GLM 5.1 cutoff where the model halted mid-sentence at an opening backtick whenever tools were present in the request. Without `finishReason` in the log, we couldn't tell whether the provider reported `stop`, `length`, `tool_calls`, or `content_filter`.

#### Change: Composer spellcheck toggle (Salon composer + Document Mode rich editor)

A new `composerSpellcheck` boolean (default on) governs browser spellcheck on the two Lexical rich-text surfaces — the Salon `ChatComposer` (`components/chat/lexical/LexicalComposerWrapper.tsx`) and the Document Mode rich editor (`app/salon/[id]/components/DocumentPane.tsx`'s `DocumentEditorPlugins`). Source-mode editors (the Markdown source view and plain-text source view in `DocumentPane`, plus `components/markdown-editor/MarkdownLexicalEditor.tsx`) keep their explicit `spellCheck={false}` — Markdown syntax against a monospace font becomes squiggle noise.

Wired through the standard chat-settings path: Zod field on `ChatSettingsSchema` (`lib/schemas/settings.types.ts`), TypeScript interface on `ChatSettings` (`components/settings/chat-settings/types.ts`), pass-through in `PUT /api/v1/settings/chat`, new `handleComposerSpellcheckChange` handler in `useChatSettings`, new `ComposerSpellcheckSettings` card under a "Composer" `CollapsibleCard` (`sectionId="composer-spellcheck"`) on the Chat tab. The two ContentEditable surfaces read the value via `useSWR('/api/v1/settings/chat')` (matching the pattern in `AutoLockSettingsCard.tsx`); SWR deduplication keeps it one request per render tree. While settings are loading, the surfaces default to `spellCheck={true}` rather than `false`.

Schema additions: `migrations/scripts/add-composer-spellcheck-field.ts` adds a `composerSpellcheck INTEGER DEFAULT 1` column to `chat_settings`, registered in `migrations/scripts/index.ts` with a pretty-label in `lib/startup/prettify.ts`.

Electron-only dictionary feed: `lib/spellcheck/useDictionaryFeed.ts` is a renderer-side hook that watches `/api/v1/characters` and pushes tokenized character names into the shell's custom spellchecker dictionary via `window.quilltap.setDictionaryWords` (feature-detected — silent no-op in the browser). Tokenization splits on `[\s\p{P}]+`, drops <2-char and pure-digit tokens, dedupes, and caps at 5000 with a warn. The hook is mounted once via a renderless (returns-null) `DictionaryFeedMount` inside the authenticated branch of `components/layout/app-layout.tsx` so the SWR call doesn't fire on auth/setup/unlock screens.

Type declarations: `types/quilltap-bridge.d.ts` gains three optional methods on `QuilltapElectronBridge` — `setDictionaryWords`, `setSpellCheckerLanguages`, `getSpellCheckerStatus` — so consumers can feature-detect without `(window as any)` casts. The matching shell-side handlers will land in `quilltap-shell`; this server-side change ships safely without them because every consumer feature-detects.

DDL.md updated. Unit tests for `tokenizeNames` at `lib/spellcheck/__tests__/tokenizeNames.test.ts`. Help docs at `help/chat-settings.md` describe the new toggle and the desktop right-click menu.

#### Fix: Deleting a mount point no longer leaks folder rows

`DELETE /api/v1/mount-points/[id]` in `app/api/v1/mount-points/[id]/route.ts` cleared chunks, file links, documents, blobs, project links, and the mount-point row itself, but never called `docMountFolders.deleteByMountPointId(id)`. `doc_mount_folders` has no FK to any of those tables, so the folder hierarchy was orphaned on every mount-point deletion. Added the call between the blobs delete and the project-links delete. Pre-existing orphan folder rows must be cleaned up by hand (e.g. via `quilltap db --mount-points` against the mount-index DB).

#### Fix: `quilltap db` raw-SQL path now accepts `--json`

The verb subcommands (`db chats`, `db schema`, etc.) already supported `--json` via `lib/db-commands.js`, but the legacy `db <SQL>` / `db --tables` / `db --count` path rejected it with `Unknown option: --json`. Added `--json` to the legacy flag parser in `packages/quilltap/bin/quilltap.js`. With `--tables` it emits a JSON array of table names; with `--count` an object `{ table, count }`; with raw SQL a JSON array of rows for SELECTs and `{ changes, lastInsertRowid }` for writes. Help text updated.

#### Change: Per-chat Concierge tri-state (Safe / Flagged / Off-duty)

Each chat now carries an explicit Concierge mode the operator can set from the sidebar. A new `chats.conciergeOverride` column (TEXT, NULL or `'OFF'`, default NULL) is added by `migrations/scripts/add-chat-concierge-override.ts`. The control lives in the Chat Sidebar's Chat section: Safe (default — global moderation applies, classifier may auto-flip to Flagged), Flagged (treat the chat as dangerous; uncensored routing for text, image gen, cheap-LLM, etc.), and Off-duty (`conciergeOverride='OFF'` — disables every Concierge effect for this chat; never auto-flips out).

Implementation:

- `lib/services/dangerous-content/chat-override.ts` exports `isConciergeOffDuty()` and `isChatActiveDangerous()`. The latter replaces direct `chat.isDangerousChat === true` reads everywhere routing or sanitization decisions are made: `danger-orchestrator.service.ts`, `image-generation-handler.ts`, `appearance-resolution`-aware paths, `cheap-llm.ts`, `chat/context-summary.ts`, `memory-trigger.service.ts`, `orchestrator.service.ts`, `message-finalizer.service.ts`, and the background handlers (`memory-extraction`, `memory-regenerate-all`, `scene-state-tracking`, `story-background`, `title-update`).
- `resolveDangerousContentSettings()` accepts an optional `chat` argument and returns `OFF_DUTY_DANGEROUS_CONTENT_SETTINGS` (mode `OFF`, every scan disabled) when the chat is off-duty, so callers that already gated on `dangerSettings.mode !== 'OFF'` pick up the override automatically.
- `scheduled-danger-scan.ts` skips off-duty chats during enumeration. `chat-danger-classification` handler bails at the top with a debug log if the chat is off-duty when its job runs.
- `lib/services/dangerous-content/manual-flip.ts` is the single chokepoint for manual transitions: it writes the appropriate combination of `conciergeOverride` and `isDangerousChat` (and clears classifier metadata when returning to Safe so the scheduler can re-evaluate), then posts a synthetic Concierge announcement via the new `postConciergeManualAnnouncement` (four variants: manual-flagged, manual-safe, manual-off-duty, manual-on-duty).
- `PUT /api/v1/chats/[id]` accepts a new `conciergeState: 'safe' | 'flagged' | 'off'` field that the helper maps onto storage.
- `ChatSidebar.tsx` adds a tri-state `<select>` at the top of the Chat section, mirroring the existing "Announce Generated Images" pattern. The salon-page toolbar pill now shows an "Off-duty" badge when applicable instead of the "Flagged" badge.
- Export schema (`public/schemas/qtap-export.schema.json`) declares `conciergeOverride` alongside the existing danger fields (which were previously undeclared) so the value round-trips through `.qtap` export/import.
- DDL.md and `lib/startup/prettify.ts` updated to mention the new column and migration.

#### Change: Salon Tools palette and Chat Settings modal consolidated into a new Chat Sidebar

The right-side Participants Sidebar on the Salon chat page is now the **Chat Sidebar** (`components/chat/ChatSidebar.tsx`), built as a single-open accordion with five sections: Participants, Chat, Visibility, Organize, Edit Content. Every control that used to live in the composer's Tools palette popover, and every setting from the Chat Settings modal, now lives inline inside the appropriate accordion section. The two inline toggles that floated above the message list in multi-character chats (Shared Vaults, All Whispers) moved into the Visibility section.

- **Chat section** holds Agent Mode toggle, Roleplay Template dropdown, Project picker, Image Provider dropdown, Announce Generated Images dropdown, Auto-generate Avatars toggle, Tools modal launcher, Run Tool modal launcher, and Regenerate Background.
- **Organize** holds Rename, State editor, Continue Elsewhere, Export, and Gallery (conditional on `chatPhotoCount > 0`).
- **Edit Content** holds Replace, Bulk Replace, Re-extract Memories, and Delete Memories.
- **Participants** absorbs the existing turn list, talkativeness sliders, pause/resume, queue indicator, and Add Character button. Default-open on first render.
- **Visibility** is gated on `isMultiChar` to match the previous behavior of the inline toggles.

The narrow mini-avatar collapsed mode of the sidebar is preserved unchanged. Accordion open/closed state is session-only — no localStorage, no server persistence — and the section is always reset to Participants on reload.

The Tools hamburger button on the composer is gone, along with `ToolPalette.tsx`, `ChatSettingsModal.tsx`, and the original `ParticipantSidebar.tsx`. `CollapsibleCard` gained optional `isOpen` / `onOpenChange` props so the parent can drive single-open behavior; uncontrolled callers are unaffected. `useModalState.ts` lost `toolPaletteOpen` and `chatSettingsModalOpen`. Files touched: `app/salon/[id]/page.tsx`, `app/salon/[id]/components/ChatComposer.tsx`, `app/salon/[id]/components/ChatModals.tsx`, `app/salon/[id]/hooks/useModalState.ts`, `components/ui/CollapsibleCard.tsx`, plus the new `components/chat/ChatSidebar.tsx`.

The previous `ParticipantSidebar.test.tsx` (1310 lines, tightly coupled to the old flat layout) and `tool-palette.test.tsx` are removed.

#### Change: Help files updated for the new Chat Sidebar

Reworked `chat-participants.md` as the **Chat Sidebar** reference (covering all five drawers), added a per-chat / global note to `chat-settings.md`, and corrected access paths in `chat-multi-character.md`, `run-tool.md`, `agent-mode.md`, `help-chat.md`, `chats.md`, `chat-state.md`, `templates-in-chats.md`, `rng-tool.md`, `lantern.md`, `chat-turn-manager.md`, `chat-message-actions.md`, `salon-host-introductions.md`, and `the-courier.md` to point at the right Chat Sidebar drawer (or, for the RNG dropdown, at the composer's gutter dice icon).

#### Fix: Save Image now works for mount-file attachments whose images-v2 sister was reaped

`saveImageToAlbum` in `lib/photos/save-image-to-album.ts` rejected with `IMAGE_NOT_FOUND` when the Salon Save-Image button (or the LLM `keep_image` tool) was used on a Librarian-attached mount file whose underlying `files` (images-v2) row no longer existed. The lookup chain — `getImageById` → `docMountFileLinks.findByIdWithContent` → `files.findBySha256` — bailed out if all three missed, even though the actual bytes were still readable from `doc_mount_blobs`. This typically hit older Lantern-generated story backgrounds that survived in a project document store after their original FileEntry was reaped by file-storage reconciliation.

The third lookup now has a fallback: it reads the bytes via `docMountBlobs.readDataByFileId(sourceLink.fileId)` and ingests them into images-v2 to synthesize a fresh `FileEntry`. The new `ingestImageBuffer` helper in `lib/images-v2.ts` wraps the internal `createFile` path (auto-WebP-convert, SHA256 dedup, dimension capture) so the synthesized entry is indistinguishable from a normal upload. The synthesized FileEntry loses the original generation metadata (prompt/model/revisedPrompt) — that vanished with the reaped row — but the photo itself survives and the save proceeds. MIME type comes from the link's `originalMimeType` with a filename-extension fallback (`inferImageMimeFromFilename`).

#### Fix: Chat-level danger classification no longer misclassifies persona prompts and Staff announcements

Two bugs let chat-level reclassification flag entire chats as dangerous based on content that wasn't user/character speech.

1. `lib/background-jobs/handlers/chat-danger-classification.ts` ran in the forked job-runner child. When `classifyContent`'s moderation-provider path returned `null` (no provider registered, or no auto-detected API key), it silently fell through to the cheap-LLM classifier (gpt-5-nano). On Friday-style instances this happened intermittently — the child's plugin init runs asynchronously at startup, so jobs dispatched before init completed never saw the OpenAI moderation provider.
2. The same handler's no-summary fallback concatenated every chat message as `ROLE: content` and shipped the first 4 KB to the classifier. With no filtering, a chat's `SYSTEM`-role persona prompt was the leading content; Staff announcements (Concierge, Lantern, Host, Librarian, Aurora, Prospero, Pascal, Ariel, Commonplace Book) and tool messages were also included. A persona prompt mentioning polyamory was enough to score a chat as NSFW even when the conversation itself was benign.

`classifyWithModerationProvider` in `lib/services/dangerous-content/gatekeeper.service.ts` now emits a `warn` log on each null-return branch, distinguishing "no moderation provider registered" (with `registryInitialized` + `providerCount` for diagnostics) from "no API key auto-detected" (with the provider name). Future regressions surface in `combined.log` instead of being absorbed silently.

`chat-danger-classification`'s no-summary fallback now filters out `SYSTEM` role, `TOOL` role, and any message with `systemSender != null` before concatenation. Only participant speech (user + character `USER` / `ASSISTANT` turns) reaches the classifier. Test mocks for both gatekeeper test suites were extended to cover the new `isInitialized` / `getAllProviders` calls.

#### Change: Concierge danger announcement names the contributing categories, scores, and threshold

When a chat is first classified as dangerous, the Concierge's in-chat announcement now states exactly what triggered the verdict: the contributing categories (using the canonical labels, e.g. `Sexual/NSFW content`, `Violence or graphic content`), each category's severity score, the overall score, the active threshold, and which assayer rendered the decision (moderation provider or cheap-LLM fallback, identified by provider name). Categories at or above the threshold are listed; if none cross individually (e.g. a moderation `flagged=true` aggregate case), the top scores by rank are shown instead, capped at three. The narrative version weaves these details into the Concierge's voice; the opaque/LLM-context body states them plainly without naming "the Concierge."

To support this, `DangerClassificationResult` gained optional `source: 'moderation' | 'llm'` and `providerName` fields, stamped inside `classifyContent` on both paths. `CATEGORY_LABELS` is now exported from `gatekeeper.service.ts` and used by the writer to keep labels consistent (the cheap-LLM path's free-text `label` is no longer relied on for display). `chat-danger-classification` handler now passes the full classification result plus the active threshold through to the writer.

Files: `lib/services/concierge-notifications/writer.ts`, `lib/services/dangerous-content/gatekeeper.service.ts`, `lib/background-jobs/handlers/chat-danger-classification.ts`, `help/dangerous-content.md`, and new specifics-rendering tests in `__tests__/unit/lib/services/staff-opaque-voicing.test.ts`.

#### Change: Prospero's connection-profile-change announcement is terser

The synthetic message Prospero posts when a character is reassigned to a different connection profile now reads `Amy's current response model is now ChatGPT 5.5 Low Verb; previous model was Kimi-K2 Thinking.` instead of the older `Prospero notes that Amy has been reassigned to ChatGPT 5.5 Low Verb (previously Kimi-K2 Thinking).` Both the visible message and the opaque LLM-context body use the same wording (the opaque body previously diverged). Null fallback (no profile assigned) now reads `unassigned` rather than `no connection profile`. `lib/services/prospero-notifications/writer.ts` + matching test in `staff-opaque-voicing.test.ts`.

#### Fix: OOC text in pre-rendered messages no longer leaks `"qt-chat-ooc">` as visible text

A user-visible bug of long standing: a message like `((some comment))` in a chat using the Standard rendering patterns would render with the literal text `"qt-chat-ooc">((some comment))` and lose its OOC styling. `applyRoleplayPatterns` in `lib/services/markdown-renderer.service.ts` (the server-side path that writes `chat_messages.renderedHtml`) ran each pattern's `string.replace` sequentially, so the dialogue pattern (`"..."` ) matched the just-inserted `"qt-chat-ooc"` attribute value inside the OOC span and wrapped it, producing `<p><span class=<span class="qt-chat-dialogue">"qt-chat-ooc"</span>>((..))</span></p>`. The browser then parsed the outer span as `<span class=` followed by stray text. The client-side `MessageContent.tsx` already used the correct single-pass earliest-match algorithm (`processRoleplayText`); the server path now mirrors it. Already-stored bad `renderedHtml` values will only correct themselves when the message is re-rendered (e.g. edited, regenerated, or imported again).

#### Fix: Characters using non-native (`simple-json`) tool calls now respond to results and can chain calls

When a model without native function-calling (e.g. `moonshotai/kimi-k2-thinking` via OpenRouter) emitted a `<tool_call>{...}</tool_call>` block, the system ran the tool but the character produced no follow-up: the continuation request to the model came back with empty content. Two design problems in `lib/services/chat-message/text-tool-loop.service.ts` combined to cause this:

1. The `<tool_call>` block was stripped from the prior assistant turn before the continuation was re-sent, so the model could not see that *it* had asked for the tool. The model only saw its own preamble prose followed by a synthetic user message carrying a `<tool_result>` — a broken causal chain. Thinking models would burn 300+ reasoning tokens and emit nothing.
2. The pass ran exactly once. Native function-calling loops up to 5 turns (`native-tool-loop.service.ts:104`); this pass did not, so even if the character had responded, it could not chain a second tool call.

`runTextToolPass` is now a `while`-loop capped at `MAX_TEXT_TOOL_ITERATIONS = 5` (mirrors the native loop). Each iteration's continuation slate carries the un-stripped assistant turn, restoring the causal chain. Duplicate-call detection mirrors the help-chat orchestrator (`help-chat/orchestrator.service.ts:335`): JSON-stringified `{name, arguments}` signatures are tracked per pass, and the third identical call is refused with a synthetic user nudge ("you've already called this with the same arguments — respond now, in character") plus one final response stream. Final `streaming.fullResponse` is each iteration's raw response stripped of markers and joined.

Test fixture for `text-tool-loop.service.test.ts` gained a FIFO chunk queue so multi-call passes can yield different content per call; three new tests cover multi-iteration accumulation, dedupe nudge, and the iteration cap. All existing tests updated for the un-stripped-assistant-turn expectation.

#### Fix: Anthropic Sonnet 4.6 no longer 400s when a chat tail is all Staff whispers

Sibling fix to the WebP-mimetype one: any chat where a character's response fails and synthetic whispers (Lantern, Host, Prospero, Librarian, Commonplace Book) accumulate at the tail produced `400 invalid_request_error: This model does not support assistant message prefill. The conversation must end with a user message.` on the next turn. The whispers are stored as `role: ASSISTANT` because that's how the Salon UI groups them, but for the LLM they are external annotations to the character — not the character's own speech.

Two places were leaking assistant-role whispers into the LLM tail:

1. **Historical whispers in chat history.** `buildMessageContext` in `lib/services/chat-message/context-builder.service.ts` now re-roles `systemSender` messages to `USER` when building the LLM-bound message list. The opaque-anywhere body swap (persona body → `opaqueContent` in opaque mode) rides on the same map; both modes get the role flip. Exception: whispers carrying attachments (Lantern image generations, Librarian-attach announcements) keep `role: ASSISTANT` so `collectLanternImageFileIdsForCharacter`, which discriminates Lantern-published images structurally as "assistant + attachments," still picks them up. The whispers that needed flipping (host, prospero, librarian-no-attach, commonplace) have no attachments, so this carve-out is naturally safe.

2. **In-line whispers injected at the very end of context-build.** `lib/chat/context-manager.ts` was pushing two whisper kinds straight into the final `contextMessages` array *after* the selected-messages loop ran, with `role: 'assistant'` hard-coded: the off-scene character introduction (a Host announcement when a workspace character is name-dropped for the first time) and the auto-prepend timestamp whisper. In non-continue mode this got buried by the trailing user message at line 1576; in continue/nudge mode there's no user message and these whisper pushes formed the tail. Both pushes are now `role: 'user'` for the same reason as (1) — they're Host voices, not character speech.

Conceptually correct and provider-agnostic: every provider sees the Staff as external input rather than as the character's voice. The Lantern walker (`filteredExistingMessages` consumer) and the `hasPriorResponse` participantId check are unaffected; both key off signals untouched by the flip. All existing context-builder, librarian, host-notification, summary-fold, turn-transcript, and courier-transport tests pass without modification.

#### Fix: Chat attachments no longer 400 with "media_type X but bytes are Y"

The Scriptorium storage bridges (`writeProjectFileToMountStore`, `writeUserUploadToMountStore`, `writeLanternBackgroundToMountStore`, `writeCharacterAvatarToVault`) transcode bitmap uploads to WebP via `transcodeToWebP` before persisting. Each bridge returns the post-transcode `storedMimeType`, `sizeBytes`, and `sha256`, but every caller (`FileStorageManager.uploadFile`, `uploadFileToProject` in `chat-files-v2.ts`, the character-avatar and story-background job handlers, `image-generation-handler`, `images-v2`, `app/api/v1/images`, `app/api/v1/wardrobe/preview-avatar`, `app/api/v1/files/shared.ts`, and `restore-service`) discarded those return values and stamped the new `files` row with the *input* `mimeType` and `buffer.length` instead. The resulting `FileEntry` lied about what was on disk: stored bytes were WebP, the row said `image/jpeg` (or whatever the user uploaded).

The visible symptom was Anthropic rejecting any attachment whose underlying blob was transcoded: `messages.N.content.M.image.source.base64: The image was specified using the image/jpeg media type, but the image appears to be a image/webp image`. HTTP `Content-Type` headers on `/api/v1/files/[id]?action=download` and `/api/v1/files/proxy/[...key]` were similarly wrong (browsers sniff and recover, so this was silent).

`UploadResult` in `lib/file-storage/manager.ts` now exposes `storedMimeType`, `sizeBytes`, and `sha256` alongside `storageKey`. All eight callers were updated to use the post-bridge values when building the `FileEntry`. `sha256` on the FileEntry is still the input-bytes hash — upload-time deduplication (`findBySha256`) runs before the transcode, so swapping it would silently break dedup of same-source re-uploads. The mismatch between `files.sha256` (input bytes) and `doc_mount_blobs.sha256` (stored bytes) is by design.

Repair migration `repair-files-mime-and-size-from-mount-blob-v1` walks every `files` row whose `storageKey` starts with `mount-blob:`, joins to `doc_mount_blobs` on the blob id encoded in the key, and rewrites `mimeType` / `size` when they disagree with the blob's `storedMimeType` / `sizeBytes`. `sha256` is left alone. Idempotent; orphaned mount-blob keys (no matching blob) are logged and skipped rather than aborting. Depends on `relink-files-to-mount-blobs-v1`.

#### Feature: Z.AI (GLM) provider plugin bundled with Quilltap

`plugins/dist/qtap-plugin-z-ai/` now ships in-tree (previously a separately-published `@quilltap/qtap-plugin-z-ai` package). Source moved verbatim; `package.json`, `manifest.json`, and `esbuild.config.mjs` were rewritten to match the other bundled provider plugins (unscoped name, `Foundry-9 LLC` author, plain `dependencies` instead of peer-deps, `index.js` at plugin root). Version bumped 1.1.3 → 1.1.4 to mark the move. No app-side registration changes — the build-plugins script discovers it automatically via `manifest.json` with `typescript: true`.

Provides GLM-4.6, GLM-4.5 family, GLM-4.6V / GLM-4.5V vision, tool/function calling, Z.AI's native `web_search` tool, and CogView-4 / GLM-Image image generation. Endpoint: `https://api.z.ai/api/paas/v4`.

#### Fix: Lantern story-background prompts no longer re-append portraits for participants

`appendMissingCharacterEnumerations` in `lib/background-jobs/handlers/story-background.ts` was scanning the full user-workspace character list and appending canonical `Name: A woman. <description>` entries for every participant whose name appeared in the crafted prompt without a `Name:` enumeration. Since the crafter LLM normally weaves participants into the scene inline ("On the left, Friday, a woman with strawberry-blonde…") rather than as `Friday: …` enumerations, the safety net was firing on every participant, dumping portrait-style side cards after the integrated scene. Image providers rendered the result as a divided triptych of head-shot tiles instead of a unified scene.

The fallback's original purpose (`c8df7d58`) was non-participant characters who get name-dropped via scene context or SceneState actions but were never handed to the crafter. The call site now filters `userCharacters` down to non-participants using `payload.characterIds` before invoking the helper — participants already had their descriptions woven in by the crafter, so they don't need a fallback portrait append. Non-participants still get the safety-net enumeration so the image provider doesn't invent appearances for them.

#### Fix: CLI no longer breaks node-pty's spawn-helper executable bit on macOS

`packages/quilltap/bin/quilltap.js` was unconditionally replacing the standalone tarball's bundled `node_modules/node-pty` with a symlink to the npm-installed copy under `/usr/local/lib/node_modules/quilltap/node_modules/node-pty`. On macOS, `sudo npm install -g quilltap` extracts that copy with the executable bit stripped off `prebuilds/<platform>/spawn-helper` (a known npm-as-root tar-extraction wart). The CLI tried to restore the bit with `chmodSync(helper, 0o755)`, but the file is owned by root and the CLI runs as a non-root user — the chmod returned `EPERM` and was swallowed by a silent `try {} catch {}`. Result: terminal spawns failed with `posix_spawnp failed` at runtime, with no actionable hint.

`linkNativeModules()` now checks whether the standalone dir already has a real (non-symlink) `node-pty` directory with a `prebuilds/<platform>-<arch>/` subdirectory for the current platform. If yes — which is the case on macOS and Windows, where the tarball ships working prebuilds — the symlink step is skipped entirely and the tarball's correct copy survives. Linux (no node-pty prebuild) and pre-existing broken-symlink states still fall through to the symlink + chmod path. The chmod failure case now logs a clear warning with the exact `sudo chmod 755 …` command instead of failing silently.

#### Fix: Lantern story-background prompts no longer dump full wardrobe prose

The Lantern's image-prompt pipeline was leaking wardrobe items' human-prose `description` fields straight into image-generation prompts, producing multi-thousand-character prompts full of markdown bullets and style commentary ("Good for moving between Lodge, office, balcony…", "She's not hiding those hands"). Three independent leak paths fixed:

1. `lib/wardrobe/outfit-description.ts:decorateOutfitItems` gained a `titleOnly` option. Image-gen-adjacent callers (`lib/wardrobe/avatar-prompt.ts`, `lib/background-jobs/handlers/scene-state-tracking.ts`) now pass `titleOnly: true`. The two inline `valuesFor` builders in `lib/image-gen/appearance-resolution.ts` and `lib/memory/cheap-llm-tasks/image-scene-tasks.ts:resolveAppearance` were collapsed to titles-only the same way. Chat-context formatting (which is rendered to a model that can use the prose) is untouched.

2. `APPEARANCE_RESOLUTION_PROMPT` was sharpened: `clothingDescription` is now capped at 200 chars of plain prose with explicit no-markdown / no-parenthetical-asides / no-commentary rules, and the equipped-wardrobe section is no longer labeled "Current Outfit … takes precedence", which a cheap LLM was reading as the "narrative → use verbatim" branch and echoing the entire input back.

3. `appendMissingCharacterEnumerations` in `lib/background-jobs/handlers/story-background.ts` (introduced by the c8df7d58 missing-enumeration fix) was injecting the *resolved* participant description — which carried the bloated wardrobe text — back into the prompt for any character whose name appeared without a `Name:` enumeration. It now always uses the compact `buildBasicEnumeration` form (gender prefix + mediumPrompt/shortPrompt); the `resolvedDescriptionsByCharacterId` parameter was dropped.

Two test expectations in `__tests__/unit/image-gen/appearance-resolution.test.ts` updated to assert the new title-only fallback output.

#### Docs: tool plugin development guide reflects the Zod-source-of-truth convention

`docs/developer/TOOL_PLUGIN_DEVELOPMENT.md` rewrote the calculator example to declare a Zod input schema, derive the OpenAI-shape `parameters` JSON via a small `zodToOpenAISchema` helper (Zod 4's native `z.toJSONSchema()` with `target: 'draft-7'`, plus a strip of `$schema`/`$id`/`definitions`/`$defs`), and have `validateCalculatorInput` delegate to `safeParse`. Added a section on `.refine()` for trim-non-empty / allowlists / cross-field constraints that JSON Schema cannot express alone. Best-practice and troubleshooting bullets updated to point at the Zod schema when input validation fails. Provider plugin docs unchanged — provider plugins consume tool definitions rather than define them.

#### Refactor: Zod schemas as the single source of truth for all 49 tool definitions

Every tool definition in `lib/tools/*-tool.ts` now declares a Zod input schema (`xxxToolInputSchema`) as the canonical contract. The OpenAI-shape `parameters` JSON Schema served to native function-calling providers is derived from that schema via a new helper `lib/tools/zod-to-openai-schema.ts` (built on Zod 4's native `z.toJSONSchema()`), and every `validateXxxInput` function is now a one-line delegate to `schema.safeParse(input).success`. Closes the long-standing gap where the JSON Schema and the runtime validator could quietly drift apart.

The conversion exposed and fixed several real drift cases that had been masked: `web_search`'s validator silently coerced string `maxResults` via `Number()` and ignored its own documented `maxLength: 500` on `query` — Zod enforces both correctly now. `whisper` rejected empty strings; the JSON Schema didn't say so; the Zod schema does now (`.min(1)`). `help_navigate`'s allowlist of permitted route prefixes lived only in the validator, never in the JSON Schema sent to the LLM — it's now a Zod `.refine()` so both surfaces see the same rule. `wardrobe_create_item`'s cross-field "either types or components must be supplied" check moved into a Zod object-level `.refine()`.

Two web-search tests that previously documented the discrepancy ("should accept maxResults as string number — converts via Number()" and "should accept query exceeding max length — no length validation in runtime") were rewritten to assert the new strict behavior. The whole point of this refactor is that the JSON Schema and the validator are now the same thing.

Snapshot test added at `lib/tools/__tests__/tool-definitions-snapshot.test.ts` captures the derived `parameters` JSON for all 49 tools so future Zod-side edits surface as snapshot diffs in review. Removed the now-unused `zod-to-json-schema` package — Zod 4 has native JSON Schema emission and `zod-to-json-schema@3.25` does not support Zod 4 schemas anyway.

Naming convention also standardized: every tool file exports `xxxToolDefinition` as the canonical name. The previously-mixed naming (some files used `xxxTool`, others `xxxToolDefinition`) has been reconciled — `lib/tools/index.ts` still re-exports both for back-compat where consumers expected the short name.

#### Feature: Simple JSON pseudo-tool surface for models without native function calling

Replaced the legacy `[[TOOL ...]]content[[/TOOL]]` text-block pseudo-tool format with a smaller, more robustly-parsed `<tool_call>{...}</tool_call>` JSON-in-XML surface. The new format is designed around three principles: a familiar syntax (JSON inside an XML tag), exactly one tool call per turn, and a hard provider stop sequence (`</tool_call>`) so the model can't emit a valid call and then keep narrating fake results.

New modules: `lib/tools/simple-json-parser.ts` (three-tier lenient parser — strict `JSON.parse`, `jsonrepair`, then a balanced-brace walker that recovers when the closing tag is dropped entirely; alias tags `<toolcall>`, `<tool>`, `<call>`, `<function_call>` are accepted) and `lib/tools/simple-json-prompt.ts` (uniform `(name: type)` signatures derived from each tool's existing OpenAI-shape `parameters` JSON Schema, replacing 15 hand-written prompt blurbs).

Strategy wiring: `TextToolStrategy` in `lib/services/chat-message/text-tool-loop.service.ts` gains `formatToolResult(toolName, content)` and an optional `stopSequences?: string[]`. The inline `[Tool Result: ...]` template that the loop hard-coded is now strategy-scoped — simple-json frames results as `<tool_result name="...">...</tool_result>`, while the legacy text-block and provider-text-markers strategies keep the existing template. Orchestrator picks the strategy from a new `resolveToolMode()` helper in `lib/tools/pseudo-tool-support.ts` and injects `stop: ['</tool_call>']` into both the initial primary stream and the continuation re-stream when simple-json is active.

Provider stop-sequence plumbing: `StreamOptions.stop?: string[]` flows through to each provider adapter. OpenAI's Responses API, Anthropic (`stop_sequences`, capped at 4), Ollama's streamMessage path, OpenRouter's chat-completions + SDK paths, and the shared `OpenAICompatibleProvider.streamMessage` all honour it now. Google and Grok already did. Each touched plugin bumps its patch version; `packages/plugin-utils` goes 2.2.8 → 2.2.9 and must be republished before the next plugin release.

Profile schema: new `pseudoToolMode` column on `connection_profiles` (enum: `auto` | `native` | `simple-json` | `text-block`, default `auto`). Migration `add-pseudo-tool-mode-field-v1` ALTER-adds the column and backfills existing rows to `'auto'`. The "Tool format" selector now lives in the connection-profile editor (`components/settings/connection-profiles/ProfileModal.tsx`, conditional on `allowToolUse`). Default `auto` resolves to native on capable models and simple-json on everything else (the spec's Phase 5 flip); the legacy text-block surface remains selectable for compatibility while users migrate.

Forcing `pseudoToolMode = 'native'` on a model that genuinely can't do native function calling now falls back to simple-json (graceful degradation) rather than shipping a broken native request. The pseudo-tool.service test that asserted the old behavior was updated accordingly.

Legacy modules moved: `lib/tools/text-block-parser.ts` and `text-block-prompt.ts` (plus their tests) now live in `lib/tools/legacy/`. Public re-exports through `lib/tools/index.ts` keep behavior identical for all consumers; only direct relative-path importers (`whisper-handler.ts` and one mock) were updated.

Help: `help/connection-profiles.md` gained a "Tool Format" section in the project's steampunk-Wodehouse voice, explaining each setting and why simple-json is the modern default. The help message-pack index needs rebuilding before release.

Tests: 55 unit tests covering the parser (three tiers, alias tags, jsonrepair recovery, balanced-brace fallback, failure modes) and the prompt builder (signature rendering for primitive/enum/array/oneOf/zero-param shapes, instruction structure); 3 new integration tests in `text-tool-loop.service.test.ts` covering the strategy's `formatToolResult` indirection and `stopSequences` passthrough. All 805 existing service/repo tests still green.

The Zod refactor of tool definitions called for by the implementation plan is deferred to a follow-up commit so this diff stays reviewable. `describeToolSignature` walks the existing OpenAI-shape `parameters` JSON, so the simple-json feature works fully without the refactor.

#### Fix: CI test suites couldn't resolve the SQLCipher driver

Four test suites (`__tests__/unit/packages/quilltap/{memories-commands,db-backup,graph-integrity}.test.js` and `__tests__/unit/lib/database/migration/repair-dangling-related-memory-edges-v1.test.ts`) failed in GitHub Actions with `Cannot find module 'better-sqlite3-multiple-ciphers'`. Their `loadDriver()` helpers tried `packages/quilltap/node_modules/better-sqlite3-multiple-ciphers` first and fell back to the bare `better-sqlite3-multiple-ciphers` require. Locally the first path resolves because `packages/quilltap/` carries its own `node_modules/`, but in CI only the root `npm ci` runs, and the root `package.json` declares the dep as `"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@..."` — npm installs that under the alias name, so neither candidate resolves. Added a third fallback that requires `better-sqlite3` (the alias the runtime already uses) and documented the resolution rule in CLAUDE.md so future tests pick the right import path from the start.

The third fallback then failed differently — `TypeError: Database is not a constructor` — because `jest.config.ts`'s `moduleNameMapper` redirects `^better-sqlite3$` to a manual mock at `__mocks__/better-sqlite3.ts` whose `MockDatabase` is exported via `export default`. `require('better-sqlite3')` therefore returned `{ default: MockDatabase }`, not a constructor. Reworked the third fallback in all four `loadDriver()` helpers to require by absolute filesystem path (`<root>/node_modules/better-sqlite3`); moduleNameMapper only matches bare specifiers, so the absolute path bypasses the mock and loads the real native binding for these tests, which is what they need.

One more failure remained: `__tests__/unit/packages/quilltap/db-backup.test.js` → `cmdBackup round trip`. The test's own loadDriver was now fine, but `cmdBackup` reaches into the production CLI's `packages/quilltap/lib/db-helpers.js → openEncryptedDb`, which does `require('better-sqlite3-multiple-ciphers')` then falls back to `require('better-sqlite3')`. In CI the first fails (alias install), the second hit jest's moduleNameMapper and got the same `{ default: MockDatabase }` non-constructor — so the opener threw, `backupOneDb` caught it, returned `ok: false`, the snapshot file was never written, and the test's `expect(fs.existsSync(snapPath)).toBe(true)` failed. Production code shouldn't need to know about jest mocks, so the fix went into the mock: append `module.exports = MockDatabase` (mirroring the real driver's CJS shape) plus a re-attached `.default` so existing `import Database from 'better-sqlite3'` callers keep working via esModuleInterop.

### 4.5.1

#### Fix: story-background prompt missed enumerating non-participant characters

When the cheap LLM that crafts the Lantern's story-background image prompt placed characters into the scene by name (e.g. "Ariadne sits reading…, Amy nearby listening…"), only the chat's current participants got a follow-on `Name: <appearance>` enumeration. Characters named via the chat title, the derived scene context, or SceneState character actions were mentioned but never described, so the image provider invented appearances for them. Added a post-processing pass in `lib/background-jobs/handlers/story-background.ts` that loads the user's workspace characters, scans `finalPrompt` for any whose name appears but lacks a `Name:` enumeration entry, and appends a canonical enumeration built from their pronouns and primary `physicalDescription`. Participants reuse their already-resolved enumeration (with equipped wardrobe) via a `characterId → description` map; non-participants fall back to defaults. Longer names are processed first to prevent `"Catherine"` from displacing `"Lady Catherine"`. Failures are caught and logged at `warn`; additions are logged at `info` with the list of names added.

#### Fix: shell completion coverage gaps

The bash/zsh/fish completion templates were missing the `logs` and `migrations` top-level subcommands, the `instances default` and `instances rename` verbs, and the global `--passphrase` flag. The bash template's per-subcommand flag lists were also stale relative to the actual parsers in `db-commands.js`, `docs-commands.js`, and `memories-commands.js`. Rewrote all three templates (`packages/quilltap/lib/completion/{bash,zsh,fish}.template`) to enumerate the full surface — every verb, every documented flag, value-list completion for `--source` (AUTO/MANUAL), `--stream` (combined/error/stdout/stderr/startup), `--field` (request/response/both), `--sort`, `--type`. Bash now also two-level dispatches on sub-verbs (e.g. `themes registry` exposes `add/remove/refresh/keygen/sign`), and instances-targeting verbs (`show`, `remove`, `rename`, `default`, `set-passphrase`) tab-complete registered instance names. Bash smoke-tested with nine scenarios covering all new verbs and flag-value completions; zsh syntax-checked with `zsh -n`. Users who already saved a completion script need to regenerate it.
