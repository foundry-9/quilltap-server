# Wardrobe lists: titles that wrap, and a chip that says where a shared garment came from

**Status:** design of record; shipped in 4.10-dev. Part 1 of a three-part wardrobe programme —
this one first, because it is small and the other two build on the row it reshapes:
[wardrobe-wear-ledger.md](wardrobe-wear-ledger.md) (part 2) and
[wardrobe-item-images.md](wardrobe-item-images.md) (part 3).

**As built — where the implementation departs from the text below:**

- **Collision precedence (§4.1, §8, §10).** The flat `findArchetypesInMounts` lets a *later*
  mount shadow an earlier one (`Map.set` in order), not the first. The text's "first group
  wins … the same order the flat read produces" contradicts itself; the binding requirement is
  that the winner is the same item either way, so `findArchetypesInMountsAttributed` iterates the
  same flattened order with the same last-write-wins rule, and its test asserts parity with the
  flat read rather than a fixed winner.
- **`hover:qt-bg-muted` (§6.3).** Already has its escaped hand-written form in
  `_utilities.css`, so the lint gate accepts it; left as is.
- **Tools (§7).** Dropped, per its own escape clause: threading origin into
  `findWearablePoolForCharacter` means carrying group and project names through
  `SharedWardrobeTiers` and every resolver that builds it, not just the pool builder.
  `wardrobe_list` still says `[shared — read-only]`.
- **`CandidateItem.origin`** is `WardrobeOrigin | null`: null for items that live in the
  wardrobe being edited, so a project editor's own items carry no chip (as they carried no
  "shared" badge before).
- **List-component props** take `ListedWardrobeItem` (`WardrobeItem & { origin?: … }`) rather
  than the required-origin type, since equipped ids and fixtures can reach them without one;
  `wardrobeOriginLabel` accepts `null`/`undefined` and renders nothing.
- **Export.** The NDJSON writer strips any `origin` key from `wardrobe_item` records as well as
  testing for its absence.

Two complaints from the operator, both about reading a list of garments:

1. **In the per-slot picker** (the inline list under a slot in the outfit composer), titles are
   cut to one line with an ellipsis. Several garments share their first few words
   ("Midnight Lightning Flapper…"), so the list cannot be told apart.
2. **In the Wardrobe dialog**, a borrowed garment is marked with a muted "· shared" beside its
   title. It should be a chip in the same family as the slot badges, and it should say *which*
   project or group it was borrowed from — "shared" alone does not tell you whose wardrobe you
   are rummaging in.

## 1. Settled decisions

- **Titles wrap; nothing in a selection list truncates.** Every list a person chooses a
  garment from shows the whole title, on as many lines as it takes. No clamp, no ellipsis, no
  tooltip-as-workaround. The one existing exception is the Wardrobe dialog's own row, which
  already wraps to two lines with a tooltip and is left alone.
- **The types column yields.** The title gets the width; the slot list on the right shrinks and
  wraps before the title does. The slot list uses the display labels from `WARDROBE_SLOT_META`
  ("Top, Bottom"), not the raw keys ("top, bottom") — the picker and the quick-pick currently
  disagree on this, and the label is the right one.
- **One chip, naming the source.** The row's "· shared" text becomes a single chip:
  `Shared · Quilltap General`, `Project · Thornfield`, `Group · The Sisters`. There is no
  separate bare "shared" chip. The chip uses the already-defined, currently unused
  `qt-badge-wardrobe-shared` class; no new CSS, so no storybook mirror and no package publish.
- **Origin is a read-time annotation, never a stored field.** A garment has no idea which
  project it lives in; the *collection read* knows, because it read a particular mount. The
  server tags each item on the way out and the client keeps the tag. It is never written to
  frontmatter, never exported, never imported.
- **Precedence is unchanged.** When the same id reaches the merged character view from two
  tiers, the winner is still character > group > project > general, and the surviving item
  carries the winner's origin.

## 2. Why origin needs plumbing

Today nothing between the vault and the row records the tier. `readSharedWardrobe(mountPointId)`
(`lib/mount-index/shared-wardrobe.ts`) forces `characterId: null` on every shared item and
that null is the only signal the client has; `findArchetypesInMounts` flattens every group's
mounts into one list; `useCharacterWardrobeItems` (`lib/hooks/use-character-wardrobe-items.ts`)
fetches four lists (personal, `?scope=group`, project, General) and de-duplicates them into one
`WardrobeItem[]`, dropping which fetch each came from at `push()`. The dialog's comment near its
transfer wiring says so outright: "the home tier of a merged shared item isn't tracked".

The project and General fetches could be tagged client-side, but the group fetch cannot — one
request returns every group's mounts merged, and only the server knows which mount produced
which item. So the server tags everything, and the client's only job is not to lose the tag.

## 3. The origin type (`lib/wardrobe/wardrobe-container.ts`)

This module is client-safe and already owns `WardrobeContainerScope` / `WardrobeContainer`.
Add beside them:

```ts
/** Which wardrobe a collection read found an item in. Read-time only; never persisted. */
export interface WardrobeOrigin {
  scope: WardrobeContainerScope;      // 'character' | 'general' | 'project' | 'group'
  id: string | null;                  // container id; null for 'general'
  name: string;                       // display name, resolved server-side
}

export type WardrobeItemWithOrigin = WardrobeItem & { origin: WardrobeOrigin };

/**
 * The one place the chip text is spelled. Returns null for a character-owned
 * item — a garment in its own vault is not "shared from" anywhere.
 */
export function wardrobeOriginLabel(origin: WardrobeOrigin): string | null {
  switch (origin.scope) {
    case 'general': return 'Shared · Quilltap General';
    case 'project': return `Project · ${origin.name}`;
    case 'group':   return `Group · ${origin.name}`;
    case 'character': return null;
  }
}
```

`WardrobeItemSchema` is **not** changed. `origin` is a response envelope detail, typed on the
API response and the hooks, and `buildWardrobeItemFile` (`lib/mount-index/character-vault.ts`)
writes an allow-list of keys, so an `origin` that leaks into a `create` body is dropped on the
floor rather than written. The `.qtap` exporter reads items through the repository, which never
attaches origin; add a test that the exported `wardrobe_item` record has no `origin` key anyway.

## 4. Server: attach origin on every collection read

### 4.1 Per-group attribution

`resolveGroupMountPointIdsForCharacter` (`lib/mount-index/tiered-mount-pool`) returns a flat id
list. Add a sibling that keeps the grouping:

```ts
export async function resolveGroupMountsForCharacter(characterId, repos):
  Promise<Array<{ group: { id: string; name: string }; mountPointIds: string[] }>>
```

(official store first, linked stores after, same order the flat variant uses today). The flat
function becomes a `flatMap` over this one so the two cannot drift.

`WardrobeRepository.findArchetypesInMounts(mountPointIds)` gains an attributed twin,
`findArchetypesInMountsAttributed(groups)`, which reads each group's mounts with
`readSharedWardrobe`, tags every item `{ scope: 'group', id, name }`, and de-duplicates by id in
group order (first group wins — the same order the flat read produces, so precedence is
unchanged). The flat function stays for callers that do not care (the tools, the wearable pool).

### 4.2 Routes

| Route | Origin attached |
|---|---|
| `GET /api/v1/characters/[id]/wardrobe` | `{ scope: 'character', id, name: character.name }` |
| `GET /api/v1/characters/[id]/wardrobe?scope=group` | per item, from §4.1 |
| `GET /api/v1/projects/[id]/wardrobe` (factory) | `{ scope: 'project', id, name: project.name }` |
| `GET /api/v1/groups/[id]/wardrobe` (factory) | `{ scope: 'group', id, name: group.name }` |
| `GET /api/v1/wardrobe` (General) | `{ scope: 'general', id: null, name: 'Quilltap General' }` |

The factory in `lib/mount-index/mount-wardrobe-route-factory.ts` takes the origin from its
config (it already knows which entity it serves); the two hand-written routes attach it
themselves. One helper, `withOrigin(items, origin)`, in `lib/wardrobe/wardrobe-container.ts`.

Single-item GETs (`/wardrobe/[itemId]`) also attach origin — the editor opens from the list and
already has it, but a direct read should not be the one place it is missing.

### 4.3 Hooks

- `useCharacterWardrobeItems`: the merged array is `WardrobeItemWithOrigin[]`. `push()` keeps
  the first (winning) copy, so the origin survives precedence for free. The hook's return type
  changes; its consumers are the dialog, the editor's candidate builder, and the outfit
  selector.
- `useWardrobeContainerItems`: `items` carry the container's origin; `resolutionItems` (the
  container plus General archetypes used to resolve composite components) carry theirs.

Both hooks use plain `fetch`, not TanStack Query; that stays as it is — this spec adds no
polling and no new query keys.

## 5. Client: the chip

### 5.1 Wardrobe dialog row (`components/wardrobe/wardrobe-item-row.tsx`)

Replace

```tsx
{!manageable && <span className="qt-text-xs qt-text-secondary">· shared</span>}
```

with the chip, rendered after the slot badges on the same wrapping line:

```tsx
{!manageable && originLabel && (
  <span className="qt-badge qt-badge-wardrobe-shared" title={`Borrowed from ${originLabel}`}>
    {originLabel}
  </span>
)}
```

where `originLabel = wardrobeOriginLabel(item.origin)`. The `manageable` test is unchanged
(`canManage(item)` from the dialog, else `Boolean(item.characterId)`), so a project view —
where every row is the project's own — shows no chip, exactly as it shows no "· shared" today.

The "· bundle" and "· default" markers stay as muted text; they are properties of the garment,
not of where it hangs, and turning everything into a chip would make the row shout.

### 5.2 Component picker (`components/wardrobe/wardrobe-item-editor/WardrobeComponentPicker.tsx`)

Two changes. The candidate rows' existing `qt-badge-info` "shared" chip becomes the origin
chip, and it moves **out of the truncating title span** — today it sits inside
`<span className="flex-1 truncate …">`, so a long title clips the chip off with it. The row
becomes:

```tsx
<span className="min-w-0 flex-1 break-words text-sm text-foreground">{c.title}</span>
{originLabel && <span className="qt-badge qt-badge-wardrobe-shared shrink-0">{originLabel}</span>}
<span className="shrink-0 whitespace-nowrap qt-text-xs qt-text-secondary">{formatSlotLabels(c.types)}{bundle}</span>
```

`CandidateItem.isShared: boolean` becomes `origin: WardrobeOrigin`; `pushCandidates(list, shared)`
in `wardrobe-item-editor.tsx` passes the origin through instead of a boolean. The selected-
component pills get the same chip.

### 5.3 Per-slot picker and quick-pick (secondary line, no chip)

`equipped-slot-row.tsx` and `outfit-quick-pick.tsx` rows stay lean: no chip, but a borrowed
garment's origin label is appended to the muted right-hand text (`Top, Bottom · Project ·
Thornfield`), because two same-named garments from different tiers are exactly the case the
picker needs to disambiguate.

## 6. Client: wrapping

### 6.1 `formatSlotLabels`

Add to `lib/schemas/wardrobe.types.ts`, beside `WARDROBE_SLOT_META`:

```ts
/** "Top, Bottom, Footwear" — display labels in canonical slot order. */
export function formatSlotLabels(types: readonly WardrobeItemType[]): string {
  return WARDROBE_SLOT_TYPES.filter((s) => types.includes(s)).map((s) => WARDROBE_SLOT_META[s].label).join(', ');
}
```

Every list that prints a slot list calls it. Today `equipped-slot-row.tsx` prints raw keys,
`outfit-quick-pick.tsx` prints labels, `WardrobeComponentPicker.tsx` prints raw keys, and
`ProjectWardrobeManager.tsx` prints raw keys; they converge on labels.

### 6.2 The rows

Each candidate row is reshaped the same way. The pattern (from `equipped-slot-row.tsx`,
currently lines ~167-180):

```tsx
<button className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:qt-bg-muted">
  <span className="min-w-0 flex-1 break-words text-sm text-foreground">{c.title}</span>
  <span className="shrink-0 max-w-[45%] text-right qt-text-xs qt-text-secondary">
    {formatSlotLabels(c.types)}{originSuffix}
  </span>
</button>
```

- `items-start`, not `items-center`: a three-line title should hang from the top beside a
  one-line slot list, not float around its middle.
- `min-w-0 flex-1 break-words` on the title: `truncate` is removed; `min-w-0` is what lets a
  flex child shrink below its content width so it wraps instead of overflowing.
- `shrink-0 max-w-[45%] text-right` on the meta: it keeps its natural width up to just under
  half the row, then wraps itself. Four-slot composites ("Top, Bottom, Footwear, Accessories")
  are the reason for the cap — without it the types column takes the row and the title is
  squeezed into a word-per-line column.

Apply to:

| File | Today | Change |
|---|---|---|
| `components/wardrobe/equipped-slot-row.tsx` candidate `<li>` | `truncate` title | pattern above |
| `components/wardrobe/outfit-quick-pick.tsx` rows | `truncate` title, `whitespace-nowrap` types | pattern above, keep its " · replaces" suffix |
| `components/wardrobe/wardrobe-item-editor/WardrobeComponentPicker.tsx` candidates | `flex-1 truncate` | §5.2 |
| `components/wardrobe/ProjectWardrobeManager.tsx` `<h4 className="qt-label truncate">` and its component checklist `<span className="truncate">` | truncate | `break-words`, `min-w-0` |

Left alone, deliberately: `wardrobe-item-row.tsx`'s two-line clamp with tooltip (already
wraps), `equipped-bundle-card.tsx` (already `break-words`), the equipped pill chips in the slot
row (short by nature; a pill that wraps looks broken), and `OutfitSlotsPreview.tsx` badges.

### 6.3 `hover:qt-bg-muted`

The slot-row button carries `hover:qt-bg-muted`, which the `qt-*` lint gate
(`scripts/check-qt-classes.mjs`) rejects as a variant prefix on a `qt-*` token. While the row is
open, replace it with whatever the gate accepts — the escaped hand-written state form in
`_utilities.css` if one exists for this family, else `hover:bg-muted/40`. Do not add a new
`qt-*` rule for it; that would trigger the storybook mirror and a package publish for a hover
colour.

## 7. Tools (optional, cheap, do it)

`wardrobe_list` (`lib/tools/handlers/wardrobe-list-handler.ts`) renders borrowed garments as
`[shared — read-only]`. With origin in hand the line can say `[shared by Project · Thornfield —
read-only]`. The handler reads through `findWearablePoolForCharacter`, which merges tiers
without origin; thread it through by having the pool builder use the attributed group read from
§4.1 and tag project/General reads the same way. If that turns out to touch more than the pool
builder, drop this section — it is a nicety, not the requirement.

## 8. Tests

- `lib/wardrobe/__tests__/wardrobe-container.test.ts`: `wardrobeOriginLabel` for all four
  scopes; `withOrigin` leaves the item fields untouched.
- `lib/schemas/__tests__/wardrobe.types.test.ts`: `formatSlotLabels` orders canonically and
  ignores unknown entries.
- Repository: `findArchetypesInMountsAttributed` tags per group and keeps first-group precedence
  on an id collision (mock two mounts returning the same id with different titles; assert the
  first group's title and origin win, matching the flat read).
- Hook: `useCharacterWardrobeItems` preserves origin through de-duplication (personal copy
  wins over a General copy, origin is `character`).
- Row (`components/wardrobe/__tests__/wardrobe-item-row-*.test.tsx`): borrowed item renders the
  chip text and `qt-badge-wardrobe-shared`; own item renders no chip; project-scope view with
  `canManage` returning true renders no chip.
- Picker rows: assert the title element has no `truncate` class (the regression that matters)
  and that the origin suffix appears for a borrowed candidate.
- Export: the `wardrobe_item` NDJSON record carries no `origin` key.

## 9. Docs and bookkeeping

- `help/wardrobe.md`: in the section that describes the four tiers, replace the sentence about
  the "· shared" marker with the chip ("a chip in the slot-badge family names the wardrobe it
  was borrowed from"). The `url` frontmatter and In-Chat Navigation block are unchanged.
- `docs/CHANGELOG.md`: two lines under the current dev version, plain voice.
- `docs/developer/DDL.md`: nothing — no schema change.
- No `packages/` or `plugins/` change. `qt-badge-wardrobe-shared` already exists in
  `app/styles/qt-components/_content.css`, `_variables.css` (light and dark tokens) and the
  storybook mirror; this spec adds no CSS.

## 10. Gotchas

- The row's `manageable` test and the chip are two different questions. `manageable` is "may
  this view edit it"; the chip is "where did it come from". In a project view, borrowed General
  archetypes do not appear in the list at all, so the two coincide today; keep them separate
  anyway so a future "show General too" toggle does not have to untangle them.
- The group read's precedence is **first group wins**; the flat read's order is whatever
  `resolveGroupMountPointIdsForCharacter` yields. Build the attributed read from the same
  resolver so the winner is the same item either way.
- `wardrobeOriginLabel` returns `null` for `character`; render nothing, not "undefined".
- Keep `origin` out of `wardrobeItemFieldsSchema`. If it were accepted on create/update it would
  be stripped at the file writer anyway, but the API should refuse to pretend it is a field.
