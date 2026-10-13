# Built-in TF-IDF profile: tuning the memory system for a lexical embedder

**Status:** Implemented (4.10-dev, 2026-10-13). Thresholds in §3 were calibrated offline; §7 lists the live checks still owed on `V4test`.
**Scope:** quilltap-server core only. No change to the `qtap-plugin-builtin-embeddings` plugin. One new column (`tfidf_vocabularies.textShapeVersion`, migration `add-tfidf-text-shape-version-v1`) and one new consolidation setting (`tfidfClusterThreshold`).
**Provider:** `BUILTIN`, model `tfidf-bm25-v1`, plugin `plugins/dist/qtap-plugin-builtin-embeddings/` (TF-IDF with BM25 term weighting, Porter stemming, unigrams + bigrams, dense L2-normalised vectors one dimension per vocabulary term).
**Source:** the 2026-10-13 dogfood session on `V4test` (bugs 235–241, commit 93c5af6ad).

## Summary

The memory system was tuned against neural embeddings, whose cosines live in a compressed band (~0.25 unrelated, ~0.45–0.75 related, 0.85+ restated). TF-IDF is a bag of stemmed words: unrelated text scores ~0, a restatement of the same fact ~0.4–0.6, and only near-verbatim text reaches 0.85. Four places assumed the neural scale or the neural text shape, and the job child had an unrelated start-up race:

| # | Finding | Cause | Change |
|---|---|---|---|
| 1 | Admission inserts duplicates on TF-IDF | The episodic anchor line's rare tokens (dates, place names) carry a large share of a short memory's vector mass; and the admission thresholds are on the neural scale | The BUILTIN path embeds memories **without** the anchor line (§2); admission uses a TF-IDF threshold set (§3) |
| 2 | Recall clears almost nothing | Same anchor dilution: query·memory cosines fall by the anchor's share of the norm | Fixed by §2; the 0.10 TF-IDF floor stays (§4) |
| 3 | Consolidation never clusters at 0.72 | Neural-scale default | `tfidfClusterThreshold` (default 0.30), used when the default embedding profile is BUILTIN (§5) |
| 4 | Every manual memory edit refits and re-embeds everything | `scheduleRefit` always enqueues refit + reindex | Refit only when the vocabulary is missing, predates the text-shape change, or has drifted (§6) |
| 5 | Help docs never embed on TF-IDF | The job child accepts jobs before its provider registry is loaded — bug 243 | The child holds each job until plugin initialisation settles |

## 1. Measurements

V4test (live, before this change): `anchor-probe` on Lorian (2a185c5b…) gave `anchoredBest 0.37`, `anchorFreeBest 0.9999` for memory eb77d81e… — identical summary and content, different anchors. `recall-replay` on chat fd40d93a… returned 1 vector candidate where the text fallback returned 12. A consolidation dry run formed clusters only at `clusterThreshold` 0.12.

Offline (this container cannot reach `V4test`): the plugin's own `TfIdfVectorizer`, fitted on the 132 help docs plus ~200 synthetic memory rows, as the refit does.

| Pair (summary + content) | Cosine |
|---|---|
| Identical text, anchors differ (date, place list) | 0.53 |
| Identical text, one anchored, one not | 0.69–0.71 |
| Different facts, **same anchor line** | 0.39 (0.30 with anchors removed) |
| Restatement of one fact (four pairs, anchors removed) | 0.38, 0.44, 0.57, 0.63 |
| Same topic, different occasion | 0.29 |
| Loose paraphrase (no shared content words) | 0.07, 0.19 |
| Same subject, different fact | 0.04, 0.05, 0.10 |
| Short recall query vs. the memory it should find | 0.22–0.26 |
| Short recall query vs. a weakly related memory | 0.06 |

Down-weighting numeric tokens alone (dates) was tried and rejected: at weight 0 it raised the identical-text-different-anchor pair only from 0.53 to 0.60. The entity names on the `place:` part, and the bigrams that join the content's last word to the anchor, carry most of the distortion — and they also make unrelated facts that share a place look alike.

## 2. The anchor line is not embedded on the BUILTIN path

`embeddingTextFor` (`lib/memory/index-store/embedding-text.ts`) is unchanged and stays the only builder of a memory's embedded text. Beside it, the same module exports `lexicalEmbeddingTextFor(memory)` — `summary\n\ncontent`, the same text without its anchor line, built from the fields (never by trimming the canonical text, so content that happens to end in "(place: …)" keeps its last line). `embeddingTextFor` builds its base from it, so the two cannot drift.

Every memory writer passes both to the embedding service: `generateEmbeddingForUser(embeddingTextFor(m, tz), userId, profileId, { priority, lexicalText: lexicalEmbeddingTextFor(m) })` — admission (`embedRow`), the unindexed-neighbour re-embed, `reembedRow`, `updateMemory`, `EMBEDDING_GENERATE`, the backfill, consolidation's digests and the anchor probe. `generateBuiltinEmbedding` embeds `lexicalText` when it is given and the text otherwise; every other provider ignores it, so neural vectors are byte-identical to before. Help-doc sections, recall queries and anything else that is not a memory carry no `lexicalText` and are embedded as given. The refit corpus is `lexicalEmbeddingTextFor` of every memory, so the vocabulary, IDF and average document length are fitted on the text that will actually be embedded.

Why not a provider argument on `embeddingTextFor`: the writers build the text before the profile is resolved inside `generateEmbeddingForUser`, so each would need its own profile read, and a profile switch between the two reads would embed the wrong shape. Handing both texts to the one place that knows the provider avoids that. (The first cut parsed the anchor line off the end of every BUILTIN text; review of PR 96 pointed out that it also trimmed help sections and queries, and memory content that ended in an anchor-like line.)

Why it costs nothing: the anchor line's two jobs are covered elsewhere for a lexical embedder. "Different occasion" is admission's structural date guard (`occasionsAreDistinct`, `dateGuardDays`), which reads `occurredAt` directly; entity names are found by recall's R4 anchor search, which is a text search. Entity names that matter usually also appear in the content.

**Reindex path.** Vectors already stored on a BUILTIN instance were embedded with anchors. Each vocabulary row carries `textShapeVersion`, the shape it was fitted on and its memories embedded with; `LEXICAL_TEXT_SHAPE_VERSION` (`embedding-text.ts`, now 1) is the current one, and the refit stamps it. Rows from before the column read 0. `checkBuiltinRefit` (§6) reports `text-shape` for any row below the current version, and the boot pass enqueues one refit-with-reindex, which clears it. A restore of an older backup brings a 0 back and triggers it again, which is correct. A version, not a date: a date cut-off would keep re-fitting vocabularies fitted on the day it shipped, and would wave through ones the old code fitted after it (review of PR 96). Bump the version whenever the BUILTIN text changes.

## 3. Admission thresholds per provider

`ADMISSION_THRESHOLDS` (neural) is unchanged. `ADMISSION_THRESHOLDS_TFIDF` sits beside it in `lib/memory/settings-defaults.ts`, and `admissionThresholdsForProvider(provider)` picks one:

| | Neural | TF-IDF | Reasoning (TF-IDF, from §1) |
|---|---|---|---|
| `nearDuplicate` | 0.90 | 0.80 | Only near-verbatim text; restatements top out ~0.63 |
| `reinforce` | 0.85 | 0.40 | Catches three of four restatements; well above different facts (≤0.10) |
| `related` | 0.70 | 0.20 | Above loose overlap and different facts; below same-topic (0.29) |

The date guard, footnote cap and every other rule are shared. The candidate's provider rides on `AdmitPreparedRequest.embeddingProvider` (the child already has the `EmbeddingResult`), so the parent decides on the scale the vector was made on; a request without it reads as neural. The decision trace records the thresholds actually used. The anchor probe uses the same picker, and on a lexical profile reports `lexicalProfile: true` with a `note`: both of its sides embed the same text there, so the anchored/anchor-free comparison measures nothing (its decisions still say what admission would do).

## 4. Recall floor

`DEFAULT_MIN_COSINE_TFIDF` stays 0.10. Recall queries are short distilled keyword strings (`buildRecallQuery`), and with anchors gone a relevant memory scores 0.22–0.26 offline against a weakly related 0.06. The V4test symptom is explained by §2: an anchored short memory's cosine to any query was scaled by its anchor-free share of the norm (as low as ~0.4). No blend change: R1's boost gate is already off for BUILTIN (`score.ts`). Re-check with `recall-replay` after the refit (§7) before touching the floor.

## 5. Consolidation threshold per provider

`MemoryConsolidationSettingsSchema` gains `tfidfClusterThreshold` (default 0.30); `clusterThreshold` (0.72) keeps its meaning for neural profiles. `resolveClusterThreshold(settings, provider)` picks one, keyed on the default embedding profile's provider, since the clustered vectors are that profile's. An explicit per-run `clusterThreshold` (the API's dry-run override) still wins on either provider. 0.30 sits below restatements (0.38+) and at same-topic-different-occasion (0.29) — the rows a digest is for — and the date-bucketing and size caps are unchanged. The consolidation card shows both thresholds ("Cluster threshold" and "Cluster threshold (Built-in)"); the report states the one the run used.

## 6. Refit only when the vocabulary needs it

Before: every manual create, edit or delete called `scheduleRefit`, which always ran `EMBEDDING_REFIT` → `EMBEDDING_REINDEX_ALL` → one `EMBEDDING_GENERATE` per memory, help doc and chunk, growing the vocabulary each time and opening a mixed-dimension window (bug 237). AUTO memories, the bulk, never triggered a refit at all.

A memory written between refits is embedded against the current vocabulary; its new words are simply out of vocabulary until the next fit. That is the normal TF-IDF trade, and it keeps the stored dimension stable.

`lib/embedding/builtin-refit-policy.ts` holds the policy. `evaluateRefitNeed` is pure:

- `unfitted` — no vocabulary row;
- `text-shape` — `textShapeVersion` below `LEXICAL_TEXT_SHAPE_VERSION` (§2);
- `drift` — memories created since `fittedAt` ≥ max(25, 10% of all memories);
- otherwise nothing.

`scheduleRefit(userId, profileId?, { force? })` keeps its debounce and now evaluates the need when the timer fires; without one it logs and enqueues nothing. Import passes `force: true` (imported rows keep their original `createdAt`, so the drift count would not see them). `checkBuiltinRefit()` runs the same evaluation for the default profile from boot and from the scheduled maintenance pass, so AUTO growth refits too. Both go through `enqueueRefitIfDue`, one check-then-enqueue serialised process-wide, so boot, the maintenance pass and a debounced edit firing together enqueue one refit. It enqueues nothing while a refit or full reindex is pending or running (`refitInHand`, queried by status with `backgroundJobs.findActiveByType`, so a pending job in backoff is never crowded out by newer finished ones) — a due reason stays due until that job lands — except that a forced import refit is held only by a pending one (a running one may have read the corpus before the import). It also enqueues nothing when there are no memories to fit. The counts are two queries (`memories.countCorpusSince`), and boot and the sweep find the instance's default profile with `embeddingProfiles.findInstanceDefault`. The policy and the refit read one corpus — every memory row — so a due refit always fits something and clears its reason; the refit used to enumerate the user's readable characters, which skips a character whose vault cannot be read and would have left the policy asking forever (review of PR 96). The profile routes' and the system tool's direct `enqueueEmbeddingRefit` calls are explicit requests and are untouched.

Help docs still re-embed on a refit: a new vocabulary changes the dimension, and a help vector of the old width cannot be compared. The saving is that refits are now rare.

## 7. Live checks owed on `V4test`

Run after the first boot on this build (the boot pass enqueues the `text-shape` refit; wait for the reindex to drain):

1. `node packages/quilltap/bin/quilltap.js anchor-probe 2a185c5b-9370-420a-a019-4b9c832b7a33 --instance V4test --json` — `anchoredBest` and `anchorFreeBest` should now agree; `anchoredAction` should be a fold for eb77d81e….
2. `node packages/quilltap/bin/quilltap.js recall-replay fd40d93a-5930-4a02-a9aa-f7a808362cff --instance V4test` — vector candidates for Lorian should be well above 1. If they are not, lower `DEFAULT_MIN_COSINE_TFIDF` in `lib/memory/scoring/relevance.ts`.
3. `POST /api/v1/memories?action=consolidate` with `{"characterId": "…", "dryRun": true}` — clusters at the default; tune `tfidfClusterThreshold` on the card if not.
4. Create, edit and delete a memory by hand; `logs/combined.log` should show `[EmbeddingScheduler] Refit not needed` and no `EMBEDDING_REINDEX_ALL`.
5. After a restart, no `Provider 'BUILTIN' not found in registry` in `combined.log`, and `help_search` returns vector hits.

## Non-goals

- Changing the plugin (sparse vectors, append-only vocabulary, field weights). An append-only vocabulary with zero-padded comparison would remove the mixed-dimension window altogether, but every cosine site checks equal lengths; it is a larger change than this one.
- A hybrid lexical score in recall. TF-IDF already is lexical; revisit only if §7.2 still under-delivers.
