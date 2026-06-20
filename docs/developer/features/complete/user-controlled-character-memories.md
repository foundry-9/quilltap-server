# Feature Plan: Memory Formation for User-Controlled Characters

## Goal

Let a user-controlled character form memories (both SELF and observations of
others) from the turns where the human is driving it — so that when the
character is later handed back to LLM control, it carries forward the
impressions, facts, and relationships built up while the human was role-playing
it.

**Decisions already made (do not re-litigate):**

- **Scope:** SELF memories *and* OTHER-pass observations of the other
  characters. Not SELF-only.
- **Gating:** Always on. Every user-controlled character forms memories on every
  qualifying turn. No new per-character flag, no new UI, no new settings field.

## Background: why it doesn't happen today

Memory extraction is driven entirely by `characterSlices` on the
`TurnTranscript`. A user-controlled character never becomes a slice:

- `buildTurnTranscript` (`lib/services/chat-message/turn-transcript.ts`) only
  groups messages where `m.role === 'ASSISTANT'` into slices. The user's
  message arrives as `role: 'USER'` and is treated as the turn *opener*
  (`userMessage`), and a fresh USER message actually *ends* the forward walk
  (the `if (m.role === 'USER' && !m.systemSender) break;` at ~line 110).
- `processTurnForMemory` (`lib/memory/memory-processor.ts`) builds
  `allowedSlices` from `transcript.characterSlices`, then runs the SELF pass
  (`for (const slice of allowedSlices)`) and the OTHER pass
  (`for (const observer of allowedSlices)`) over exactly those slices. No slice
  ⇒ no SELF, no OTHER-as-observer.
- The user character is already injected into the OTHER pass's **subject** set
  (with `isUser: true`), which is why *other* characters already form memories
  *about* the user. Being a subject is passive — it never makes the user
  character a holder.

So today the user character is a thing memories are *about*, never a thing that
*holds* them.

## Key facts confirmed during investigation

1. **The user's message carries the user-controlled character's participant ID.**
   In `orchestrator.service.ts` (~line 634) the persisted USER message sets
   `participantId: userParticipantId`, and `userParticipantId` resolves (via
   `participant-resolver.service.ts` → `findUserParticipant`) to the
   user-controlled CHARACTER participant. So a clean user slice — text +
   contributing message IDs + character identity — is reachable from existing
   data. We do not need to parse anything heuristically.

2. **Multi-impersonation exists.** `findUserParticipant` (singular) is
   `@deprecated` in favor of `findUserControlledParticipants` (plural) in
   `lib/chat/turn-manager/utils.ts`. A chat can have more than one
   user-controlled character. The transcript currently models only a single
   `userCharacterId`. The plan must decide how to handle N user characters
   (see Open Decisions) — but the **minimum viable** version can build a slice
   for each distinct `participantId` among the turn's USER messages that maps to
   a `controlledBy: 'user'` CHARACTER participant, which generalizes cleanly.

3. **All downstream machinery is keyed on character ID and already works for
   any character ID:** `resolveExtractionRateLimit`, the Memory Gate
   (`createMemoryWithGate`), near-duplicate absorption, vault canon loading
   (`loadCanonForSelf`, `Others/<subject>.md`), `aboutCharacter` resolution,
   timestamp anchoring. The user character has a normal `Character` record with
   a vault. Nothing in this layer needs user-specific special-casing.

4. **The transcript currently presents the user's text as the opener**
   (`renderTurnContext` in `memory-tasks.ts`: `"<name> (the user) says: ..."`).
   If the user character also becomes a slice, we must avoid feeding the same
   text twice in a way that confuses the extractor, and the SELF prompt must
   attribute first-person "I…" text to the user character correctly.

## Design

The cleanest approach keeps the existing two-pass machinery intact and changes
**what counts as a slice**. We promote the user-controlled character(s) to
first-class slice(s) for this turn, then let the existing SELF and OTHER loops
pick them up — with a few guarded adjustments so the rendered transcript and
prompts stay coherent.

### Slice model change

Add a flag to `TurnCharacterSlice`:

```ts
export interface TurnCharacterSlice {
  characterId: string
  characterName: string
  characterPronouns?: Pronouns | null
  text: string
  contributingMessageIds: string[]
  /** True when this slice's text was authored by the human driving a
   *  user-controlled character (role: 'USER'), not by the LLM. */
  isUserControlled?: boolean   // NEW
}
```

This lets every consumer that already iterates slices keep working, while the
few places that must render or prompt differently can branch on
`isUserControlled`.

### `buildTurnTranscript` changes (`turn-transcript.ts`)

Today the forward walk `break`s on the first non-system USER message and only
collects ASSISTANT messages. We need user-controlled USER messages *within the
turn window* to also become slices, without breaking turn-boundary semantics.

Important subtlety: the **turn opener** is itself a USER message authored by the
user character. We do not want the opener to both (a) populate `userMessage` /
be rendered as the opener *and* (b) silently vanish from SELF formation. The
intent is that the user character forms SELF memories from everything it
contributed this turn — which includes the opener text.

Recommended approach:

1. Keep `userMessage` / `turnOpenerMessageId` exactly as today (the opener still
   frames the turn for the OTHER pass and for non-user characters' context).
2. **Additionally** build a user slice (or slices) from every USER message in
   the turn window whose `participantId` maps to a `controlledBy: 'user'`
   CHARACTER participant — *including* the opener. Join their text the same way
   ASSISTANT slices are joined.
3. Append the user slice(s) to `characterSlices` with `isUserControlled: true`.
4. Do **not** change the `break` behavior in a way that would let a *second*
   human turn bleed into the current one. The turn window is still "opener →
   next genuine user turn." The opener belongs to the current turn; a
   *subsequent* USER message that starts a new turn still closes it. (In
   practice, within a single turn the only USER messages are the opener plus any
   the orchestrator attributes to the user character before control returns to
   an LLM; verify against autonomous and multi-impersonation flows.)

Because the user message persists with the right `participantId`, you can build
the slice by the same `participants.find(...)` + `participantCharacters.get(...)`
lookup already used for ASSISTANT slices — just with the `controlledBy === 'user'`
branch instead of the `!== 'user'` assumption baked into the current ASSISTANT
filter.

### `resolveUserCharacterParticipant` (in `memory-extraction.ts`)

Currently returns a single optional user character. To support
multi-impersonation, generalize to return all user-controlled CHARACTER
participants (use `findUserControlledParticipants`, the non-deprecated plural).
The single `userCharacterId/Name/Pronouns` on the transcript can stay for the
OTHER-pass *subject* injection (or be widened to a list — see Open Decisions),
but slice construction should handle all of them.

### `memory-processor.ts` changes

The SELF and OTHER loops already iterate `allowedSlices`. Once user slices are
present, **they participate automatically.** Required adjustments:

1. **Rate limiting:** `rateLimits` is populated from
   `ctx.transcript.characterSlices`, so user slices get rate-limited too. Good —
   no change needed, but confirm the per-character hourly cap is desirable for a
   human-driven character (it is: prevents a long role-play session from
   flooding memory).

2. **OTHER-pass subject set / self-exclusion:** The OTHER pass extracts
   `(observer, subject)` pairs where subject ≠ observer. The user character is
   *already* in the subject set. With the user character now also an observer
   slice, verify the existing "skip self" logic excludes the user character as
   its own subject (it should, since it keys on character ID — but add/confirm a
   test). Also ensure we don't double-add the user character to `subjects`
   (once via the `allowedSlices` loop now that it's a slice, once via the
   explicit `if (ctx.transcript.userCharacterId ...)` block). **De-dupe by
   character ID** when assembling `subjects`.

3. **`isUser` flag on subjects:** Keep tagging the user character's *subject*
   entry with `isUser: true` so other characters' OTHER prompts still read
   "(the user-controlled character)". That's about how *others* see the user and
   is unchanged.

### `memory-tasks.ts` (prompt rendering) changes

`renderTurnContext` must stay byte-stable across SELF/OTHER calls within a turn
(prompt-cache prefix), so any change here applies uniformly.

1. **Roster:** Today AI characters are listed under "CHARACTERS (AI characters
   in this chat)" and the user under "USER". When the user character is also a
   memory-forming slice, the roster should make clear it's both the human
   participant *and* a character that can hold memories. Simplest: keep the
   USER line, and in the transcript body label its slice consistently. Avoid
   listing the same name under both "USER" and "CHARACTERS" in a contradictory
   way.

2. **Transcript body double-feed:** Today the opener is rendered as
   `"<name> (the user) says: ..."` and slices as
   `"<name> (the character) says: ..."`. If the user character is now a slice
   built partly from the opener text, rendering both would duplicate the opener.
   **Resolution:** render the user-controlled character's contribution exactly
   once. Recommended: drop the separate opener rendering *for the user
   character's own text* and let its slice carry it, labeled as the user
   character. Keep `userMessage` available for any non-user consumer that needs
   "what the human said" framing, but do not emit it twice in the same prompt.
   Pin this down with a snapshot test (below).

3. **SELF prompt first-person attribution:** The SELF extractor is tuned on
   third-person-ish assistant prose. Human role-play is often first person
   ("I told him I wouldn't go"). Add a clause to the SELF prompt (or a
   conditional clause gated on `isUserControlled`) instructing the extractor
   that this character's lines may be written in the first person and that
   "I/me/my" refers to the slice's character. Validate empirically — this is the
   single biggest *quality* risk.

### `aboutCharacter` / resolution

`namesForAboutCharacter` already appends `USER_GENERIC_ALIASES` ("user", "the
user") when `controlledBy === 'user'`. For SELF memories the user character
forms about *itself*, `aboutCharacterId === characterId`, which is fine. For
OTHER memories the user character forms about *other* characters, the existing
resolver applies unchanged. No change expected; add tests to lock it.

## Files to touch

- `lib/services/chat-message/turn-transcript.ts` — add `isUserControlled` to
  `TurnCharacterSlice`; build user slice(s) from in-turn user-controlled USER
  messages; keep opener semantics.
- `lib/background-jobs/handlers/memory-extraction.ts` — generalize
  `resolveUserCharacterParticipant` to all user-controlled participants
  (`findUserControlledParticipants`); pass through what the transcript builder
  needs.
- `lib/memory/memory-processor.ts` — de-dupe the OTHER-pass `subjects` by
  character ID; confirm self-exclusion; confirm rate-limit coverage. (Likely
  small.)
- `lib/memory/cheap-llm-tasks/memory-tasks.ts` — `renderTurnContext` single-feed
  of the user character's text; SELF-prompt first-person clause gated on
  `isUserControlled`.
- `lib/chat/turn-manager/utils.ts` — no change expected, but this is where
  `findUserControlledParticipants` lives; use it instead of the deprecated
  singular.

## Logging (project requirement: debug logs on touched backend paths)

Add `[Memory]` debug logs for the new path, mirroring the existing style in
`memory-processor.ts`:

- When a user-controlled slice is built: log character name + contributing
  message count.
- When SELF/OTHER passes run for a user-controlled slice: log
  `"SELF for <name> (user-controlled): N candidate(s)"` so the per-message debug
  panel distinguishes user-driven extraction from LLM-driven.
- When de-duping subjects, log any collision skipped.

These surface in the existing `debugMemoryLogs` panel on the turn's latest
assistant message.

## Testing

Existing tests live under `lib/memory/cheap-llm-tasks/__tests__/` and likely
around the processor/transcript. Add/extend:

1. **Transcript builder unit test** — a turn where the opener is authored by a
   `controlledBy: 'user'` character produces a `characterSlices` entry with
   `isUserControlled: true`, correct joined text, and correct
   `contributingMessageIds`. Multi-impersonation: two user characters →
   two user slices.
2. **No-double-feed snapshot** — `renderTurnContext` for a turn with a
   user-controlled character emits that character's text exactly once. Snapshot
   the rendered prompt (this also guards the prompt-cache prefix). Update via
   `npx jest -u` deliberately.
3. **Processor integration** — user-controlled slice yields SELF candidates
   attributed to the user character (`aboutCharacterId === characterId`) and
   OTHER candidates about the *other* present characters; the user character is
   not its own OTHER subject; `subjects` has no duplicate user entry.
4. **Rate-limit** — user-controlled slice respects the per-character hourly cap
   and throttle floor.
5. **Regression** — a turn with **no** user-controlled character (plain human
   user, no persona) behaves exactly as before: user appears only as an OTHER
   subject, forms no memories.
6. **`aboutCharacter` resolution** — OTHER memory the user character forms about
   another character resolves to that other character's ID, not flipped to the
   user.

## Open decisions for the implementer

1. **Multi-impersonation subject widening.** The transcript today carries a
   single `userCharacterId/Name/Pronouns` for OTHER-pass *subject* injection.
   With multiple user characters now also being *observers* via slices, decide
   whether to widen those subject fields to a list, or rely solely on the
   slice-derived subjects (which already covers all present characters). Leaning:
   derive subjects from slices + remaining present characters uniformly and
   retire the special single-user subject block, de-duping by ID. Confirm this
   doesn't drop the user as a subject when the user character spoke but is being
   observed by an LLM character in the same turn.

2. **Greeting/continue turns with no user opener.** When `turnOpenerMessageId`
   is null (greeting-only), there's no user text to slice — correct, the user
   character simply forms nothing that turn. Confirm no crash on the null path.

3. **Autonomous rooms.** In `chatType === 'autonomous'` there is no human user
   driving a character mid-run. Ensure the new user-slice construction is inert
   there (no user-controlled participants are speaking), so the
   `inAutonomousRoom` path is unaffected. Add an assertion/test.

4. **Witnessed context / source attribution.** Memories the user character forms
   should carry normal (non-autonomous) `witnessedContext`. Verify the existing
   attribution doesn't mis-tag them.

## Effort estimate

Moderate. The data model and downstream machinery already support arbitrary
character IDs as memory holders, so there is no schema change, no migration, no
new DB column, no `.qtap`/SillyTavern export change, and no settings/UI work
(given "always on"). The work concentrates in four files and is mostly:
(a) constructing the user slice in the transcript builder, (b) preventing
double-feed in prompt rendering, (c) de-duping subjects, and (d) a SELF-prompt
first-person clause. The dominant *risk* is extraction **quality** on
first-person human prose, which is a prompt-tuning and eval problem rather than
a plumbing one — budget iteration time for reading real debug logs from a live
`npm run dev` session and adjusting the SELF prompt.

## Documentation to update (per project conventions)

- Help files in `help/*.md` if this is user-visible (it is — a character now
  "remembers" being played). Add to the memory/Commonplace Book help page in the
  house steampunk-Wodehouse voice, with correct `url` frontmatter and matching
  `help_navigate` In-Chat Navigation call.
- `docs/CHANGELOG.md` — terse, direct entry (changelog is the plain-English
  exception to house style).
- The Commonplace Book section of any developer memory docs if the holder
  semantics are documented there.
- No `DDL.md` change expected (no schema change) — but confirm.
