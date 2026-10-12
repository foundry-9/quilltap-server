# Bug 224 — The inter-character section repeats the archive's digests

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase E) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix C) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — in a multi-character chat the model sees the same digests twice in one turn, which spends memory budget on repeats and over-weights them |
| **Who it bites** | every multi-character chat where the responding character holds hot digests about another character present |
| **Provenance** | Original to v4. Came in with consolidation and hot/cold tiers, which put digests at the head of both sections |
| **Defect site** | `lib/chat/context-manager.ts:1756-1858` (inter-character block; digest fetch `:1784-1789`); `lib/memory/frozen-archive-cache.ts:157-178` (`computeFrozenArchive`) |
| **Fix site** | `lib/chat/context-manager.ts` (inter-character block) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Targeted fix ahead of Phase E. `buildContext` records the ids the frozen archive and the dynamic head actually rendered this turn (`memoryIdsInWhisper`, from their `debugMemories`), and the inter-character section filters both its importance half (hot digests + partition query) and its relevance half against that set, with a debug log of how many were skipped. A row now reaches the model in at most one of archive / head / inter-character. Rows the archive held but its token budget cut are still eligible for the inter-character section. The section does not backfill to replace a skipped digest — per-character limits stay as they were (decision 14). The recap and the single-pool inter-character relevance search (decision 12) are left to Phase E. Test: `__tests__/unit/context-management.test.ts` — a digest eligible for both the archive and the inter-character section appears once, and the section still carries the non-archive row.

## Symptom

With A responding and B present, A's two highest-ranked hot digests about B appear in the
`## Memory Anchors` archive and again under "You also recall about the others present:".

## Root cause

`computeFrozenArchive` (`frozen-archive-cache.ts:157`) takes
`findHotDigests(characterId, otherId, FROZEN_ARCHIVE_DIGESTS_PER_PRESENT = 3)` for each present
character (`:175-177`). The inter-character block in `context-manager.ts` takes
`findHotDigests(character.id, otherId, INTER_CHAR_DIGEST_LIMIT = 2)` (`:1784-1789`, constant at
`:251`). Same query, same `ORDER BY reinforcedImportance DESC, …` (`memories.repository.ts:848`),
so the inter-character top 2 is a subset of the archive's top 3.

The head is deduped against the archive (`archiveIds`, `context-manager.ts:1406`, `:1418`,
`:1550`). The inter-character block dedups only within itself (`interSeen`, `:1795-1800`); it never
consults `archiveIds` or the head. Its partition query (`findByCharacterAboutCharacters`) and its
per-character relevance searches can also return rows the archive's fill or the head already
carry.

Minor difference noted while verifying: the archive's present set is
`participantCharacters.keys()` (`:1404`), while the inter-character block uses `CHARACTER`
participants only (`:1764-1771`). The overlap holds wherever both include B.

## Why it survived

Each section was specified and tested on its own. Digests were added to both by the same feature,
each for a sound local reason, and no test renders the two sections together.

## Fix

Spec §3.8 and locked decision 12: `assemble` dedups across pools, so a row appears in at most one
of archive / head / inter-character / recap. The inter-character relevance half becomes a filter of
the turn's one gathered pool by `aboutCharacterId`.

## Verify

Phase E acceptance: on a multi-character chat, the inter-character section never repeats an archive
row. Test: `assemble` cross-pool dedup with a digest eligible for both pools.
