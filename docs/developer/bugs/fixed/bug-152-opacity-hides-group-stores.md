# Bug 152 — the vault covenant hides a character's own group stores, and the error tells them it is a typo

**FIXED in v4 (2026-09-17)** — opacity now says *what* to hide instead of
achieving it by withholding the identity everything else is derived from. The
acting character stays in the resolution context and a `hideCharacterVaults`
flag subtracts the two vault tiers, so group, project and global stores resolve
as they always should have. The covenant is unchanged: her own vault, her peers'
vaults and the reserved `self` token all stay closed. Separately, a store that
exists but is out of scope is now refused as `ACCESS_DENIED` saying so, since
the old `NOT_FOUND` read to a model as a misspelling and was what turned a wall
into eight minutes of guesswork.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-17, reported live from the `Friday` instance — *"why in the world is Leilani having so much trouble writing this file?"*, chat `00bb0f9c-cec6-4386-9b2d-71f81702dd1a` |
| **Fixed** | 2026-09-17 |
| **Severity** | **Medium-High** — no data loss, but an opaque character cannot read or write **any group store**, and because the refusal is a `NOT_FOUND` phrased as an addressing failure, the model spends its entire agent-mode budget guessing mount names instead of reporting the wall. Eight minutes and ~10 tool calls on the reported turn |
| **Who it bites** | any character with `systemTransparency !== true` (**the default**) in a chat whose work lives in a **group** document store — the group's official store or any store linked to a group it belongs to. Project-linked stores and Quilltap General are unaffected, which is what makes it look intermittent |
| **Provenance** | Original to v4. Latent since the tiered mount pool gave group stores their own tier: the opacity gate predates the group tier and hides vaults by a means that silently takes groups with it |
| **Fix site** | `lib/tools/handlers/doc-edit/shared.ts` (`buildReadResolutionContext` / `buildWriteResolutionContext`), `lib/doc-edit/path-resolver.ts`, `lib/mount-index/tiered-mount-pool.ts` (`flattenTierPool`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

Leilani was asked to record a piece of history into **"Group Files: Severed"**,
the official store of the `Severed` group she belongs to. She named it
correctly on her first call and every attempt failed, so she began guessing at
the address — the raw name, the store's UUID, a truncated `qtap://` URI, the
bare word `Group`, the reserved token `self` — across three different write
tools, for eight minutes, while the operator watched a message that would not
finish streaming.

```
02:44:00  doc_write_file     Group Files: Severed        characters: none
02:44:49  doc_write_file     Group Files: Severed        characters: none
02:45:27  doc_write_file     eeef911d-ee01-4f20-…        characters: none
02:46:02  doc_write_file     Group Files: Severed        characters: none
02:46:44  doc_write_file     Group Files: Severed        characters: none
02:47:35  doc_write_file     self                        characters: none
02:48:12  doc_insert_text    Group Files: Severed        characters: none
02:48:58  doc_update_heading Group Files: Severed        characters: none
```

Every one paired with:

```
[stderr] {"level":"warn","message":"Path resolution error in doc-edit tool",
          "toolName":"doc_write_file","code":"NOT_FOUND",
          "message":"Mount point not found or not accessible in this context"}
```

The store is real, enabled, and was written successfully by the **operator**
through Document Mode three minutes earlier (`LibrarianNotification … kindLabel:
"saved"` at 02:41:20). Only the character could not reach it.

## Root cause

Two correct-looking pieces compose into a wall.

**1. The group tier is keyed solely on `characterId`.** In
`resolveTieredMountPool` (`lib/mount-index/tiered-mount-pool.ts:282`):

```ts
const groupMountPointIds: string[] = ctx.characterId
  ? await resolveGroupMountPointIdsForCharacter(ctx.characterId)
  : [];
```

`characterId` is the *only* input from which group membership can be derived —
`characterIds` feeds the participant tier and nothing else.

**2. The opacity gate hides vaults by deleting `characterId`.** A character with
`systemTransparency !== true` accepts the covenant of trust, under which every
character vault is hidden from `doc_*` tools. Both resolution-context builders
implement that by returning a context with the character removed
(`lib/tools/handlers/doc-edit/shared.ts:370` and `:401`):

```ts
const opaque = await actingCharacterIsOpaqueToVaults(context);
if (opaque) {
  // No characterId / characterIds → resolver admits only project document
  // stores. Mount-point name lookups for character vaults won't resolve.
  return { projectId: context.projectId, mountPoint: input.mount_point, operatorOverride: context.operatorOverride };
}
```

The comment states the intent and understates the effect. Dropping
`characterId` does hide the character's vault — and, because the group tier has
no other key, it also erases **every group store the character belongs to**.
`actingCharacterIsOpaqueToVaults`'s own doc comment says *"Project-linked
document stores remain accessible regardless"*, which is true and is the whole
list: group stores were never considered, because when the covenant was written
they were not yet a tier of their own.

Leilani's row is the trigger: `systemTransparency = 0`. Abigail, in the same
chat, is `1`. `eeef911d-ee01-4f20-968d-eebe663653b2` is the
`officialMountPointId` of group `6fb9d8fd-90de-4f5c-84b0-7de050e5bd68`
(`Severed`) and is **not** project-linked, so the project tier cannot stand in
for it. With `characters: none` the accessible set is project stores plus
Quilltap General, and the group store is not in it — by name or by UUID, since
both lookups iterate only the accessible set.

The `self` attempt at 02:47:35 failed for the same single reason and confirms
it: `resolveDocumentStorePath`'s reserved-token branch is guarded by
`if (context.characterId && …)`, so with the character stripped the token never
resolves and falls through to a plain name lookup.

## Why it survived

- **The refusal is indistinguishable from a typo.** `NOT_FOUND` / *"Mount point
  not found or not accessible in this context"* conflates "no such store" with
  "exists, but out of scope here". A model reads the first meaning and does the
  rational thing — tries another spelling. Nothing in the message says the wall
  is structural, so nothing stops the loop; agent mode (`maxTurns: 25`) simply
  spends itself.
- **Opacity is the default**, so the broken configuration is the common one,
  while the visible symptom needs the *other* uncommon ingredient — work that
  lives in a group store rather than a project store. Most chats never combine
  them.
- **The gate is write-and-read symmetric and looks deliberate.** Both builders
  carry the same early return with a comment asserting the blast radius, so a
  reader checking whether opacity is honoured finds it plainly honoured.
- **`photo-handlers.ts:184` gets the same covenant right** by filtering peers
  (`if (peer.systemTransparency !== true) continue`) rather than discarding the
  acting character, so the one nearby precedent looks consistent while using a
  different and correct means.

## The fix

**Landed as described.**

Opacity must say *what* to hide, not achieve it by withholding the identity
everything else is derived from.

- `PathResolutionContext` gains `hideCharacterVaults`. The opaque branch of both
  builders now keeps `characterId` and sets the flag, instead of returning a
  context with no character in it.
- `collectAccessibleMountPointIds` honours the flag by dropping the **character
  and participant tiers** from the flattened pool while the group, project and
  global tiers resolve normally — so group membership is still derived from the
  same `characterId` it always was.
- `flattenTierPool` gains `includeCharacterTier` (default `true`), the natural
  sibling of the existing `includeParticipants`, so "everything but the vaults"
  is expressible in the pool helper rather than re-derived at the call site.
- The reserved `self` token stays refused for an opaque character — now
  explicitly (`!context.hideCharacterVaults`) rather than as a side effect of a
  missing `characterId`.
- `resolveDocumentStorePath` distinguishes the two meanings it had collapsed: a
  store that exists but is outside the caller's scope is refused as
  `ACCESS_DENIED` naming that fact, so a model is told the wall is structural
  and stops guessing. **Character vaults are excluded from that disclosure** —
  admitting a vault exists would leak through the refusal exactly what the
  covenant withholds, the same reason `assertCharacterMayRead` mirrors the
  "missing file" shape. A vault keeps the indistinguishable `NOT_FOUND`.

Regression test `lib/doc-edit/__tests__/path-resolver-opacity-group-stores.test.ts`
(13 cases) runs against the **real** tiered-mount-pool, mocking only the
repositories and the instance-settings singleton, because the defect lived in
the composition of the gate and the pool rather than in either alone. Four
cases are red against the unfixed builders — the group store by name (the
reported failure), by id, on the read path, and the context shape itself — while
the covenant and control cases pass against both, which is what pins the fix as
a subtraction rather than a loosening. Full suite green: 832 suites / 12,682
tests.

## How to verify

1. A character with `systemTransparency = 0`, a member of a group whose official
   store is **not** linked to the active project, calls
   `doc_write_file(scope="document_store", mount_point="<group store name>", …)`.
   Before: `NOT_FOUND`. After: the write lands.
2. The same character calls `doc_read_file` against **a peer's vault by name**
   and against `self`. Both still refuse — the covenant is unchanged.
3. A character with `systemTransparency = 1` is unaffected in both directions.
4. Asking for a store that genuinely does not exist still answers `NOT_FOUND`;
   asking for one that exists but is out of scope now answers `ACCESS_DENIED`
   and says so.
