# Bug 222 — Carina memory extraction drops the chat's project and context summary

| | |
|---|---|
| **Status** | Open — closed by Phase D of the [memory system refactor](../features/memory-system-refactor.md) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix A) |
| **Fixed** | — |
| **Severity** | Low — a Carina-formed memory in a project chat has `projectId: null`, so a `scope: narrow` memory escapes project scoping and recalls at full strength in other projects; the extractor also judges scope without the project description |
| **Who it bites** | answerers of `@Name:` / `@Name?` / `ask_carina` queries in chats that belong to a project |
| **Provenance** | Original to v4. Came in with Carina memory extraction (`CARINA_MEMORY_EXTRACTION`) |
| **Defect site** | `lib/background-jobs/handlers/carina-memory-extraction.ts:127-144` (the `processTurnForMemory` call) |
| **Fix site** | Phase D of the refactor — `extraction/` (`buildExtractionContext` supplies the project to every pass) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

In a project chat, a memory formed from a Carina answer is stored with `projectId: null`. The
same memory formed from an ordinary turn would carry the project id.

## Root cause

The per-turn handler passes three project/context fields to `processTurnForMemory`
(`lib/background-jobs/handlers/memory-extraction.ts:133-176`): `projectId: chat.projectId`,
`projectDescription` (looked up from the project), and `chatContextSummary: chat.contextSummary`.
The Carina handler's call (`carina-memory-extraction.ts:127-144`) passes none of them. The
processor writes `projectId: opts.ctx.projectId ?? null` (`lib/memory/memory-processor.ts:302`)
and hands `projectDescription` / `chatContextSummary` to the prompts (`:427-428`).

At recall, `scopeProjectMultiplier` (`lib/memory/recall-tags.ts:368-388`) returns 1 when the
memory has no `projectId` (`:375`). A narrow memory with a null project therefore gets neither the
same-project boost (1.15) nor the cross-project down-weight (0.15) or exclusion.

## Why it survived

Carina extraction was built by copying the per-turn handler's call and trimming it to a synthetic
one-slice transcript; the project fields went with the trim. Carina answers in project chats are
uncommon, and a null `projectId` reads as a legacy row.

## Fix

Spec §3.7: every unit of work builds one `ExtractionContext`, which carries
`project: { id, description }` and the chat summary; the Carina handler calls
`buildExtractionContext` like the others and the project rides on every candidate's provenance.

## Verify

In a project chat, ask a character a question with `@Name?`, let the Carina extraction job run,
and check the new memory's `projectId` equals the chat's. Test: Carina memories carry `projectId`.
