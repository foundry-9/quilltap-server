# Concierge Overhaul — Phase 2: The Refusal Ledger and the Auto-Switch

**Status:** Implemented (4.10-dev, 2026-09-25) — see [As built](#as-built) for where the shipped code departs from the plan.
**Scope:** quilltap-server. Two new columns on `chats`, one migration, one new setting inside `dangerousContentSettings`, one new announcement kind, one new repository method. No settings UI beyond a single number field on the existing Dangerous Content card. No plugin or package change.
**Prerequisites:** [Phase 1](concierge-overhaul-phase-1-refusal-failover.md) landed — specifically `classifyRefusal` (`lib/services/dangerous-content/refusal.ts`), `generateImageWithConciergeFailover` (`image-failover.ts`), and the `moderation-refusal` handling in `attemptHardErrorFailover`. If phase 1 has not landed, this phase's hook points do not exist; do not attempt to wire the ledger into the five pre-phase-1 reroute sites.
**Part of:** [concierge-overhaul.md](concierge-overhaul.md) (phase 2 of 5).

## Summary

The Concierge's decision to flip a chat to the uncensored desk today rests on a cheap LLM reading the context summary and guessing. This phase gives it evidence instead: every moderation refusal that phase 1 detects is recorded on the chat, and after a configurable number of them (default 2) on a Monitored chat, the Concierge switches the chat to Flagged and posts a bubble saying exactly why. Setting the chat back to Monitored by hand clears the ledger.

The summary classifier keeps running in this phase. It is demoted to an opt-in pre-screen in phase 4.

## Goals

- A refusal that the Concierge already rerouted (or could not) leaves a mark on the chat that survives the turn.
- The N-th refusal switches a Monitored chat to Flagged, once, with an announcement that names the count and the last refusing provider.
- The operator can turn the auto-switch off (N = 0) or tune it.
- Returning a chat to Monitored by hand resets the count, so the operator's decision is not immediately undone by stale refusals.

## Non-goals

- Changing the four per-chat states or what Flagged means (phase 3 collapses them; this phase reuses `'flagged'` as the auto-switch target because it is the state that today means "the Concierge decided, uncensored route").
- Retiring or gating the summary classifier (phase 4).
- Counting anything but stated refusals. Empty bodies with no finish reason, "inferred" refusals, and pre-flight classifier verdicts do not count.
- Any per-project or global cascade of the threshold.

## Known State (verified 2026-09-25)

- `chats` carries `isDangerousChat`, `dangerScore`, `dangerCategories`, `dangerClassifiedAt`, `dangerClassifiedAtMessageCount`, `conciergeOverride` (`docs/developer/DDL.md:549-554`). No column records refusals.
- The only writer of `isDangerousChat` outside the manual flip is the background job `lib/background-jobs/handlers/chat-danger-classification.ts:207-214`, fed by the context summary, the scenario text, or raw messages (:85-128), sticky once true (:63-65), and announced once via `postConciergeDangerAnnouncement` (:219-230).
- `applyConciergeFlip` (`lib/services/dangerous-content/manual-flip.ts:55-130`) is the single transition chokepoint. Its `'flagged'` case stamps the classifier metadata so the sticky rule holds (:73-82); its `'monitored'` case clears them (:86-100). It takes `(chatId, requested, chat)` and posts a manual announcement kind.
- Refusals are recorded per message on `routeTrail` (`lib/schemas/chat.types.ts:198-217`) with `trigger: 'moderation-refusal'` and `evidence: 'finish-reason' | 'inferred'`, and after phase 1 also on image-bearing messages with `profileKind: 'image'` and phase 1's wider evidence set. Nothing aggregates them.
- Chat rows are validated on update through `ChatMetadataBaseSchema` (`lib/schemas/chat.types.ts:1144`, via `base.repository.ts:_update` :371-400), which strips unknown keys: a new column must be declared in **both** `ChatMetadataSchema` (:742) and `ChatMetadataBaseSchema`.
- Background job handlers run in the forked child; `getRepositories()` there is a proxy whose writes are buffered and shipped to the parent (`docs/developer/BACKGROUND_JOBS_CHILD.md`). Two image jobs for the same chat can be in flight, so a read-modify-write increment can lose a count.
- Settings for the Concierge live in `dangerousContentSettings` (`lib/schemas/settings.types.ts:394-415`), edited by `components/settings/chat-settings/DangerousContentSettings.tsx` and saved via PUT `/api/v1/settings/chat` (`app/api/v1/settings/chat/route.ts:181-183` parses with `DangerousContentSettingsSchema`).
- Migrations follow `migrations/scripts/add-chat-concierge-override.ts` (`Migration` object with `id`, `description`, `introducedInVersion`, `dependsOn`, `shouldRun`, `run`), register in `migrations/scripts/index.ts` (import, array, named export), and need a `PRETTY_LABELS` entry in `lib/startup/prettify.ts` (the concierge group sits at :118-120). `addColumnIfMissing` lives in `migrations/lib/database-utils.ts:347`.

## Design

### 1. Storage

Two columns on `chats`:

| Column | Type | Meaning |
|---|---|---|
| `moderationRefusalCount` | `INTEGER NOT NULL DEFAULT 0` | stated moderation refusals since the chat was last set to Monitored |
| `lastModerationRefusalAt` | `TEXT NULL` | ISO timestamp of the most recent one |

Migration `add-chat-refusal-ledger-v1` (`migrations/scripts/add-chat-refusal-ledger.ts`): `introducedInVersion: '4.10.0'`, `dependsOn: ['add-chat-concierge-override-v1']`, `shouldRun` when either column is missing, `run` adds both with `addColumnIfMissing`. No rows are touched, so no `reportProgress` loop. `PRETTY_LABELS`: *"Opening the Concierge's ledger of refusals"*.

Declare both in `ChatMetadataSchema` and `ChatMetadataBaseSchema`; add to `docs/developer/DDL.md` beside the danger fields; add to `ExportedChat` in `public/schemas/qtap-export.schema.json` (they export with the row like the other danger fields, via the spread at `lib/export/ndjson-writer.ts:312-321`, and import through `import-entities.ts:373-381`).

### 2. The setting

`DangerousContentSettingsSchema` gains:

```ts
/** After this many stated moderation refusals on a Monitored chat, the Concierge flips it to Flagged. 0 = never. */
autoSwitchAfterRefusals: z.number().int().min(0).max(10).default(2),
```

`DEFAULT_DANGEROUS_CONTENT_SETTINGS` in `resolver.service.ts:28-36` and the client mirror `components/settings/chat-settings/types.ts:535` follow. `VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS` sets it to `0`; the `'chat-uncensored'` spread inherits the global value but the switch never fires there (§4 gates on Monitored). Existing rows lack the key and get the default `2` through Zod.

One number input on the Dangerous Content card (`DangerousContentSettings.tsx`, shown when mode is not `OFF`), label *"Switch a chat to Flagged after this many refusals (0 = never)"*, written through `handleDangerousContentUpdate`.

### 3. Recording a refusal — `lib/services/dangerous-content/refusal-ledger.ts`

```ts
export interface RefusalRecord {
  chatId: string
  kind: 'text' | 'image'
  purpose: 'chat' | 'cheap' | 'tool' | 'lantern' | 'avatar' | 'dialog'
  refusedProfileId: string
  refusedProfileName: string
  provider: string
  modelName?: string | null
  evidence: RefusalEvidence
  rerouted: boolean
}

/** Increment the chat's ledger and, if the threshold is met, ask the Concierge to switch the chat. */
export async function recordModerationRefusal(rec: RefusalRecord): Promise<{ count: number; switched: boolean }>
```

Rules:

- Only `evidence` in `{'typed-error', 'provider-code', 'finish-reason', 'message-pattern'}` is recorded. `'inferred'` is not evidence of a refusal, it is evidence of a flag, and the flag came from a guess.
- The increment is **atomic in SQL**: new `ChatsRepository.incrementModerationRefusalCount(chatId, at: string): Promise<number>` runs `UPDATE chats SET moderationRefusalCount = moderationRefusalCount + 1, lastModerationRefusalAt = ? WHERE id = ?` and returns the new count. In the job child this is a buffered write like any other and executes in the parent; the child cannot read the resulting count back in the same job, so `recordModerationRefusal` returns `count` only when it ran in the parent and `switched` is decided as in §4.
- Logged at `info` with the whole record.

**Hook points** (all phase-1 chokepoints, so this is four lines of wiring):

- `generateImageWithConciergeFailover` (`image-failover.ts`), after step 3 (the primary refused), whether or not the reroute later succeeds. It has the chat id when there is one; the dialog without a chat records nothing.
- `attemptUncensoredRetry` / `attemptHardErrorFailover` in `provider-failover.service.ts`, when the opening verdict is a refusal with recordable evidence.
- The cheap-LLM empty-response fallback (`lib/memory/cheap-llm-tasks/core-execution.ts:403-435`, `shouldAttemptUncensoredFallback`) if and only if it can name a finish reason; an empty cheap-LLM body with no stated reason is not recorded.

### 4. The auto-switch

In the **parent process only** (the child ships its write and the parent runs the check when it applies the buffered increment; see below):

```
after incrementing:
  chat = re-read
  N = resolveDangerousContentSettings(global, chat).settings.autoSwitchAfterRefusals
  if N > 0
     and getConciergeState(chat) === 'monitored'
     and mode === 'AUTO_ROUTE'
     and chat.moderationRefusalCount >= N
  then applyConciergeFlip(chatId, 'flagged', chat, { by: 'concierge', reason: 'refusals' })
```

`applyConciergeFlip` gains an optional fourth argument `{ by?: 'operator' | 'concierge'; reason?: 'refusals' | 'classifier' }` (default `{ by: 'operator' }`). Its `'flagged'` case, when `by === 'concierge'`, sets `dangerCategories: ['moderation-refusals']` instead of `[]` so the header pill's tooltip has something to say, and posts the new announcement kind `'auto-flagged-refusals'` instead of `'manual-flagged'`. The `'monitored'` case additionally resets `moderationRefusalCount: 0, lastModerationRefusalAt: null` — the operator's return to Monitored is a fresh start.

Because the increment can happen in the child, the switch check must run where the count is authoritative. Implement `recordModerationRefusal` so that in the parent it increments then checks; in the child it buffers the increment and enqueues nothing — instead the parent's write-commit path for `chats` (the chokepoint that applies buffered partition writes, `docs/developer/BACKGROUND_JOBS_CHILD.md`) calls `maybeAutoSwitchAfterRefusal(chatId)` once per chat whose `moderationRefusalCount` it just changed. That keeps the rule in one function with two entry points, and never lets the child decide.

The switch is idempotent: `applyConciergeFlip` is a no-op when the state already matches, and the `'monitored'` gate stops a second refusal from re-announcing.

### 5. The announcement

`postConciergeManualAnnouncement`'s kind union (`concierge-notifications/writer.ts:171-176`) gains `'auto-flagged-refusals'`, with `details: { count: number; lastProvider: string; lastModel?: string | null }`. Voice: *"Twice now the house's regular staff have declined this conversation on grounds of propriety — most recently Gemini. I have taken the liberty of moving the whole affair to the uncensored desk; you may move it back from the sidebar whenever you wish."* Opaque: *"Two moderation refusals (last: Gemini). The Concierge switched this chat to Flagged; change it in the sidebar."*

### 6. What the ledger does not do

- It never switches a Vouched Safe or Uncensored chat (`getConciergeState` gate), and never a Flagged one (already there).
- It does not touch `isDangerousChat` directly; only `applyConciergeFlip` does.
- It does not decay. A chat that collected one refusal a month ago and one today has two.

## Decisions of record

- **Flagged, not Uncensored, is the auto-switch target in this phase.** Flagged is "the Concierge decided; uncensored route", which is exactly what happened. Phase 3 renames both to Unmoderated with a provenance note.
- **Only stated refusals count.** An inferred refusal is an empty body on content the pre-flight classifier flagged; counting it would let the guess promote the chat, which is the ratchet the Lantern comment warned about.
- **Reset on manual Monitored, and only then.** The classifier's own re-check on new messages already exists; the ledger has no equivalent because a refusal is a fact, not an estimate.
- **The parent decides.** The child cannot read its own buffered write, and two jobs can race; the rule runs where the count is real.

## Carried over from phase 1 review

Two low-severity findings from the Copilot review of phase 1
([foundry-9/quilltap-server#73](https://github.com/foundry-9/quilltap-server/pull/73))
were acknowledged there and deferred to the next code push. Do them first in
this phase — both touch files this phase also edits — and tick them here when
done.

- [x] **The `refusal-rerouted` bubble claims a location it cannot know.**
  `buildRefusalContent` in `lib/services/concierge-notifications/writer.ts`
  ends the rerouted copy with "The result is attached above." The chokepoint
  (`generateImageWithConciergeFailover`, `image-failover.ts`) posts the note
  *before* the caller saves the picture and posts its own Lantern / Aurora
  bubble or TOOL row, so the picture follows the note; and the legacy image
  dialog posts no picture message at all. Reword to say nothing about where the
  picture is. Update the matching `refusal-rerouted` example in
  `help/dangerous-content.md` if its wording changes, and the phase-1 spec's
  §8 example sentence, which has the same claim.
- [x] **`scripts/concierge-four-state-test.sh` matches compressed text raw.**
  `chat_messages.content` is a compressed column (CLAUDE.md: raw SQL that
  reads one wraps it in `qt_text()`). Two queries break the rule and would
  report false failures: `check_ann` (`… AND content LIKE '%$1%' …`) and
  CT-4's reroute check (`… AND content LIKE '%across the street%' …`). Change
  both to `qt_text(content) LIKE …`, and confirm the CLI's `db` command
  registers `qt_text` before relying on it. If the rerouted wording above
  changes, CT-4's phrase must change with it — prefer matching on
  `systemKind='refusal'` plus a phrase that survives the rewording.

## Implementation order

0. The two carried-over fixes above.
1. Migration, schemas, DDL, export schema, `incrementModerationRefusalCount`.
2. `refusal-ledger.ts` and the `applyConciergeFlip` fourth argument, announcement kind, `'monitored'` reset.
3. Parent-side commit hook and the four call-site lines.
4. Setting, default, card field.
5. Docs.

## Testing

- **Migration**: adds both columns idempotently; `shouldRun` false when both exist.
- **`refusal-ledger.test.ts`**: `inferred` not recorded; recordable evidence increments; count returned in-parent; N=0 never switches; Monitored + `AUTO_ROUTE` + count ≥ N switches exactly once and posts `auto-flagged-refusals` with the count; Vouched, Uncensored, Flagged and `DETECT_ONLY` never switch; a second refusal after the switch posts nothing.
- **`manual-flip.test.ts`**: `'monitored'` resets the ledger; `'flagged'` with `by: 'concierge'` writes `['moderation-refusals']` and the auto kind; the default fourth argument keeps every existing transition byte-identical.
- **Child path**: a job-child test that buffers an increment and asserts the parent's commit hook runs the switch check once for that chat.
- **Integration (mocked providers)**: two refused pictures on a Monitored chat → the second one produces a Flagged chat, one auto-flag bubble, and the third picture goes straight to the uncensored desk with no refusal recorded.

## Documentation and housekeeping

- `docs/CHANGELOG.md`: the ledger, the setting, the announcement, the reset rule.
- `help/dangerous-content.md`: a "When the Concierge switches a chat" section; the setting on the Dangerous Content card; the reset-on-Monitored rule.
- `docs/developer/DDL.md`, `public/schemas/qtap-export.schema.json`, `migrations/README.md` table row.
- `docs/developer/BACKGROUND_JOBS_CHILD.md`: the commit-hook call.
- `.claude/commands/update-documentation.md`: catalog row.
- `CLAUDE.md` chokepoints: extend the Concierge bullet — *`applyConciergeFlip` takes `{ by, reason }`; the refusal ledger is written only by `recordModerationRefusal`, and the auto-switch runs only in the parent.*

## As built

Implemented 2026-09-25. Departures from the plan above, each for a stated reason:

- **The two columns are not in `ChatMetadataSchema` / `ChatMetadataBaseSchema`, and therefore not
  in `.qtap` exports.** §1 asked for both. But `base.repository.ts:_update` rewrites the whole
  validated row from a snapshot it read a moment earlier, so a counter declared in the schema can
  be rewound by any concurrent chat-row write — the exact failure `transcriptVersion` documents
  and avoids the same way. Zod strips undeclared keys, so no `update` can touch the ledger; it is
  read with `ChatsRepository.getModerationRefusalLedger` and reset with
  `resetModerationRefusalLedger`. An imported chat starts with an empty ledger, which is also the
  right answer for a chat moved between instances. `qtap-export.schema.json` is unchanged.
- **`incrementModerationRefusalCount(chatId, at, refusedBy?)`** carries an optional third argument
  naming who refused. It is not stored; it goes to the repository's debug log and, for a buffered
  child write, to the parent's commit hook, which needs it for the announcement's "most recently
  …" clause (§5).
- **`recordModerationRefusal` returns `{ count: number | null, switched }`.** `null` when nothing was
  recorded or the increment was buffered in the child.
- **`applyConciergeFlip`'s options also carry `refusals?: { count, lastProvider, lastModel }`**, the
  announcement's details. `dangerCategories: ['moderation-refusals']` is exported as
  `MODERATION_REFUSALS_CATEGORY`.
- **The ledger entry is written once the call's outcome is known**, not at step 3, so its `rerouted`
  field is true rather than a guess. Every exit of the image chokepoint after a primary refusal
  records it exactly once; the understudy's own refusal is never recorded.
- **Text hook sites:** the empty-response path records its *opening* verdict in
  `attemptEmptyResponseRecovery` (the same-provider retry's verdict is not a second refusal of the
  turn); the hard-error path records in `attemptHardErrorFailover`'s `moderation-refusal` branch.
  `attemptUncensoredRetry` itself records nothing — it only sees the understudy.
- **Cheap LLM:** `sendToProvider` now returns the provider's `finishReason`; an empty body whose
  finish reason `classifyRefusal` reads as a moderation stop is recorded whether or not the
  uncensored fallback then runs.
- **The commit hook** is `runRefusalLedgerChecks` at the end of `applyWritesUnsafe`
  (`lib/background-jobs/host/job-dispatcher.ts`), inside the apply chain so the flip's writes cannot
  land in another job's open transaction, after every partition has committed, and best-effort. The
  pure selector `chatsWithRecordedRefusals` is exported for tests.
- **Concurrent checks for one chat are chained** in-process (`maybeAutoSwitchAfterRefusal`), so two
  refusals that land together cannot both read the chat as Monitored and announce twice.
- **Moderation-exempt chats** (Help, Brahma) never switch: the resolver returns the Vouched Safe
  settings for them, whose `autoSwitchAfterRefusals` is 0 and mode `OFF`.

Tests: `refusal-ledger.test.ts`, `refusal-ledger-integration.test.ts` (two refused pictures flip
the chat; the third goes straight to the uncensored desk and records nothing),
`manual-flip.test.ts`, `image-failover.test.ts`, `child-proxy-refusal-ledger.test.ts`,
`job-dispatcher-apply.test.ts` and `add-chat-refusal-ledger.test.ts`.
