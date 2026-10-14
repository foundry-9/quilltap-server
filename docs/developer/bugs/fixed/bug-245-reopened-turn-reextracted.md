# Bug 245 — A reopened turn is extracted again from its first line

| | |
|---|---|
| **Status** | Fixed 2026-10-14 |
| **Found** | 2026-10-13, V4test dogfood of the memory refactor (a Skip after a closed multi-character turn) |
| **Fixed** | 2026-10-14 |
| **Severity** | Medium — the earlier speakers' lines are read a second time, so the memories they produced a minute ago are reinforced by their own source (counts and `reinforcedImportance` inflate), and a paraphrase that misses the reinforce threshold lands as a near-duplicate row; every re-read also spends a cheap-LLM call per cast member |
| **Who it bites** | any Salon turn reopened after it closed: Skip, nudge, a continue, a late chained speaker. and autonomous rooms, where no USER opener exists, so each speaker's job read the room from its first line (confirmed in the transcript builder) |
| **Provenance** | Original to v4. The per-turn trigger has addressed a turn by its USER opener and re-extracted the whole interchange on each close since the per-turn redesign; Phase D of the memory refactor moved it onto `runTurnExtraction` unchanged. Bugs 209 and 231 fixed duplicates *inside* one job and across *concurrent* jobs; this is two *sequential* jobs over one turn |
| **Defect site** | `lib/services/chat-message/memory-trigger.service.ts` — `triggerTurnMemoryExtraction` enqueues `{ turnOpenerMessageId }` with no record of which slices were already read; `lib/background-jobs/queue-service.ts` `enqueueMemoryExtraction` dedupes only against PENDING/PROCESSING jobs; `lib/services/chat-message/turn-transcript.ts` `buildTurnTranscript` collects every assistant message after the opener |
| **Fix site** | `lib/services/chat-message/turn-transcript.ts` (`extractAfterMessageId`, `priorSlices`, `withPriorAsMaterial`, autonomous bounds in `listExtractionTurns`); `lib/memory/extraction/turn.ts` (`liveTurnBound`, `advanceTurnCursor`); `lib/memory/extraction/window.ts` (`PRIOR_TURN_CONTEXT_HEADING`); `lib/memory/extraction/passes/other-turn.ts`; a `turn` row in `memory_extraction_cursors` (`lib/schemas/memory-extraction-cursor.types.ts`), carried in bundles as `turnExtractionWatermarkMessageId` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-14).** The turn grain has a cursor: a `turn` row in
`memory_extraction_cursors` holding the last assistant message a committed turn extraction
covered. It only moves forward. A live turn job reads it as the transcript's lower bound;
`buildTurnTranscript` applies a bound only when it is one of the turn's own lines, so a cursor
left in an older turn (or moved ahead by a concurrent job) never hides a turn's lines. Lines at or
before the bound, the opener's slice with them, become `priorSlices`: rendered under
"EARLIER IN THIS TURN (already noted — context only…)", capped at 8 messages, never extraction
material. SELF runs only for speakers with new lines. OTHER still runs for everyone who spoke: a
speaker from the earlier part reads only the new lines and is skipped when nobody else said
anything new; a speaker new to the turn reads the whole turn (`withPriorAsMaterial`), since none of
it was observed through them before. A regenerate and the queue-memories batch read each turn whole
(they do not consult the cursor, and advance it only forward). **Autonomous rooms (confirmed in the
transcript builder):** `listExtractionTurns` now bounds each speaker by the previous anchor, so a
rebuild reads each line once instead of the room's whole history per speaker, and a live speaker's
job is bounded by the cursor. Tests: `context-and-carina.test.ts` ("a reopened turn is read past its
turn cursor"), `turn-transcript.test.ts` ("reading a turn past lines already extracted"), the
regenerate test's autonomous bounds, and the bundle round-trips in `uuid-remapper.test.ts`,
`restore-field-fidelity.test.ts` and `duplicate-chat-message-ids.test.ts`. Verified on V4test
2026-10-14: a Skip after a closed turn ran SELF for the two new speakers only, and the cursor moved
to the new last line.

## Symptom

V4test, chat "Marmalade, the Packard, and Dirigible Shares" (Lorian, Riya, Tester as the user
character), 2026-10-13:

1. 23:02 — Tester sends a message; Lorian answers; the turn closes. Job `23da5249` extracts it:
   3 candidates, 3 created — among them Lorian's SELF memory `08777ab3` ("committed to friday
   notary hold").
2. 23:08 — Tester presses **Skip**; Riya answers; the turn closes again. Job `1795f0d3` extracts the
   *same* turn (`turnOpenerMessageId` `2a439f92` both times): the self-turn pass runs for all three
   cast members (`calls: 3`), re-reads Lorian's unchanged line and **reinforces `08777ab3` from its
   own source** (`reinforcementDelta: 1`, `novelDetails: 0`, cosine 0.72). Tester's memory
   `86f785c6` is reinforced the same way.

Nothing new was said by Lorian or Tester between the two jobs.

## Root cause

A turn is addressed by its USER opener. `buildTurnTranscript` walks every assistant message after
the opener and groups them into per-speaker slices; every pass then extracts from every slice. The
finalizer triggers extraction when control returns to the user, which in a normal chain happens
once. A Skip (or nudge, or continue) hands the floor out again *without a new USER message*, so the
next close triggers a job with the same opener, and its transcript holds the earlier speakers'
lines as well as the new one. The queue's dedupe cannot help: the first job finished minutes ago.
Admission's per-attempt key stops a retried job counting twice, not a second job.

**Suspected in autonomous rooms (not confirmed on live data).** An autonomous room has no USER
opener; the finalizer triggers on every speaker with `extractionAnchorMessageId` set to that
speaker's message. With `turnOpenerMessageId: null`, `buildTurnTranscript` starts scanning at the
first message and stops at the anchor, so — in isolation, with a four-message history `A1 B1 A2 B2`
and anchor `B2` — the slices are `Ann: "A1\n\nA2"` and `Bob: "B1\n\nB2"`: the whole history so far,
not the last exchange. If that is what runs live, every autonomous turn re-reads the room. Friday's
130-turn room "The Coat That Hasn't Spoken" averages 1.6 reinforcements (max 8), which does not
look like a full re-read per turn, so something may bound it; this needs checking against a fresh
room before the fix is designed.

## Why it survived

The extraction tests address one turn once. The dogfood walks before this one never reopened a
closed turn; the turn-transcript tests have no case with a null opener and an anchor.

## Fix (as proposed; built — see the FIXED paragraph above)

Give the turn grain a cursor, as the fold passes have: record per chat the last assistant message a
turn job has extracted, and build the next job's transcript from the slices after it (earlier
slices as read-only context, never as extraction material). The same cursor bounds an autonomous
room's per-speaker jobs. `memory_extraction_cursors` already has the shape (`chatId`, `pass`,
`messageId`); a `turn` pass row would serve.

## How to verify

On V4test: in a multi-character chat, send a message, let the turn close and its extraction finish,
then press **Skip**. The second job's `[Memory] Pass complete` for `self-turn` should report one
call (the new speaker), and no memory created by the first job should be reinforced by it. For
autonomous rooms: start a fresh two-character room, let it run four turns, and compare each
extraction's transcript to the speaker's own message.
