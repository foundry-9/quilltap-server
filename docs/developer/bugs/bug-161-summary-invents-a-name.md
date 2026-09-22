# Bug 161 — the running summary invents a name for a character it was never told about

| | |
|---|---|
| **Status** | **Open** — spec at [features/context-summary-speaker-names.md](../features/context-summary-speaker-names.md) |
| **Found** | 2026-09-21, live on the `Friday` instance, chat `358cabfe-00f4-459f-8fb4-22b080825824` ("Tuesday-Night Pie and a Dress in the Car") |
| **Fixed** | — |
| **Severity** | **Medium** — no data is lost and the transcript is untouched, but the summary is what a character reads about the conversation once the early turns have been compressed away, and it is wrong about who was in the room. The error compounds: every later fold carries the invented name forward under a "carry forward" instruction, and the model reads the character's real name, when it finally appears, as an alias |
| **Who it bites** | every chat whose characters do not speak each other's names in the first ten turns. Two-seat chats between a character and the user's persona are the common case: the persona is addressed by name in dialogue and the character is not |
| **Provenance** | Original to v4, from the rolling-window fold (the `FOLD_SUMMARY_PROMPT` rewrite). The transcript renderer was written against `ChatMessage`, which has a role and no seat, at the same time the prompt was written to demand names |
| **Fix site** | `lib/chat/context-summary.ts:291` (`turnsToChatMessages` drops `participantId`), `lib/memory/cheap-llm-tasks/chat-tasks.ts:626` (renders `ROLE:` and asks for names); the working resolver to share is `lib/memory/fold-episode-pass.ts:89` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

## Symptom

The chat is a two-seat Salon between **Friday** (LLM) and **Charlie** (the user's persona). Its
`contextSummary` calls Friday **"Vivienne"** in every section — "Charlie and Vivienne are on their
first real date", "Vivienne has committed to opening her own bank account in the name Friday
Sebold". Twenty-nine occurrences after three folds. No message in the chat contains the string;
no character on the instance has the name.

## Root cause

`generateContextSummary` loads the chat, partitions its messages into turns, and hands them to
`turnsToChatMessages`, which keeps `{ role, content, createdAt }` and discards `participantId`.
`foldChatSummary` then renders each turn as `[date] USER:` or `[date] ASSISTANT:` under a system
prompt whose last instruction is *"Use character names, not roles."*

Charlie's name reaches the model because Friday says "Charlie Sebold" in her second line. Friday's
name reaches it nowhere: nobody addresses her in the first ten turns. Told to name a speaker it had
no name for, DeepSeek supplied one. The first fold's request (LLM log
`7277e4fa-b196-48ee-ac79-28f3574ec1e4`) contains neither "Friday" nor "Vivienne"; its response
contains "Vivienne" nine times. The second fold received that summary as its prior text with the
instruction to carry it forward, and so on.

The episode consolidator that runs on the same turns three seconds later
(`fold-episode-pass.ts`) is correct, because it resolves each message's `participantId` to a
character name through `findByIdRaw` and renders `Friday:` / `Charlie:`. That resolver is private
to the episode pass; the context fold never got one.

## Why it survived

- The unit test asserts the defect: `fold-chat-summary.test.ts:54` expects the rendered transcript
  to contain `USER: hi` and `ASSISTANT: hello`.
- The failure is a fluent, warm, internally consistent summary in which half the names are right.
  Nothing errors, nothing is empty, and the wrong name is a plausible one.
- The summary is read by the model, not shown prominently to the operator, so the symptom surfaces
  only when a character refers to herself or a companion by the invented name, turns later, or when
  the operator opens the summary panel and reads it.
- The episode pass, which shares the input and the cadence, was correct, so the memory side of the
  same turns showed no defect.

## The fix

Specified in [context-summary-speaker-names.md](../features/context-summary-speaker-names.md):
one shared `resolveSpeakerNames` used by both passes, the fold transcript rendered by name, the
prompt told to keep a role label rather than invent, and a `rebuild-summary` chat action so an
operator can discard a poisoned summary without raw SQL. No migration: a wrong name is not
mechanically detectable.

## How to verify

```sh
node packages/quilltap/bin/quilltap.js db --instance <name> logs --chat <chatId> --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(r=>r.type==="SUMMARIZATION").map(r=>r.id).join("\n")))'
node packages/quilltap/bin/quilltap.js db --instance <name> log <one of those ids>
```

Every transcript line in the fold request must start with a character name. On the chat above,
after a rebuild, `contextSummary` must not contain "Vivienne".
