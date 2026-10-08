# Memory Consolidation and Tiers — Let the Commonplace Book Forget Gracefully

**Status:** Implemented 2026-10-08 (workstreams A–D, E4 chores). E2 Friday backfill and E3 measurement not yet run — see §9.
**Owner:** Charlie
**Drafted:** 2026-10-08
**Companion:** [memory-recall-and-housekeeping-fixes.md](./memory-recall-and-housekeeping-fixes.md)
(the small, independent fixes; ship those first — several of them make this
spec's validation meaningful)

A handoff spec for Claude Code. The Commonplace Book can **append**, **reinforce**,
**link**, and **delete**. It cannot **combine**. At Friday's scale (700+
conversations, ~5,000 memories) that one missing verb is the root of every
symptom: recall that can't keep track, a corpus that only grows, and a
housekeeping sweep whose only lever is deletion — which is now quietly
destroying her older history every night.

This spec adds the missing verb (a consolidation job that writes **digest**
memories), a place to put what's been combined (a **hot/cold tier**), a change
of grain at the source (memories about *others* extracted per fold, not per
turn), and the recall changes that make digests the thing a character actually
sees.

Read §1 before touching code. Several obvious-looking alternatives (lower the
cap, turn up `mergeSimilar`, raise the gate thresholds) make things worse.

---

## 1. Diagnosis — Friday, measured 2026-10-08

All numbers from Friday (`d9d0d998-281e-4598-8345-d81d47be5e97`) via the CLI on
2026-10-08; code references verified against `f5e953a3f`.

### 1.1 The corpus

| Measure | Value |
|---|---|
| Total memories | 5,037 |
| About others / self / null-about | 3,116 / 1,767 / 154 |
| `kind: 'episodic'` | 230 (4.6%) |
| `reinforcementCount = 1` | 4,856 (**96%**) |
| No `relatedMemoryIds` | 3,098 (62%) |
| Importance ≥ 0.6 | 4,806 (95%); 0.8–0.9 alone is 65% |
| Created 2026-09 / first 8 days of 2026-10 | 1,875 / 808 (~16/day Apr–Jul → ~100/day now) |
| Source of Sep–Oct growth | ordinary `salon`/`user_present` chats (autonomous rooms: 105) |
| Top Sep chats | 58–111 memories *for Friday alone* per chat |

Sample of her latest memories about others: *"proposed memory strategy talk"*,
*"proposed storytelling over prompting strategy"*, *"proposed performing the past
as story"*, *"proposed ariadne memory-system piece"*, *"joined memory strategies
discussion"* — one conversational thread, five rows, none reinforcing another;
plus ephemera stored as standing facts (*"insisted charlie eat eggs"*, *"busy all
morning with sewer"*).

### 1.2 Why the pile grows

- **Per-turn extraction is the wrong grain for observations of others.**
  `memory-processor.ts` runs a SELF pass per character and an OTHER pass per
  (observer, subject) pair *every turn*, up to `HARD_CANDIDATE_CAP = 2` each
  (+`EVENT_EXTRA_SLOT`). In a room with Charlie, Laura, Amy, and Abigail, Friday
  alone can mint ~11 candidates per turn. A turn sees one beat of a thread, so it
  emits fragments of the thread.
- **The extractor's "already known" list never includes memories.** Canon is the
  card fields (SELF) or a hand-written `Others/<name>.md` (OTHER)
  (`cheap-llm-tasks/canon.ts`). Nothing learned ever flows back into canon, so
  the same facts are re-extracted forever and left to the gate.
- **The gate can't fold paraphrases.** Fragments of one thread embed in the
  0.70–0.85 band → `INSERT_RELATED` (or below → `INSERT`). Only 0.85–0.90
  reinforces; ≥ 0.90 is skipped *without* reinforcing (companion spec F1).
  Result: 96% of rows have never been reinforced.

### 1.3 Why housekeeping now destroys history

Housekeeping is enabled; Friday's cap override is 5,000. The 2026-10-08 04:35
sweep: `totalBefore 5013 → totalAfter 5000`, `merged 1`.

- Protection (`calculateProtectionScore`): content capped at 0.40 + 0.08 for
  `reinforcementCount = 1` + 0.10 recent-access (83% of rows have a
  `lastAccessedAt`, because every search bumps all ~15 fetched candidates). An
  importance-0.8 memory stays ≥ 0.5 for ~40 days; then it is fair game.
- So at ~100 new rows/day against a full cap, the cap pass deletes ~100
  **older** rows/day, chosen by `effectiveWeight` — which, with importance
  clustered at 0.6–0.9 and a 0.70 decay floor, is close to arbitrary.
  Pre-September history (~2,300 rows) is on track to be gone within a month.
- `mergeSimilar` is not a merge: the loser is deleted and its `[+]` details,
  reinforcement count, and links are discarded (`housekeeping.ts` pass 2). It
  also rarely fires (gate blocks ≥ 0.90 inserts; date guard skips the rest).

**Interim mitigation (already advised, not part of this spec):** back up, then
raise Friday's `perCharacterCapOverrides` entry to ~10,000 so nightly sweeps stop
evicting. A larger corpus is a recall problem this spec solves; deleted rows are
unrecoverable.

### 1.4 Why recall can't keep track

Per turn Friday sees ~30 of ~5,000 memories: the frozen archive (25, chosen from
the top 100 by **raw** `importance` with no tiebreak — `findMostImportant`), a
dynamic head of 5 in ≤ 200 tokens, plus inter-character slots. Contradicted
facts both stay live and either can surface. There is no row that says "here is
what Friday knows about Laura," only hundreds of shards of it.

---

## 2. Design overview

```
             per turn                       per fold (every 5 turns)              daily / watermark
  ┌──────────────────────────┐   ┌─────────────────────────────────────┐   ┌──────────────────────────┐
  │ SELF pass (unchanged)    │   │ OTHER pass (moved here, A1)         │   │ MEMORY_CONSOLIDATION (C) │
  │ OTHER: commitments/new   │   │ episode pass (unchanged)            │   │ cluster hot rows per     │
  │ facts ≥ floor only (A1)  │   │                                     │   │ subject → write DIGESTS  │
  └────────────┬─────────────┘   └──────────────────┬──────────────────┘   │ members → cold, superseded│
               └──────────── memory gate ───────────┘                      │ mirror digests to vault  │
                                     │                                     └────────────┬─────────────┘
                               HOT tier ◄──────────────────────────────────────────────┘
                                     │  (cap pressure → DEMOTE, never delete AUTO rows) (B)
                               COLD tier: gate + search tool only; never whispered
```

Five workstreams. **B (tiers) lands first** — it is the safety net that makes
everything else non-destructive. Then C (consolidation), D (recall reads
digests), A (extraction grain), E (rollout).

---

## 3. Workstream B — Hot / cold tiers

### B1. Schema

Migration `add-memory-tiers-v1` (`migrations/scripts/`, registered in
`index.ts`, `PRETTY_LABELS` entry in `lib/startup/prettify.ts` — e.g.
*"Fitting the Commonplace Book with a cellar"*):

```sql
ALTER TABLE memories ADD COLUMN "tier" TEXT DEFAULT 'hot';            -- 'hot' | 'cold'
ALTER TABLE memories ADD COLUMN "supersededById" TEXT DEFAULT NULL;   -- digest that replaced this row
ALTER TABLE memories ADD COLUMN "consolidatedFrom" TEXT DEFAULT '[]'; -- digest: JSON string[] of member ids
ALTER TABLE memories ADD COLUMN "consolidatedAt" TEXT DEFAULT NULL;   -- last time the consolidator considered this row
CREATE INDEX "idx_memories_character_tier" ON "memories" ("characterId", "tier");
```

- `MemorySourceEnum` gains `'CONSOLIDATED'` (digest rows).
- `MemorySchema` gains the four fields (`tier` default `'hot'`).
- Update `docs/developer/DDL.md`, `public/schemas/qtap-export.schema.json`,
  export/import, backup/restore (missing columns read as hot / null / `[]`).
- **v5:** this is a v4 schema move; v5 follows it by re-dumping
  `fresh_schema.json` (D23), never by hand.

### B2. Who reads which tier

| Path | Tier |
|---|---|
| Frozen archive, dynamic head, proactive pre-search | hot only |
| Inter-character both halves (`findByCharacterAboutCharacters` + relevance) | hot only |
| Memory recap (`findRecentByImportanceTier`) | hot only |
| Memory gate (`runMemoryGate`) | **hot + cold** (so cold rows still stop re-insertion) |
| `search` tool / Commonplace Book UI / CLI | hot + cold, cold labelled |

The character vector store holds both tiers. Put `tier` in each vector entry's
metadata and give `vectorStore.search` an optional predicate (it is brute-force,
so a filter costs nothing; over-fetch is unnecessary). Keep metadata in sync on
demote / promote.

### B3. Gate behavior against cold rows

When the gate's best match is a **cold** row that has a `supersededById`:

- `REINFORCE` / `SKIP_NEAR_DUPLICATE` → redirect the reinforcement to the
  superseding digest (increment its count, `lastReinforcedAt`; no footnote —
  the next consolidation folds the novel detail in, see C4).
- `INSERT_RELATED` → link to the digest, not the cold member.

A cold row with no `supersededById` (demoted by cap pressure, B4) that is
re-observed at ≥ MERGE is **promoted** back to hot and reinforced — the world
asked for it again.

### B4. Housekeeping becomes demotion

- The cap counts **hot** rows only.
- Pass 3 (cap) **demotes** instead of deleting: same ranking, same protection,
  but `tier = 'cold'`.
- Pass 2 (`mergeSimilar`) is retired in favour of consolidation (or, until C
  lands, replaced by the real merge in companion spec F9).
- Pass 1 (low-importance + old + inactive) also demotes.
- **Deletion** of AUTO rows happens only for cold rows that are superseded *and*
  older than `coldRetentionDays` (setting, default `null` = never). Deletion
  stays on `deleteMemoriesWithUnlinkBatch`. MANUAL rows are never demoted or
  deleted automatically.

Cold rows are cheap (Friday's 5,000 rows are a rounding error next to her
~837 MB database), so the default is: nothing AUTO is ever destroyed by policy.

---

## 4. Workstream C — The consolidation job

### C1. Job and triggers

- New job type `MEMORY_CONSOLIDATION` (`lib/schemas/job.types.ts`), handler
  `lib/background-jobs/handlers/memory-consolidation.ts`, service
  `lib/memory/consolidation.ts`.
- Triggers: daily scheduled sweep (beside `scheduled-housekeeping.ts`, run
  **before** housekeeping), plus a watermark — enqueue for a character when
  hot rows with `consolidatedAt IS NULL` exceed `watermark` (default 150).
  Dedupe in-flight jobs per character as `enqueueMemoryHousekeeping` does.
- Manual: "Consolidate now" (with dry-run) in the Memory settings tab and
  `npx quilltap memories consolidate --instance <i> --character <name> [--dry-run]`.

### C2. Settings

`instance_settings['memoryConsolidation']` (key-value, no migration —
precedent: `memoryRecall`, `memoryExtractionLimits`):

```ts
{
  enabled: boolean            // default false; Friday rollout turns it on
  connectionProfileId: string | null  // null → cheap LLM; recommend a capable model
  clusterThreshold: number    // cosine, default 0.72
  minClusterSize: number      // default 3 (2 when any member is > matureAfterDays old)
  maxClusterSize: number      // default 30
  matureAfterDays: number     // default 7 — don't consolidate rows younger than this
  maxClustersPerRun: number   // default 40 — bounds cost; backlog drains over runs
  watermark: number           // default 150
  coldRetentionDays: number | null // default null (never delete cold)
}
```

### C3. Bucketing and clustering

Per character, per **subject bucket** (`aboutCharacterId`; self; null):

1. Load hot, non-digest rows older than `matureAfterDays`, plus the bucket's
   existing hot digests. Page loads like `runHousekeeping` does and yield to the
   event loop.
2. **Semantic rows:** greedy agglomerative clustering on stored embeddings at
   `clusterThreshold`, average linkage, capped at `maxClusterSize`. A row whose
   best neighbour is an existing digest joins that digest's cluster.
3. **Episodic rows** cluster only with episodic rows whose `occurredAt` is
   within 1 day (respecting `DATE_GUARD_DAYS` semantics) — they consolidate into
   *episode* digests, never into standing-fact digests.
4. Skip clusters below `minClusterSize`; mark their rows `consolidatedAt = now`
   so they aren't re-scanned every run (they re-qualify when a new neighbour
   arrives — compare against `consolidatedAt`).

Order clusters by total member `reinforcedImportance` and take the top
`maxClustersPerRun`.

### C4. The consolidation call

One LLM call per cluster (`cheap-llm-tasks/consolidation-tasks.ts`, Zod schema
as single source of truth, JSON output). Input: holder name, subject name and
canon, existing digest (if any), members as `id | occurredAt | importance |
reinforcementCount | content` sorted chronologically. Output:

```ts
{
  digests: Array<{
    content: string          // match the extractor's voice: third person about
                             // the subject; first person ("I") for the self bucket
    summary: string          // ≤ 12 words, extractor style
    keywords: string[]       // incl. the three targeting tags (recall-tags.ts vocab)
    importance: number       // 0.2–1.0
    kind: 'semantic' | 'episodic'
    occurredAt?: string      // episodic only: earliest member event time
    memberIds: string[]      // which inputs this digest replaces
  }>
  keepStandalone: string[]   // members too distinct to fold — stay hot, untouched
  contradictions: Array<{ olderId: string; newerId: string; note: string }>
}
```

Prompt rules (write them in house voice; the CHANGELOG stays plain):

- Combine; don't summarize away specifics. Names, dates, numbers, quoted
  promises survive.
- **Newer wins on conflict.** The digest states the current truth; where the
  change itself matters, record it ("prefers tea now; preferred coffee until
  late August").
- Ephemera (a meal, a busy morning) fold into one line of pattern
  ("Charlie often skips breakfast on job days") or are dropped into
  `keepStandalone` when they are a dated event worth keeping as an episode.
- Never invent; every digest sentence must trace to a member.

Validation: every `memberIds` entry must be an input id; every input appears in
exactly one of `digests[].memberIds` or `keepStandalone` (unlisted → treat as
`keepStandalone`). On schema failure, skip the cluster (log) — never partial
writes.

### C5. Writing the result

For each digest (all writes in one per-character batch; the job runs in the
forked child, so reads do **not** see its own writes — compute everything,
then write):

- Insert via the direct-with-embedding path (**skip the gate** — it would
  absorb the digest into its own members). `source: 'CONSOLIDATED'`,
  `consolidatedFrom: memberIds`, `reinforcementCount = Σ member counts`
  (cap 50), `importance` = LLM value clamped to `[min, max]` of member
  `reinforcedImportance`, `relatedMemoryIds` = union of members' links pointing
  *outside* the cluster, `occurredAt` per kind, `chatId` / `projectId` only if
  all members share one.
- Updating an existing digest: update in place (append to `consolidatedFrom`,
  re-embed), don't mint a second row.
- Members: `tier = 'cold'`, `supersededById = digest.id`,
  `consolidatedAt = now`. Rewrite inbound links: neighbours that pointed at a
  member now point at the digest (dedupe).
- Contradictions: the older row goes cold (`supersededById` = the digest that
  carries the newer fact).
- Invalidate the character's frozen archive cache (companion F5) and vector
  store (the job dispatcher's `vectorStore` invalidation already covers writes
  from the child — verify the new metadata field rides along).
- Publish `memories` realtime from the parent chokepoint as existing jobs do.

### C6. Mirror digests into the vault (canon feedback)

After commit, write one file per subject bucket into the holder's vault:
`Commonplace/<Subject Name>.md` and `Commonplace/Self.md` — **separate from**
the hand-written `Others/` folder so no user prose is ever overwritten.
Frontmatter: `type: commonplace-digest`, `subjectCharacterId`, `updatedAt`.
Body: the subject's hot digests, highest importance first, ≤ ~1,500 tokens.

- Vault writes must run on the parent: follow
  `writeConversationSummaryToVaults`, which proxies through `callHost` from the
  child. Respect the archived-character tombstone (`findByIdRaw` →
  skip), as that bridge does.
- Canon loaders (`cheap-llm-tasks/canon.ts`): OTHER canon becomes
  `Others/<name>.md` (hand) **then** `Commonplace/<name>.md` (digest);
  SELF canon appends `Commonplace/Self.md` after the card fields. Cap the
  combined canon block; keep it in the cached prefix as today.

This is the loop that slows growth at the source: once a fact is digested, the
extractor sees it as ALREADY ESTABLISHED and stops re-mining it.

---

## 5. Workstream D — Recall reads digests

- **Frozen archive** (`frozen-archive-cache.ts`): compose instead of "top 25 by
  importance":
  1. For each character present this turn: their top hot digests (default 3
     each, by `reinforcedImportance`).
  2. Top self digests (default 5).
  3. Fill to size with top hot rows by `reinforcedImportance DESC`, then
     `COALESCE(lastReinforcedAt, createdAt) DESC`.
  Size by budget rather than a fixed 25 (companion F7). Still sorted by id for
  byte-stability within a generation; cache key includes the chat (F5).
- **Inter-character importance half:** digests about that character first, then
  the existing query, hot only.
- **Recap:** hot only, digests preferred in the high tier.
- **Dynamic head / proactive search:** hot only (B2). Digests compete on cosine
  like anything else — they usually win, because they are denser.
- **`search` tool:** returns cold rows labelled `(archived — superseded by
  <digest id>)` so a character drilling into the past still finds the shards.

---

## 6. Workstream A — Extract observations of others at fold grain

### A1. Move the OTHER pass to the fold

- Folds already run every `FOLD_TURN_BATCH = 5` turns once a chat passes
  `FOLD_TRIGGER_DELTA = 10` (`lib/chat/context-summary.ts`), and the episode pass
  already piggybacks there. Add `runFoldOtherPass` beside `runFoldEpisodePass`:
  per (observer, subject) over the folded window, cap 3 candidates per subject,
  same prompt family as today's OTHER pass but told it is seeing a *stretch of
  conversation* and should state each thread once.
- Per-turn OTHER pass is kept only for **commitments, agreements, and new
  standing facts**: candidates below `perTurnOtherFloor` (default 0.75) are
  dropped (reuse `applyImportanceFloor`).
- Setting: `memoryExtractionMode.otherPass: 'turn' | 'fold' | 'hybrid'`
  (default `'hybrid'` as above; `'turn'` is today's behavior). Instance
  setting, no migration.
- **Short chats never fold.** Track `chats.otherExtractionWatermarkMessageId`
  (new column, same migration as B1 or its own); the daily maintenance sweep
  (`scheduled-maintenance.ts`) runs a catch-up fold-grain OTHER pass for chats
  idle > 2 h whose last message is past the watermark. Advance the watermark at
  every fold-grain pass.

### A2. SELF pass

Unchanged in cadence. Gains `Commonplace/Self.md` in canon (C6), which is the
main lever on SELF duplication.

### A3. Expected effect

Rough budget for a 4-character room: today up to ~11 candidates/turn for one
observer; hybrid ≈ 3 SELF + high-floor OTHER per turn + ≤ 9 per 5-turn fold.
Expect 3–5× fewer rows before consolidation even runs. Measure (E3).

---

## 7. Workstream E — Rollout and validation

### E1. Order

1. Companion fixes F1–F9 (independent, small).
2. B (migration + tier reads + demotion). Ship; Friday stops losing rows by
   design.
3. C + C6, behind `memoryConsolidation.enabled = false`.
4. D.
5. A, behind `memoryExtractionMode.otherPass`.

### E2. Friday backfill

1. Backup (System → Backup) and keep it.
2. `npx quilltap memories consolidate --instance Friday --character Friday --dry-run`
   → review ~20 digests against their members by hand (Charlie). Tune the prompt
   and `clusterThreshold` here.
3. Run for real with `maxClustersPerRun` raised (or repeated runs). Expect
   ~5,000 rows → a few hundred digests + standalones hot, the rest cold.
   Use a capable model profile for this pass; the cheap LLM can handle steady
   state.
4. Lower Friday's cap override back toward 2,000–2,500 hot only once hot count
   is under it.

### E3. Measurement

Build on `lib/memory/recall-replay.ts`:

- **Fact probes:** a fixed list of ~25 questions about Charlie, Laura, Amy,
  Abigail, and Friday with known current answers (including a few known to have
  changed). Replay the dynamic head + archive for each; score whether the right
  fact appears and whether a stale contradicting one also appears.
- **Composition:** per-turn whisper — digests vs. fragments, hot count, token
  spend.
- **Growth:** rows/day before and after A.

Acceptance (Friday):

- No AUTO row deleted by policy after B.
- Hot count < cap with consolidation on; ≥ 80% of whispered entries are digests
  or standalones (not fragments) on the probe set.
- Probe accuracy improves vs. baseline; stale-contradiction appearances near
  zero.
- New rows/day falls ≥ 3× after A at comparable usage.

### E4. Housekeeping chores per repo rules

`docs/CHANGELOG.md` (plain voice); `help/` pages for the Memory settings tab
(consolidation toggle, "Consolidate now", tiers in the memory list) with `url`
frontmatter + In-Chat Navigation; DDL.md; export schema; `lib/startup/prettify.ts`
label; tests for clustering (pure), the consolidation schema, gate-against-cold
redirect, demotion-not-deletion, and canon loading order.

---

## 8. Risks and open questions

- **Consolidation quality is the whole game.** A bad digest is worse than five
  fragments because it outranks them. Mitigations: members stay cold and
  searchable; digests are rewritable; dry-run review on Friday before enabling.
  Open: should a digest carry a short provenance line ("from 14 notes, Apr–Sep")
  in the whisper? Probably yes, for the character's own epistemic honesty.
- **Cost.** Friday's backfill is a few hundred calls; steady state is bounded by
  `maxClustersPerRun`. Open: whether steady state needs the capable model or the
  cheap one suffices — decide from the dry-run comparison.
- **Prefix-cache churn.** The archive changes when digests change. Consolidation
  runs daily, so at most one archive change per day per character, plus chat
  compaction generations as today.
- **Self vs. others voice.** Digest prose must follow the extractor's existing
  person conventions (first person for SELF, third for others).
- **Fold-grain OTHER pass on dangerous chats.** Inherit the Concierge policy /
  uncensored fallback exactly as the per-turn pass does.
- **v5.** Every schema move here is a D23 follow for quilltap-v5; the
  consolidation job is a new Phase-3-style service with its own differential
  corpus when v5 ports it.

---

## 9. Implementation notes (2026-10-08)

Built as specified, with these decisions and deviations:

- **B4.** Pass 2 (`mergeSimilar`) is retired outright; the setting is read but ignored. Digests
  (`CONSOLIDATED`) are fully protected from both demotion passes, like MANUAL rows, rather than
  being demotable by the cap as a last resort.
- **B3.** A redirected REINFORCE against a superseded cold row is reported as
  `SKIP_NEAR_DUPLICATE` on the digest (that path updates count / `lastReinforcedAt` /
  `reinforcedImportance` without a `[+]` footnote). Superseded chains are followed up to 3 hops. A
  cold row seen only in the related band is linked to, never promoted.
- **B2.** The vector index does not persist metadata, so `tier` is stamped at
  `CharacterVectorStore.load` from `findColdIdsByCharacterId`; a failed lookup degrades to "all
  hot". `isHotVector` is the recall predicate.
- **C3.** "`minClusterSize` drops to 2 when any member is > `matureAfterDays` old" would always apply
  (every candidate is already that old), so the drop applies when a member is older than
  2 × `matureAfterDays`. Only hot AUTO rows are consolidation candidates (MANUAL never). Buckets are
  capped at 2,000 rows per run. Members are handed to the model as `m1…mN` handles, not UUIDs.
- **C5.** Concierge policy is inherited from the members' chats: any Locked chat wins, then
  Unmoderated (uncensored desk), then the global policy. A digest whose embedding fails drops its
  whole cluster from the batch.
- **C1.** Watermark checks run in the dispatcher's post-commit hook for memory-writing jobs,
  debounced to one count per character per 10 minutes, and skip a character consolidated in the last
  6 hours. When the daily sweep enqueues any consolidation, housekeeping is scheduled 30 minutes
  later. Job runs get a 7-minute time budget (the dispatcher's stuck-job sweep is 10). Dry-run *jobs*
  only log their report; the API dry run calls `runConsolidation` in-process.
- **C6.** From the job child, the vault mirror is written via host-RPC at the end of the handler,
  slightly before the parent commits the batch (same as `writeConversationSummaryToVaults`). The
  no-subject bucket gets no mirror file. Combined canon is capped at 2,500 tokens; only the digest is
  trimmed.
- **D.** Inter-character recall prepends 2 digests per character (not 3). Provenance is the count
  only (`(from N notes)`), so the frozen archive stays byte-stable.
- **A1.** The fold-grain pass reuses the per-turn OTHER task type and writer. Catch-up windows are
  the newest 60 messages past the watermark; chats active in the last 30 days only. The chat memory
  regenerate resets the watermark and enqueues one catch-up (idle check skipped).

Not done yet: **E2** (Friday backfill — dry-run review of ~20 digests, then real runs with a capable
profile) and **E3** (fact probes, composition and growth measurement).

