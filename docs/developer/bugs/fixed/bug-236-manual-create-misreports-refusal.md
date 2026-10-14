# Bug 236 — Manual memory create blames the embedding profile for every refusal

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, live on `V4test` while dogfooding the memory refactor |
| **Fixed** | 2026-10-13 |
| **Severity** | Low — a misleading 500 sends the operator to check a healthy embedding profile |
| **Who it bites** | anyone (or any client) posting a blank memory to `POST /api/v1/memories` |
| **Provenance** | Phase C (`8af764514`): `admitCandidate` returns `memory: null` for a `reject` with reason `empty` or `embedding-failed`, and the route only handled the second |
| **Defect site** | `app/api/v1/memories/route.ts` (`handleCreateMemory`: any null `outcome.memory` → `serverError('Failed to generate embedding…')`); `createMemorySchema` / `updateMemorySchema` accepted whitespace-only `content` and `summary` |
| **Fix site** | `app/api/v1/memories/route.ts`, `app/api/v1/memories/[id]/route.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** `content` and `summary` are trimmed and must be non-empty in both the
create and edit schemas, so blank text is a 400 before admission runs. When admission still writes
nothing, the route answers by the reject reason: `empty` → 400, `embedding-failed` → 502 (as the
edit route already did), anything else → 500 without blaming the profile. Test:
`__tests__/unit/api/memories-manual-create.test.ts`.

## Symptom

`POST /api/v1/memories` with `"content": "   "` returned
`500 {"error":"Failed to generate embedding for memory — no row was created. Check the configured embedding profile."}`.
The log said `Memory not admitted: empty text`; no embedding was ever attempted.

## Root cause

The request schema used `z.string().min(1)`, which whitespace passes. Admission refused the blank
text (`reject`, reason `empty`), and the route mapped every null `outcome.memory` to the embedding
message.

## Why it survived

The only refusal test covered `embedding-failed`.

## Fix

Trim and validate at the schema; map the outcome by `action.reason`.

## Verify

Post a blank memory: 400, admission never called. Simulate an embedding failure: 502.
