# Refactor 4.13 — An item-store kernel for the Wardrobe, the Inventory and the Atlas

**Status:** Done (2026-11-11). Proposed 2026-11-10, written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #186 and settles four points the three families disagree on. See [§9 Outcome](#9-outcome) for what landed and where it departs from the plan.

Line numbers are from the audit and will drift. Re-locate each site by name before editing.

## 1. The problem

CLAUDE.md describes the Inventory as "the wardrobe's shape, with its own doors" and the Atlas as "the Inventory's shape without archetypes, kits or equip". The 4.12 [browser-family spec](refactor-4-12-browser-family.md) shared the route preamble and the client browsers. The server-side storage layer was not shared, and the Atlas (new in the 4.13 cycle) was built by copying the Inventory's.

Measured with names normalised and comments stripped:

| File | Atlas | Inventory | Wardrobe | Differing lines |
|---|---|---|---|---|
| `folders.ts` | 97 | 95 | 103 | 4 (A/I), 20 (W) |
| `vault-writes.ts` | 251 | 269 | n/a | about 34 per side |
| `item-image-generation.ts` | 135 | 141 | n/a | 14 per side |
| `item-images.ts` | 176 | 198 | n/a | about 27 per side |
| `request.ts` | 47 | 47 | n/a | 4 per side |
| `[id]/images/route.ts` | 49 | 49 | 118 | about 10 per side |
| `location.ts` write wrapper | same shape in all three | | | |

The real differences in `vault-writes.ts` are the serialiser (Markdown with frontmatter vs JSON), the Inventory's `withInventoryWritesLinted`, the `remove` keys, and `followOn` on delete. `applyPatches`, `updateManyUnserialized`, the per-mount delete, the WeakMap tree-scan trick and the five folder wrappers are verbatim.

Where the copies disagree, the disagreement is not a feature:

| Question | Answers today |
|---|---|
| Does a pool remember which tiers it failed to read? | Inventory: yes (`unreadMounts`, `consultedMounts`). Atlas: no, a failed tier is swallowed. Wardrobe: check. |
| Does anyone act on an unread tier? | Only `lib/inventory/title-lint.ts:202`. `lib/inventory/equip.ts` does not, which is #186: one failed read and the next equip drops every carried id from that tier. |
| Within a tier, which mount wins? | Atlas reads strongest-first, first wins (`readMounts` + `shadowAtlasLayers`). Inventory reads reversed, last wins (`readTier` + `shadow`). Same result, two spellings; the tier-walk spec settled "earlier mount wins" and asked for one. |
| How is a name folded for comparison? | `trim().toLocaleLowerCase()` (`lib/atlas/pool.ts:45`), `trim().toLowerCase()` (`lib/atlas/match.ts:51`), `toLocaleLowerCase()` with no trim (`lib/atlas/transfers.ts:74-75`, the vault scan). Under a Turkish locale the uniqueness rule and the matcher can disagree. |
| Where do shared helpers live? | `lib/atlas` imports `archivedPatch` and `nextCopyTitle` from `lib/wardrobe`. |

## 2. Goal

One kernel, `lib/mount-index/item-store.ts`, that each family binds with its serialiser and rules. The per-family files CLAUDE.md names as chokepoints (`location.ts`, `vault-writes.ts`, `item-mutations.ts`, `pool.ts`) stay, as thin bindings, so the grep-tests and the documentation keep pointing at real files.

## 3. Non-goals

Rejected or settled by the 4.12 set; do not reopen:

- The pools' shadowing keys (id for Wardrobe and Inventory, canonical name for the Atlas), `transfers.ts`, and `item-mutations.ts` bodies. They really differ.
- `ItemRowShell` and a shared transfer service.
- The client browsers.
- Wardrobe slot math, outfit history, the Inventory's equip planner (beyond the #186 fix), archetypes and kits.

## 4. Known state

Verified by reading (2026-11-10): `readEquippedSet` (`lib/inventory/equipped-set.ts:39-58`) drops ids the pool cannot resolve; `equip.ts:326`, `:444`, `:512` rewrite the whole set from it; `unreadMounts` has one reader. The line counts and the name-fold sites are the audit's measurements; re-measure before starting and correct this table.

## 5. Design

### 5.1 `createItemFolderStore`

```ts
createItemFolderStore<T>({
  kind,                 // 'wardrobe' | 'inventory' | 'atlas' — folder name, log context
  ext, serialize, parse, scan,
  wrapWrite?,           // Inventory passes its title lint
  onDelete?,            // followOn
})
```

returns `create`, `updateMany`, `delete`, the folder operations (over `lib/mount-index/item-folders.ts`, as today), and the location write wrapper (`writableMount` / `write(fn, landed)` / `cleanPatch`). `defineItemFolderErrors(kind)` replaces the three copies of four error subclasses.

### 5.2 `readTiers`

One function reads the four tiers for a reach and returns `{ layers, unread, consulted }` in tier order, strongest mount first within a tier. All three pools build from it. Every pool therefore knows what it failed to read.

A rule to state in CLAUDE.md once this lands: **a whole-set rewrite never treats "unread" as "gone".** `equip.ts` keeps unresolved raw ids from an unread tier in the rewrite (#186). Check the Wardrobe's `commitEquippedOutfit` path for the same shape and fix it the same way if it has it.

### 5.3 One name fold

`foldItemName(s)` = `s.trim().toLowerCase()` after NFC normalisation, in the kernel. The Atlas's three sites and any Inventory title comparison use it. Locale-sensitive folding is not used for identity.

While there: `assertNameFree` (`lib/atlas/item-mutations.ts:72-83`) reads outside `runSerialized`, so two concurrent creates of one name both pass. Move the check inside the serialised section.

### 5.4 Item images

`createItemImages(kind)` and `createItemImagesRoute(kind)` replace the Atlas / Inventory pairs of `item-images.ts`, `item-image-generation.ts`, `request.ts` and `[id]/images/route.ts`. The 4.12 spec proposed the route factory for two kinds; there are now three. The Wardrobe's 118-line images route joins if its extra 70 lines turn out to be the same preamble; if they are wardrobe-specific behaviour, leave it and say why.

### 5.5 Shared helpers move down

`archivedPatch` and `nextCopyTitle` move from `lib/wardrobe` to the kernel; all three families import from there.

## 6. Phases

1. **#186 first, in place**: failing test with a pool whose group tier is unread; fix in `equip.ts`. This is a data-loss bug and should not wait for the kernel.
2. **`readTiers`**; the three pools on it; the Atlas pool gains `unread`.
3. **`foldItemName`**; `assertNameFree` inside the lock.
4. **`createItemFolderStore`**; Atlas and Inventory `vault-writes.ts` and `folders.ts` bound to it; then the Wardrobe's `folders.ts`.
5. **Item images** kernel and route factory.
6. Helpers moved; CLAUDE.md's Wardrobe / Inventory / Atlas paragraphs updated to name the kernel and the unread rule.

Behaviour is identical after each of phases 2 and 4–6; the existing family tests are the proof.

## 7. Tests and gates

- The chokepoint grep-tests (`__tests__/unit/lib/atlas/chokepoints.test.ts` and the Wardrobe and Inventory equivalents) keep passing unmodified where possible; where a rule moves into the kernel, the test follows it.
- A new kernel test file exercises the store with a toy serialiser.
- Expected size: 550–750 lines removed; medium risk.
- CHANGELOG cites `#186`. No help-doc change: nothing user-visible moves.

## 8. Decisions for the human

1. On an unread tier during equip: keep the unresolved ids and proceed (proposed), or refuse the change with a message?
2. Should the Atlas's failed-tier read be surfaced anywhere the operator can see, or stay a log line?

## 9. Outcome

Landed in six commits, one per phase; the full unit suite was green after each.

**Decisions taken** (§8): on an unread tier, equip keeps the unresolved ids and proceeds (the proposal). The Atlas's failed-tier read stays a `warn` log line; the pool now carries `unread`, so surfacing it later is a read of a field that exists.

**Where the code is.**

| Piece | File |
|---|---|
| Tier reads, shadowing, `UnreadMount` | `lib/mount-index/item-tiers.ts` (kept apart from the writer so a pool does not load it) |
| `foldItemName`, `nextCopyTitle`, `archivedPatch` | `lib/mount-index/item-rules.ts` (client-safe) |
| `createItemFolderStore`, `locationWriter`, `cleanPatch` | `lib/mount-index/item-store.ts` (re-exports the two above) |
| `defineItemFolderErrors`, `defineItemFolderFamily` | `lib/mount-index/item-folders.ts` (client-safe, beside the rules they bind) |
| `createItemImages` | `lib/mount-index/item-family-images.ts` |
| `createItemRequest` (the client `request.ts` pair) | `lib/mount-index/item-request.ts` |

**Corrections to §4 and §5.**

- The Wardrobe answered "does a pool remember which tiers it failed to read?" with *no*: `WardrobeRepository.readSharedTiers` swallowed a failed store and the pool swallowed a failed character read. The wearable pool now reads one mount at a time (`readSharedTiers(…, { strict: true })`) and carries `unread`.
- The Wardrobe's `commitEquippedOutfit` path does not have #186's shape: `applyDisplacement` edits the stored slots it reads, never a pool-filtered copy, so an unread tier cannot drop a garment.
- §5.4's route factory already existed (4.12's `createItemImagesRoute`); the Atlas and Inventory route files were already adapters and stay so, calling the families' named exports (their tests mock those). The Wardrobe's 118-line route stays as it is: its extra lines are its own `link-image` action and error mapping, already on the shared factory, not preamble.
- `assertNameFree` became a write `guard` that the location's `create` / `update` run inside the folder's write chain, against the records that write is about to rewrite.
- The Wardrobe's `vault-writes.ts` and `location.ts` were not bound to the store (§6 named only its `folders.ts`): its writer is the repository's overlay path, with composite and history concerns the other two lack.

**Size.** `lib/` and `app/` came out about 90 lines smaller net (1,684 added, 1,777 removed), not the 550–750 §7 expected. The verbatim copies are gone, but the kernel states each rule once with its documentation, and the per-family bindings keep every exported name so no caller changed.
