# Feature: Inform — out-of-character information a character receives before their next turn

**Status:** specified, not started. Target release: 4.10.

The Salon composer gains an **Inform** button beside Insert Announcement and the Pascal
custom-tool button. It opens a floating dialog where the operator picks one, several, or
every LLM-controlled character in the chat and writes a short second-person passage in a
Markdown editor. Each targeted character receives that passage, verbatim, as a system
block immediately after their system prompt on their next generation, and then it is
consumed for them. The transcript keeps a record: a Host message carrying exactly what
was typed, public when everyone was targeted and whispered to the targets otherwise.
The record is for the operator; it never reaches a model.

The point is to steer — to change how a character behaves, or how they read what is
happening, or both — without putting words in anyone's mouth and without the passage
becoming a standing instruction.

## Vocabulary

- **Inform** — one operator-authored passage, posted once, aimed at one or more seats.
- **Batch** — the set of rows one post produces: one row per targeted participant, sharing a `batchId`.
- **Target** — a chat participant of type `CHARACTER` with `controlledBy = 'llm'` and not removed. Silent and absent seats are valid targets; they receive the inform whenever they next generate. User-controlled seats are never targets. Impersonation is irrelevant: an impersonated seat is still LLM-controlled, and delivery happens on that seat's next *LLM* generation.
- **Pending** — a row whose `consumedAt` is null.
- **Consumed** — a row that was delivered and whose turn produced a persisted assistant message.
- **Record** — the Host transcript message that documents the post.

## Decisions of record

These were settled with the operator before this spec was written. Do not reopen them.

| Question | Decision |
|---|---|
| What is "the next turn"? | Each target's own next generation. Alice may consume two messages before Bob does. |
| Regenerate / swipe | Re-applies. A swipe of a message that consumed an inform sees the same inform again. Pending informs are *not* delivered to a swipe. |
| Stacking | Multiple pending batches are all delivered, in posting order, `---`-separated. |
| Pending indicator | Yes: a composer chip naming who is still to be informed, with a cancel affordance. |
| Where in the prompt | A **separate system block** after the static system group (blocks 1–2), before the compressed-history block. Never inside block 1 or 2. |
| Framing text | **None.** The block is exactly what the operator typed. No preamble, no "do not mention this", no Host voice — for transparent and opaque characters alike. |
| Subset targets — transcript record | A Host message whispered to the targets, body verbatim. Operator-visible; stripped from every model's context. |
| All targets — transcript record | A public Host message, body verbatim. Same strip. The system block is the only delivery; the record is never double-delivered. |
| Host's wording | Text alone. No "The Host informs the company:" prefix in the record either. |
| Opaque characters | No special path. Delivery is the verbatim block for everyone; the record never reaches a model, so `systemTransparency` has nothing to gate. |
| Autonomous rooms | Delivered. Autonomous turns run the same `buildContext`. |
| Carina | Not delivered. Carina builds its own minimal call. |
| Second-person help | Guidance copy in the dialog only. No LLM rewrite. |
| Memory | The block is not a message, so the per-turn extractor never sees it. The record carries `systemSender`, and `buildTurnTranscript` skips Staff messages, so it is not extracted either. |
| Storage | A new table, `chat_informs`. Not hidden message rows, not a JSON column on `chats`. |

## Storage — `chat_informs`

One row per (batch × target). Duplicating the body per target is deliberate: consumption
is then a single-row `UPDATE`, with no read-modify-write of a shared array that a buffered
job-child write could clobber (see [Background jobs](#delivery-in-the-job-child)).

```sql
CREATE TABLE "chat_informs" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "contentMarkdown" TEXT NOT NULL,
  "recordMessageId" TEXT,
  "createdAt" TEXT NOT NULL,
  "consumedAt" TEXT,
  "consumedByMessageId" TEXT,
  FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_chat_informs_pending" ON "chat_informs" ("chatId", "participantId", "consumedAt");
CREATE INDEX "idx_chat_informs_batch" ON "chat_informs" ("batchId");
CREATE INDEX "idx_chat_informs_consumedBy" ON "chat_informs" ("consumedByMessageId");
```

- `participantId` is a **chat participant id**, never a character id — the same rule as `targetParticipantIds`.
- `recordMessageId` links every row of a batch to its Host record message. Nullable so a record-write failure cannot orphan the batch (the announcer convention: errors never propagate).
- `consumedByMessageId` is the assistant message whose generation delivered the row. It is what makes regenerate re-apply.
- No `userId` column ([single-user](../../../CLAUDE.md)).
- Consumed rows are kept. They are tiny, they make swipes honest, and the chat's cascade removes them. No sweep.

**Zod:** `lib/schemas/chat-inform.types.ts` — `ChatInformSchema` in the shape of `ChatDocumentSchema` (`lib/schemas/chat-document.types.ts`), plus `ChatInformInputSchema` omitting `id`/`createdAt`.

**Repository:** `lib/database/repositories/chat-informs.repository.ts`, `ChatInformsRepository extends AbstractBaseRepository<ChatInform>`, registered in `lib/database/repositories/index.ts` beside `chatDocuments`. Method names must classify correctly under the job-child proxy's `WRITE_PREFIXES` (`lib/background-jobs/child/child-repositories-proxy.ts:164`) — reads start with `find`, writes with `create`/`mark`/`delete`:

| Method | Kind | Purpose |
|---|---|---|
| `findPendingForParticipant(chatId, participantId)` | read | Rows with `consumedAt IS NULL`, ordered by `createdAt`, then `id` |
| `findConsumedByMessages(chatId, participantId, messageIds)` | read | Rows whose `consumedByMessageId` is in the set (swipe re-apply) |
| `findPendingBatches(chatId)` | read | Pending rows grouped by `batchId` for the composer chip |
| `findByChatId(chatId)` | read | Everything, for export and backup |
| `createBatch({ chatId, contentMarkdown, participantIds, recordMessageId })` | write | Mints one `batchId`, one row per target |
| `markConsumed(ids, messageId)` | write | Sets `consumedAt` + `consumedByMessageId` on exactly those ids |
| `deletePendingByBatch(batchId)` | write | Cancel: removes only rows with `consumedAt IS NULL` |
| `deletePendingForParticipant(chatId, participantId)` | write | Seat removed from the chat |
| `deleteByChatId(chatId)` | write | Mirror of `chatDocuments.deleteByChatId` wherever the chats repository calls it |

Add the repo to the method-override audit in [BACKGROUND_JOBS_CHILD.md](../BACKGROUND_JOBS_CHILD.md#method-name-overrides) only if a name falls outside the prefix rules; with the names above none should.

**Migration:** `migrations/scripts/add-chat-informs-table.ts`, id `add-chat-informs-table-v1`, `introducedInVersion: '4.10.0'`, modelled on `add-text-replacement-rules-table.ts` (`CREATE TABLE IF NOT EXISTS`, `shouldRun` = table absent). No loop, so no `reportProgress`. Add the pretty label to `PRETTY_LABELS` in `lib/startup/prettify.ts` — something like *"Laying out a tray for the notes you slip the cast"* — and the export to `migrations/scripts/index.ts`. Add the section to [DDL.md](../DDL.md) after `chat_documents`.

## API

All under the existing `/api/v1/chats/[id]` action dispatch (`handlers/post.ts`, `handlers/get.ts`, `actions/index.ts`, `schemas.ts`).

### `POST ?action=inform`

```ts
export const informSchema = z.object({
  contentMarkdown: z.string().min(1),
  /** Chat PARTICIPANT ids. null = every eligible seat at post time. */
  targetParticipantIds: z.array(z.uuid()).min(1).nullable(),
});
```

Handler `handleInform` in `actions/inform.ts`:

1. Resolve eligible seats: `CHARACTER`, `controlledBy === 'llm'`, `status !== 'removed'`, `removedAt` null.
2. `null` targets → every eligible seat. Otherwise validate every id is eligible (reuse `resolveAnnouncementAudience` from `lib/services/announcer/audience.ts` for membership, then filter for `controlledBy`); any miss → `badRequest` naming the ids. Empty eligible set → `badRequest('No LLM-controlled seat to inform.')`.
3. If the explicit set covers *every* eligible seat, treat it as `null` — the public/whisper distinction follows actual coverage, not how the operator clicked.
4. Post the record (below) through a new `postInformRecord` in `lib/services/announcer/writer.ts`, beside `postAdhocAnnouncement`. Returns the message or `null`; a null record does not fail the post.
5. `repos.chatInforms.createBatch(...)`.
6. `logger.info('[Chats v1] Inform posted', { chatId, batchId, targetCount, audience: 'public' | 'whisper', recordMessageId })`.
7. `created({ batchId, targetParticipantIds, message })`.

`addMessage` already bumps `transcriptVersion` and publishes `chats`; nothing more is needed for the transcript. The chip's query is on the same topic (see [Realtime](#realtime)).

### `GET ?action=informs`

Returns `{ batches: Array<{ batchId, contentMarkdown, createdAt, pendingParticipantIds: string[], recordMessageId }> }` from `findPendingBatches`. Rows whose participant is no longer in the chat are omitted (defensive; the remove-participant path deletes them anyway).

### `POST ?action=cancel-inform`

Body `{ batchId }`. `deletePendingByBatch`. If the batch had **no** consumed rows, also delete its record message (it would otherwise document something that never happened); if any row was consumed, the record stays and only the remaining targets are dropped. Then `publishRealtime('chats', chatId)` explicitly — a delete of pending rows touches no message row, so nothing else fires the hint. Returns `{ removed: number, recordDeleted: boolean }`.

### Participant removal

`handleRemoveParticipantAction` (`actions/participants.ts`) calls `deletePendingForParticipant` for the removed seat. Debug-log the count.

## The record message

Written by `postInformRecord({ chatId, contentMarkdown, targetParticipantIds })`:

| Field | Value |
|---|---|
| `role` | as other Host announcements |
| `systemSender` | `'host'` |
| `systemKind` | `'inform'` |
| `content` | the Markdown, verbatim, trimmed |
| `opaqueContent` | identical to `content` (the dual-body convention is honoured; there is simply no persona to strip) |
| `targetParticipantIds` | `null` when the batch covered every eligible seat; the target list otherwise |
| `customAnnouncer` | null |

The `systemKind` value `'inform'` is new. It is a free string on the message schema, so no enum changes; but add the label `inform: 'out of character'` to the kind-label map in `app/salon/[id]/components/system-message-labels.ts` so the collapsed chip reads *The Host · out of character · to Alice, Bob · 21:14*. The Salon's existing rule that Staff whispers always render for the operator and are never dimmed (`VirtualizedMessageList.tsx`, `isOverheardWhisper`) applies unchanged because `systemSender` is set.

### The record never reaches a model

This is the one hard invariant of the transcript side. Three places must honour it:

1. **`buildMessageContext`** (`lib/services/chat-message/context-builder.service.ts:861`): widen the Commonplace strip into a general *record-only* predicate — `isRecordOnly(m) = (commonplaceBook && !relevant-conversations) || m.systemKind === 'inform'` — so the record is dropped from every character's history, transparent or opaque, single- or multi-character. The regenerate/swipe path goes through the same function.
2. **The rolling summary** (`lib/chat/context-summary.ts`) and **budget compression** (`lib/chat/context/compression.ts`): verify what they feed the summarizer. If Staff messages are included, exclude `systemKind === 'inform'` — a record folded into a summary would reach the model by the back door.
3. **The Courier transport** (`courier-transport.service.ts`) builds its own transcript; exclude the kind there too if it includes Staff messages.

The Markdown transcript export (`lib/export/markdown-transcript.ts`) is for humans and keeps it. The memory extractor's `buildTurnTranscript` already skips every Staff message; nothing to do, but keep the test below.

## Delivery — the inform system block

### Where

`buildContext` (`lib/chat/context-manager.ts`, final assembly around `:2040–2080`). After block 2 (the identity reminder) and **before** block 3 (compressed history):

```ts
if (informBlock) {
  contextMessages.push({ role: 'system', content: informBlock, metadata: { isInjected: true } })
}
```

Content is the rows' `contentMarkdown` in delivery order, joined with `\n\n---\n\n`. Nothing else. When there is nothing to deliver, nothing is pushed — **byte-for-byte identical** to today, which is what keeps the cache-determinism golden (`__tests__/unit/cache-determinism/system-prompt.test.ts`) and the 30-turn stability eval untouched.

Why this position and not "right after block 1" literally: blocks 1 and 2 are the static prefix. The Anthropic plugin puts its `cache_control` breakpoint on the **first** system block only (`plugins/dist/qtap-plugin-anthropic/provider.ts:442`, `:628`), OpenAI-style prefix caching is unaffected by anything after an unchanged prefix, and local providers fold the leading system run into one message (`collapseLeadingSystemMessages`) so an extra block costs them nothing. Placing the inform between 2 and 3 keeps the cached region contiguous; to the model, "after the system prompt" is exactly what it sees. Neither `IDENTITY_STACK_BUILDER_VERSION` nor `PROMPT_CACHE_STRUCTURE_VERSION` is bumped: the block is conditional, not structural.

Add a row to the wire-order table in [PROMPT_ARCHITECTURE.md §2](../PROMPT_ARCHITECTURE.md), a bullet in §14 ("the inform block is the one sanctioned turn-variable system block, and it is empty-is-absent"), and a line in the CLAUDE.md chokepoint list.

### Which generations

Every generation for an LLM seat that goes through `buildContext` with a `respondingParticipant`: a normal Salon turn, a nudge, a queued turn, a chained autonomous turn. **Do not gate on `isContinueMode`** — autonomous rooms run with `continueMode: true` (`autonomous-room-turn.ts`), so a continue-gate would silently exclude them; a "Continue" press in the Salon delivering a pending inform is harmless and correct. Turn-skipping (`[NOTHING TO ADD]`) persists no assistant message, so a pass leaves the rows pending and they are delivered again on the seat's next attempt — the information waits until the character actually speaks.

Not delivered: Carina (`lib/services/carina/carina.service.ts`, own builder), the greeting (`lib/chat/initialize.ts`, no rows can exist yet), the character-voiced announcer preview, the impersonation voice rewrite, help chat, Brahma.

### Chokepoint

One reader: **`buildInformBlock({ repos, chatId, participantId, regenerationOfMessageIds? })`** in `lib/chat/context/inform-block.ts`, returning `{ content: string | null, rowIds: string[] }`. It selects pending rows, plus — when `regenerationOfMessageIds` is given — rows consumed by any of those ids. Nothing else reads `chat_informs` on the prompt path. Debug-log `{ chatId, participantId, pending, reapplied }`.

`BuildContextOptions` gains `regenerationOfMessageIds?: string[]`; `BuiltContext` gains `informRowIds: string[]`.

### Consumption

Consumption is tied to a **persisted assistant message**, never to context building:

- `buildMessageContext` returns `informRowIds` alongside `formattedMessages`; the orchestrator threads it to `finalizeMessageResponse`, which calls `repos.chatInforms.markConsumed(informRowIds, assistantMessageId)` immediately after `saveAssistantMessage` (`message-finalizer.service.ts:269`). The abrupt-stream partial-preservation path in `primary-stream.service.ts:89` persists a message too, and consumes likewise — the content was delivered.
- A provider failure that saves nothing leaves the rows pending. Next turn retries.
- Swipes never consume. `regenerateMessageAsSwipe` passes `regenerationOfMessageIds = [targetMessage.id, ...every id in its swipe group]` and ignores the returned `rowIds`. Pending rows are deliberately not delivered to a swipe: a swipe re-rolls a past line, and it would be surprising for a brand-new inform to land there and vanish.

### Delivery in the job child

Autonomous turns read through the child proxy (`findPendingForParticipant` passes through to the readonly connection) and buffer `markConsumed`, which the parent applies in the same main-DB batch as the assistant message insert. Read-your-writes does not arise: nothing on the turn re-reads the rows after marking them. `publishRealtime` is a no-op in the child by design; the parent's completed-job invalidation already publishes `{ topic: 'chats', id }`, which refreshes the composer chip.

## The dialog

### Button

`components/chat/ComposerGutterTools.tsx`. The grid is two columns filled left-to-right: Announce / Mail; Library / Image; Attach / RNG; then Pascal when a custom-tool roster resolves. Place **Inform** immediately after the Pascal slot, so row 4 is *Pascal, Inform* when Pascal is present and *Inform* alone otherwise. Update the layout comment at the top of the file. Icon: `info` (already in `components/ui/icons/icon-registry.ts`; Madman's Box may or may not override it — either is fine). `title` / `aria-label`: **"Inform the cast"**. Disabled under the same conditions as Insert Announcement.

Wiring mirrors Insert Announcement exactly: `informOpen` / `openInform` / `closeInform` in `app/salon/[id]/hooks/useModalState.ts`, an `onInformClick` prop through `ChatComposer` → `ComposerGutterTools`, and the dialog rendered from `ChatModals.tsx` with the same participant projection the announcement dialog receives.

### `components/chat/InformDialog.tsx`

A `FloatingDialog` (title **"Inform the cast"**, `storageKey: 'quilltap:inform-geometry'`). The operator asked for it to be *wide enough to hold the whole formatting toolbar*: measure `MarkdownLexicalEditor`'s toolbar at its natural width and set `initialGeometry.width` and `minWidth` so the toolbar never wraps at the minimum — expect something in the region of 820 wide, and set `minWidth` to the measured toolbar width plus the dialog's horizontal padding. Do not guess; measure in the browser and record the number in the component comment.

Layout, top to bottom:

1. **Audience.** A row of chips: **Everyone** (default, selected) followed by one chip per eligible seat (avatar + name; silent/absent seats shown with their status, still selectable). Selecting any seat deselects Everyone; selecting every seat is equivalent to Everyone and the dialog sends `null`. Seats with `controlledBy === 'user'` are not shown at all.
2. **Guidance** (steampunk voice, short). The gist, to be worded by the implementer: *Write it to them, in the second person, as a thing they now know or notice — "You see that Alice slipped the letter into her sleeve." "You remember that Bob and Carol were at school together." Everyone you pick receives the very same words before their next turn, so write a passage that is true from each of their chairs. It is never spoken aloud, and it is gone once they have had their turn.*
3. **Editor.** `MarkdownLexicalEditor` (`namespace="InformDialog"`, `ariaLabel="What they are told"`), filling the remaining height.
4. **Footer.** *Cancel* and **Inform** (primary; disabled when the body is empty or no seat is selected). While posting, both disabled.

On success: `showSuccessToast`, `onPosted()` → `fetchChat()` (the record appears), invalidate `queryKeys.chats.informs(chatId)`, close. The whole dialog is conditionally mounted like the announcement dialog, so state resets on each open.

### The pending chip

Rendered in the composer, adjacent to the gutter (implementer's call on exact placement; it must not shift the editor). One chip per pending batch: **"Informing Alice, Bob before their next turn"** with a × that calls `cancel-inform`, and a hover/title showing the first line of the body. Names resolve from the chat payload's participants. Hidden when there are no batches.

Data: `useQuery({ queryKey: queryKeys.chats.informs(chatId), queryFn: ({ signal }) => apiFetch(...?action=informs, { signal }) })`. Add `informs: (id) => ['chats', id, 'informs']` to `queryKeys.chats` in `lib/query/keys.ts` and the key to the `chats` case of `lib/realtime/topic-map.ts` so the existing `publishRealtime('chats', chatId)` hint refreshes it. Gate any refetch interval with `useRealtimeRefetchInterval` — **a new polling site is a bug**.

## Export, import, backup

- **`.qtap` export:** a new record kind `chat_inform`, emitted per chat after `chat_message` and before `conversation_annotation` in `lib/export/ndjson-writer.ts` (consumed rows included — they are what make swipes honest after a round-trip). Add `ChatInform` to `$defs` and the kind to the record enum in `public/schemas/qtap-export.schema.json`; add the type to `lib/export/types.ts`; handle the kind in `lib/import/quilltap-import-stream.ts` and create rows in `lib/import/quilltap-import/execute.ts` after chats and messages exist, remapping `chatId`, `participantId`, `recordMessageId` and `consumedByMessageId` in `reconcile.ts`. A row whose remapped participant or record message is missing is dropped with a `warn`, not imported dangling.
- **Backup / restore:** collect `chatInforms` per chat in `lib/backup/backup-service.ts` (beside `chatDocuments`), write `data/chat-informs.json`, and add it to `types.ts` (data + counts), `restore/archive.ts`, `restore/preview.ts`, `restore/restore.ts` and `restore/uuid-remap.ts`, following `chatDocuments` line for line.
- **SillyTavern export:** nothing new — the record is a Staff message and follows whatever Staff messages already do.
- **Chat merge / continuation** (`lib/chat/apply-chat-merge.ts`, `apply-chat-continuation.ts`): pending informs do not travel. Deferred; note it in the help doc.

## Realtime

| Event | Hint |
|---|---|
| Post | `addMessage` publishes `chats` (record insert) — nothing extra |
| Cancel | explicit `publishRealtime('chats', chatId)` in the handler |
| Consume (parent turn) | the assistant message insert publishes `chats` |
| Consume (job child) | no-op in the child; the parent's completed-job invalidation publishes `chats` |

## Logging

Debug on every touched backend path: the reader (`pending` / `reapplied` counts per generation), `markConsumed` (ids, message id), `createBatch` (batch id, target count), cancel (removed count, whether the record went), participant-removal cleanup. `info` on the post itself. `warn` on a record-write failure and on an import row dropped for a missing FK.

## Documentation

- `help/inform.md` — `url: /salon`, an *In-Chat Navigation* section with `help_navigate(url: "/salon")`, steampunk voice: what the button does, who can be informed, the second-person rule with the two example lines, that the words are never spoken and are gone after the turn, the transcript record and what it looks like (public vs. whispered chip), the pending chip and cancelling, regenerate behaviour, autonomous rooms, and the two caveats — it does not follow a chat through a merge, and Carina does not hear it. Cross-link from `help/insert-announcement.md` (one sentence: an announcement is *said*; an inform is *known*).
- `.claude/commands/update-documentation.md` — add the help entry.
- `docs/developer/PROMPT_ARCHITECTURE.md` — §2 table row, §14 trap, §15 key-file row for `inform-block.ts`.
- `docs/developer/DDL.md`, `docs/developer/API.md`, `docs/developer/BACKGROUND_JOBS_CHILD.md` (only if a method needs an override).
- `CLAUDE.md` chokepoints: *Inform delivery is `buildInformBlock` and consumption is `markConsumed` after a persisted assistant message; a swipe re-applies by message id and never consumes; the `inform` record is record-only and is stripped in `buildMessageContext`.*
- `docs/CHANGELOG.md` — plain voice, under 4.10-dev.

## Tests

- `__tests__/unit/lib/chat/context/inform-block.test.ts` — pending rows in order; `---` join; regeneration set includes consumed-by rows and excludes pending ones; empty → `content: null`, `rowIds: []`.
- `buildContext` — with no rows the assembled messages are **byte-identical** to today (extend the existing cache-determinism golden with an explicit empty-informs assertion); with rows, exactly one extra `system` message sits between the identity reminder and the compressed-history block, and no other message changes.
- `buildMessageContext` — an `inform` record is absent from the formatted history in single- and multi-character chats, for transparent and opaque rosters, and from the swipe path.
- `actions/inform` — `null` → every eligible seat; explicit full coverage → public record; a user-controlled or removed id → 400; record failure still creates the batch; cancel with nothing consumed deletes the record, cancel after partial consumption keeps it.
- Finalizer — `markConsumed` called with the threaded ids and the saved message id; not called when the save throws; the partial-preservation path consumes.
- `regenerateMessageAsSwipe` — passes the swipe group, never calls `markConsumed`.
- `buildTurnTranscript` — an `inform` record is skipped (guards the memory decision).
- Export/import round-trip — rows survive with remapped ids; a row with a missing participant is dropped with a warning.
- Backup/restore — `chat-informs.json` written and restored, counts reported.
- Migration — creates the table and indexes; idempotent.
- Snapshot: none of the tool-definition snapshots change (no tool is added).

## Engineering tasks (phased; delegate the mechanical ones)

### Phase 0 — storage (delegable)
Schema, repository, migration + pretty label + index, DDL.md, `deleteByChatId` mirror, participant-removal cleanup.

### Phase 1 — record + API (delegable after 0)
`postInformRecord`, `informSchema`, `handleInform`, `handleGetInforms`, `handleCancelInform`, dispatch registration, API.md, the record-only strip in `buildMessageContext` and the summary/compression/Courier audit, `system-message-labels` entry.

### Phase 2 — delivery (plan carefully; not delegable)
`inform-block.ts`, `BuildContextOptions.regenerationOfMessageIds`, `BuiltContext.informRowIds`, the block push, threading through `buildMessageContext` → orchestrator → finalizer (both save sites), swipe wiring, the cache-determinism assertion, PROMPT_ARCHITECTURE.md.

### Phase 3 — UI (delegable after 1)
Button, modal state, `InformDialog` (measure the toolbar), pending chip, query key + topic-map row.

### Phase 4 — export/import/backup (delegable after 0)

### Phase 5 — docs + CHANGELOG

## Verification (live, on the V4test instance — never Friday)

1. Two-character chat, transparent Alice, opaque Bob. Inform Everyone: *"You notice the clock has stopped."* — public Host chip appears, body verbatim, no preamble. Open the LLM log for Alice's next turn: a third system block containing exactly that sentence, block 1 unchanged from the previous turn, the record absent from history. Same for Bob.
2. Inform Alice only. Whispered chip *to Alice*. Bob's next log shows no inform block and no record. Alice's shows the block. Chip disappears after Alice's turn; the record stays.
3. Post two informs for Alice before she speaks; her block carries both, in order, `---` between.
4. Swipe Alice's message from step 1: the log shows the block again; the row's `consumedByMessageId` is unchanged; the chip does not reappear.
5. Post an inform, then cancel: chip and record both gone, `chats` refreshes without a reload. Post, let Alice consume, cancel the rest: record stays, Bob's row gone.
6. Autonomous room with a pending inform: the next chained turn's log shows the block; the chip clears when the job completes.
7. Continue on a pending inform: delivered and consumed.
8. Turn-skip: Alice passes with the sentinel; the row is still pending; her next real turn consumes it.
9. Export `.qtap`, import into a scratch instance: rows present with remapped ids. Backup, restore: same.
10. Confirm no new polling: the chip's query has no bare `refetchInterval`.

## Deferred

- LLM rewrite into second person with review (the announcement dialog's `VoiceRewriteReviewPanel` would fit if ever wanted).
- Per-target variants of the same inform.
- Expiry after N turns, or a standing "until cancelled" mode.
- Editing a pending inform (cancel and re-post covers it).
- Carrying pending informs across a merge or continuation.
- A `qt-*` class review for the chip and dialog beyond what the announcement dialog already uses — reuse first.
