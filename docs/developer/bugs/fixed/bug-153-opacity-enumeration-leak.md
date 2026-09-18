# Bug 153 — the vault covenant is enforced when a store is opened and not when it is listed

**FIXED in v4 (2026-09-17)** — `getAccessibleMountPoints` now takes the same
`hideCharacterVaults` notion the resolution context has, and all four callers
derive it from `actingCharacterIsOpaqueToVaults` — the one helper the
resolution-context builders already use. Enumeration and resolution read the
same flag through the same collector, so they cannot disagree.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-17, spun off from the [bug 152](bug-152-opacity-hides-group-stores.md) fix rather than reported live |
| **Fixed** | 2026-09-17 |
| **Severity** | **Medium** — no data loss and no write reaches a hidden vault, but the covenant's whole purpose is that a vault is *not visible*, and `doc_list_files` recited vault names to an opaque character. The follow-up open then refused them, which reads to a model as a broken tool rather than a boundary |
| **Who it bites** | any character with `systemTransparency !== true` (**the default**) calling `doc_list_files`, `doc_grep`, or a blob tool. Peers' vaults appear as well when the chat has `allowCrossCharacterVaultReads` on |
| **Provenance** | Original to v4, and older than bug 152: the covenant has always been implemented in the two resolution-context builders, which the enumeration path does not go through |
| **Fix site** | `lib/doc-edit/path-resolver.ts` (`getAccessibleMountPoints`), `lib/tools/handlers/doc-edit/text-handlers.ts`, `lib/tools/handlers/doc-edit/blob-handlers.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

An opaque character calls `doc_list_files` with no `mount_point`. The listing
includes her own vault and — where cross-character reads are enabled — every
present peer's, with real file paths under each. She then calls `doc_read_file`
against one of those paths and is refused `NOT_FOUND`.

Two things are wrong at once. The listing **leaks the vault names the covenant
exists to hide**, which is the security half. And the pair of answers is
self-contradictory: a tool that offers a path and then denies it looks broken,
so a model retries, re-lists, and re-reads rather than accepting a boundary —
the same loop bug 152 burned eight minutes on, arrived at from the other side.

## Root cause

The covenant lives in the two resolution-context builders
(`buildReadResolutionContext` / `buildWriteResolutionContext`,
`lib/tools/handlers/doc-edit/shared.ts`), which set `hideCharacterVaults` for an
opaque character. `collectAccessibleMountPointIds` honours it by flattening the
tiered pool with `includeCharacterTier: false, includeParticipants: false`.

`getAccessibleMountPoints` shares that collector but took no flag to pass it:

```ts
export async function getAccessibleMountPoints(
  projectId: string | undefined,
  characterId?: string,
  extraCharacterIds?: string[],
): Promise<AccessibleMountPoint[]>
```

Its four callers never built a resolution context at all — they hand the
character straight in, because enumeration has no path to resolve:

- `text-handlers.ts:795` — `doc_grep`
- `text-handlers.ts:991` — `doc_list_files`
- `blob-handlers.ts:59` — `resolveBlobMountPointForRead`
- `blob-handlers.ts:80` — `resolveBlobMountPointForWrite`

So the enumeration side saw an unrestricted pool while the resolution side saw
a subtracted one, and nothing in either made the omission visible.

## Why it survived

- **The two sides look unrelated.** A reader auditing the covenant finds it in
  the context builders, honoured by the resolver, and with a regression suite
  over it. The enumeration helper is in the same file as the resolver but does
  not go through a `PathResolutionContext`, so it is not where anyone looks.
- **The failure is a disclosure, not an error.** Nothing throws, nothing is
  written where it should not be, no log line fires. A listing that is one row
  too long is invisible unless you know what should have been subtracted.
- **Bug 152 masked half of it.** Before that fix, the opaque *resolution* path
  had no `characterId`, so the two sides disagreed in the safe direction on the
  group tier and in the leaky direction on the vault tier at the same time. The
  vault half only reads as a clean defect once the group half is settled.

## The fix

**Landed as described.**

- `getAccessibleMountPoints` takes a single `AccessibleMountPointsQuery`
  (`projectId`, `characterId`, `extraCharacterIds`, `hideCharacterVaults`)
  rather than three positionals, and passes the flag through to
  `collectAccessibleMountPointIds` — the same collector `resolveDocumentStorePath`
  uses, so what the listing offers is exactly what an open accepts.
- All four callers set it from `await actingCharacterIsOpaqueToVaults(context)`,
  the helper the resolution builders already use. One source of the predicate,
  so the two sides cannot drift apart again.
- The group, project and global tiers are untouched for an opaque character —
  bug 152's fix, not regressed. `characterId` still goes in; only the two vault
  tiers come out.
- `mount_point: "self"` stays unresolvable. `resolveMountPointRef` still
  translates the token to her own vault id, but that id is no longer in the
  enumerated set, so the filter matches nothing and the listing is empty — a
  refusal that discloses nothing, matching how the resolver handles it.

Regression test
`lib/doc-edit/__tests__/path-resolver-opacity-enumeration.test.ts` (15 cases),
the sibling of bug 152's and built the same way: the **real** tiered-mount-pool
with the repositories, instance-settings and database-store reader mocked,
because the defect is in the composition. It drives the real handlers, not just
the helper — `doc_list_files`, `doc_grep`, and the three blob entry points —
and includes an explicit agreement case asserting that every store the listing
returns also resolves. **7 of 15 are red against the unfixed call sites**; the
transparent-character controls are green against both, pinning the change as a
subtraction rather than a loosening.

## How to verify

1. A character with `systemTransparency = 0` in a chat with
   `allowCrossCharacterVaultReads = 1` calls `doc_list_files` with no
   `mount_point`. Before: her vault and her peers' appear in the listing, with
   file paths. After: neither appears, and group, project and general files are
   unchanged.
2. The same character calls `doc_grep` with no `mount_point`. No match is
   attributed to any vault.
3. The same character calls `doc_list_files` or `doc_grep` with
   `mount_point: "self"`, and `doc_read_blob` / `doc_list_blobs` against her own
   vault by name. All refuse, without disclosing that the store exists.
4. A character with `systemTransparency = 1` still sees her own vault and, with
   cross-character reads on, her peers'.
