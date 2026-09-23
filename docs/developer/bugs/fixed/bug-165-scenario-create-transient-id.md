# Bug 165 — creating a character scenario returns an id that is never stored

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-23)** |
| **Found** | 2026-09-23, live-verifying the Scenario Builder on V4test |
| **Fixed** | 2026-09-23, v4.10-dev |
| **Severity** | Low — nothing is lost, but any client that uses the returned id to address the new scenario (select it, edit it, delete it) is holding a dead reference |
| **Who it bites** | callers of `POST /api/v1/characters/[id]/scenarios` on a vault-backed character — every character since the vault cutover. In the app: the Scenario Builder's **Save as scenario…** to a character, which then tried to select the new scenario in the picker and could not |
| **Provenance** | Original to v4. The vault projection re-keys scenarios from their file path; `addToSubArray` predates it and still returns the id it minted |
| **Fix site** | `lib/database/repositories/characters.repository.ts` (`addScenario`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-23).** `addScenario` notes the scenario ids a read returns before the add,
performs the add, re-reads the character, and returns the entry that is new (the one with the
same title, else the only new one). A character whose read-back keeps the minted id (no vault
re-keying) still gets that id; if nothing new is visible, the minted item is returned as before.

## Symptom

In the Salon sidebar, the Scenario Builder saved a scene to a character's own scenarios. The
save succeeded and the new scenario appeared in the picker's list, but the picker stayed on
**Custom...** instead of selecting it: the list carried the path-derived id
`30c167b3-ce60-8742-…`, and the create response a freshly minted one that matched nothing.

## Root cause

`CharactersRepository.addScenario` → `addToSubArray` mints an id with `generateId()`, pushes the
item into `character.scenarios`, writes it through `update()`, and returns the minted item. For a
vault-backed character the write lands as `Scenarios/<title>.md`, and every later read projects
the folder back into the array with ids derived from the file path. The minted id is never
persisted anywhere. The route (`app/api/v1/characters/[id]/scenarios/route.ts:89`) returned it
as `{ scenario }`.

## Why it survived

Nothing in the app used the returned id: the character editor refetches the whole list after a
create. CLAUDE.md already records the same transience for system prompts (`addSystemPrompt`
leaves the default column null for that reason), but scenarios had no consumer that noticed.

## Fix

`addScenario` returns the projected entry. `addToSubArray` itself is unchanged, so system
prompts keep their documented behaviour.

## Verify

- `__tests__/unit/lib/database/repositories/character-add-scenario-projected-id.test.ts` —
  the projected id wins over the minted one; title match among several new ids; a
  non-re-keying read keeps the minted id; a failed add returns null.
- Live (V4test, 2026-09-23): Scenario Builder in-chat → Save as scenario… → *Lorian's
  scenarios* → the sidebar picker selects the new scenario.
