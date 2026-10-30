# Feature: Deus Ex Machina — established facts in the Salon

**Status:** Implemented in 4.12-dev (2026-10-29). Live verification on V4test (§Verification) outstanding. Design agreed with the operator on 2026-10-30. See [As built](#as-built) for the few places the code differs from the text below.

The operator gains two ways to declare something **true** in a Salon chat:

1. **In their own voice.** The line they are typing is posted as their seat's ordinary message, but marked as established fact: everything in it is true in the story, known to everyone, and needs no verification. Armed with a `/deus` slash command or sent with a modifier shortcut.
2. **From the machine.** A fourth tab, **Deus Ex Machina**, in the Insert Announcement dialog posts a fact that belongs to no speaker at all. It is attributed to the Host for characters with System Transparency and to nobody for opaque characters.

The Salon already has two siblings, and this is the third:

| | Announcement | Inform | **Established fact** |
|---|---|---|---|
| Nature | *said* | *known*, privately | *true* |
| In the history the models read | yes, in place | no (record-only) | **yes, in place** |
| Audience | public or whispered | chosen seats | **everyone, always public** |
| Vouched for | no | yes (`INFORM_BLOCK_HEADER`) | **yes** |
| Lifetime | permanent | one turn (or standing) | **permanent; reaches summaries and memories** |

## The one rule about the name

**"Deus Ex Machina" is a UI name only. No model ever reads it.** Not a character, not the summariser, not the memory extractor, not the title writer, not the Courier. Everything bound for a model says *established fact*. In data and server code the feature is called **established fact** (`isEstablishedFact`, `systemKind: 'established-fact'`, `lib/chat/established-fact.ts`). "Deus Ex Machina" appears only in UI strings, the slash-command label and the help page. A test enforces it (see [Tests](#tests)).

## Decisions of record

Settled with the operator before this spec was written. Do not reopen them.

| Question | Decision |
|---|---|
| Name | **Deus Ex Machina** in the UI. Never in anything a model reads. |
| Framing for transparent characters, machine-delivered fact | The Host's attribution plus the plain established-fact frame. No "Deus Ex Machina", no flourish. |
| Framing for opaque characters | The same plain frame, no speaker. |
| Absent / silent characters | They know it. Both kinds reach every LLM seat that is not removed. |
| A one-turn "since you last spoke" reminder | Yes. |
| Audience | Public only, both kinds. Private knowledge stays Inform's job. |
| Memories | Yes, on by default. |
| Composer UI | No new permanent button. A `/deus` slash command arms it; ⌘/Ctrl + Shift + Enter sends one line as fact; while armed, a chip above the composer, a tinted editor frame and a changed Send label. Disarms after one send. |
| Announcement tab label | **Deus Ex Machina**. |

Derived from those (stated here so nobody re-derives them differently):

- **"Everybody knows" beats the join-time cut.** A seat without `hasHistoryAccess` normally sees nothing before its `createdAt` (`filterMessagesByHistoryAccess`, `lib/chat/context/turn-history.ts:57-80`). Established facts bypass that cut: a character who joins later knows them too.
- **Refused while whispering.** The composer never whispers today (`WhisperDialog` is the only whisper path), so the refusal is a server rule: `isEstablishedFact` with a non-empty `targetParticipantIds` is a 400.
- **No in-character rewrite.** The exact words are what is true. An armed line skips the "In their own words" rehearsal.
- **The frame is applied at read time, never stored.** Stored bodies are what the operator typed. Edits need nothing special, and a wording change to the frame applies everywhere at once.

## Known state (verified 2026-10-30)

- **Send path.** `ChatComposer` `onSubmit` takes no arguments (`app/salon/[id]/components/ChatComposer.tsx:90`, form at :483). `SalonView` `onSubmit` (`app/salon/[id]/SalonView.tsx:1921-1964`) runs `impersonationVoice.intercept` and then `sseStreaming.sendMessage(...)`. That is a positional 8-argument function (`app/salon/[id]/hooks/useSSEStreaming.ts:1031-1047`) that builds `requestPayload` `{ content, fileIds, speakingAsParticipantId, pendingToolResults }` (:1129-1141) and POSTs `/api/v1/messages?chatId=…`. Both message routes parse `sendMessageSchema` (`lib/services/chat-message/orchestrator.service.ts:116-134`) through `buildSendMessageOptions` (`request-helpers.ts:32-45`) into `SendMessageOptions` (`types.ts:32-80`).
- **The USER row is written by `recordOperatorPost`** (`lib/services/chat-message/operator-post.service.ts:81-92`; params at :39-63). It has two callers: `orchestrator.service.ts:604-624` and the fair-rotation pause in `turn-holds.service.ts:173-190`. Both must carry the flag (bug 262 is what happens when one does not).
- **Keyboard.** `components/chat/lexical/plugins/KeyboardPlugin.tsx:110-137`: in chat mode plain Enter submits and Shift/⌘/Ctrl+Enter insert a line break; in composition mode ⌘ (Mac) / Ctrl (elsewhere) + Enter submits. ⌘/Ctrl + Shift + Enter is unclaimed in both modes. `altKey` is never checked.
- **Rehearsal gate.** `shouldRehearseImpersonatedLine` (`app/salon/[id]/hooks/useImpersonationVoice.ts:57-77`) is the one pure gate for "In their own words".
- **Slash commands.** `ComposerAction` (`lib/slash-commands/types.ts:23-38`), the exhaustive `COMPOSER_ACTION_SPECS` (`registry.ts:28-106`), `ACTION_ICONS` (`components/chat/lexical/plugins/SlashCommandPlugin.tsx:75-84`), and the handler map in `ChatComposer.tsx:255-291`. `lib/slash-commands/` may not import React or `@/lib`.
- **Composer chips.** `PendingInformChips` is mounted at `ChatComposer.tsx:403-405`. It uses `qt-chat-attachment-list` / `qt-chat-tool-result-chip` / `qt-chat-attachment-chip-remove` and has no `aria-live`. The editor wrapper is a bare `div` at `ChatComposer.tsx:593`. `ContentEditable` hard-codes its classes (`LexicalComposerWrapper.tsx:148`).
- **Insert Announcement.** `Mode = 'staff' | 'character' | 'custom'` (`components/chat/InsertAnnouncementDialog.tsx:82`), tabs at :388-420, POST `?action=announcement` (:256-292) → `handleInsertAnnouncement` (`app/api/v1/chats/[id]/actions/announcement.ts`) with `insertAnnouncementSchema` (`app/api/v1/chats/[id]/schemas.ts:213-239`, a discriminated union on `sender.kind`) → `postAdhocAnnouncement` (`lib/services/announcer/writer.ts:72-139`). The closest template for a Host row is `postInformRecord` (:170-232).
- **Salon rendering.** `systemKind` is a free string. Chip labels live in `KIND_DISPLAY_OVERRIDES` (`app/salon/[id]/components/system-message-labels.ts:4-58`) and dot tiers in `IMPORTANCE_TABLE` (:308ff). The only accent hook is `getAnnouncementAccentClasses` (:290-295, Pascal-only today). `announcement-render-items.ts:46-47` keeps named kinds out of chip packing.
- **`buildMessageContext`** (`lib/services/chat-message/context-builder.service.ts`). The passes run in this order: record-only strip (:901), `attributeAdhocAnnouncements` (:916-938), whisper filter (:947-955), `isOpaqueAnywhere` (:970-986), `normalizeWhisperRoles` (:991; Staff rows take `opaqueContent ?? content`, become USER and lose `systemSender`), then `buildConversationMessages` (:1050, which drops `systemKind`). The multi-character `[Name]` prefix is added later, by `buildNamePrefixedContent` (`lib/llm/message-formatter.ts:109-116, :200`), from the `name` that `attributeMessagesForCharacter` sets. A Host row (`participantId: null`) gets no prefix.
- **Presence windows do not filter the main path.** `filterMessagesByPresenceWindows` has one caller, the in-scene rehearsal (`lib/services/announcer/in-scene-voiced.ts:169-172`), which also drops every `systemSender` row (:148-155). Absent seats already see public rows posted while they were away. Only the join-time cut can hide one.
- **Trailing sections.** `TrailingSections` / `orderedSections` (`lib/chat/context/turn-trailing.ts:42-70`) run in this order: coreWhisper, recall, mail, progressions, inventory, inform, referentLedger, closingEcho, turnSkip, turnYield, storyteller. Inform is wired in `lib/chat/context-manager.ts:706-736` with `regenerationOfMessageIds`. `findLastOwnTurnMs(events, respondingParticipantId)` lives at `lib/chat/context/core-whisper-trigger.ts:205`.
- **Cheap-LLM transcripts.** `toVisibleConversationMessage` (`lib/memory/cheap-llm-tasks/chat-tasks.ts:271-291`) passes Staff rows as raw `content` with no label. It feeds compression (whose output returns as system block 3), titles, story background and scene tracking.
- **The summary fold skips every Staff row** (`partitionMessagesIntoTurns`, `lib/chat/context-summary.ts:269`). It labels lines through `speakerLabel` (:300-317). Its prompt is `FOLD_SUMMARY_PROMPT` (`chat-tasks.ts:607-617`).
- **Memory extraction skips Staff rows and rows with no `participantId`** (`isFoldEligibleMessage`, `lib/memory/extraction/window.ts:230-236`; `buildTurnTranscript`, `lib/services/chat-message/turn-transcript.ts:336`). Any non-staff USER row opens its own extraction turn (:86-95, :154). Episode holders are present seats only (`passes/episode-fold.ts:39`). The rules live in `lib/memory/extraction/prompts/shared.ts`.
- **Manual admission precedent.** `POST /api/v1/memories` builds a `MemoryCandidate` with `source: 'MANUAL'`, `pass: 'manual'` and calls `admitCandidate` in the parent (`app/api/v1/memories/route.ts:585-613`).
- **Courier.** The full bundle reuses `buildMessageContext`'s output and inherits the frame. The delta bundle (`buildCourierDeltaEvents`, `lib/services/chat-message/courier-transport.service.ts:223-349`) reads raw rows, skips only `inform`, labels Staff `[Staff: The Host]` and uses raw `content`. It needs its own handling.
- **Storage precedent.** `migrations/scripts/add-silent-message-field.ts` adds `"isSilentMessage" INTEGER DEFAULT NULL`. Row schema: `chats-messages.ops.ts:76` (`z.union([z.boolean(), z.number().transform(v => v === 1)])`). `is*` columns hydrate as booleans (`lib/database/backends/sqlite/backend.ts:413-416`). `updateMessage` merges `{ ...existing, ...updates }` (`chats-messages.ops.ts:530-552`), so an edit keeps the flag.
- **Leak-test template.** `__tests__/unit/lib/pascal/intervention-leaks.test.ts` walks every model-facing path.
- **No per-character catch-up summary exists.** The comments at `lib/schemas/chat.types.ts:413-414` and `lib/services/librarian-notifications/writer.ts:754-759` claim presence windows feed one. They are stale; correct them in this change.
- **`help/character-system-transparency.md` is wrong on two points.** It says Staff messages are "stripped out" for opaque characters (they get the persona-free `opaqueContent`) and refers to a chat/project setting that disables Staff messages (none exists). This feature depends on the real behaviour, so fix the page in this change.

## Design

### The chokepoint: `lib/chat/established-fact.ts`

One pure, client-safe module. It is the only place that knows the frame wording or how to recognise a fact row.

```ts
export const ESTABLISHED_FACT_KIND = 'established-fact'   // Host row systemKind

/** True for either kind: a flagged seat line, or a Host fact row. */
export function isEstablishedFact(m: {
  isEstablishedFact?: boolean | null
  systemSender?: string | null
  systemKind?: string | null
}): boolean

/** True only for the machine-delivered kind. */
export function isEstablishedFactAnnouncement(m): boolean

/** Wrap a row's body for a model. `voice` decides the Host attribution. */
export function frameEstablishedFact(
  body: string,
  opts: { kind: 'seat' | 'announcement'; voice: 'host' | 'plain' },
): string

/** The trailing reminder's header. */
export const ESTABLISHED_FACT_REMINDER_HEADER: string
```

Wording (final text is tuned during Phase 2 and pinned by a golden; none of it may name the feature):

- **Seat line:** `(Established fact: what follows is true in this story and known to everyone; it needs no verification.)` then a blank line and the body. In a multi-character chat the formatter's `[Name] ` prefix lands in front of it, as it does for any line.
- **Machine fact, transparent roster** (`voice: 'host'`): `The Host makes it known, as established fact (true in this story, known to everyone, needing no verification):` then a blank line and the body.
- **Machine fact, opaque roster** (`voice: 'plain'`): `Established fact (true in this story, known to everyone, needing no verification):` then a blank line and the body.
- **Reminder header:** `Established since you last spoke: true in this story, already known to you, needing no verification, and outranking any older memory or record that disagrees:`

`voice` follows the existing chat-wide `isOpaqueAnywhere` rule. If any LLM seat is opaque, everyone reads the plain form. That is the same shared-reality reason the Staff body swap already gives.

### Storage

- **Seat line:** new column `chat_messages.isEstablishedFact INTEGER DEFAULT NULL`. Domain schema in `lib/schemas/chat.types.ts` beside `isSilentMessage`; row schema in `chats-messages.ops.ts` with the same boolean/number union; migration `add-established-fact-field.ts` modelled on `add-silent-message-field.ts`, registered in all three places in `migrations/scripts/index.ts`, with a `PRETTY_LABELS` entry in `lib/startup/prettify.ts` (it's a single `ALTER`, so it has no loop to report progress from). Set only on USER rows written by `recordOperatorPost`. NULL everywhere else.
- **Machine fact:** no new column. A Host row: `role: 'ASSISTANT'`, `systemSender: 'host'`, `systemKind: 'established-fact'`, `participantId: null`, `targetParticipantIds: null`, `customAnnouncer: null`, and `content` = `opaqueContent` = the trimmed text as typed. The row is persona-free. The Host's voice is added only by the frame, at read time.
- `docs/developer/DDL.md` (`### chat_messages`) and `public/schemas/qtap-export.schema.json` (`MessageEvent`: `isEstablishedFact`, and `established-fact` noted in the `systemKind` description).

### Feature 1: the seat line

**Arming (client).**

- `ComposerAction` gains `'deus'`, with a `COMPOSER_ACTION_SPECS` entry: label *Deus Ex Machina*, description *Post this line as established fact*, keywords `['fact', 'true', 'canon', 'dem']`, `needsDialog: false`. It also gets an `ACTION_ICONS` entry (a glyph that already exists in the icon set; no new asset). `ChatComposer`'s `actions` map gets `deus: toggleEstablishedFact`. Picking it a second time disarms.
- Armed state is per-composer React state in `ChatComposer`. It is not persisted with the draft: a reload disarms.
- `KeyboardPlugin`: ⌘ (Mac) / Ctrl (elsewhere) + Shift + Enter calls `onSubmit({ establishedFact: true })` in both chat and composition modes. Plain submits call `onSubmit()` as now. The shortcut sends one line as fact without arming, and it is added to the toolbar's shortcut hint (`ChatComposer.tsx:539-541`).
- While armed:
  - **Chip.** A chip renders above the composer, in the row `PendingInformChips` uses, inside a wrapper with `aria-live="polite"`. It reads *Deus Ex Machina: this line will be established as fact* and has an × button (`aria-label="Disarm Deus Ex Machina"`).
  - **Tint.** The editor wrapper at `ChatComposer.tsx:593` gains `qt-chat-composer-established-fact`, a frame tint built from existing theme tokens. Its focus ring must hold 3:1 in light and dark.
  - **Send label.** The Send button's `title` and `aria-label` become *Send as established fact*. The icon is unchanged, so the layout does not move.
- Disarms after a successful send, and on chat switch.
- Arming is refused (a toast, state unchanged) when the composer holds attachments only, because a fact needs words.

**Threading.** The flag rides as an option, not a ninth positional argument:

- `ChatComposer` `onSubmit` becomes `(e, opts?: { establishedFact?: boolean })`.
- In `SalonView` `onSubmit`, `shouldRehearseImpersonatedLine` gains `establishedFact`, which returns false first: no rehearsal.
- `sendMessage` gains a trailing options object, and `requestPayload` gets `isEstablishedFact: true`. The optimistic USER bubble carries the flag so the ribbon shows at once.
- `sendMessageSchema` gets `isEstablishedFact: z.boolean().optional()`. Its `superRefine` refuses it with non-empty `targetParticipantIds` and with empty `content`.
- From there it flows through `buildSendMessageOptions` → `SendMessageOptions` → **both** `recordOperatorPost` callers → `OperatorPostParams.isEstablishedFact` → the `addMessage` call.

Everything else in `recordOperatorPost` (dice, Pascal triggers, Carina, danger flags) runs unchanged.

**Rendering.** The operator's bubble keeps its speaker's name and avatar and gains a small *Deus Ex Machina* ribbon (`qt-chat-message-established-fact`).

### Feature 2: the Deus Ex Machina tab

**Dialog.**

- `Mode` gains `'fact'`, rendered as the fourth tab, **Deus Ex Machina**.
- With it selected, the speaker pickers, the profile and system-prompt pickers and **Who hears it** are hidden. A single line explains: *Posted as established fact: true, known to everyone, needing no verification.*
- The editor label reads *Fact*. The post button reads *Establish*; the operator may rename it during Phase 3.
- `canSubmit` needs only non-empty content. Selecting the tab clears any audience.

**API.**

- `insertAnnouncementSchema`'s sender union gains `{ kind: 'fact' }`. A `fact` sender with non-null `targetParticipantIds` is a 400.
- `handleInsertAnnouncement` routes it to a new writer, `postEstablishedFact` (`lib/services/announcer/writer.ts`, modelled line for line on `postInformRecord`). The writer builds the row described under Storage, then enqueues the memory job (below), and returns 201 with the message.
- `info` log on post. `debug` with message id and job id. `warn` on enqueue failure: the post stands either way.

**Rendering.**

- `KIND_DISPLAY_OVERRIDES['established-fact'] = 'Deus Ex Machina'` and `IMPORTANCE_TABLE.host['established-fact'] = 'high'`.
- `getAnnouncementAccentClasses` is generalised from Pascal-only to a per-kind accent, with `qt-chat-established-fact` for this kind.
- The kind joins the list in `announcement-render-items.ts` that is kept out of chip packing, so it never collapses into a run of Host chips.
- It renders as a full-width band rather than a speech bubble, and is expanded by default.

**Edit and delete.** Ordinary message controls. An edit rewrites `content` only. The frame pass reads `content` for this kind and ignores the stored `opaqueContent`, so the two bodies cannot drift. Memories already formed are not changed by an edit or a delete; the help page says so and points at the Commonplace Book.

### Delivery to the models

**1. History framing: one new pass in `buildMessageContext`.**

`frameEstablishedFacts(messages, { voice })` runs between the whisper filter (:955) and `normalizeWhisperRoles` (:991), while `systemSender`, `systemKind` and `isEstablishedFact` are all still on the rows. For a seat line it frames `content`. For a machine fact it sets both `content` and `opaqueContent` to the framed `content` (with `voice` from `isOpaqueAnywhere`), so the later Staff swap picks up the right body whichever way it goes. It is pure and idempotent, like `attributeAdhocAnnouncements`. The `existingMessages` element type gains `isEstablishedFact`.

**2. History access.** `filterMessagesByHistoryAccess` keeps every `isEstablishedFact` row regardless of the join time. The in-scene rehearsal's Staff drop and presence filter (`in-scene-voiced.ts:148-172`) keep fact rows too, framed by the same function.

**3. The trailing reminder: `buildEstablishedFactReminder`** (`lib/chat/context/established-fact-reminder.ts`).

- **Select.** Pick every fact row (both kinds, after the whisper filter) newer than `findLastOwnTurnMs(events, respondingParticipantId)`. With no prior own turn, it is every fact row since the seat's join, or since the start for history-access seats.
- **Format.** Join them in posting order under `ESTABLISHED_FACT_REMINDER_HEADER`. Seat lines are prefixed with the speaker's name via `resolveSpeakerNames` / `speakerLabel`; machine facts are unprefixed. Bodies are verbatim.
- **Cap.** 8,000 characters. Oldest items are dropped first, with a `debug` count of what was dropped; they remain in history.
- **Placement.** A new `establishedFacts` slot in `TrailingSections`, immediately after `inform` (the operator's vouched words travel together).
- **Empty-is-absent.** No fact rows means no section, so a turn without facts stays byte-identical.
- **Never writes.** Nothing is stored and nothing is consumed: the cadence is derived from history, as progressions' is.
- **Swipes.** With `regenerationOfMessageIds`, "last own turn" is measured on the history the swipe sees, the target and its swipe group excluded. The re-roll gets what the original saw.
- **Where it runs.** Autonomous turns and continues run through the same `buildContext`, so they get it. Carina builds its own call and does not.

**4. Cheap-LLM transcripts.** `toVisibleConversationMessage` frames fact rows with `voice: 'plain'`, always, because its output can return into an opaque prompt as system block 3. Machine facts become `user` lines.

**5. The context-summary fold.**

- `partitionMessagesIntoTurns` keeps machine-fact rows despite their `systemSender`, as their own turn.
- `turnsToChatMessages` labels them with the fixed speaker label `Established fact`. That label is added to `speaker-names.ts` beside the `User` / `Character` fallbacks.
- Seat lines keep their speaker's name and get the seat frame.
- `FOLD_SUMMARY_PROMPT` gains one rule: *Lines labelled or marked as established fact are settled truth in this story. Carry them forward as facts of the world, not as anyone's claim, and do not let a later line's doubt undo them.*
- `calculateInterchangeCount` is unchanged: a machine fact is not an interchange.

**6. Memories.**

- **Seat lines** are already extraction-eligible. `renderTurnContext`, `renderStretch` and `buildTurnTranscript` frame them through the shared function, and `prompts/shared.ts` gains the same established-fact rule as the fold. Present seats form memories through the ordinary passes.
- **Machine facts** stay out of LLM extraction (no speaker, nothing to interpret). Each one is admitted deterministically by a new job, `ESTABLISHED_FACT_MEMORIES` (modelled on `CARINA_MEMORY_EXTRACTION`: queue-service, handler index, activity kind, job topic). It runs once per post. For every LLM seat that is not removed (absent and silent included), it builds a `MemoryCandidate` and admits it over the `admitMemory` host-RPC. The candidate's fields:
  - `subject: { holderId: seat.characterId, aboutId: null }`
  - `kind: 'semantic'`
  - content and summary: the fact verbatim
  - importance 0.8
  - targeting `present / wide / information`
  - `provenance.source: 'MANUAL'`: operator-authored, so it never folds into an extracted row, and `retireChatMemories(…, { keep: 'manual' })` spares it on a chat wipe
  - `pass: 'established-fact'`: a new member of the pass enum
  - `sourceMessageId` set to the row's id

  Admission's own dedup handles a repeat. A seat whose character record fails to load is skipped with a `warn`. An embedding failure is a `warn` per seat, not a job failure.
- **Known gap, accepted:** an *absent* seat forms no memory of a *seat line*, because episode holders are present seats only. It still knows the fact from history and the reminder. See [Deferred](#deferred).

**7. The Courier delta bundle.** `buildCourierDeltaEvents` frames fact rows through the shared function (plain voice, matching `extractVisibleConversation`). It labels a machine fact `[Established fact]` instead of `[Staff: The Host]`.

### Export, import, backup

- `.qtap` export and import: `isEstablishedFact` rides on the message record. Confirm that `lib/import/quilltap-import/` carries the field rather than whitelisting message fields; add it to the round-trip test either way. The machine-fact row needs nothing new.
- Backup and restore: `chat_messages` rows are carried whole. Verify with a round-trip.
- SillyTavern export: a seat line exports as an ordinary user message (ST has no concept of it), and a machine fact follows Staff rows. Nothing new.
- Chat merge and continuation carry messages, and both kinds travel with them.

### Realtime

| Event | Hint |
|---|---|
| Seat line / machine fact posted | `addMessage` publishes `chats`, so nothing extra is needed |
| Memory job completes | the job's completion topic publishes `memories` (add the kind to `lib/realtime/job-topics.ts`) |

No polling anywhere. The armed chip is local state.

### Logging

`debug` on every touched backend path:

- the frame pass (counts by kind, voice)
- the reminder (selected, dropped by cap, swipe or not)
- the fold and extraction inclusion
- the Courier delta
- the history-access bypass (count kept)
- the memory job (per-seat outcome)

`info` on each post. `warn` on enqueue failure, on per-seat admission failure, and when a seat's character is missing.

## Documentation

- **`help/deus-ex-machina.md`** (new). `url: /salon`, an *In-Chat Navigation* section with `help_navigate(url: "/salon")`, steampunk voice. It covers:
  - both instruments: `/deus`, the shortcut, the chip and the tab
  - that the cast hears *established fact* and never the name
  - that transparent characters hear the Host deliver the machine kind
  - public only
  - absent characters and late joiners know it
  - the one-turn reminder
  - memories, including that edits and deletes do not unform them
  - no in-character rewrite
  - Carina does not hear the reminder
- **Cross-links.** One sentence each in `help/insert-announcement.md` and `help/inform.md`: an announcement is *said*, an inform is *known*, a Deus Ex Machina is *true*.
- **`help/character-system-transparency.md`.** Correct item 2 and the "Chat or project disabled Staff messages?" bullets (see Known state).
- **Developer docs.**
  - `.claude/commands/update-documentation.md`: the new help entry.
  - `docs/developer/PROMPT_ARCHITECTURE.md`: a trailing-section row, the frame pass, and a key-file row for `established-fact.ts`.
  - `docs/developer/DDL.md` and `docs/developer/API.md`: the send schema field and the announcement sender kind.
  - `docs/developer/SYSTEM_FLOWCHARTS.md` §9: the new trailing slot.
- **`CLAUDE.md` chokepoint line.** *An established fact is recognised and framed only by `lib/chat/established-fact.ts`. The frame is applied at read time and never stored, and no model-facing text names "Deus Ex Machina".*
- **`docs/CHANGELOG.md`.** Plain voice.
- **Stale comments.** Fix `lib/schemas/chat.types.ts:413-414` and `lib/services/librarian-notifications/writer.ts:754-759`.

## Tests

- **`established-fact.test.ts`.** The predicate covers both kinds and rejects `announcement` and `inform`. The frame is golden-pinned per kind and voice. Every exported string, and every frame output, contains no `/deus\s+ex\s+machina/i`.
- **Leak and coverage test,** modelled on `intervention-leaks.test.ts`. A chat with one seat line and one machine fact is walked through every model-facing path:
  - `buildMessageContext`, single- and multi-character, transparent and opaque rosters, and the swipe path
  - `extractVisibleConversation`
  - the fold input
  - the extraction transcript
  - the Courier full and delta bundles
  - the in-scene rehearsal history

  Each path must contain the fact and its frame, and none may contain the UI name.
- **History access.** A seat without history access that joined after the fact still sees it. Other pre-join rows remain hidden.
- **The reminder.**
  - **Selection:** only facts after the seat's last own turn, in order; seat lines are name-prefixed.
  - **Cap:** oldest dropped first.
  - **Swipes:** a swipe reproduces the original.
  - **Empty case:** the assembled context is **byte-identical** to today (extend the cache-determinism golden).
- **`buildContext`.** System blocks are untouched. Only the trailing message changes, by the new section after inform.
- **Send schema.** The flag plus a whisper target is a 400; the flag with empty content is a 400. Both `recordOperatorPost` callers persist the flag (the fair-rotation pause included).
- **`shouldRehearseImpersonatedLine`.** Returns false when established.
- **Announcement action.** A `fact` sender writes the row shape exactly. `fact` with targets is a 400. The job is enqueued.
- **Memory job.** One admission per non-removed LLM seat, absent included and user-controlled excluded, with `source: 'MANUAL'` and `pass: 'established-fact'`. An embedding failure on one seat does not stop the others.
- **Fold.** A machine fact is included with the `Established fact` label. The prompt carries the rule.
- **Slash commands.** `deus` is registered and exhaustive; `slash-commands.test.ts` is updated.
- **`system-message-labels.test.ts`.** The new label and tier.
- **Round trips.** Migration (adds the column, idempotent), export and import, backup and restore.
- **Tool snapshots.** None of the tool-definition snapshots change.

## Engineering tasks (phased)

### Phase 0: storage (delegable)
Migration, pretty label, domain and row schemas, DDL.md, export schema, round-trip tests.

### Phase 1: the chokepoint (not delegable)
`lib/chat/established-fact.ts`: wording, predicate, frame and goldens. The name-leak assertions.

### Phase 2: delivery (plan carefully; not delegable)
- the frame pass in `buildMessageContext`
- the history-access bypass
- the in-scene rehearsal
- the reminder section and its `TrailingSections` slot, including swipes
- `extractVisibleConversation`, the fold, the extraction transcripts and prompts, and the Courier delta
- the leak test and the cache-determinism assertion
- `PROMPT_ARCHITECTURE.md` and `SYSTEM_FLOWCHARTS.md`

### Phase 3: the two posts (delegable after 1)
- **Server:** send schema → options → both `recordOperatorPost` callers; the announcement sender kind and `postEstablishedFact`; API.md.
- **Memory job:** `ESTABLISHED_FACT_MEMORIES`, the job topic, and the new pass enum member.

### Phase 4: UI (delegable after 3)
- the slash action, the keyboard shortcut, the armed chip, the tint, the Send label and the rehearsal gate
- the dialog tab
- rendering: the ribbon, the band, labels, tier, accent and the render-items exclusion

The new `qt-*` classes go in `app/styles/qt-components/` and are mirrored de-Tailwinded into `packages/theme-storybook/src/css/qt-components.css`. Bump that package's patch version, then **stop and ask the operator to `npm publish`**: the publish gates the commit. Run `/release-checklist-13-ui` contrast checks on the tint and ribbon.

### Phase 5: docs and CHANGELOG
Everything under [Documentation](#documentation).

## Verification (live, on the V4test instance, never Friday)

1. Two-character chat, transparent Alice, opaque Bob, plus Carol absent. Type `/deus`: the chip appears, the frame tints and Send reads *Send as established fact*. Post *"The bridge to Ashford collapsed in the night."* The bubble has the ribbon and the composer disarms.
2. Open the LLM logs for the next turns of Alice and Bob:
   - The line in history carries the seat frame with the speaker prefix.
   - The trailing section repeats it under the reminder header, after any inform.
   - "Deus Ex Machina" appears nowhere.
   - System blocks are unchanged from the previous turn.
3. Post a machine fact from the Deus Ex Machina tab. It renders as a band labelled *Deus Ex Machina*. Because Bob is opaque, the whole chat reads the plain form, with no "The Host". Remove Bob and post another: Alice's log now shows *The Host makes it known…*.
4. Bring Carol back. Her first turn's log holds both facts in history and both in the reminder. Her second turn has no reminder.
5. The Commonplace Book shows one MANUAL memory per seat (Carol included) for the machine fact, and none for the user-controlled seat.
6. Swipe Alice's reply from step 2. The reminder is identical, and no new memory job runs.
7. Try `/deus` with only an attachment: refused. Try to whisper an established line through the API: 400.
8. Force a summary fold. The summary states both facts as facts of the world.
9. Export `.qtap` and import into a scratch instance. Back up and restore. The ribbon and band survive.
10. Courier: a delta bundle shows `[Established fact]` and the framed seat line.

## Deferred

- **Seat-line memories for absent seats.** They know it from history and the reminder, but form no memory of a seat line because episode holders are present seats only. A deterministic admission like the machine fact's would close it, but a seat line is dialogue and action in a speaker's voice, which makes a poor verbatim memory. Revisit if it bites.
- **A visible composer button.** Deferred for space. If wanted later, the least disruptive slot is a fourth button under Terminal in the middle toolbar column.
- **Carina** does not receive the reminder. It builds its own minimal call, as it does for informs.

## As built

Implemented as specced, with these choices made during the build:

- **Idempotent frames.** `frameEstablishedFact` strips any frame it put on a body before framing (`stripEstablishedFactFrame`), so re-running the pass, or re-voicing a framed body, never stacks openers.
- **Multi-character fact marking.** `buildConversationMessages` drops `systemKind`, so `buildMessageContext` collects the fact row ids before normalisation and marks the matching `messagesWithParticipants` rows `isEstablishedFact: true`; `filterMessagesByHistoryAccess` and `filterMessagesByPresenceWindows` keep marked rows.
- **The current turn's own line.** The new user message is not in `existingMessages` (it is persisted after they are read), so the orchestrator frames `newUserMessage` itself when the send is a fact.
- **The fold.** A machine fact rides under the `Established fact` label with its body unframed (the label is the frame); a seat line keeps its speaker and gets the seat frame. `turnsToChatMessages` is exported for tests.
- **The reminder never fails a turn.** A failed chat read drops the section with a `warn`; the facts still ride in history.
- **The writer imports the queue lazily** (`await import('@/lib/background-jobs/queue-service')`), so the announcer module does not drag the job processor into everything that imports it.
- **Rendering class names.** Ribbon `qt-chat-message-established-fact` (text: "Deus Ex Machina — established as fact"); band `qt-chat-established-fact-row` (row) and `qt-chat-established-fact-band` (bubble), no avatar; bar accent `qt-chat-established-fact`. The tint is on the rich editor's wrapper only, not the raw-source textarea.
- **Icon.** `/deus` uses the existing `zap` glyph.
- **Ribbon colour.** The ribbon takes the bubble's own text colour (`color: inherit`, set apart by weight and small caps). A fixed info hue failed on Art Deco's dark user bubble during live verification.
- **Row-level collapse.** `VirtualizedMessageList` decides `isSystemMessageCollapsed` with its own check, separate from `buildRenderItems`; a machine fact is exempted in both, or it renders as a chip.
- **Live verification (2026-10-29, V4test, DeepSeek v4 flash).** Steps 1–8 checked: the armed composer, ribbon and disarm; the seat frame, `[Tester]` prefix and reminder in both seats' requests with zero mentions of the UI name; the band; the plain voice on an opaque roster and the Host voice after both seats went transparent (applied to an older fact too, confirming read-time framing); the absent seat's MANUAL memory and her two-fact reminder on return, none on the next turn; an identical reminder on swipe with no new job; the three 400 refusals; the fold stating the fact as settled. The ⌘⇧Enter shortcut stores the flag. Not checked live: the Courier delta (no Courier profile on V4test) and the export/import round trip (unit-tested).
