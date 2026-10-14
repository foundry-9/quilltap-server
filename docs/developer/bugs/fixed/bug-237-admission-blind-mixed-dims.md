# Bug 237 — Admission is blind to rows whose vectors it cannot compare

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, live on `V4test` while dogfooding the memory refactor |
| **Fixed** | 2026-10-13 |
| **Severity** | Medium — during a re-embed (a TF-IDF refit, or switching the embedding profile on a large corpus) every candidate inserts, so duplicates accumulate for as long as the re-embed runs |
| **Who it bites** | built-in TF-IDF instances after any hand edit (refit + reindex); any instance while a profile switch re-embeds the corpus; any stale cache |
| **Provenance** | Phase B (`af48f6cc2`) let the index hold mixed vector lengths and score only entries matching the query; recall got a text fallback, admission did not |
| **Defect site** | `lib/memory/admission/neighbours.ts` (`gatherNeighbours` searched only comparable entries) |
| **Fix site** | `lib/memory/admission/neighbours.ts` (`unscorableRowCount`, `unindexedNeighbourHits`, `NeighbourProbe`); `lib/memory/admission/admit.ts` (passes the candidate's text) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** Before searching, admission asks the index how many of the
character's rows match the candidate's vector length. If some do not, it drops the cache once (the
rows may already be right — a stale cache, as in bug 235) and asks again. If rows still differ, it
searches those rows by the longest words of the candidate's summary and content, takes the
`ADMISSION_TOP_K` with the most words in common, embeds each one's stored text
(`embeddingTextFor`) with the candidate's profile, and scores them by cosine beside the indexed
hits. An embedding failure costs that row alone; rows the dry run would retire are never
re-embedded. Nothing is written — the re-embed job still owns the rows. Test:
`lib/memory/__tests__/admission-neighbours.test.ts` ("rows the index cannot compare").

## Symptom

A hand-written memory with text identical to an existing one came back `action: "insert"` with no
links. The log: `Query vector dimension mismatch … storedDimensions: 100703, queryDimensions:
102602`, then `Gathered admission neighbours … neighbours: 0`.

## Root cause

`CharacterVectorStore.search` scores only entries whose length equals the query's. When none (or
few) do, `gatherNeighbours` returns no neighbours and `decideAdmission` inserts. Recall had a text
fallback for this; admission had none.

## Why it survived

Fixed-dimension providers only mix lengths during a profile switch, which is rare in testing; the
TF-IDF refit window is seconds long unless a cache goes stale (bug 235).

## Fix

As above.

## Verify

With an index whose stored vectors are another length, admit a candidate whose words match a row:
that row is re-embedded and decides the outcome (`absorb` for an identical text).
