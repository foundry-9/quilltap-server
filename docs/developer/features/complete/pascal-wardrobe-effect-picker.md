# Feature: Picking garments for a Pascal wardrobe effect (the Workbench's wardrobe picker)

**Status:** Implemented (2026-10-16, 4.11-dev). Design of record; see [As built](#as-built).
**Owner subsystem:** Pascal the Croupier — Pascal's Workbench (`components/custom-tools/`, `lib/pascal/`), reading the wardrobe (`lib/wardrobe/`, `components/wardrobe/`).
**Extends:** [complete/pascal-wardrobe-effects.md](pascal-wardrobe-effects.md) (the `effects[].wardrobe` gesture, implemented 4.11) and [complete/custom-tool-builder.md](custom-tool-builder.md) (the Workbench). Read those first, then [complete/wardrobe-refactor.md](wardrobe-refactor.md) §pool and [complete/wardrobe-list-legibility.md](wardrobe-list-legibility.md) (the `origin` annotation). This document describes only the delta.
**Implementation note:** Written to be executed by Claude Code (Opus) with no further design input. Where a choice existed it has been made — see [Design decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, debug logging on every touched backend path, the wardrobe and Pascal chokepoints, `queryKeys` for every query, no stubs). Every file and symbol named below was verified against the code at commit `25b8fab6a`.

## Motivation

A wardrobe effect names its garments as bare strings — a title or an id, optionally templated — and the Workbench's *Change the outfit* row ([`SideEffectsSection.tsx`](../../../../components/custom-tools/SideEffectsSection.tsx), `WardrobeFields`) offers one plain text box per item with the placeholder `Cloak of Night`. To fill it in, the author must already know the garment's exact title (or copy a UUID out of the Scriptorium), must remember which tier it lives in and therefore who will be able to reach it when the tool runs, must remember which slots it covers before picking `add_to_slot` and a **Slot**, and gets no picture to tell two same-named frocks apart. The Salon's "change what they're wearing" surfaces — the wardrobe dialog's rows ([`wardrobe-item-row.tsx`](../../../../components/wardrobe/wardrobe-item-row.tsx)), the slot pickers ([`equipped-slot-row.tsx`](../../../../components/wardrobe/equipped-slot-row.tsx)) and the outfit pull-down ([`outfit-quick-pick.tsx`](../../../../components/wardrobe/outfit-quick-pick.tsx)) — already answer every one of those questions at a glance: a thumbnail, the title, slot badges, an origin chip naming the wardrobe the item was borrowed from. The Workbench should borrow the same answers.

This feature gives the wardrobe row a **picker**: browse the garments and outfits a character can reach (or one shared wardrobe), see where each lives, what slots it fills and its picture, and click one to fill the reference. A filled reference renders as a **resolved chip** carrying the same badges, so a saved tool reads as well as it was authored. The proving bench learns to say which garment a dry run *would* have found, rather than only "would attempt".

Nothing about the file format, the applier or any write path changes. This is a reading surface over data the client already fetches elsewhere.

## Doctrine (read first)

1. **The reference stays a string, and the string stays a title.** `wardrobe.items[]` is unchanged: a title (case-insensitive) or an id, rendered through `renderTemplate` before lookup. The picker fills the field with the item's **title** by default, because a title is legible in the JSON, survives a `.qtap` round trip and resolves through tier shadowing for *whoever* rolls. Ids are offered as an opt-in per row for the author who has two garments of one name and needs exactness. No new field, no object form, no `$ref`.
2. **Resolution has one rule, stated once.** The server resolves a reference by id first, then by case-insensitive title (`findInPool`, [`lib/wardrobe/wear-ops.ts`](../../../../lib/wardrobe/wear-ops.ts); `WearablePool.findByTitle`, [`lib/wardrobe/pool.ts`](../../../../lib/wardrobe/pool.ts)). The client must display a reference by the same rule. That rule is extracted into one client-safe pure function (§2.1) which both `findInPool` and the Workbench call. Never re-derive it in a component.
3. **A tool has no character until it is run.** The rolling character's pool is what a gesture resolves against, and the Workbench edits a file that any character may one day run. So the picker browses from a **vantage**: a character whose reach to show (defaulting from the store the file lives in), or a shared wardrobe. The vantage is a lens for the author, never written to the file. The picker says plainly who will be able to reach a chosen item.
4. **Read-only, through the routes that exist.** The picker reads through the wardrobe collection routes and hooks the dialog already uses (`useCharacterWardrobeItems`, `useWardrobeContainerItems`), keyed by `queryKeys.wardrobe.list`. No new wardrobe API route. The one server-side addition (§4) is a read inside the existing `?action=preview` handler, loading a pool with `loadWearablePool` and writing nothing.
5. **No new wardrobe writer, no new wardrobe UI vocabulary.** Thumbnails are `WardrobeItemThumbnail`, slot chips are `SlotBadge`, origin text is `wardrobeOriginLabel`, slot lists are `formatSlotLabels`, outfits-versus-garments is `selectComposedOutfits` / `selectGarments`. The picker is a new arrangement of existing pieces, in the Salon's wardrobe idiom, so a user who has dressed a character recognises it at once.

## 1. The vantage — whose wardrobe are we looking at?

### 1.1 State

`WorkbenchEditor` ([`WorkbenchEditor.tsx`](../../../../components/custom-tools/WorkbenchEditor.tsx)) gains one piece of editor state shared by the side-effects card and the proving bench:

```ts
/** Whose reach the Workbench shows: a character, or one shared wardrobe. Never saved. */
export type WardrobeVantage =
  | { kind: 'character'; characterId: string }
  | { kind: 'container'; container: WardrobeContainer }   // general | project | group
  | { kind: 'none' };
```

(`WardrobeContainer` from [`lib/wardrobe/wardrobe-container.ts`](../../../../lib/wardrobe/wardrobe-container.ts).) Put the type in `lib/pascal/tool-draft.ts` beside `ToolDraft` — it is form state, like `rollForm`, and client-safe — but **not** on `ToolDraft` itself: `serializeDraft` must not see it, and `draftFromDefinition` cannot produce it. Hold it in `WorkbenchEditor` as `useState<WardrobeVantage>` and pass it down with its setter.

### 1.2 Default

Derive the opening vantage once, from where the file lives, using the destinations list the editor already fetches for the save dialog (`GET /api/v1/custom-tools?action=destinations`, `queryKeys.customTools.destinations()`, type `CustomToolDestinations` in [`lib/pascal/workbench.ts`](../../../../lib/pascal/workbench.ts)):

| The definition's `mountPointId` is… | Opening vantage |
|---|---|
| a character's vault (`destinations.characters[].mountPointId`) | `{ kind: 'character', characterId }` — the one character who can run it |
| a group's store (`destinations.groups[].stores[].mountPointId`) | `{ kind: 'container', container: { scope: 'group', id: groupId } }` |
| a project's store (`destinations.projects[].stores[].mountPointId`) | `{ kind: 'container', container: { scope: 'project', id: projectId } }` |
| the General store (`destinations.general.mountPointId`) | `{ kind: 'container', container: GENERAL_CONTAINER }` |
| unattached, or a new unsaved file | `{ kind: 'none' }` |

Add a pure helper `defaultWardrobeVantage(mountPointId: string | null, destinations: CustomToolDestinations): WardrobeVantage` in `lib/pascal/tool-draft.ts` with unit tests for each row. Run it once when the destinations load (a `useEffect` latched on "not yet chosen by the user"), and again when `location` changes after a *Save As…* — but never clobber a vantage the author has picked by hand. Mirror the latch pattern `OutfitSelector` uses for `autoResolved`.

### 1.3 The selector

One compact control, rendered at the head of the **Side effects** card only while the draft has at least one `wardrobe`-kind effect, and again inside the picker dialog's header (same component, `WardrobeVantageSelect`):

> Browsing **Imogen's** wardrobe ▾

The `<select>` groups its options: *Characters* (from `destinations.characters`, by name), *Shared wardrobes* (Quilltap General; each project in `destinations.projects`; each group in `destinations.groups`), and a leading *— choose —* row for `none`. Names and ids all come from the destinations payload; the picker needs no further catalogue query. Option labels: `Imogen` / `Quilltap General` / `Project · Thornfield` / `Group · The Regulars`, matching the origin-chip spelling in `wardrobeOriginLabel`.

Beneath it, one muted line stating what the vantage means for the file (house voice, short):

- character — *What Imogen can reach: her own wardrobe, her groups', and Quilltap General. Another character rolling this tool sees their own.*
- container — *Every garment in this wardrobe, and who can reach it: everyone / members of The Regulars / chats in Thornfield.*
- none — *Choose whose wardrobe to browse before picking garments.*

### 1.4 The bench borrows it

The proving bench's fact-sheet card ([`ProvingBench.tsx`](../../../../components/custom-tools/ProvingBench.tsx), `sheet` state with modes `none` / `character` / hand-typed) keeps its three modes, but its *Pick a character* mode **reads and writes the shared vantage** instead of its own `characterId`: choosing a character on the bench sets `vantage = { kind: 'character', characterId }`, and a character vantage chosen in the effects card pre-selects the bench's character mode. A container vantage leaves the bench's sheet mode untouched (a store has no fact sheet). The bench's `charactersQuery` already selects from `?action=destinations`; keep that, it is the same data.

## 2. Resolving a reference on the client

### 2.1 One rule, extracted

New client-safe module **`lib/wardrobe/wearable-ref.ts`**:

```ts
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/**
 * The one lookup rule for a wearable reference: id first, then case-insensitive
 * title, the pool's own-items-first order already applied by the caller. Used by
 * the server's `findInPool` and by every Workbench surface that displays a
 * reference, so the two can never disagree about which garment a string names.
 */
export function resolveWearableRef<T extends Pick<WardrobeItem, 'id' | 'title'>>(
  pool: readonly T[],
  ref: string,
): T | undefined;

/** True when a reference carries a `{{…}}` placeholder and so is chosen at run time. */
export function isTemplatedWearableRef(ref: string): boolean;   // delegates to scanPlaceholders
```

`WearablePool.findByTitle` (server) already encodes *own items first (archived included), then the wearable shared set*; the client pool from `useCharacterWardrobeItems` is the same merge in the same precedence (`mergeWearableTiers`), so passing its `items` as `pool` gives the same answer for live items. Keep the function trivially simple and make `findInPool` call it for the title half (`pool.get(id)` stays as is), so a grep-test can assert the Workbench and the applier share the rule: add a case to `__tests__/unit/lib/wardrobe/wear-ops.test.ts` (or the nearest existing suite) that mocks `resolveWearableRef` and proves `findInPool` delegates.

### 2.2 Archived items

`useCharacterWardrobeItems` drops archived items per tier before shadowing unless `includeArchived: true`. The Workbench passes `includeArchived: true` so a reference to an archived garment still *resolves* and can be shown with the **archived** badge the dialog uses — and then warns per action: a `wear` of an archived item will be refused at run time (`wearRefusal`), a `take_off` will not (archived items may come off; the applier says so). The chip's warning text comes from `archivedWearMessage` ([`lib/wardrobe/wearable.ts`](../../../../lib/wardrobe/wearable.ts)), not a new string.

## 3. The Side effects card

### 3.1 The item row becomes a reference chip

In `WardrobeFields`, each item row renders one of three ways, decided by `resolveWearableRef` against the vantage pool:

1. **Resolved** — the string names a garment or outfit the vantage can reach. Render a chip, 28 px thumbnail (`WardrobeItemThumbnail`, no `onOpen` — it sits inside a button), the title (wrapping, never `truncate` — the legibility rule), `· outfit` for a composite (`isComposite`), the slot badges (`SlotBadge` per `types`), the origin chip (`wardrobeOriginLabel(item.origin)`, which is null for the character's own garments — then show *Imogen's own*), the archived badge when `archivedAt`. A small **by id / by title** toggle (§3.3) and the existing trash button. Clicking the chip body opens the picker with the current item highlighted.
2. **Templated** — the string contains `{{…}}` (`isTemplatedWearableRef`). Keep the text input exactly as today, with a muted *chosen at run time* note. The picker is still reachable from a *Choose…* button beside it, and a pick replaces the template.
3. **Unresolved** — plain text that names nothing in the vantage's reach (a typo, or a garment only another character owns). Keep the text input, add the `qt-input-error`-free advisory chip *not in Imogen's reach* and the *Choose…* button. This is an **advisory, not a draft error**: the applier is fail-soft and the vantage is only a lens, so `validateDraft` stays pure and pool-blind. The advisory is computed in the component.

With vantage `none`, every row is the plain text input it is today plus a *Choose…* button that opens the picker on its vantage prompt. Nothing regresses for an author who ignores the feature.

### 3.2 Slot coupling

When the action is `wear` with mode `add_to_slot`, or `take_off` with a slot named, and every non-templated item row resolves: the **Slot** `<select>` marks slots none of the chosen items cover with `(not covered)` in the option label, and an advisory line names the mismatch — *“Sundress” covers Top, Bottom — not Footwear* — using `formatSlotLabels`. Do not disable the option (a templated second item may cover it). The run-time refusal message this mirrors is `resolveWearable`'s `slot` reason; keep the wording in step with it.

### 3.3 Title or id

The chip's toggle rewrites the stored string between `item.title` and `item.id`; the picker's footer has the same switch (*Reference by: title ○ id*), defaulting to title, remembered for the editor session only (component state, not `localStorage`). Beside the id form, a one-line hint: *An id names this exact garment and no other; a title names whichever garment of that name is nearest when the tool runs.* Both forms fit `MAX_WARDROBE_ITEM_REF_LENGTH` (200).

### 3.4 The picker dialog

New component **`components/wardrobe/wardrobe-reference-picker.tsx`**, exported from `components/wardrobe/index.ts`, generic enough that the Scenario Builder or a future Pascal preset could reuse it — so it takes a `vantage` and an `onPick(item, { reference: 'title' | 'id' })`, and knows nothing about drafts. Open it from `SideEffectsSection` via `createPortal` to `document.body` (the Workbench lives in the workspace, whose `isolation: isolate` traps overlays under the sticky toolbar — the same rule the wardrobe dialog follows). Use `BaseModal` like the wardrobe dialog, and the `useClickOutside` Escape idiom (`escapeCapture: true`) so Escape closes the picker, not the Workbench.

Layout, top to bottom:

- **Header:** *Choose a garment or outfit* with the `WardrobeVantageSelect` (§1.3) at its right, so the author can change whose wardrobe without closing the dialog.
- **Filter row:** a search box (title substring, case-insensitive — the same filter `OutfitQuickPick` and `EquippedSlotRow` apply); a *Show archived* checkbox (default **on** for `take_off`, **off** for `wear` — the applier's own asymmetry); and, when the gesture names a slot, a *Covers `<Slot>` only* checkbox (default on).
- **Outfits** section: `selectComposedOutfits(items)`, sorted by title (the function already sorts). Each row: 40 px thumbnail, title, `· outfit`, slot badges for the composite's `types`, origin chip, default star when `isDefault`, the wear line (`formatWearLine(wearOf(item))` — the list reads carry the ledger annotation; it costs nothing and tells the author which outfit is the character's habit), and a `▶` expander that lists the components by title and slot (resolve `componentItemIds` against the vantage pool, as `WardrobeItemRow` does). An outfit is **one** reference and wears whole, so the expander is for looking, not picking.
- **Garments** section: `selectGarments(items)`, grouped by first slot in `WARDROBE_SLOT_TYPES` order under `WARDROBE_SLOT_META[slot].groupLabel` headings (Tops, Bottoms, Footwear, Accessories, Hair), the row shape as above minus the expander. A multi-slot garment appears under its first slot only, with every badge shown.
- **Empty states:** vantage `none` → the §1.3 prompt and the selector, nothing else; a vantage with no items → *Nothing hangs here yet. Items are added from the Wardrobe.* with a link that opens the wardrobe dialog on the vantage (`useWardrobeDialogOptional()?.open({ characterId })` for a character vantage; for a container vantage, open without context — the dialog's own selector takes it from there).
- **Footer:** the *Reference by* switch (§3.3) and Cancel. Clicking a row picks it and closes; there is no multi-select (a gesture lists at most eight items and each is picked deliberately, in order).

Each row also carries a plain-text **reach** note under the origin chip, in muted text, derived from `origin.scope` — the thing the dialog never needed to say, because there the character was given:

| `origin.scope` | reach note |
|---|---|
| `character` | *Imogen only* |
| `group` | *members of The Regulars* |
| `project` | *chats in Thornfield* |
| `general` | *everyone* |

Put the mapping in one function `wardrobeReachLabel(origin, characterName?)` beside `wardrobeOriginLabel` in `wardrobe-container.ts`, with tests.

### 3.5 Data

- Character vantage: `useCharacterWardrobeItems(characterId, { includeArchived: true })`. No `chatId` / `projectId` is passed — the Workbench has no chat, so the project tier is absent, exactly as `loadToolPool` resolves it for a run in a chat with no project. Say so in the character vantage's hint line when the file lives in a project store: *This tool lives in Thornfield's store; garments from Thornfield's wardrobe will also be in reach when it runs there.* (Derive the project from `destinations.projects`; this is the one case the lens is knowingly narrower than the run.)
- Container vantage: `useWardrobeContainerItems(container, { includeArchived: true })`; use `.items` for the rows and `.resolutionItems` for a composite's component lookups (General archetypes join the resolution pool there).
- Both hooks go through `queryKeys.wardrobe.list(...)` already; add nothing to `lib/query/keys.ts`. Realtime: the `wardrobe` topic already gates these reads; a new polling site would be a bug and none is needed.

## 4. The proving bench says what it would have found

Today a dry run reports `→ wardrobe: wear “Cloak of Night” (would attempt)` because the bench had no character. Now it may have one.

### 4.1 Server: resolve against the chair's pool

In `handlePreview` ([`app/api/v1/custom-tools/route.ts`](../../../../app/api/v1/custom-tools/route.ts)), after `executeCustomTool` returns, when `body.metadata` named a character (`{ characterId }` — the existing `MetadataInputSchema` form; the hand-typed sheet has no character and gets no resolution) **and** the result carries wardrobe `ResolvedEffect`s:

```ts
const pool = await loadWearablePool(repos, characterId, { operator: true });   // no chatId: no project tier, as the lens
```

then, for each `{ index, wardrobe }` effect, walk its `items` with `findInPool` (archived included — the applier's rule) and, for `wear`, `resolveWearable(pool, { itemId: ref, itemTitle: ref }, mode, slot)` to carry the refusal reason; for `clear_slot` there is nothing to resolve. Return beside the result:

```ts
wardrobeResolution?: Array<{
  index: number;
  items: Array<
    | { ref: string; found: { id: string; title: string; types: WardrobeItemType[]; origin: WardrobeOrigin; imageFileId: string | null } }
    | { ref: string; found: null; reason: string }   // not_found | archived | slot, in resolveWearable's words
  >;
}>;
```

This is a read. It never calls `wearItem`, `applyDisplacement` or `notifyWardrobeChanged`, and the handler's existing *"The bench computes effects; it never applies them"* contract holds. Wrap the pool load in the same fail-soft the applier uses — a pool that cannot be read logs `warn` and omits `wardrobeResolution`; the roll result still returns. Add a `logger.debug` line with `context: 'custom-tools.preview'`, `tool`, `characterId`, and the counts found / missing.

Add the response shape to `lib/pascal/workbench.ts` (`PreviewWardrobeResolution`), export it, and extend the route's unit tests (beside `__tests__/unit/app/api/v1/custom-tools/route-state.test.ts`, a new `route-preview-wardrobe.test.ts`) with cases: a found title, a found id, an unknown title, an archived garment under `wear` vs `take_off`, a slot mismatch under `add_to_slot`).

### 4.2 Client: the dry-run line

`describeBenchGesture` in `ProvingBench.tsx` gains the resolution when present. Per item:

- found → `→ wardrobe: wear Cloak of Night (Top, Bottom · Quilltap General) (would apply)`, with the 28 px thumbnail inline when `imageFileId` is set;
- not found → `… “Cloak of Nite” — not in Imogen's reach (would skip)`;
- archived under `wear` / slot mismatch → the server's reason verbatim, `(would skip)`.

Without a character in the chair the line stays exactly as today, *would attempt*. Update the component's doc comment, which currently explains why it can only ever say *would attempt*.

## 5. Tests

- **`lib/wardrobe/wearable-ref.test.ts`** — id beats title; title is case-insensitive; first match wins in pool order; a template is never resolved; `isTemplatedWearableRef`.
- **`findInPool` delegation** — see §2.1.
- **`defaultWardrobeVantage`** — one case per row of the §1.2 table, plus "mount attached to a character *and* a group" (character wins: it is the narrower, truer reach).
- **`wardrobeReachLabel`** — the four scopes.
- **`WardrobeReferencePicker`** (RTL, `renderWithQuery`, `jest-fetch-mock` serving the collection routes) — outfits and garments sectioned; search filters; *Covers Footwear only* hides a Top; archived default per action; a pick calls `onPick` with the title, and with the id after the switch; vantage `none` shows the prompt; empty vantage shows the empty state.
- **`SideEffectsSection`** — a resolved reference renders as a chip with the origin and slot badges; a templated one keeps its input; an unresolved one shows the advisory and no draft error; the slot-coverage advisory appears for `add_to_slot`; `serializeDraft` output is byte-identical before and after resolving (the vantage never reaches the file).
- **Preview route** — §4.1.
- **Snapshot / golden:** none of `tool-definitions-snapshot`, `IDENTITY_STACK_BUILDER_VERSION` or the custom-tool JSON schema is touched; assert the published schema's agreement corpus still passes untouched.

## 6. Documentation and bookkeeping

- `help/pascals-workbench.md` — the **Side effects** bullet: describe the *Choose…* picker, the chip (picture, slots, where it lives, who can reach it), the vantage selector and what *Browsing Imogen's wardrobe* means for a tool anyone may run, title-versus-id; the **proving bench** section's *Side effects, dry* bullet: with a character in the chair the bench now says which garment it found or why it would skip. House voice. Keep the `url` frontmatter and the In-Chat Navigation block as they are.
- `help/custom-tools.md` — *Dressing and undressing*: one sentence after "Items are named by title or id": the Workbench's picker fills these in for you and shows what each name reaches.
- `help/wardrobe.md` — *Related Topics*: a line pointing at the Workbench's picker.
- `docs/CHANGELOG.md` — plain voice, one entry under the current unreleased heading (find the existing section; do not add a second header).
- `docs/FEATURES.md` — the Pascal paragraph, half a sentence.
- `.claude/commands/update-documentation.md` — a row for this spec; on completion move the file to `complete/` and update the row and `help/pascals-workbench.md`'s row.
- `docs/developer/features/ROADMAP.md` — tick the Pascal entry added with this spec.
- `components/wardrobe/wardrobe-item-thumbnail.tsx` doc comment lists the surfaces that use it — add the Workbench chip and picker.

## 7. Phasing

1. **Phase A — the rule and the lens.** `wearable-ref.ts` + `findInPool` delegation; `WardrobeVantage`, `defaultWardrobeVantage`, `WardrobeVantageSelect`; lifting the bench's character into the shared vantage. No visible change to the item rows yet beyond the selector appearing. Tests.
2. **Phase B — chips and the picker.** `WardrobeReferencePicker`, `wardrobeReachLabel`, the three row renderings, slot coupling, title/id toggle. Tests. Help docs.
3. **Phase C — the bench.** `wardrobeResolution` in `?action=preview` and the dry-run line. Tests.

Each phase is committable on its own; B is the deliverable the request names, A is its prerequisite, C is the polish that makes the lens honest. Verify B live on the `V4test` instance (never Friday): open a tool stored in a character vault and in the General store, confirm the opening vantage of each, pick a General archetype from the character vantage and confirm its chip reads *Shared · Quilltap General · everyone*, save, reopen, confirm the saved JSON holds only the title.

## Design decisions (resolved)

- **Title by default, id by choice.** A title is what the help page teaches, what reads in the file, and what shadows correctly for any roller; an id is exactness for the author who needs it. The chip resolves either, so the display never depends on which was stored.
- **A vantage, not a binding.** The alternative — storing a `characterId` on the gesture — would turn a tool anyone may run into one character's, contradicting the applier's "the rolling character wears it". The lens is editor state and dies with the editor.
- **Default vantage from the store.** A tool in Imogen's vault can only ever be run as Imogen; starting there is simply correct. A group or project store starts on that shared wardrobe because that is what every member will certainly reach; a General-store tool starts on General for the same reason.
- **Advisories, not errors.** The applier is fail-soft and the lens is partial (no project tier, and another character may roll), so an unresolved reference must never block a save. `validateDraft` stays pure.
- **The project tier is knowingly absent from the lens**, matching `loadToolPool` for a chat with no project rather than guessing a project. The hint line names the gap when the file's store tells us there is one.
- **No multi-select, no drag-to-reorder.** Eight items at most, picked deliberately; the existing per-row trash and Add item suffice.
- **A new picker component rather than reusing `WardrobeItemRow`.** The dialog row carries a kebab of mutations (edit, archive, move, delete) that have no place in a reference picker, and its `inChat` buttons wear things. The picker composes the same primitives into a row that only chooses.
- **The bench resolves server-side.** The client could resolve against the vantage pool, but the bench's doctrine is "the very same machinery a live chat uses"; `loadWearablePool` + `resolveWearable` on the server is that machinery, and it carries the refusal reasons the client would otherwise have to re-derive.

## Not in scope

- Picking garments inside the **composer's run dialog** at run time (a parameter of type string with `{{params.garment}}` already serves; a wardrobe-typed parameter is a format change and a separate spec).
- Any change to `effects[].wardrobe`'s schema, the published JSON Schema, or `CUSTOM_TOOL_SPEC.json`.
- Creating or editing garments from the Workbench — the empty state links to the wardrobe dialog instead.
- Folders: the picker flattens the vantage's items and searches by title; a folder crumb per row may follow if the lists grow unwieldy.

## As built

Implemented 2026-10-16 (4.11-dev), all three phases in one change. Where the build departs from the text above:

- **The shared rule has two exports, not one.** `lib/wardrobe/wearable-ref.ts` exports `matchWearableTitle` (the title half) beside `resolveWearableRef` (id, then `matchWearableTitle`) and `isTemplatedWearableRef`. `findInPool` is unchanged; its title half goes through `WearablePool.findByTitle`, which now calls `matchWearableTitle` over the own tier, then the wearable shared set. The delegation test (`__tests__/unit/lib/wardrobe/wearable-ref-delegation.test.ts`) therefore mocks `matchWearableTitle`, not `resolveWearableRef`. Calling `resolveWearableRef` from `findInPool` would have made a tool's `itemTitle` match ids as well, a behaviour change for the `wardrobe_*` tools.
- **The pool loader is `useWardrobeVantageItems`** (`lib/hooks/use-wardrobe-vantage-items.ts`), a switch over `useCharacterWardrobeItems` / `useWardrobeContainerItems` with `includeArchived: true`. The Side effects card and the picker both call it; the queries share one cache. The card reads nothing until a wardrobe row exists.
- **The vantage select** is `components/custom-tools/WardrobeVantageSelect.tsx`, which also exports `encodeWardrobeVantage` / `decodeWardrobeVantage` / `wardrobeVantageOrigin` / `wardrobeVantageName`. The editor's default runs as a render-time latch keyed on `destinations loaded + location.mountPointId`, not a `useEffect`; once the author picks a vantage by hand it is never overwritten.
- **The bench's sheet** became `{ mode: 'character' } | { mode: 'manual'; text }`; the character is the vantage's. Choosing "nobody in particular" on the bench clears a character vantage to `none`. `ProvingBench` and `SideEffectsSection` keep working without the vantage props (the bench holds a local one; the card shows no selector).
- **The picker** uses `BaseModal`, which already portals to `document.body` and closes on Escape; there is no inner popover, so no `escapeCapture` listener was needed. The id-form hint is exported as `REFERENCE_FORM_HINT` and reused by the chip toggle's tooltip.
- **`wardrobeResolution` entries** carry both `reason` (`'not_found' | 'archived' | 'slot'`) and `message` (`resolveWearable`'s words; for not-found, `wardrobeItemNotFoundMessage(null, ref)` so the text names the ref once). The resolver lives in `lib/pascal/bench-wardrobe.ts` (`resolveBenchWardrobe`, pure core `resolveBenchWardrobeAgainst`); the pool is loaded with `projectMountPointIds: []`, which is how `loadWearablePool` spells "no project tier". The route's `{ characterId }` check is now one helper, `benchCharacterId`, shared by `resolveMetadata`.
- **Live check (V4test, 2026-10-16), partial.** A General-store tool opened on *Browsing Quilltap General wardrobe* (General is empty there, so the picker showed its empty state). Switching to a character vantage listed that character's garment with slot badges, origin and reach; picking it rendered the chip and wrote only the title into the exact-bytes preview; the bench seated the same character and its dry run read `wear Forest travel robe (Top, Bottom) (would apply)`. Not done: opening a character-vault tool, picking a General archetype (none exist on V4test), and save/reopen — nothing was saved to the instance.
