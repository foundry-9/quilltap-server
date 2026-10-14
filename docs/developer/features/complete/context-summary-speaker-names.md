# Feature: the context summary names its speakers

**Status:** **complete** — landed in v4.10-dev on 2026-09-21. Design of record for
[bug 161](../../bugs/fixed/bug-161-summary-invents-a-name.md).

Built as specified, with one deviation: the Salon's **Rebuild Summary…** entry is wired through a
new `hooks/useSummaryActions.ts` rather than `useModalState`. There is no modal — the confirm is a
`showConfirmation` await, the same shape `useMemoryActions` uses for re-extract and delete — and
`useModalState` holds only open/close booleans.

## The incident

On the `Friday` instance, chat `358cabfe-00f4-459f-8fb4-22b080825824` ("Tuesday-Night Pie and a
Dress in the Car") is a two-seat Salon between **Friday** (LLM) and **Charlie** (the user's
persona). Its running `contextSummary` refers to Friday as **"Vivienne"** throughout — twenty-nine
times by the third fold. No message in the chat contains that name, and no character on the
instance carries it.

The first fold (LLM log `7277e4fa-b196-48ee-ac79-28f3574ec1e4`, 2026-09-21 23:30 UTC) received a
transcript labelled `USER:` / `ASSISTANT:` under a system prompt that says *"Use character names,
not roles."* Charlie's name survives because Friday addresses him as "Charlie Sebold" in dialogue;
nobody says Friday's name in the first ten turns, so the model was ordered to name a speaker it had
no name for and chose one. Every later fold carries the prior summary forward under a "carry
forward" instruction, so the invention compounds rather than corrects. The one place "Friday
Sebold" appears in the summary is a line where she says it herself, and the model recorded it as a
pseudonym.

The episode consolidator that ran three seconds later on the same turns
(`fold-episode-pass.ts`) got it right, because it renders each turn as `Friday:` / `Charlie:`.

## Root cause

Two functions, one omission:

- `turnsToChatMessages` in [`lib/chat/context-summary.ts:291`](../../../lib/chat/context-summary.ts)
  reduces each `MessageEvent` to `{ role, content, createdAt }`. The `participantId` is dropped
  even though the chat, and therefore its participants, is loaded a few lines above in
  `generateContextSummary`.
- `foldChatSummary` in [`lib/memory/cheap-llm-tasks/chat-tasks.ts:626`](../../../lib/memory/cheap-llm-tasks/chat-tasks.ts)
  renders `${role.toUpperCase()}: ${content}`, and its system prompt demands names.

`fold-episode-pass.ts:89–107` already solved the identical problem for the episode pass: it builds a
`participantId → character.name` map through `repos.characters.findByIdRaw` (a raw read that
survives a broken vault) and renders `speaker:` per message, falling back to `User` / `Character`.
That code is private to the episode pass.

## Design

### 1. One speaker resolver, shared

Extract the map-building loop from `fold-episode-pass.ts` into a new module,
`lib/chat/speaker-names.ts`:

```ts
export type SpeakerNames = ReadonlyMap<string, string>  // participantId → display name

/** Raw character reads (findByIdRaw) so a broken vault degrades to a role label, never throws. */
export async function resolveSpeakerNames(chat: Chat): Promise<SpeakerNames>

/** The label a transcript line gets. Never a bare LLM role. */
export function speakerLabel(m: Pick<MessageEvent, 'participantId' | 'role'>, names: SpeakerNames): string
```

- Iterate **every** seat in `chat.participants`, removed and silent ones included. A message from a
  seat that has since left the chat still has a name.
- The user's seat is a `CHARACTER` participant with a `characterId`, so the persona resolves the
  same way an LLM seat does. No special case.
- Fallback when a participant has no character or the read fails: `User` for `USER`, `Character`
  for everything else. This matches the episode pass and is what the prompt change in §3 is for.
- `fold-episode-pass.ts` switches to the shared resolver in the same change. Its behaviour does not
  change; its private loop is deleted. Two implementations of the same map is how this bug happened
  once already.

### 2. The fold carries the speaker

`FoldSummaryInput.newTurns` becomes:

```ts
newTurns: Array<{ speaker: string; role: 'user' | 'assistant'; content: string; createdAt?: string | null }>
```

`turnsToChatMessages` takes the resolved `SpeakerNames` and fills `speaker` through
`speakerLabel`. `foldChatSummary` renders:

```
[2026-09-21] Friday: *My head comes up from the sofa cushion…*
[2026-09-21] Charlie: Put on your shoes, smart girl…
```

`role` stays on the shape because callers may want it, but nothing in the rendered transcript shows
it any more.

### 3. The prompt stops demanding what it was not given

`FOLD_SUMMARY_PROMPT`'s *"Use character names, not roles."* becomes:

> Refer to each speaker by the name on their turns. If a turn is labelled only by a role, keep that
> label; never invent a name for anyone.

This is the belt to §2's braces. With names on every line the instruction is redundant; with a
fallback label on a line it is what stops the next Vivienne.

The fold prompt is a cheap-LLM task, not part of the identity stack. Changing it bumps no builder
version and needs no golden.

### 4. A way to rebuild a summary that is already wrong

Nothing user-facing can trigger a from-scratch summary today. `forceRegenerate` exists on the
summary job but is passed `true` only by the SillyTavern importer. An operator who finds a wrong
name in a summary has no move short of raw SQL.

Add `POST /api/v1/chats/[id]?action=rebuild-summary`, dispatched from
`app/api/v1/chats/[id]/handlers/post.ts` beside `regenerate-title`. The handler:

1. Refuses on an autonomous room that is currently running (its own turn loop owns the summary
   cadence; the operator can pause first).
2. Clears `contextSummary`, `summaryAnchorMessageIds` and `lastSummaryTurn` on the chat in one
   update.
3. Enqueues the ordinary summary job. The existing fold cadence then folds from turn 1 in
   `FOLD_TURN_BATCH` steps until it is `FOLD_TRIGGER_DELTA` behind the head, one bounded call at a
   time. This deliberately does **not** use the single-shot `forceRegenerate` path, which puts every
   turn up to the tail floor into one request and will not fit a cheap model's window on a long
   chat. (Whether the importer should move off that path too is a separate question; leave it.)
4. Publishes `publishRealtime('chats', chatId)` so the Salon's summary panel re-reads.

The Salon gets a **Rebuild summary** entry in the same header menu as **Merge conversation**
(`SalonView.tsx`, wired through `useModalState` like its neighbours), with a one-line confirm
because the old summary is gone the moment the button is pressed and the new one arrives a few
turns later.

### 5. No migration

A wrong name cannot be identified mechanically — Charlie's name in the same summary is correct, and
a summary that names a participant not in the cast is indistinguishable from one that names an NPC.
Rebuilding every folded chat on `Friday` is 369 chats' worth of cheap-LLM calls to fix a defect the
operator has noticed in one. The rebuild action is the remedy; the operator applies it where they
see the symptom.

### 6. Logging

`generateContextSummary` logs at `debug` the number of seats resolved and the ids of any that fell
back to a role label, so the next unresolvable seat is visible in `combined.log` before it is
visible in a summary.

## Files

| File | Change |
|---|---|
| `lib/chat/speaker-names.ts` | new: `resolveSpeakerNames`, `speakerLabel` |
| `lib/memory/fold-episode-pass.ts` | use the shared resolver; delete the private loop |
| `lib/chat/context-summary.ts` | `turnsToChatMessages(turns, names)`; resolve names in `generateContextSummary`; debug log |
| `lib/memory/cheap-llm-tasks/chat-tasks.ts` | `FoldSummaryInput` carries `speaker`; render by name; prompt wording |
| `app/api/v1/chats/[id]/handlers/post.ts` + `actions/` | `rebuild-summary` action |
| `app/salon/[id]/SalonView.tsx`, `hooks/useModalState.ts` | Rebuild summary menu entry + confirm |
| `help/chats.md` | document the menu entry (Quilltap voice) |
| `docs/CHANGELOG.md` | plain-voice entry under 4.10-dev |
| `docs/developer/API.md` | the new action |

## Tests

- `__tests__/unit/lib/memory/fold-chat-summary.test.ts`: the two assertions on `USER: hi` /
  `ASSISTANT: hello` become `Charlie: hi` / `Friday: hello`; add a case where a turn has no
  resolvable seat and the label is `User` / `Character`; assert the prompt contains the new
  wording and not the old.
- New `__tests__/unit/lib/chat/speaker-names.test.ts`: removed seats resolve; a throwing
  `findByIdRaw` falls back without throwing; user seat resolves to its persona.
- `context-summary` unit test: the rendered transcript handed to `foldChatSummary` carries names
  for a two-seat chat.
- `fold-episode-pass` test: output unchanged after switching resolvers.
- Route test for `rebuild-summary`: clears the three columns, enqueues once, refuses on a running
  autonomous room.

## Verification (live, on `V4test`, never `Friday`)

1. Start a two-character chat; take eleven turns without either character speaking the other's
   name. After the first fold, the summary must name both characters correctly.
2. Take five more turns. The second fold must keep the names.
3. Open the LLM log of the fold: every transcript line must begin with a character name, none with
   `USER:` or `ASSISTANT:`.
4. Rebuild summary from the Salon menu. The summary panel must go empty, then fill after the next
   fold; `lastSummaryTurn` must advance from 0 in steps of `FOLD_TURN_BATCH`.
5. On the `Friday` chat that reported the bug, once the change is deployed: Rebuild summary, and
   confirm "Vivienne" is gone.
