# Refactor — The Green Room, casting, and the opening

**Status:** Implemented and verified live on V4test 2026-11-09 (4.13-dev), all six phases in one change — see §10 for what landed and where it departed. Proposed the same day; the §9 questions were answered then, so every decision in §5 is settled. Written to be run by an implementing model: §5 holds the decisions, which are settled; the mechanics under each phase in §6 are the implementer's to work out. Where the code contradicts a decision in §5, stop and report rather than improvise around it.

**Scope:** everything between the operator choosing to start a chat and the first character speaking in the Salon. Server: `app/api/v1/chats/route.ts` (`handleCreate` and its helpers), `lib/chat/initialize.ts`, `lib/chat/initial-greeting.ts`, `lib/chat/first-message-context.ts`, `lib/chat/creation-progress.ts`, `app/api/v1/chats/creation-progress/route.ts`, `lib/wardrobe/apply-outfit-selections.ts` and `lib/inventory/apply-defaults.ts` (their call sites, not their algorithms), `lib/wardrobe/green-room-model.ts`, `lib/inventory/green-room.ts`, the arrival halves of `app/api/v1/chats/[id]/actions/participants.ts` and `lib/chat/apply-chat-merge.ts`. Client: `components/new-chat/**`, `components/providers/new-chat-provider.tsx`, `components/providers/creation-progress-provider.tsx`, `app/salon/new/*`, the New Chat modal mounts in `app/salon/[id]/SalonView.tsx`, `app/aurora/[id]/CharacterPage.tsx` and `components/homepage/CharacterCard.tsx`, and a new Green Room panel in the Salon. The outfit and inventory *choosers* (`chooseLLMOutfit`, `chooseArrivalInventory`, slot-ops, recent openings, the roster gate) move with their callers and are not redesigned.

**Related:** [refactor-4-12-salon-stream-frames.md](../refactor-4-12-salon-stream-frames.md) (the `StreamFrame` union this spec extends), [complete/concierge-default-at-creation.md](concierge-default-at-creation.md) and [complete/concierge-overhaul-phase-3-three-states.md](concierge-overhaul-phase-3-three-states.md) (the Concierge's place in the opening order, which this spec keeps), [complete/inventory.md](inventory.md) §"Packing in the Green Room", [complete/wardrobe-refactor.md](wardrobe-refactor.md), [complete/tanstack-query-migration.md](tanstack-query-migration.md) (the client rule the New Chat hook predates), [complete/tabbed-workspace.md](tabbed-workspace.md) (why creation must not route), [complete/refactor-character-repository-and-vault.md](refactor-character-repository-and-vault.md) (the sibling spec; same style of chokepoint), bugs 141, 158, 171, 262, 263.

---

## 1. The problem

A chat is born in one HTTP request that does a dozen unrelated things in a fixed order, three of them LLM calls, behind a dialog the operator cannot dismiss. The first words the character speaks are composed by a prompt builder the chat never uses again. The same arrival sequence is spelled three times. The client mirrors the server's default rules so it can show them, then sends the server a request shaped to be "byte-identical" to what it would have done anyway. All of it is verified in the code at the lines cited; none of it is speculation.

### 1.1 One request, fourteen jobs

`handleCreate` (`app/api/v1/chats/route.ts:1196-1568`) runs, in order: parse (`createChatSchema`, 97 lines, 105-201) → continuation ownership check → autonomous preconditions → `buildAllParticipants` (234-357, which also draws the opening speaker) → primary character read → `resolveScenarioSelection` → opener subprompts → `buildChatContext` (the legacy prompt, §1.2) → chat settings → `resolveProjectDefaults` → timestamp, image-profile and roleplay-template precedence → `repos.chats.create` (1336) → outfit selections in two branches (1395-1447) → `applyInventoryDefaults` (1452) → `compileAllIdentityStacks` (1473) → the SYSTEM row (`writeSystemPromptMessage`) → the Concierge flip → continuation backfill → `createInitialMessagesScenarioAndStaff` (481-671: Prospero context, per-seat group whispers, Host scenario, Host user-character, Host adds, Aurora opening outfits with avatar refresh, then the greeting) → autonomous auto-start (1545) → `progress.finish()`.

Three flavours — a fresh Salon chat, a continuation, an autonomous room — are interleaved by `if` through the whole sequence (`isAutonomous` at 1201, 1235, 1352, 1498, 1545; `isContinuation` at 1497, 1511, 1533). The route file is 1,671 lines; `handleCreate` plus its private helpers are about 1,000 of them. Churn: 38 commits touch the file, 29 of them since May 2026, each feature (Inventory, wear ledger, scenarios-from-anywhere, Concierge at creation, LLM Inspector, the Green Room's inventory pass) adding a stanza. The six route tests under `__tests__/unit/app/api/v1/chats/route.*.test.ts` each mock 19-20 modules to get `handleCreate` to traverse — the coupling made measurable.

### 1.2 The greeting is composed under a prompt the chat never uses again

`buildChatContext` (`lib/chat/initialize.ts:60-140`) builds the greeting's system prompt with a private `buildSystemPrompt` (160-290): the character's prompt, subprompts, a forced progressions report, "You are roleplaying as", description, manifesto, personality, the user character, the scenario, example dialogue, and "Stay in character at all times." That is not the prompt every later turn uses. The Salon's turn runs `buildIdentityStack` (`lib/chat/context/system-prompt-builder.ts:176`, versioned, cached per seat in `compiledIdentityStacks`) inside `buildContext`'s phases (`lib/chat/context/turn-*.ts`): roleplay template, timestamp, tool instructions, physical description, clothing, multi-character context, silent mode, the Core whisper, the recall pipeline, Informs, progressions as a trailing section, the Inventory section. The greeting gets none of that except what `autoGenerateFirstMessage` (683-1058) hand-appends: a trailing Inventory section (776-781) and two private recall copies — `buildFirstMessageContext` (`lib/chat/first-message-context.ts`, participant memories by a "recent + participant" search that stamps `lastAccessedAt` itself at line 228, outside `deliverRecall`) and `buildRecentConversationsBlock`, which is the recap pool `assembleRecall` already runs for "first message of a new chat" (`lib/memory/recall/recap.ts:13-16`).

The greeting also has its own provider ladder: four rungs plus two Concierge-desk attempts (`autoGenerateFirstMessage` 808-1057: full context → without memories → uncensored desk on a content filter → a plain retry after a second's sleep), with the desk's permission re-derived by hand from `resolveConciergeSettings`. The Salon turn does the same through `provider-failover.service.ts` and the `lib/llm/fallback` engine. CLAUDE.md: *provider fallback is the engine's to build, not a call site's.* And the greeting is not streamed: `generateGreetingMessage` concatenates the chunks server-side (`initial-greeting.ts:184-186`, "streaming them to the UI is a planned follow-up (see CHANGELOG v2.9.x)") and the Salon learns of it only when the create response arrives and the page loads.

The first row of every chat is a SYSTEM message carrying that legacy prompt (`writeSystemPromptMessage`, 364-378). Every reader filters it out: the message count (`chats-messages.ops.ts:250`), the SillyTavern export (`lib/sillytavern/chat.ts:145,164`), the Markdown export, the gallery, the danger classifier, the Salon's own transcript reconcile (`app/salon/[id]/hooks/transcript-reconcile.ts:243`). Nothing reads its content. It is a fossil that records a prompt the chat did not use.

### 1.3 The opening speaker is drawn twice

`buildAllParticipants` picks the greeting's speaker with `pickWeightedRandom` over talkativeness (`route.ts:338`). The turn manager has its own draw (`lib/chat/turn-manager/selection.ts`, `resolveCycleOrder` the only writer of `cycleOrderParticipantIds`). The greeting's speaker is not recorded as having spoken: the row's `lastTurnParticipantId` / `spokenThisCycleParticipantIds` are untouched by the greeting (verify: the finalizer writes them at `message-finalizer.service.ts:663,829`; the greeting never passes through it), so the first real turn's rotation starts as if nobody had.

### 1.4 Arrival is spelled three times

Dressing a seat, packing its pockets, compiling its identity stack, announcing it and refreshing its avatar happens at chat start (`route.ts:1395-1535`), when a seat is added or reactivated (`participants.ts`, `applyOutfitForAddedParticipant` ~190-250 and `refreshAvatarForArrivingCharacter`), and in a merge (`apply-chat-merge.ts:240-275`). The three differ:

| | chat start | add-participant | merge |
|---|---|---|---|
| default outfit mode when the client sends none | `default` for everyone (1428-1446) | `default` | `previous_chat` |
| Green Room narration | yes (`progress`) | **none** — no emitter is passed | none |
| opening-outfit whisper (Aurora) | every seat (580-625) | no | no |
| avatar refresh | inside the whisper loop | `refreshAvatarForArrivingCharacter` | not here |
| identity stack | all seats, after inventory | one seat, after Host add | one seat, before outfit |
| order | outfit → inventory → stacks → Host add → outfit whisper | Host add → stack → outfit → inventory → avatar | Host add → stack → outfit → inventory |

The client decides that an LLM-controlled character with `canChooseOutfit` opens in `llm_choose` (`components/wardrobe/outfit-selector.tsx:90-96`, `computeSyncInitialMode`); the server, when `outfitSelections` is omitted, dresses everyone in `default`. An API client, the CLI, or any future launcher that does not send the array gets a different chat than the dialog would have made.

### 1.5 The Green Room is a side-channel to a request that should not block

The dialog (`ChatCreationProgressModal`) is non-dismissable while the POST runs; the POST is the "ready" signal (`creation-progress-provider.tsx:12-16`). Progress travels on a client-minted `progressId` through the operation-progress bus and a dedicated SSE route (`/api/v1/chats/creation-progress`), a provider mounted outside the New Chat provider so the dialog outlives the modal (`WorkspaceProviders.tsx:37-52`). The chat row exists from line 1336 on; the operator is kept out of it for the outfit passes (≤ 60 s each, concurrent), the inventory pass (≤ 60 s), the identity stacks, the staff posts, and the greeting (≤ 90 s to first chunk, 60 s idle). Bug 141 bounded the wedge; the wait is still the whole of creation, and a Stop button does not exist because the operation is not a turn. The Salon already has a per-chat stream, a turn-control handle (`lib/chat/turn-control.ts`: `runWithTurnControl`, `waitForEarlierTurns`, `stopActiveTurns`) and a tagged frame protocol (`lib/chat/stream-frames.ts`); the Green Room uses none of them.

### 1.6 The client mirrors the server, then second-guesses it

`useNewChat` (`components/new-chat/hooks/useNewChat.ts`, 1,006 lines) fires seven to twelve raw `fetch` calls in one `Promise.all` (270-300) and hand-parses each (`data.profiles || []`, `Array.isArray(data) ? data : data.profiles || []`), against the TanStack Query rule in CLAUDE.md and the `queryKeys` factory. It then reproduces server precedence so the form can show a default: scenario (character > project > general, `scenario-seed.ts`), roleplay template (project > user), the Concierge's `newChatsStartAs`, the timestamp config, and (in `outfit-selector.tsx`) the outfit mode. Three `touched` flags guard the seeds. The submit (780-935) assembles the body with conditionals whose comments say "so a plain create stays byte-identical" — the client is shaping its request around what it believes the server would default to, which is the definition of a rule living in two places. The title is computed client-side (`generateTitle`) and the server has a different fallback (`Chat with ${name}`, 1339).

`NewChatForm` (919 lines) takes 25 props. It is mounted from five places — `NewChatProvider` (the workspace), `NewChatPageClient` (`/salon/new`), `SalonView` (Continue Elsewhere), `CharacterPage` and `CharacterCard` (each with its own `<NewChatModal>`) — and each mount threads the whole prop set from `useNewChat`. The continuation modal fetches `?action=outfit-summary` on its own (`NewChatModal.tsx:85-100`).

### 1.7 Defects at the seams (verified; not yet filed)

1. **A seat added mid-chat with "Dress Themselves" is dressed in silence.** `applyOutfitForAddedParticipant` passes no progress emitter, so the operator who chose `llm_choose` on the Add Participant dialog waits up to 60 s with no indication, and the outfit never appears anywhere until the next Aurora whisper. (§1.4.)
2. **Omitting `outfitSelections` produces a different chat than the dialog would.** The `canChooseOutfit` default is client-only. (§1.4.)
3. **The greeting's recall stamps `lastAccessedAt` outside `deliverRecall`.** CLAUDE.md names delivery as the one writer. Harmless today, but a second door.
4. **The participant-level `imageProfileId` is documented "ignored" and consulted.** `createParticipantSchema` says "Legacy: kept for backwards compatibility but ignored" (99); `buildAllParticipants` collects `firstImageProfileId` (316) and the precedence at 1292 falls back to it.

## 2. Goal

- **Casting is fast and transactional.** `POST /api/v1/chats` validates, resolves every default on the server, creates the row and the seats, writes what a continuation needs, applies the Concierge state, and returns. No LLM is called before the response.
- **The opening is a narrated, stoppable, resumable turn.** Dressing, packing, announcing and the greeting run as one operation under the chat's turn-control handle, narrated into the Salon over the chat's own stream with `StreamFrame`s, and the greeting is a real turn: the Salon's prompt, recall, Informs, fallback engine, Concierge routing, finalizer, title check and Lantern cue, streamed live. Stop stops it; a send waits for it; a closed tab resumes it.
- **One arrival.** Chat start, add-participant and merge call one `seatArrival` with one default rule and one order, and every arriving seat is announced and drawn the way an opener is.
- **The client sends intent.** The form shows the defaults the server states and sends only what the operator changed, through TanStack Query, from one mount.
- **Everything the greeting had privately is deleted:** the legacy prompt builder, the recall copies, the provider ladder, the SYSTEM fossil, the speaker draw, the progress bus's chat-creation face and its SSE route.

## 3. Non-goals — examined and deliberately left alone

- **The outfit and inventory algorithms.** `chooseLLMOutfit`, `dropOverlappingEnsembles`, `dissolveCompositesInSlots`, `spreadAcrossCoveredSlots`, pronoun guidance, recent openings, `chooseArrivalInventory`, the roster gate, the Green Room model selection and timeout. They move under the opening module unchanged. Tuning them is another spec.
- **The turn pipeline.** `processMessage`, `buildContext`, the finalizer, `recordOperatorPost`. This spec *uses* them for the greeting and adds one `purpose: 'opening'`; it does not restructure them. The Salon's SSE transport is out of scope by the standing rule.
- **Import, restore and the help and Brahma chats.** `importMultiCharacterChat`, `importLegacyChat`, `import-entities.ts`, `restore.ts`, `help-chats/route.ts`, `brahma-console/route.ts` create rows directly, several with preserved ids. They do not open a chat and are not touched, except by the optional D12.
- **The Scenario Builder dialog** and the scenario pickers. `resolveScenarioSelection` is already the chokepoint; casting keeps calling it.
- **Autonomous-room running.** `startAutonomousRoomManually` and the cron path are callers of the opening, not part of it.
- **The operation-progress bus itself.** The Almanack keeps it. Only its chat-creation face goes.
- **The Add Participant and Merge dialogs' UI.** They gain narration through the shared arrival; their forms are not redesigned.

## 4. Known state (verified 2026-11-09)

- `createChatSchema` is the wire contract for the New Chat dialog, the Continue Elsewhere modal, and the autonomous-room form; `useNewChat.request-body.test.tsx` pins the body shape.
- Continue mode (`continueMessageSchema`, `orchestrator.service.ts:163-173`) runs a turn with no operator text; with `respondingParticipantId` omitted the participant resolver picks the speaker (461). A nudge posts a Host announcement (494-505). `isContinueMode` skips the Core whisper (`context-builder.service.ts:1241`).
- `assembleRecall` has a recap pool that runs at chat start and on a character's join (`recap.ts:13-16`).
- `StreamFrame` is a Zod union on `kind`; a grep-test forbids a hand-spelt `data: ${` under the turn path.
- The `chats` table has patch-only columns (`conciergeMode` trio, `equippedInventory`, `turnMode`) written by named repository methods (`chats.repository.ts:586-588`).
- `openTurnStream` / `runWithTurnControl` give a stream a Stop and a raised hand; `waitForEarlierTurns` serialises a whisper behind running turns.
- `useWorkspaceNavigate` opens a chat as a tab in place inside the workspace and routes outside it; `NewChatProvider.open` is called by `WorkspaceLinkInterceptor` for `/salon/new` links and by `WorkspaceIntent` for `?open=new-chat`.
- The sibling spec, if it lands first, changes nothing this spec depends on: casting reads characters through `findById` and writes none of their fields.

## 5. Decisions of record

**D1. Casting and the opening are two operations, and the request returns after the first.** `POST /api/v1/chats` becomes `castChat` (`lib/chat/opening/cast.ts`): validate, resolve defaults (D5), resolve the scenario, create the row and seats with `openingState: 'pending'`, apply the requested Concierge state through `applyConciergeFlip`, run the continuation backfill (`applyChatContinuation`, DB only, so the Salon opens with its history), and return `201 { chat }`. Nothing that calls a model runs before the response. The opening (`runOpening`, `lib/chat/opening/run.ts`) is a separate operation on an existing chat: it is started by the Salon when it opens a chat whose `openingState` is not `'done'` (D7), by the autonomous-room start before the first run turn (D6), and by `POST /api/v1/chats/[id]?action=open` for any other caller (the CLI, a script). A chat nobody opens stays `'pending'` and costs nothing until someone does; the list and the detail GET carry the state so the UI can say "not yet opened".

**D2. The greeting is a turn.** The opening's last phase calls `handleSendMessage` in continue mode with a new `purpose: 'opening'` (beside the Storyteller's `purpose`), on the Salon's own stream (D7). The turn pipeline supplies everything the greeting had privately: the identity stack and `buildContext`'s phases, the recall pipeline with its recap pool (the greeting's participant memories and recent conversations are that pool's job), Informs, the Inventory trailing section, progressions, the Core whisper (`'opening'` does **not** skip it the way plain continue does — the Core whisper is exactly what an opener should have), the fallback engine and the Concierge routing (`readCurrentConciergeState` at refusal time), the stall watchdog with the Salon's budgets (the tighter greeting budgets existed because of the undismissable dialog, which is gone), the finalizer (so the speaker is recorded, the title check runs, and the Lantern gets its cue), and memory extraction. The greeting instruction — "the chat is beginning now; open in character, briefly, and invite the operator to engage" — is an ephemeral trailing note under `purpose: 'opening'`, in the register of `turnSkip` / `offerYield`, never in system block 1. The "nothing to add" skip is withheld for this turn as it is for a nudge. A **scripted** first message (`character.firstMessage`, templated with the per-turn template context) is posted by the opening as the opener's ASSISTANT row through the same finalizer path a generated one takes, so the two kinds of opener leave the same state behind; if the finalizer offers no entry for a row that no model produced, the implementer adds a narrow one rather than writing the row by hand. Deleted: `lib/chat/initialize.ts` (its `buildSystemPrompt` and `buildChatContext`), `lib/chat/initial-greeting.ts`, `lib/chat/first-message-context.ts`, `autoGenerateFirstMessage` and its ladder, `generateViaUncensoredDesk`, the greeting's `buildRecentConversationsBlock` call (the recap module keeps the function for its own pool), and `route.greeting-stall.test.ts` (its guarantee is now the turn pipeline's, already tested at `stream-watchdog.test.ts`; a replacement test asserts an opening turn runs under the watchdog). A golden records the opener's first request (system blocks and trailing sections) for a fixture chat, so the prompt the greeting sees is pinned the way `IDENTITY_STACK_BUILDER_VERSION` pins the stack.

**D3. The SYSTEM fossil is not written for new chats.** `writeSystemPromptMessage` goes. Old rows are untouched; every reader already filters the role. The implementer greps for any assumption that `messages[0]` is SYSTEM (the continuation anchor, swipe groups, `revealMessageId`) and lists what was found in §10. The help chat's own SYSTEM row (`help-chats/route.ts`) is out of scope.

**D4. One arrival.** `seatArrival(chatId, characterId, { source, outfitSelection?, sourceChatId?, narrator? })` in `lib/chat/opening/arrival.ts` is the only caller of `applyOutfitSelections` and `applyInventoryDefaults` (a grep-test holds it) and runs, in one order for every source: outfit → inventory → identity stack (`compileIdentityStackForParticipant`) → Host add announcement (when the chat has more than one LLM seat, or the source is a join or merge) → Aurora opening-outfit whisper → avatar refresh. The default outfit mode when the caller sends none is decided here, once, by `defaultOutfitMode(character, source, sourceChatId)`: `previous_chat` when a source chat has an outfit for the character (continuation, merge); else `llm_choose` when the character is LLM-controlled and `canChooseOutfit`; else `default`. The client's `computeSyncInitialMode` becomes a display of that rule, served by D8's defaults action, not a second copy. The wear-ledger `source` (`chat-start` / `participant-added` / `merge`) and the merge's never-credit rule are unchanged. Chat start runs `seatArrival` for every seat concurrently in the resolve half and serially in the commit half exactly as `applyOutfitSelections` does today internally; the module keeps that two-phase shape because the slot write is a read-modify-write of one JSON column. The narrator (D7) is optional and inert when absent, so a join or a merge narrates when the operator is watching and is silent for a script. **Every arrival announces and draws.** A seat that joins or is merged mid-chat gets the Aurora opening-outfit whisper and the avatar refresh exactly as an opener does: the whisper always, the avatar through `refreshAvatarForOutfit`, which already gates on the chat's `avatarGenerationEnabled` and skips autonomous rooms. Today a join refreshes the avatar but posts no whisper, and a merge does neither (§1.4); both are brought up to the opener's behaviour, not the other way round. If the Add Participant path already announces the outfit by another route (`scheduleWardrobeAnnouncement`), the implementer removes that route rather than posting twice, and records which in §10.

**D5. Defaults resolve on the server, once, and are readable before casting.** `resolveCastingDefaults(input)` (`lib/chat/opening/defaults.ts`) answers every precedence chain in one place: title (the server names the chat; the client's `generateTitle` is deleted and the server's rule is "the LLM cast's names joined, with the user character's name when there is one", matching what the client produces today), timestamp config (request > character > global), image profile (request > project > character default — the participant-level `imageProfileId` is removed from the schema, §1.7.4), roleplay template (explicit request including `null` > project > user), tool defaults and avatar generation (project), the Concierge state (`requestedConciergeStateAtCreation`, unchanged), the scenario selection (character default > project > general, today's `scenario-seed.ts` order), and per-seat outfit mode (D4). `GET /api/v1/chats?action=casting-defaults&characterIds=…&projectId=…&continuationFromChatId=…` returns the resolved defaults for a prospective cast, plus the continuation's previous-outfit summary (replacing the modal's own `?action=outfit-summary` fetch). Casting calls the same function with the request layered on top, so what the form showed is what the chat got.

**D6. Flavours are a table, not `if`s.** `OPENING_PHASES` lists the phases in order — identity stacks, Prospero context and group whispers, Host scenario, Host user-character, arrivals (D4), the greeting (D2), autonomous start — each with `appliesTo(flavour)` for `'salon' | 'continuation' | 'autonomous'` and a `narrate(…)` label. The greeting applies to `'salon'` only; `'autonomous'` ends with the run start; `'continuation'` ends after arrivals. `runOpening` walks the table; `handleCreate` no longer tests the flavour anywhere but to name it. The phase that today writes the per-seat group-context whispers *before* the Host scenario keeps that order (the order of staff rows in a new chat is visible in every transcript and must not change).

**D7. The Green Room narrates inside the Salon, over the chat's stream.** The opening runs as a stream request from the Salon: on opening a chat with `openingState !== 'done'`, `SalonView` POSTs `/api/v1/chats/[id]/messages` with `{ continueMode: true, opening: true }` and consumes the stream it already knows how to read. The `StreamFrame` union gains `kind: 'greenRoom'` with a payload union of its own — `status`, `log`, `wardrobeStart`, `wardrobeResult` (the slot preview DTO), `inventory` (what was packed), `phase` — encoded only by `encodeFrame`, dispatched by the client's exhaustive `switch`. The Salon renders a **Green Room panel** at the head of the transcript while the opening runs (the dialog's content, in place: headline, per-character wardrobe panels resolving into `OutfitSlotsPreview`, the activity log) and collapses it to a one-line "Opened" row with a disclosure once `done` arrives, so the record of who chose what survives the session. The greeting then streams beneath it as an ordinary turn bubble. `ChatCreationProgressModal`, `CreationProgressProvider`, `lib/chat/creation-progress.ts`, `app/api/v1/chats/creation-progress/route.ts`, `progressId` on the create schema and the `progress` parameters on `OutfitSelectionContext` / `InventoryGreenRoomOptions` are deleted; the narrator is a `GreenRoomNarrator` interface in `lib/chat/opening/narrator.ts` with a frame-writing implementation and an inert one. The operation-progress bus stays for the Almanack. The New Chat modal closes on `201` and navigates at once; a casting failure is the toast it is today.

**D8. The client is query-backed, shows the server's defaults, and sends only overrides.** Reference data comes through TanStack Query (`queryKeys.characters.all`, `connectionProfiles`, `imageProfiles`, `roleplayTemplates`, `projects`, `chatSettings`, and the three scenario tiers; add the missing key blocks) with `apiFetch`, so the dialog reuses caches other pages fill and refreshes on the `characters` / `projects` / `wardrobe` topics instead of refetching by hand. The seeded defaults come from D5's `casting-defaults` query, keyed by the selected cast and project. Form state becomes `defaults ⊕ overrides`: `overrides` holds only what the operator changed (scenario, template, Concierge, timestamp, image profile, avatar generation, per-seat outfit selections, autonomous fields), the three `touched` flags go, and the request body is `{ participants, projectId?, continuationFromChatId?, chatType?, ...overrides }`. `scenario-seed.ts`, the template seeding, the Concierge seeding and `computeSyncInitialMode` are deleted. The "byte-identical" conditionals go with them: the server treats an absent key as "use the default", which is what it does today.

**D9. One mount.** `NewChatProvider.open(opts)` is the only way the dialog appears. `SalonView`'s Continue Elsewhere, `CharacterPage` and `CharacterCard` call it (through `useNewChatModalOptional`, falling back to `router.push('/salon/new?…')` outside the workspace) and their own `<NewChatModal>` mounts are deleted. `/salon/new` stays as the full-page fallback and renders the same `NewChatDialogBody`. `NewChatForm`'s 25 props become a `NewChatFormProvider` context fed by `useNewChat`, so the modal, the page, `CharacterPickerPanel` and `OutfitSelector` read from it. `NewChatModal`'s `openedFromQuery` → `router.push('/aurora')` special case is replaced by the provider's close returning wherever the opener was.

**D10. The opening is under the turn lock and under Stop, and it resumes.** `runOpening` runs inside `runWithTurnControl`, so a send during the opening waits (`waitForEarlierTurns`) and the Salon's Stop reaches the greeting. `chats.openingState` (`'pending' | 'running' | 'done'`) and `openingPhase` (the last completed phase key, nullable) are **patch-only** columns written by `ChatsRepository.setOpeningState`, called only by `runOpening`. Each phase is idempotent against the row: an arrival checks the seat's equipped entry before dressing (as `applyInventoryDefaults` already does for the Inventory), stacks are recompiled harmlessly, staff posts check for their own row by `systemKind` before posting, the greeting checks for an existing opener row. A tab closed mid-opening leaves `'running'`; the next open (or a startup reconciler for rows `'running'` older than ten minutes) re-runs from `openingPhase + 1`. Stop ends the greeting turn and marks the opening `'done'` — outfits already committed stay, and a chat without an opener is a chat whose first line is the operator's. Migration: add the two columns with `openingState` defaulting to `'done'` so every existing chat is complete; casting sets `'pending'` explicitly. Not exported in `.qtap`, not backed up (a restored or imported chat is `'done'`); DDL.md gains the columns; the loading-screen label and `reportProgress` rules apply even though the migration has no loop.

**D11. The opening speaker is the turn manager's.** `buildAllParticipants`' `pickWeightedRandom` copy is deleted. The greeting turn passes no `respondingParticipantId`; the participant resolver draws the cycle (`resolveCycleOrder`) and the finalizer records the speaker, so the first operator turn's rotation knows who opened. The per-seat system prompt and subprompts come from the participant row, as every later turn reads them. The one remaining use of "the first LLM character" — the title's name when there is a single LLM seat — is a plain `find`.

**D12. Row defaults live in the repository (optional, gated).** `ChatsRepository.create` accepts a `NewChatInput` in which `contextSummary`, `tags`, `messageCount`, `lastMessageAt`, `lastRenameCheckInterchange`, `disabledTools`, `disabledToolGroups`, `imageProfileId`, `roleplayTemplateId`, `timestampConfig` and `projectId` default, so casting, the help chat, Brahma, the two SillyTavern importers and the qtap importer stop spelling the empty row six times. Done only if the importers' `{ id }` option and restore's raw payload fit without a second code path; otherwise record why in §10 and leave it.

## 6. Phases

Each phase is independently committable and leaves the suite green. 0 → 1 → 2 → 3 are ordered; 4 may start after 1; 5 is last and optional.

### Phase 0 — Extraction, no behaviour change

- Create `lib/chat/opening/` and move, verbatim: `createChatSchema` and the participant schema → `schema.ts`; `buildCharacterParticipant` / `buildAllParticipants` / `resolveProjectDefaults` / the precedence block / `repos.chats.create` → `cast.ts` (as `castChat`, still running the whole sequence for now); `createInitialMessagesScenarioAndStaff`'s staff posts → `staff.ts`; the two outfit branches and the inventory call → `arrival.ts` (still three callers); `autoGenerateFirstMessage` and `GeneratedGreeting` → `greeting.ts`; `applyRequestedConciergeState` / `requestedConciergeStateAtCreation` → `concierge.ts`; the ordered sequence → `run.ts` (`runOpening`). `lib/wardrobe/green-room-model.ts` and `lib/inventory/green-room.ts` move to `lib/chat/opening/green-room/`. `handleCreate` becomes parse → `castChat` → `runOpening` → `created(...)`, under 60 lines.
- Re-point the six route tests at the modules; each test mocks the module it is about and nothing else. Record the mock counts before and after in §10.
- Done when: `app/api/v1/chats/route.ts` is under 300 lines; `npx tsc` and `npm run test:unit` green; `git diff --stat` on the moved bodies shows moves, not edits.

### Phase 1 — One arrival (D4) and the defects

- `seatArrival` with the one order and `defaultOutfitMode`; chat start, `participants.ts` and `apply-chat-merge.ts` call it; the three private sequences are deleted. Narrator optional.
- Fix §1.7.1 (a join narrates when a narrator is present — at this phase, still the dialog's emitter, passed from the Add Participant action through a `progressId` the dialog already knows how to open; it is deleted again in Phase 3), §1.7.2 (the server default), §1.7.3 (the stamping goes with `first-message-context.ts` in Phase 2; here, note it), §1.7.4 (drop the participant `imageProfileId`; the create schema is `.strict()` on the participant object so a client still sending it gets a 400 — confirmed, §9.3).
- Grep-test: `applyOutfitSelections` and `applyInventoryDefaults` have exactly one caller outside their own modules and tests.
- File the four §1.7 defects as GitHub issues per CLAUDE.md (the human confirmed filing on 2026-11-09, §9.6; do not ask again); cite them in the CHANGELOG.
- Done when: the §1.4 table has one row; a test adds a `canChooseOutfit` character through each of the three doors with no selection and asserts `llm_choose` was attempted each time; a second test adds a seat to a chat with avatar generation on and asserts one opening-outfit whisper and one avatar refresh, and to a chat with it off and asserts the whisper alone.

### Phase 2 — The greeting is a turn (D2, D3, D11)

- `purpose: 'opening'` through `handleSendMessage` → `processMessage` → `buildContext`: the ephemeral opening note, the Core whisper not skipped, the skip option withheld, the Salon budgets. At this phase the opening still runs inside the blocking POST; the turn's stream is consumed into the progress log (a `SinkNarrator`) so the operator's experience is unchanged except for the prompt.
- Scripted first message through the finalizer path; `buildChatContext` is deleted and its one other export, `ChatContext`, with it. `writeSystemPromptMessage` deleted (D3) after the `messages[0]` grep.
- `pickWeightedRandom` out of casting (D11).
- Golden: the opener's request for a fixture chat (one LLM seat, one user seat, a scenario, a subprompt, a worn outfit, a carried object, one pending Inform, a progression) — every block and trailing section. A second golden for a scripted opener asserts the finalizer side effects (speaker recorded, title check scheduled).
- Delete `initial-greeting.ts`, `first-message-context.ts`, `initialize.ts`, the ladder, `route.greeting-stall.test.ts` (replaced as in D2).
- Done when: `grep -rn "generateGreetingMessage\|buildChatContext\|buildFirstMessageContext" lib app` is empty; the opening turn appears in the LLM Inspector as a `CHAT_MESSAGE` with the chat's real system prompt; a chat opened Unmoderated routes its greeting to the frank desk through `provider-failover.service.ts` (test), and a Locked chat's content-filter refusal is not rerouted (test).

### Phase 3 — Casting, the opening, and the panel (D1, D5, D6, D7, D10)

- Migration for `openingState` / `openingPhase` (default `'done'`), `PRETTY_LABELS` entry, DDL.md; `setOpeningState` patch-only.
- `castChat` returns after the Concierge flip and the continuation backfill; `runOpening` becomes the resumable table walk (D6) under `runWithTurnControl` (D10); `OPENING_PHASES`.
- The `opening: true` continue request; `greenRoom` frames in `stream-frames.ts`; `GreenRoomNarrator` with the frame and inert implementations; the Salon's Green Room panel and the collapsed "Opened" row; `SalonView` fires the opening on mount when the state is not `'done'`; `?action=open` for other callers; `startAutonomousRoomManually` and the cron start call `runOpening` with the inert narrator before the first run turn; the startup reconciler for stale `'running'` rows.
- `resolveCastingDefaults` and `GET /api/v1/chats?action=casting-defaults` (D5); the server names the chat.
- Delete the dialog, the provider, `creation-progress.ts`, the SSE route, `progressId`, the `progress` options, and the `creation-progress` tests; `WorkspaceProviders` loses a provider.
- `publishRealtime('chats', chatId)` when the opening completes, so lists and the detail refetch.
- Done when: `POST /api/v1/chats` with a `llm_choose` seat returns in a DB round trip in a test with the chooser mocked to hang; the Salon shows the panel, the outfit resolves into it, and the greeting streams beneath (V4test); Stop during the greeting leaves `openingState: 'done'` with no opener row and the composer live; closing the tab mid-outfit and reopening resumes from the right phase (test with a persisted `openingPhase`); an autonomous room's first run turn sees dressed, packed, compiled seats.

### Phase 4 — The client (D8, D9)

- Queries and key blocks; `useCastingDefaults`; `defaults ⊕ overrides` state; delete the seeds and `touched` flags; the request body is participants plus overrides. Update `useNewChat.request-body.test.tsx` to assert "absent means default" rather than byte identity.
- `NewChatFormProvider`; one `NewChatProvider` mount; the three private mounts call `open`; `/salon/new` renders the shared body; `openedFromQuery` retired.
- Done when: `grep -rn "fetch('/api/v1/" components/new-chat` is empty; `NewChatForm` takes no data props; a cast change re-seeds the shown defaults without touching an override (test); `CharacterCard`, `CharacterPage` and `SalonView` contain no `<NewChatModal>`.

### Phase 5 — Row defaults (D12, optional)

- Attempt it; keep it only if the importers and restore fit without a second path. Record the outcome in §10.

## 7. Verification

- `npx tsc`, `npm run lint`, `npm run test:unit` after every phase (never `--findRelatedTests`).
- Grep-tests, in the style of `reach-chokepoint.test.ts`: (a) one caller of `applyOutfitSelections` / `applyInventoryDefaults`; (b) no module outside `lib/chat/opening/` writes `openingState`; (c) no `generateGreetingMessage` / `buildChatContext` / `buildFirstMessageContext`; (d) no hand-built `greenRoom` frame (the existing `data: ${` rule covers the transport; add the kind to the frame snapshot); (e) no raw `fetch` under `components/new-chat`; (f) each route test under `__tests__/unit/app/api/v1/chats/route.*` mocks at most five modules.
- Goldens: the opener's request (Phase 2); the `greenRoom` frame set for a fixture opening (Phase 3), beside the Salon's existing golden streams.
- On V4test (never Friday): start a one-character chat with Dress Themselves and watch the panel fill and the greeting stream; press Stop mid-greeting; start a two-character chat and confirm the Host adds precede the greeting and the opener is recorded as the last speaker; Continue Elsewhere from it and confirm the history is present before the panel finishes; create an autonomous room and confirm its first turn opens dressed; add a Dress Themselves seat to a running chat and confirm the panel narrates the join; merge a chat and confirm `previous_chat` is the default; create a chat from the character page, the homepage card, the project page and the Salon list and confirm one dialog; `npx quilltap` (or `curl`) `POST /api/v1/chats` without `outfitSelections` and confirm the `canChooseOutfit` seat was asked.
- Export a chat opened under this spec to `.qtap` and import it: `openingState` is `'done'` and the opener row is ordinary.

## 8. Documentation

- `docs/developer/API.md` — `POST /api/v1/chats` (response, `progressId` and the participant `imageProfileId` removed, strict participant object), `GET /api/v1/chats?action=casting-defaults`, `POST /api/v1/chats/[id]?action=open`, the `opening` continue request, `GET /api/v1/chats/creation-progress` removed, the `greenRoom` frame.
- `docs/developer/DDL.md` — `chats.openingState` / `openingPhase`, patch-only.
- `docs/developer/SYSTEM_FLOWCHARTS.md` — §1 describes the first *operator* message; add the opening as its own section (casting → opening phases → the greeting as a turn) and point §8's turn pipeline at `purpose: 'opening'`.
- `CLAUDE.md` — a chokepoint paragraph: a chat is cast by `castChat` and opened by `runOpening`; a seat arrives through `seatArrival` (the only caller of the outfit and inventory appliers, one default rule); the greeting is a turn with `purpose: 'opening'` and nothing composes an opener by hand; `openingState` is patch-only.
- `help/chats.md` — rewrite "The Green Room" in voice: the curtain rises in the Salon itself, Stop, what a reopened chat does; `help/chat-participants.md` — a joining character is dressed in view; `help/chat-settings-ai-services.md` — the Green Room Wardrobe Model paragraph still true. `url` frontmatter and In-Chat Navigation per the standing rule.
- `docs/CHANGELOG.md` — plain voice, per phase.
- `.claude/commands/update-documentation.md` and `docs/developer/features/ROADMAP.md` — this spec is listed (done with this proposal).
- `public/schemas/qtap-export.schema.json` — unchanged (the new columns are not exported); `lib/startup/prettify.ts` — the migration's label.

## 9. Decisions taken by the human (2026-11-09)

The seven questions this proposal raised were put to the human on 2026-11-09 and answered as follows. They are settled; the implementer does not reopen them.

1. **The SYSTEM row is not written for new chats (D3).** Confirmed. Old rows stay; the `messages[0]` grep is still due and its findings go in §10.
2. **A chat stays `'pending'` until opened (D1).** Confirmed. The opening starts on the first Salon visit, on an autonomous run start, or on `?action=open`; casting never starts it detached.
3. **The participant object is `.strict()` and loses `imageProfileId` (Phase 1).** Confirmed. An unknown participant key is a 400.
4. **Stop ends the greeting only (D10).** Confirmed. What was dressed and packed stays; the chat is `'done'` with no opener row and a live composer. No `'partial'` state.
5. **The opener runs under the Salon's stall budgets (D2).** Confirmed. The greeting's 90 s / 60 s constants are deleted with `initial-greeting.ts`.
6. **All four §1.7 defects are filed as GitHub bug issues before Phase 1.** Confirmed; the implementer files them with `gh issue create --label bug` without asking again, and cites them from the CHANGELOG when each is fixed.
7. **Phase 5 is attempted, gated as D12 states.** Confirmed.

## 10. As built

Landed 2026-11-09 as one working-tree change rather than six phase commits (the phases share files too closely for the intermediate states to be worth committing on their own); the order of work followed §6.

### Route-test mock counts (Phase 0)

| test | before | after |
|---|---|---|
| `route.concierge-state.test.ts` | 19 | deleted → `__tests__/unit/lib/chat/opening/cast.test.ts` |
| `route.continuation-autonomous.test.ts` | 18 | deleted → `cast.test.ts`, `run.test.ts` |
| `route.roleplay-template.test.ts` | 18 | deleted → `cast.test.ts` |
| `route.scenario-seed.test.ts` | 19 | deleted → `cast.test.ts` |
| `route.greeting-stall.test.ts` | 18 | deleted (D2); the opener is an ordinary `processMessage` turn under `withStallWatchdog` |
| `route.get.test.ts` | 1 | 1 |
| `route.create.test.ts` (new) | — | 2 |

Fence (f) in `opening-chokepoints.test.ts` holds every `route.*` test at five mocks or fewer. `app/api/v1/chats/route.ts` is 250 lines (was 1,671).

### What landed

- `lib/chat/opening/`: `schema.ts` (participant object `.strict()`, no per-seat `imageProfileId`, no `progressId`; the scenario keys are one override, `SCENARIO_KEYS`), `defaults.ts` (`resolveCastingDefaults`, served as `GET /api/v1/chats?action=casting-defaults`), `cast.ts` (`castChat`), `concierge.ts`, `arrival.ts` (`seatArrival` / `seatArrivals`, `defaultOutfitMode`), `staff.ts`, `run.ts` (`OPENING_PHASES`, `runOpening`, the in-process one-opening-per-chat registry, `waitForOpening`, `reconcileStaleOpeningsAtStartup`), `narrator.ts` / `narrator-frames.ts`, and `green-room/` (the moved `model.ts` and `inventory.ts`).
- The greeting is `processMessage` with `purpose: 'opening'` on the Salon's stream (`openChatStream` in the orchestrator): Core whisper offered, skip withheld, recap pool forced, `buildOpeningInstruction` as the last trailing section. A scripted `firstMessage` is templated in `processMessage` and closed by `finalizeScriptedOpener`; the finalizer's post-save tail is now `closePersistedReply`, shared by both.
- Deleted: `lib/chat/initialize.ts`, `initial-greeting.ts`, `first-message-context.ts`, `creation-progress.ts`, `app/api/v1/chats/creation-progress/`, `writeSystemPromptMessage`, `pickWeightedRandom` in casting, and their tests.
- Salon: `GreenRoomPanel` above the transcript (`useGreenRoom` folds `greenRoom` frames), `useSSEStreaming.openChat()` fired once per visit when `openingState !== 'done'`, Continue Elsewhere opens the one `NewChatProvider`.
- Migration `add-chat-opening-state-v1`; `ChatsRepository.getOpeningState` / `setOpeningState` / `findUnopenedChatStates` / `resetStaleOpenings`; list and detail GET carry `openingState`.

### Departures from §5–6

1. **A third column, `openingPlan`.** The operator's outfit choices (and a continuation's source chat) must survive from casting to an opening that runs in a later request; §5 named only two columns. `openingPlan` is JSON, patch-only and outside the schema like the other two, written by `castChat` and cleared when the opening finishes.
2. **A join narrates over its own stream, not the dialog's emitter.** Phase 1's interim `progressId` on Add Participant was skipped (it would have been deleted again in Phase 3). Instead `?action=add-participant` takes `narrate: true` and answers with a `greenRoom` SSE stream that the Salon reads into the same panel. A merge arrives through `seatArrival` too but the Merge dialog does not ask for narration, so a merge is announced and drawn but not narrated live.
3. **The title rule is the client's old `generateTitle`** ("Chat with A", "A and B", "A, B, and C", "Group Chat (n characters)"), without the user character's name; D5 asked for both "the user character's name" and "matching what the client produces today", and those disagree.
4. **Identity stacks compile twice at a chat's opening** — the `stacks` phase (D6) and each arrival (D4). Both are D's; the second is a harmless rewrite.
5. **The Host introduces the operator's character from the user-controlled seat**, not from that character's default `controlledBy` (the old `buildChatContext` quirk that skipped the introduction for an LLM-default character played by the operator).
6. **On a join, the join-scenario whisper now follows the arrival** (after Aurora's whisper) rather than directly after the Host's welcome.
7. **Staff posts are idempotent by `systemSender`/`systemKind` when the opening is resuming; Aurora's opening-outfit whisper is not** (it carries no structured character key), so an arrivals phase broken off half-way and re-run may announce an already-announced seat a second time. The seat's outfit and inventory are not redone (the arrival checks the seat's entries).
8. **The reconciler returns stale `'running'` rows to `'pending'`** rather than re-running them headless; the next visit (or run start) resumes from `openingPhase`. A `'running'` row with no in-process opening is resumable on the next open whatever its age.
9. **`buildRecentConversationsBlock`** stayed in `recap.ts` as D2 said, but nothing outside its tests called it; it and `calculateRecentConversationsLimit` were removed in the 2026-11-10 dead-code sweep. The recap's `buildConversationRecallLists` carries the bug-158 guards on the live path.

### Second announcement route on a join (D4)

None existed: Add Participant never posted an opening-outfit whisper and did not call `scheduleWardrobeAnnouncement`; the arrival's whisper is the only one.

### `messages[0]` audit (D3)

Nothing indexes the first row as the SYSTEM prompt. Every reader filters by role: `chats-messages.ops.ts:250` (message count), `lib/sillytavern/chat.ts:145,164`, `lib/export/markdown-transcript.ts:72`, `lib/photos/chat-gallery.ts:750`, `chat-danger-classification.ts:109`, `app/api/v1/characters/[id]/handlers/get.ts:228`, `app/salon/[id]/hooks/transcript-reconcile.ts:243`. The continuation backfill, swipe groups and `revealMessageId` address rows by id. The help chat still writes its own SYSTEM row (out of scope).

### D12 (Phase 5)

Attempted and kept, smaller than drafted: the row defaults already live in `ChatMetadataBaseSchema` (`.default()` / `.nullable().optional()`), so no `NewChatInput` type was needed. The hand-spelled empties were removed from casting, the help chat and the Brahma console; the importers already relied on the schema, and restore and the qtap importer (which pass a whole payload and an `{ id }`) are unchanged.

### Tests and goldens

- `__tests__/unit/lib/chat/opening/`: `arrival.test.ts` (the default rule; each door asks a `canChooseOutfit` seat to choose; join with avatars on → one whisper + one refresh, off → whisper alone; the one order), `cast.test.ts`, `run.test.ts` (order, plan, resume, Stop, one-at-a-time, flavours, autonomous start), `opening-chokepoints.test.ts` (fences a–f).
- Golden stream `__tests__/fixtures/salon-stream/opening.legacy.json`, replayed by `useSSEStreaming-golden.test.tsx` and covered by the frame-kind check in `stream-frames.test.ts`.
- The opener's request: a golden of its trailing message (every section in order, the opening note last, never in system block 1) and the Core-whisper-on-continue case in `context-management.test.ts`; the scripted opener's finalizer side effects in `message-finalizer.service.test.ts`.
- **Not built:** a golden of the opener's full request through `processMessage` (system blocks included) and orchestrator-level tests that an Unmoderated opener routes to the frank desk and a Locked one is not rerouted — there is no `processMessage` harness to hang them on. The opener takes the same `resolveMessageDangerState` → `provider-failover.service.ts` path as every turn, which `provider-failover-*.test.ts` and `stream-watchdog.test.ts` cover.

### Live verification on V4test (2026-11-09)

Done against V4test on :3005. Seen working: the New Chat dialog closing on `201` and the Salon opening the chat; the Green Room panel narrating the staff posts, a "Let character choose" consultation resolving into the slot preview, and what was packed; the greeting streaming beneath as a turn and the panel folding; the opener recorded (the rotation moved to the operator's seat); the greeting logged as a `CHAT_MESSAGE` whose request carries the identity stack, the chosen outfit and the opening note, with no skip offer; Stop mid-greeting leaving `openingState: 'done'`, the staff rows and no opener row; `POST /api/v1/chats` over HTTP answering in 28 ms, `'pending'`, server-named, with the General default scenario applied, and the retired per-seat `imageProfileId` a 400; `?action=open` running the whole opening headless; a continuation cast with its history already present and defaulting to `previous_chat`; reopening a chat whose opening never ran, which resumed it without a second greeting; and a narrated join from the Add Character dialog. Not exercised live: the `canChooseOutfit` default (no V4test character carries the flag; covered by `arrival.test.ts`) and an autonomous room.

Two bugs it found, both fixed:

1. `buildContinueMessageOptions` (`request-helpers.ts`) dropped the new `opening` flag, so the Salon's opening request ran as a plain continue: no staff posts, no arrivals, no Green Room. Test added in `request-helpers.test.ts`.
2. The staff phases skipped a post the chat "already had", and a continuation's replayed history carries the source chat's Host scenario and Prospero rows, so a continuation lost them. The check now runs only when the opening is resuming (`StaffPhaseOptions.resuming`; `staff.test.ts`).

Also adjusted from looking at it: the panel's body is capped lower (`max-h-64`) so the greeting stays visible on a small window, and the panel folds when the opening request settles even if no `done` frame arrived.

### Still owed

- Nothing. The four §1.7 defects were filed as #151 (§1.7.1), #152 (§1.7.2), #153 (§1.7.3) and #154 (§1.7.4) and are fixed by this change.
