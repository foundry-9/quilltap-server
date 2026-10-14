# Bug 158 — a scenario masquerades as a summary, and greets you from the wrong room

**FIXED in v4 (2026-09-21)** — chat creation no longer seeds `contextSummary`
with the chosen scenario. A scenario is a stage direction for a conversation
that has not happened; `contextSummary` is a record of one that has, and only
the summarizer writes it now. The scenario keeps the column it was given in
4.1.0. The greeting's "Recent Conversations" block was rendering that value
whole, uncapped and unframed, immediately before the instruction to greet — it
now truncates each entry through the same `truncateGist` its sibling recap uses
and closes with the same `READ_CONVERSATION_CALL_NOTE`, so a future wrong value
is a short wrong value that announces itself as a past transcript. The three
Concierge sites that were unknowingly reading the scenario through the seed now
read `scenarioText` on purpose, and the handler reports `inputSource:
'scenario'` instead of claiming `summary`; their behaviour is unchanged.
`clear-scenario-seeded-chat-summaries-v1` clears the rows already on disk.
Regression tests in
`__tests__/unit/app/api/v1/chats/route.scenario-seed.test.ts` and
`__tests__/unit/lib/memory/memory-recap.test.ts`.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-21, live on the `Friday` instance, chat `6cd2068d-3ea4-4125-a217-143c467fd925` ("Chat with Friday, Amy, and Abigail") |
| **Fixed** | 2026-09-21, the day it was reported |
| **Severity** | **High** — the character opens in the wrong place, in front of the operator, on the very first line of a new chat. No data is lost, but the greeting is unusable and the error is invisible from the UI: the scenario the operator chose is displayed correctly while the model is reading a different one |
| **Who it bites** | anyone who starts a chat with a character who has an unsummarized prior chat — which is every character with a chat that was opened and abandoned, or is still short of its first summary fold. On `Friday`, **186 of 712** chats (26%) are in that state |
| **Provenance** | Original to v4, from the `scenarioText` split. `contextSummary` carried the chosen scenario because it was the only column that could; `add-chat-scenario-text-field-v1` (4.1.0) gave the scenario its own home and the seed beside it was never removed |
| **Fix site** | `app/api/v1/chats/route.ts:1268` (the seed), `lib/memory/memory-recap.ts:82` (the unguarded consumer), the three Concierge sites that were quietly relying on the seed, and `lib/chat/scenario-seeded-summary.ts` +2 ingest callers |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

A new chat was opened in the Lodge office. Its scenario — `# Scenario: Afternoon
Work` — was resolved correctly, stored correctly, and placed correctly in the
greeting prompt, at line 134 of the system block:

> Charlie, Friday, and Amy work at their desks in the Lodge office […] Abigail
> has come with news from Jackie's last CET meeting about the spyglass.

Amy's greeting was:

> You found the right rock — the flat one's still warm from an hour ago, and
> I've been in long enough that the cold stopped being news. Sit. Tell me what's
> in your face before you decide whether to say it.

She is in a swimming hole. The operator had to correct her in the first user
message of the chat:

> *I look around.* Amy… we're not in your pool, we're in the office. Abigail
> said she had something to run by us.

## Root cause

The greeting call (`llm_logs` `2957d76b-703b-4680-9ee3-c64a2ec7a7a0`, 30,684
prompt tokens) carries a `### Recent Conversations` block built by
`buildRecentConversationsBlock`. Its last two entries were not summaries. They
were entire scenario documents:

| Chat | `contextSummary` holds | chars |
|---|---|---|
| The Wrong Wall | the full text of `# Scenario: Afternoon Work` | 2,299 |
| Damp Curtains and Cold Water | the full text of `# Scenario: Amy's Pool` | 9,169 |

Both chats have `contextSummary` byte-identical to `scenarioText`. The second
sorted last by `lastMessageAt`, so 1,300 words of pool — cottonwoods, the
artesian spring, the limestone rocks, the sign — were the **last thing in the
system prompt**, and they ended on a stage direction:

> Amy is in her pool, and Charlie walks up the path and sits down on the flat
> rocks next to it.

immediately followed by:

> You are starting a brand new conversation. Before the user says anything, open
> with a concise greeting that fits Amy's established voice.

Amy read the nearest, freshest, most specific scene statement she had been given
and greeted from it. The model did nothing wrong.

Two independent defects combine:

**1. The seed is wrong** — `app/api/v1/chats/route.ts:1268`:

```ts
contextSummary: resolvedScenario || null,
…
scenarioText: resolvedScenario || null,
```

The same string in both columns. A scenario is a stage direction for a
conversation that has not happened; a summary is a record of one that has. The
seed predates `scenarioText` (added by `add-chat-scenario-text-field-v1` in
4.1.0) and survived it as a duplicate.

**2. The consumer trusts the column's name** —
`findRecentSummarizedByCharacter` (`chats.repository.ts:189`) filters on
`contextSummary: { $exists: true }`, and `buildRecentConversationsBlock`
(`memory-recap.ts:82`) inlines whatever it finds, whole:

```ts
.map(c => `#### ${c.title} (\`${c.id}\`)\n${c.contextSummary}`)
```

No cap, no framing. Its sibling in the same file —
`buildConversationRecallLists`, the per-turn recap — renders the same data
through `truncateGist` (280 chars) and closes with
`READ_CONVERSATION_CALL_NOTE`, which tells the model these are past transcripts
it may go read. The greeting path has neither, so a 9 KB scenario arrives at full
length with nothing marking it as past.

## Why it survived

- **Both halves look right in isolation.** The seed is one plausible line in a
  120-line `create` call; the consumer is a one-line `.map` over a repository
  method whose name promises the rows are summarized.
- **The UI shows the correct scenario.** Nothing an operator can see reveals
  that a second, different scenario is in the prompt.
- **It needs a specific history to fire.** The character must have a prior chat
  that was created and never summarized. Every test builds its chats explicitly,
  and a test that seeds a `contextSummary` seeds a summary.
- **The failure is a plausible greeting.** The model does not error; it produces
  a warm, in-voice, entirely coherent opener. It is simply in the wrong room.

## Knock-on effects of the same seed

Every consumer that reads `contextSummary` as "a record of this conversation"
was reading a scenario instead, for the whole pre-summary life of every chat:

| Consumer | What it did with the scenario |
|---|---|
| `chat-danger-classification.ts:77` | classified the **scenario**, and labelled the result `inputSource: 'summary'` — never reaching its raw-messages fallback |
| `scene-state-tracking.ts:221` | pushed the scenario a second time under `Story so far:`, beside the copy it already reads from `scenarioText` |
| `context-summary.ts:392` | handed the scenario to the first fold as `priorSummary`, so the first real summary is built on top of a stage direction |
| `memory-recap.ts:192` | the relevant-conversations gist — same wrong content, but capped at 280 chars |
| `apply-chat-merge.ts:310` | carried the scenario into a merged chat as `summaryText` |
| `regenerate-conversation-summaries.ts:32` | embedded scenarios as conversation summaries into the vault |

The Concierge sites are the only ones where the seed was load-bearing: with it
gone, a chat would not be danger-classified until its first fold.

## The fix

**Stop the seed.** `contextSummary` starts `null`. The scenario lives in
`scenarioText`, which is set on the next line and which every consumer that
genuinely wants a scenario already prefers (`context-manager.ts:1284` reads
`chat.scenarioText || chat.contextSummary`; `scene-state-tracking.ts:213` reads
`chat.scenarioText` for its per-character baseline).

**Make the Concierge's bootstrap explicit.** The three danger sites that were
relying on the seed now read `chat.contextSummary ?? chat.scenarioText` on
purpose, and the handler reports `inputSource: 'scenario'` when that is what it
classified. Behaviour is unchanged; it is no longer accidental, and the log no
longer says `summary` about a scenario.

**Harden the greeting block** so a future wrong value cannot dominate the
prompt: `buildRecentConversationsBlock` now truncates each entry through the
same `truncateGist` its sibling uses, and closes with the same
`READ_CONVERSATION_CALL_NOTE`, which frames the entries as past transcripts
rather than present scenes.

**Backfill.** `clear-scenario-seeded-chat-summaries-v1` NULLs `contextSummary`
on every chat where it is byte-identical to `scenarioText`. Equality is the
whole predicate: a real summary that happens to quote the scenario is not
byte-identical to it, and a chat whose summary has been folded at least once has
had that column overwritten.

That claim was measured, not assumed. On a copy of `Friday`'s main database:

```
chats with a contextSummary                              712
  … of those, folded at least once (lastSummaryTurn > 0) 369
  … of those, matched by the predicate                     0
matched by the predicate                                 186
```

**Zero** folded chats fall inside the predicate — every row it takes is a chat
that has never been summarized. Running the UPDATE on that copy cleared 186
rows, left 526 real summaries standing, touched no `scenarioText`, and left no
folded chat without a summary.

**The ingest paths, because a migration only reaches what is already here.** A
`.qtap` export or a backup taken before this fix carries the seed in its chat
rows, and importing one into a fixed instance reopens the bug — the migration
has long since run and will not run again. `stripScenarioSeededSummary`
(`lib/chat/scenario-seeded-summary.ts`) holds the same rule the migration states
in SQL, and the three ingest sites run their rows through it: the `.qtap`
importer's normal and `duplicate` branches, and the backup restore. Restoring an
instance *exactly* would restore the defect with it, so this one deliberately
does not: the scenario is untouched, its second home is cleared. The migration
restates the predicate rather than importing it because `migrations/` is
isolated from `lib/`; the two must be changed together.

## How to verify

1. **The greeting.** With a character who has an unsummarized prior chat in a
   different setting, start a new chat in a known scenario. Read the greeting
   call's system prompt (`quilltap db --instance <i> logs --chat <id>`, then
   `log <id>`): the `### Recent Conversations` block must contain no
   `# Scenario:` heading, and the last text before the greeting instruction must
   be the chat's own scenario.
2. **The seed.** Create a chat with a scenario;
   `SELECT contextSummary, scenarioText FROM chats WHERE id = ?` — `scenarioText`
   set, `contextSummary` NULL.
3. **The backfill.**
   `SELECT COUNT(*) FROM chats WHERE contextSummary IS NOT NULL AND contextSummary = scenarioText`
   is 0 after startup.
4. **The Concierge.** A new chat on a scenario the classifier should flag is
   still flagged before its first fold, and the job's log line reads
   `inputSource: 'scenario'`.
5. **A stale bundle.** Import a `.qtap` exported before this fix, or restore a
   pre-fix backup; the predicate query in step 3 must still be 0 afterwards,
   and the restored chats must keep their `scenarioText`.
6. **Tests.** `__tests__/unit/lib/memory/memory-recap.test.ts`,
   `__tests__/unit/app/api/v1/chats/route.scenario-seed.test.ts` and
   `__tests__/unit/lib/chat/scenario-seeded-summary.test.ts`.
