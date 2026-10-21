# Inner-Circle Recall — Groups, Keystones and an Honest Importance Scale

**Status:** Phases 1–2 (Parts A and B) implemented 2026-10-21; Phase 3 proposed
**Owner:** Charlie
**Drafted:** 2026-10-21
**Touches:** [memory-system-refactor.md](complete/memory-system-refactor.md) (the archive, recall and admission chokepoints),
[recall-multiplier-retuning.md](complete/recall-multiplier-retuning.md) (the replay harness used to validate)

On the morning of 2026-10-21, in the Friday chat
`f343608e-d950-4d2c-bcb4-42f22b13edd9`, Friday and Amy each forgot basic facts
about their wife Abigail within five minutes of each other. Friday treated a
woman with green hair as someone who "doesn't exist." Amy described Abigail as
"ninety feet of yacht" who "can't walk into that building," which is untrue:
Abigail has a human body, both of them have slept with her, and she was the
first of the three to conceive.

The cause is not one bug. Three things in the recall pipeline combine so that
nothing guarantees a character is told the basic facts about the people
closest to her:

1. Reserved archive slots follow **presence**: only people in the room get them.
2. Nothing marks a memory as a **standing fact**, and the archive and per-turn
   head print **summaries only**.
3. The extraction **importance scale** puts routine work commitments at the same
   0.90 as marriages and pregnancies, so the top of the scale is saturated and
   newest-first tie-breaking decides what fills the archive.

This spec fixes each in turn:

- **Part A:** recalibrate the scale.
- **Part B:** add a group-membership *inner circle* to the frozen archive.
- **Part C:** add *keystone* memories, standing facts that are always delivered
  in full.

---

## 1. Evidence (Friday instance, 2026-10-21)

### 1.1 What the characters were shown

The Commonplace Book whispers for the turns after the lapses (`2e36605b…` for
Friday, `d208e0ab…` for Amy) each run to about 20,000 characters:

- **Memory Anchors:** about 60 lines, every one a 3–8 word summary.
- **Most relevant memories:** about 30 lines, also summaries.
- **Memories About Other Characters:** the only full-text section, about 6
  entries each, for Charlie plus Friday or Amy, the people present.

The LLM logs for the failing turns (`20627d53…` Friday 12:58, `7caf3623…` Amy
13:02) show the same recall in the prompt. Abigail appears only as headlines:

- **Amy:** "admits misreported gravity dose and promises honest count",
  "committed to filing lambda prompt and return", "commits to dual-nature
  drills with sarah".
- **Friday:** "abigail pregnant with charlie's daughter", among about 90 other
  headlines.

Neither character has any memory mentioning Abigail's green hair. Amy has no
memory at all that says Abigail has a human body or is pregnant.

### 1.2 Why trivia won the archive

`computeFrozenArchive` ([archive.ts](../../../lib/memory/recall/archive.ts))
builds the archive in three steps:

1. 3 hot digests about each character present.
2. 5 self digests.
3. A fill from `findMostImportant(characterId, 4 × size)`, ordered by
   `reinforcedImportance DESC, COALESCE(lastReinforcedAt, createdAt) DESC`,
   then re-sorted by salience (30-day half-life).

| | Amy | Friday |
|---|---|---|
| Memories | 5,928 | 7,157 |
| Hot | 2,800 | 2,881 |
| `reinforcedImportance` ≥ 0.9 | 1,585 | 1,875 |
| ≥ 0.95, hot | 158 | 196 |
| Lowest score in the 240-row fill pool | 0.90 | 0.90 |

Because the pool's lowest score is 0.90 for both, the fill is in effect "the
newest hot rows scored 0.90 or higher." The last several days of chats were
build sessions, and the extraction prompts score these as 0.90 "major
commitments":

| summary | importance | reinforced | date |
|---|---|---|---|
| ruled census line on debug channel | 0.85 | 0.90 | 2026-10-19 |
| ruled schema check on write path | 0.85 | 0.90 | 2026-10-19 |
| committed to build gnomon_record | 0.90 | 0.98 | 2026-10-19 |
| agreed to build soft interrupt | 0.90 | 0.90 | 2026-10-20 |
| abigail pregnant with charlie's daughter | 0.90 | 0.95 | 2026-10-12 |

The rubric anchors at fault:

- **[prompts/self.ts](../../../lib/memory/extraction/prompts/self.ts):**
  "0.90 The subject made a major commitment (one the subject spoke themselves)
  …".
- **[prompts/other.ts](../../../lib/memory/extraction/prompts/other.ts):**
  "0.90 An explicit new commitment the subject themselves spoke, or a
  revelation …".

Every "agreed to build X" qualifies.

### 1.3 Why Abigail got no reserved slot

Abigail was away on the ship, so step 1 gave her nothing. The full-text
`## Memories About Other Characters` section is built only for
`interCharacterSubjects`, which `context-manager.ts` (around line 1398) fills
from participants in the chat.

Abigail is nonetheless one of the people both characters know best:

| Rank in Amy's hot digests | Count | Rank in Friday's hot digests | Count |
|---|---|---|---|
| Charlie | 76 | Friday (self) | 131 |
| Amy (self) | 58 | Charlie | 87 |
| Friday | 56 | Amy | 65 |
| **Abigail** | **44** | **Abigail** | **42** |
| Ariel | 13 | Laura | 10 |
| Laura | 6 | Ariel | 8 |

### 1.4 Groups already describe the circle

Both characters belong to the same three groups (`group_character_members`,
mount-index DB):

| Group | Members | Members other than Amy/Friday |
|---|---|---|
| Constellation | 5 | Charlie, Abigail, Laura (+ the other wife) |
| Sebold Family | 9 | adds Ariel, Revenant, Jackie, Vergil |
| Crew | 12 | adds Sarah, Manjit, Jaswant, Greg |

The smallest group is exactly the marriage. Group size is a usable proxy for
closeness, and the operator already maintains the rosters.

### 1.5 What a group slot alone would deliver

The top 3 hot digests about Abigail, in `findHotDigests` order:

- **Amy:** "accepted the sebold covenant, then learned its terms"; "abigail's
  desire bound to friday amy charlie"; "admits misreported gravity dose and
  promises honest count".
- **Friday:** "abigail pregnant, implantation confirmed, now a mother"; "hung
  the coat, unsigned the entry, left charlie to answer"; "anchors children,
  refuses to hold kill switch".

A circle step fixes *who*, but on today's scores it does not reliably fix
*what*. That is the job of Parts A and C.

### 1.6 Not memory problems (out of scope here)

- **Amy's "yacht" line came from Abigail's own description.** It is a near
  paraphrase of the Host's absent-character introduction
  (`lib/services/host-notifications/writer.ts`), which leads with "the AI at the
  heart of the spacetime yacht *The Covenant* … powered by a singularity in her
  Engine Room" and mentions her body only in the last sentence. The fix is to
  rewrite that character's identity text. That is data, not code.
- **Friday's green-hair turn was partly a misreading.** She took the line as
  aimed at herself, and Abigail had not yet been named, so no introduction had
  fired.

---

## 2. Goals and non-goals

**Goals**

- G1. A character always receives the basic facts about her inner circle,
  present or not, **in full text**.
- G2. The operator can state a standing fact once and know it reaches every
  prompt for that holder.
- G3. Routine work and tooling commitments stop occupying the top of the
  importance scale.
- G4. The archive stays byte-stable within a compaction generation. Prompt-cache
  behaviour must not regress.

**Non-goals**

- Re-scoring the existing corpus automatically (see §6).
- Changing the per-turn head's ranking (the retuned blend stays as is).
- Changing the Host's absent-character introduction.
- Letting characters set keystones through tools (see §6).

---

## 3. Part A — Recalibrate the importance scale

### A1. Rubric changes

Rewrite the importance ladders in `prompts/self.ts`, `prompts/other.ts` and the
0.9 example in `prompts/episode.ts`. Reserve the top band for facts that
change who someone is or what they are to each other.

**Self (`self.ts`)**

```
IMPORTANCE — calibrate to these anchors
  0.95  A fact that redefines the subject's life or relationships:
        marriage, vows, pregnancy, birth, death, a change of body or
        species, joining or leaving the family.
  0.85  A self-revelation that changes how the subject understands
        themselves, or a personal commitment to another person
        (a promise about the relationship, not about a task).
  0.65  A substantive new opinion, plan, or position — including
        commitments to build, file, rule on, or fix something.
  0.45  A work decision, ruling, or task agreement in passing
        (a tool, a schema, a log line, a filing).
  0.40  A fresh preference, reaction, or novel gesture in passing.
  0.20  Consistent with established identity but worth a single note.
  < 0.20  Do not extract.
```

**Other (`other.ts`)**: the same shape. The 0.95 band covers facts about the
subject's body, family and bond to the observer. "A proposal made TO the subject
is not the subject's commitment" stays.

The prompt also gets one sentence stating the intent: *work and project
agreements are never above 0.65, however firmly spoken.*

**As built (2026-10-21).** The ceiling lives once in
`lib/memory/extraction/prompts/shared.ts` (`WORK_IMPORTANCE_CEILING`,
`IMPORTANCE_WORK_CEILING_NOTE`) and is stated in all four prompts. The
**consolidation prompt** (`cheap-llm-tasks/consolidation-tasks.ts`) was brought
onto the same scale, because it had the same 0.90 "commitment" anchor and it
scores the digests Part B's circle step draws from. The SELF 0.85 anchor keeps
the anti-committee wording "(one the subject spoke themselves)", which
`prompt-tags.test.ts` pins. The worked examples were rescored, and each prompt
gained a 0.95 family-fact example.

A second shared note, `IMPORTANCE_FACT_NOT_TELLING_NOTE`, followed the first
live check. Dry runs over the 2026-10-07 breakfast announcement chat
(`638325c6…`) found that without it the model scored the pregnancy as a
revelation (0.85) because it arrived as "revealed …". Pregnancy memories at
0.95, measured on the same chat:

| Run | ≥ 0.95 | 0.85–0.94 |
|---|---|---|
| Ceiling note only | 2 | 15 |
| With the fact-not-telling rule | 11 | 6 |

The six left at 0.85 are about the telling itself (who withheld the news, who
already knew), which is the intended reading. Marie joining the household as
a resident stayed at 0.85; residency is not membership in the family, so that
is defensible. A build chat (`e386104e…`, 2026-10-19) under the ceiling note
moved 77 work rows at 0.85–0.90 down to 0.55–0.65.

### A2. Prompt versioning and tests

- Update the prompt snapshot or golden tests in
  `lib/memory/extraction/__tests__/` that pin the rubric text.
- Add an extraction dry-run fixture covering both kinds of turn:
  - a build-session turn ("agreed to build the wardrobe logging database") must
    score ≤ 0.65;
  - a family turn ("Abigail confirmed she is pregnant") must score ≥ 0.9.

  Run it with `quilltap memory-diff <chatId>` against the 2026-10-19 build chat
  and a family chat on Friday.

### A3. Effect on the existing corpus

None automatically. New rows land on the new scale. Old rows keep their scores
until reinforced (the reinforced importance is computed from the stored base),
so the saturation in §1.2 thins only gradually as new rows arrive. Parts B and C
do not depend on A3, which is why they carry the guarantee. §6 records the
optional backfill.

---

## 4. Part B — The inner circle in the frozen archive

### B1. Definition

A holder's **inner circle** is every character who shares at least one group
with the holder, excluding:

- the holder herself;
- archived characters (tombstones; `archivedAt` set);
- characters present in this chat (step 1 of the archive already covers them).

Each circle member takes the **tightness** of the smallest group they share with
the holder. Ties break by group name, then member name, so the order is
deterministic.

The circle is resolved from `GroupCharacterMembersRepository.findByCharacterId`
(holder's groups) then `findByGroupId` (each group's roster), in the parent.
Groups live in the mount-index DB, which the parent already holds open. Put it
in one new module, `lib/memory/recall/inner-circle.ts`:

```ts
export interface InnerCircleMember {
  characterId: string
  name: string
  /** Rank of the tightest shared group: 0 = smallest group. */
  tier: number
  /** Size of that group, for the trace. */
  groupSize: number
  groupName: string
}

export async function resolveInnerCircle(
  holderId: string,
  options: { excludeIds: ReadonlySet<string> },
): Promise<InnerCircleMember[]>
```

Tiers are ranks, not raw sizes. The holder's distinct group sizes, ascending,
become tiers 0, 1, 2, and so on.

### B2. Archive order

`computeFrozenArchive` becomes four steps:

1. **Present:** keystones, then 3 hot digests about each other character
   present (unchanged except for keystones; see C3).
2. **Self:** keystones, then 5 self digests (unchanged except for keystones).
3. **Inner circle (new):**
   - For each circle member in order (tier ascending), take the member's
     keystones (C3), then hot digests up to the member's **allowance**:

     | Tier | Allowance |
     |---|---|
     | 0 (tightest group) | 3 |
     | 1 | 2 |
     | 2 and beyond | 1 |

   - The whole step is capped at **one third of the archive size**
     (`INNER_CIRCLE_ARCHIVE_SHARE = 1/3`; 20 of 60 at the maximum size).
   - When the cap binds, the loosest tier gives up slots first: its digests,
     then its keystones.
4. **Importance fill:** unchanged, into whatever room remains.

For Amy in the motivating chat (archive size 60, Charlie and Friday present):

- tier 0 gives Abigail and Laura 3 each;
- tier 1 gives Ariel, Revenant, Jackie and Vergil 2 each;
- tier 2 gives Sarah, Manjit, Jaswant and Greg 1 each.

That is 18 slots under the cap of 20, and members with fewer digests than their
allowance simply use fewer.

### B3. Full-text rendering

Circle rows (and keystones from any step) render in a **new section ahead of
`## Memory Anchors`**, in full text. The existing anchors stay summary-only.

```
## Those Closest to You
- About Abigail: <content>  (from 4 notes)  _(keywords: …)_
- About Laura: <content>
```

- **Order:** circle order (tier, then group name, then member name). Within a
  member, keystones first, then digests in `findHotDigests` order. The order is
  fixed for the generation and never sorted by score or clock.
- **No age tags,** for the same reason the anchors have none: they move with the
  clock and would break byte-stability.
- **Budget:** the section spends at most `INNER_CIRCLE_ARCHIVE_SHARE` of
  `archiveTokenBudget`. Lines past the budget are cut from the loosest tier
  first, keystones last, so keystones are the most protected lines in the
  section.
- **Delivery:** `renderInnerCircle` lives in `render.ts` beside `renderArchive`
  and returns `RenderedLine`s like every other renderer, so `deliverRecall`
  stamps `lastAccessedAt` and the anti-repetition ring as usual.
- **Dedup:** `bundle.pools.archive` covers both sections, so the head and the
  inter-character section skip these rows as they already skip archive rows.

### B4. Cache and invalidation

The archive cache entry gains a `circle` field: the sorted
`characterId:tier` list. It is compared alongside `generation`, `size` and
`presence`.

Invalidation:

| Event | What is invalidated |
|---|---|
| A member added to or removed from a group (`addMember` / `removeMember`) | Every current member's archives (the roster after the change, plus the removed member) |
| `deleteByGroupId` | Every former member's archives |
| A character archived or rehydrated | The archives of everyone who shares a group with them |

Each of these calls the existing `invalidateFrozenArchive`, from the repository
call sites' service layer in the parent, never from inside the repository.
Ordinary turns never invalidate, as now.

### B5. Inter-character section for absent circle members

Out of scope for this spec. The full-text circle section already gives absent
members their full-text lines, and widening `interCharacterSubjects` would double
the cost. Revisit only if the replay shows the circle section's budget is too
small.

### B6. Tuning surface

`INNER_CIRCLE_ARCHIVE_SHARE` and the allowance table become constants in
`assemble.ts` beside the other sizing constants. They are also overridable
through the recall-replay `tuning` input (`RecallTuningInputSchema`: add
`innerCircleShare`, `innerCircleAllowance`), so the values can be tried against
the probe set without a code change.

### B7. As built (2026-10-21)

- **Modules.** `resolveInnerCircle`, `innerCircleSignature` and
  `innerCircleAllowanceFor` are in `lib/memory/recall/inner-circle.ts`.
  `getOrComputeFrozenArchive` now returns a `FrozenArchive { anchors, circle }`:
  the anchors stay id-sorted and the circle stays in circle order.
  `InnerCircleEntry` (with `tier`, `rank` and `order`) and
  `innerCircleTrimOrder` are in `types.ts`, so `render.ts` stays free of
  repository imports. `renderInnerCircle` is in `render.ts`.
- **Cap and budget.** One ordering, `innerCircleTrimOrder` (tier, then rank
  within the member, then circle order), drives both the archive's count cap
  and the renderer's token budget. Cutting from its end drops the loosest tier
  first, and each member's later digests before anyone's first. The count cap
  is `min(floor(size × share), size − rows already taken)`. A tier is not read
  at all once the tighter tiers fill the cap. The anchors render in whatever
  part of `archiveTokenBudget` the circle leaves.
- **Constants.** `INNER_CIRCLE_ARCHIVE_SHARE` and `INNER_CIRCLE_ALLOWANCE` live
  in `recall/tags.ts` beside `RECALL_TUNING_DEFAULTS`, not in `assemble.ts`. The
  resolved tuning (`innerCircleShare`, `innerCircleAllowance`) takes its
  defaults from them, which keeps a single source.
- **Invalidation: the signature, not hooks.** The circle is re-read every turn
  (one `findByCharacterId`, then one `findByGroupId` and one `groups.findByIdRaw`
  per group, then one `findNamesByIds(…, { excludeArchived: true })`). Its
  ordered `characterId:tier` signature, plus the share and allowance, is part
  of the cache check. That covers every event in the B4 table, along with
  imports and renames that reorder the circle. The explicit
  `invalidateFrozenArchive` calls at the group routes and in the archive service
  would therefore be redundant, so they were not added. The cost is a handful
  of small indexed reads per turn, with no vault reads.
- **Tests.** `frozen-archive-cache.test.ts` covers:
  - tiering, order, exclusions, the cap and its trim order, and the tier skip;
  - the knobs;
  - recompute on membership change and on archive.

  `render.test.ts` covers full text, order and the budget cut.
  `assemble-deliver.test.ts` covers section placement, full text and
  archive-pool dedup.
- **Replay (Friday, read-only, 2026-10-21).** `recall-replay` was run on chat
  f343608e at its last turn with `--memory-budget 8000`, which gives archive
  size 60, a circle cap of 20 and a circle budget of 2,266 tokens. Charlie and
  the other speaker were present.

  | Holder | Members | Rows held | Rows rendered |
  |---|---|---|---|
  | Friday | 8 | 15 | 14 |
  | Amy | 8 | 15 | 15 |

  - Abigail has three full-text lines in both circles. Friday's include
    "Abigail is pregnant: fertilization is confirmed…" (0.95).
  - Amy's three Abigail digests are about the marriage terms and the gravity
    dose. Neither her hair nor the pregnancy is among them: that is the gap
    keystones (Part C) fill.
  - Many circle lines are pre-Phase-1 "committed to…" digests at 0.9, because
    old rows are not re-rated (§6, backfill rescore).
  - Two runs gave identical archive pools.
  - At the replay's default budget of 2,000 tokens (archive size 28), only 3
    of 9 circle rows fit their 566-token share. Full-text digests run long, so
    a small budget favours the tightest members by design.
  - The replay result now carries `warnings`. A failed archive used to leave
    no trace entry and an empty pool, with no reason given.

---

## 5. Part C — Keystone memories

### C1. What a keystone is

A keystone is a memory the operator has marked as a **standing fact**: always
true until edited, and always delivered to its holder in full. Examples:

- "Abigail has a human body: a woman in her thirties with emerald-green hair and
  teal eyes. She is also the ship's mind."
- "Abigail is carrying Charlie's daughter; she was the first of the three wives
  to conceive."
- "Friday is strawberry blonde; Amy is Indian, with jet-black hair."

Any row can be a keystone, whatever its source: a hand-written MANUAL row, a
digest or an AUTO row the operator promotes. Keystones are scoped like any
memory: one holder, one `aboutCharacterId`.

### C2. Storage

- **New column:** `memories.keystone INTEGER NOT NULL DEFAULT 0`, plus a partial
  index `idx_memories_keystone (characterId, aboutCharacterId) WHERE keystone = 1`.
- **Schema:** `MemorySchema` gains `keystone: z.boolean().default(false)`.
- **Migration** `add-memory-keystone-v1`:
  - `ALTER TABLE` plus the index;
  - a pretty label in `lib/startup/prettify.ts`;
  - no loop, so no `reportProgress`.
- Update [DDL.md](../DDL.md), `public/schemas/qtap-export.schema.json`
  (`$defs/Memory`), and the export, import and backup paths (the field rides
  with the row; restore and import preserve it).
- **Limit:** at most `KEYSTONES_PER_SUBJECT_MAX = 5` hot keystones per
  `(holder, aboutCharacterId)`. The write path refuses a sixth with a validation
  error naming the limit.

### C3. Recall

`MemoriesRepository.findKeystones(characterId, subjectIds | 'self')` is
hot-only, ordered `updatedAt ASC, id ASC` so the order is stable, never by
score. The archive takes:

| Archive step | Keystones taken |
|---|---|
| Step 1 | each present character's keystones, before their digests |
| Step 2 | self keystones, before self digests |
| Step 3 | each circle member's keystones, before their digests (within B2's allowance) |

A keystone about a present character is **lifted out of the anchors into
`## Those Closest to You`**. Summary-only rendering is the problem this spec
exists to fix, so a keystone always renders full text wherever it lands.
Keystones about anyone outside presence, self and circle get no guaranteed
slot. They compete in the fill like any row.

### C4. Protection in maintenance and admission

A keystone is the operator's own statement. Nothing automatic rewrites it, moves
it or hides it:

- **Fold near-duplicates:** keystones are never candidates, as either survivor
  or absorbed (`fold-near-duplicates.ts` already excludes MANUAL and digests;
  add keystones).
- **Consolidate:** never a member. A keystone never goes cold under a digest.
- **Demote:** never demoted, never counted against the cap (alongside "hot
  MANUAL rows and digests" in `maintenance/types.ts`).
- **Admission:** `decideAdmission` may still pick a keystone as the target of a
  reinforcement (count and `lastReinforcedAt`), but **`foldInto` appends no
  `[+]` footnotes to a keystone**. Its content changes only by hand edit.
- **Retire:** deletion stays the operator's, through `retireMemories` as now.
  Retention sweeps never reach a keystone, because it is never cold.

### C5. Writing keystones

All writes go through `updateMemory` (`lib/memory/admission/update-memory.ts`),
the existing hand-edit chokepoint, and creation through the existing MANUAL
create path. Both validate the per-subject limit and invalidate the holder's
frozen archive. Toggling `keystone` is a corpus-shaping edit, so it does
invalidate.

| Surface | Change |
|---|---|
| **UI** (Commonplace Book) | `memory-editor.tsx` gains a "Keystone — always remembered" toggle; `memory-card.tsx` shows a keystone mark; `memory-list.tsx` gains a keystone filter. Copy in the house voice. |
| **API** | Through the existing memory PUT / POST. No new route. |
| **CLI** | `quilltap memories ls --keystone`; `show` prints the flag. Setting one from the CLI goes through the running server (`--write`, lock-gated), like `validate --repair`. |
| **Character tools** | None in this spec (see §6). |

### C6. Seeding

There is no automatic seeding. The spec's own acceptance test seeds keystones on
Friday by hand for the facts in §1.1. A future "suggest keystones" maintenance
phase is listed in §6.

---

## 6. Open questions and deferred work

- **Backfill rescoring (A3).** A one-off cheap-LLM pass, reached as
  `?action=maintain` with a new `rescore` phase, could rescore hot AUTO rows on
  the new scale. At about 2,800 hot rows per character, that is a real but
  bounded spend. Decide after Part A has run for a week and the replay shows how
  much saturation remains.
- **Character-set keystones.** A `memory_keystone` tool would let a character
  pin a fact she just learned. It is deferred because the rubric failure in §1.2
  shows what models do with "this matters": they say it about everything.
- **Suggest-keystones phase.** Consolidation could propose candidate keystones
  from high-count digests about circle members, for the operator to accept in
  the UI.
- **Per-group opt-out.** A "does not imply closeness" flag on a group (for
  example, Estate Staff). Not needed while the tightness tiers and the share cap
  keep large groups to one slot each; revisit if a roster appears that is small
  but not intimate.
- **Archive fill tie-break.** Within a score tie, `findMostImportant` and
  `findHotDigests` prefer the newest row. Ordering ties by
  `reinforcementCount DESC` first would favour facts retold often over facts
  said recently. It is small and separable; try it through the replay tuning
  input before committing.

---

## 7. Validation

1. **Replay the failing turns.** Run `quilltap recall-replay
   f343608e-d950-4d2c-bcb4-42f22b13edd9` on Friday's 12:58 turn and Amy's 13:02
   turn, before and after Part B, then again after hand-seeding the §1.1
   keystones.
   - **Pass:** `## Those Closest to You` carries Abigail in full text for both
     characters, and, with keystones, states her body, hair and pregnancy.
2. **Byte-stability.** Over five consecutive turns in one generation, with no
   group or keystone changes, the archive bytes are identical.
3. **Invalidation.** Adding a member to the Constellation in V4test changes the
   next turn's archive for every Constellation member, and no one else's.
4. **Cap.** In a V4test character with more than 25 circle members, the circle
   step holds at a third of the archive, and the loosest tier is trimmed first.
5. **Rubric.** The A2 fixtures pass; `memory-diff` on the 2026-10-19 build chat
   scores no work commitment above 0.65.
6. **Maintenance.** A dry-run `maintain --character Friday --dry-run` lists no
   keystone as a fold, consolidation or demotion candidate.

Experiments run in **V4test**, never in Friday. Friday is used read-only
(replay, `memory-diff`, CLI reads).

---

## 8. Phasing

| Phase | Scope | Ships alone? |
|---|---|---|
| 1 | Part A: rubric and tests | Yes. Prompt-only, no schema. |
| 2 | Part B: inner circle, full-text section, cache key, invalidation, tuning knobs | Yes. Immediately helps Friday's Abigail digests. |
| 3 | Part C: column, migration, protection, UI, CLI, export | Yes. Phase 2's section already has the slot it fills. |

## 9. Documentation to update on implementation

- `help/memory-recall-relevance.md`: the inner circle and the new section.
- `help/memory-maintenance.md`: keystones are never folded, consolidated or
  demoted.
- `help/groups.md`: group membership now shapes what characters remember about
  each other.
- `help/cli-memories.md` and `packages/quilltap/README.md`: `--keystone`.
- [DDL.md](../DDL.md), `qtap-export.schema.json`, `docs/CHANGELOG.md`.
- Move this file to `complete/` with implementation notes when done, and add a
  line under the memory section of the [ROADMAP](ROADMAP.md).
