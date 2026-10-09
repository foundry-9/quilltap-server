# Wardrobe refactor plan

**Status:** proposed (2026-10-09). Nothing here is implemented.
**Scope:** `lib/wardrobe/`, `lib/database/repositories/wardrobe*`, the vault
overlay wardrobe reader/writer, the seven `wardrobe_*` tools, the wardrobe API
routes, the wardrobe image pipeline, and `components/wardrobe/`. About 30k
lines across 100 files, 31 commits since August.

## 1. Diagnosis

The wardrobe has grown four tiers (character > group > project > General),
dissolving bundles, a wear ledger, item pictures, transfers and dressing
instructions, each added as its own layer. Every layer was built well in
isolation; what is missing is the two abstractions they all needed and each
re-derived locally:

1. **A wardrobe location.** "Where does this item live, and how do I read and
   write there" is spelled eight ways: `WardrobeContainer` (client),
   `ResolvedWardrobeContainer` (`resolve-container.ts`), `WardrobeLocation`
   (`wardrobe-writes.ts`, which has no `group` scope and uses `*Project*`
   writers for groups), `WardrobeItemHome` (`item-images.ts`, with a
   scope-switched `update`), `resolveContainerMountPointId`, `locationKey`
   (transfers), `OwnerStoreResolution` (route factory), and the repository's
   `ownerCharacterId: string | null` hint, which can only address two of the
   four tiers. The tier-specific write switch is re-coded in three places and
   the project/group routes bypass the repository entirely.

2. **A per-request wearable pool.** "Everything this character can reach,
   indexed by id" is rebuilt on every lookup. `findByIdForCharacter` and
   `findByIdsForCharacter` each parse the whole vault plus every shared tier;
   `hydrateComponentGraph` calls the latter once per nesting level; the vault
   reader itself calls `findArchetypes` to seed component resolution. A
   two-level composite costs three vault reads and two full archetype parses.
   `apply-outfit-selections.ts` hand-rolls its own memoised pool to avoid
   this, and the outfit-summary action hand-rolls a cast-wide one.

Everything below follows from supplying those two and deleting what they
replace. Section 2 lists the defects found on the way; section 3 is the work,
in order; section 4 is what disappears.

## 2. Defects found (file before the refactor touches the area)

Each is verified against source and filed in the [bug catalogue](../bugs.md) as bugs 187–197.

| # | Severity | Defect | Where |
|---|---|---|---|
| 187 | **High, data loss** | A character composite whose component lives in a group or project store loses that reference on the next vault read, and the next write of any item re-projects the stripped list to disk. The reader seeds component resolution from General only (`vault-readers.ts:384-385`, `findArchetypes(true)` with no tiers) and the parser drops unknown refs (`parsers.ts:466-490`); the write side's cycle check accepts the same refs (`wardrobe-writes.ts:111-128`). `wardrobe_create` and the item editor both let such references be made. | vault overlay |
| 188 | High | `wardrobe_archive` re-stamps `archivedAt` on an already-archived item (`WardrobeRepository.archive` is unconditional; the tool can resolve archived items by id). The routes go through the idempotent `archivedPatch`; the tool does not. | tools |
| 189 | High | A tool-queued item picture ignores the chat's Concierge state: `item-image-generation.ts:267` passes `chatId: null` although the job payload carries it. A Locked chat's refusal can be rerouted to the uncensored desk, and the ledger and announcement are skipped. | images |
| 190 | Medium | The item editor computes a composite's `types` from a candidate list that has no group tier and no archived items (`wardrobe-item-editor.tsx:193-259, 299`); the routes trust the client's `types`. Editing a composite whose parts are group-shared silently narrows its slots and drops their chips. | UI |
| 191 | Medium | `?action=equip` wears archived items (no `archivedAt` check in `outfit.ts`; `findByIdForCharacter` includes archived by design). The tool refuses them. `set_all` doesn't check either. | routes |
| 192 | Medium | Transfer source probing walks character > **project > group** > General (`transfers/route.ts:163-203`), the reverse of the canonical group > project, and provisions the project store as a side effect of a read probe. | routes |
| 193 | Medium | `wardrobe_create` with `equip: true` never records the Aurora announcement: the executor's create branch is the one of seven that doesn't forward `pendingWardrobeAnnouncements` (`tool-executor.ts:799`) and the handler calls only the avatar trigger. | tools |
| 194 | Medium | The full-screen viewer's missing-picture cleanup posts to `DELETE /api/v1/images/{id}`, which knows nothing about wardrobe links or `imageFileId`, and does not invalidate wardrobe queries. | UI/images |
| 195 | Low | `wardrobe_update` without `types` replaces a composite's slots with the plain component union, dropping designated extras (the Naked case the create tool documents); create widens, update narrows. | tools |
| 196 | Low | `WARDROBE_ITEM_IMAGE` log rows are excluded from per-profile image spend (`almanack/phase6-wire-records.ts:139` filters `IMAGE_GENERATION` only). | Almanack |
| 197 | Low | Import-from-image's vision call bypasses `shrinkImageForLlmTransport` and the attachment-arrival check, and its profile picker uses `profileSupportsMimeType` instead of `profileCanReceiveAttachment` (bug 91's predicate). | images |

Fix 187, 188, 189 and 191 before any structural work; they are small and the
refactor would otherwise carry them along. The rest fall out of the phases
that touch them.

**Done 2026-10-09:** 187, 188, 189 and 191 are fixed (see each bug's file in
`bugs/fixed/`). What the phases below still owe them: Phase B can drop the
General seed and the `seedArchetypes` guard (187's data loss is closed by
keeping unmatched UUIDs); `resolveWearable` can absorb
`lib/wardrobe/wearable.ts` (191); `archive-item.ts` is only needed if the
notifier wants a home (188 — the repository's `archive` / `unarchive` are
already gone).

## 3. The work, in order

Phases are independent enough to ship one at a time. Each ends with `npx tsc`,
the wardrobe unit suites, and a V4test walkthrough of the surfaces named.

### Phase A. One wardrobe location (server)

Replace the eight shapes with one.

```ts
// lib/wardrobe/location.ts
export type WardrobeScope = 'character' | 'group' | 'project' | 'general';   // Zod enum, exported
export interface WardrobeLocation {
  scope: WardrobeScope;
  id: string | null;            // owner id; null for general
  mountPointId: string;         // ALWAYS set, every tier
  characterId: string | null;   // scope === 'character' only
  origin: WardrobeOrigin;
  readItems(includeArchived?: boolean): Promise<WardrobeItem[]>;
  findItem(id: string): Promise<WardrobeItem | null>;
  create(item: WardrobeItem): Promise<WardrobeItem>;
  update(id: string, patch: Partial<WardrobeItem>): Promise<WardrobeItem | null>;
  delete(id: string): Promise<boolean>;
}
export async function resolveWardrobeLocation(scope, id, repos, userId, opts?: { ensure?: boolean }): Promise<WardrobeLocation | null>;
export function locationKey(loc: Pick<WardrobeLocation, 'scope' | 'mountPointId'>): string;
```

- `ensure` provisions a project/group store and its `Wardrobe/` folder only
  when a write is coming. Read probes (transfers) pass `false`; this is bug 192's
  side-effect half.
- The archived-character tombstone stays where it is (`resolveWardrobeMount`
  throws `CharacterArchivedError`); `resolveWardrobeLocation` surfaces it the
  same way for the character scope.
- `wardrobe-writes.ts`: add `'group'` to `WardrobeLocation.scope`, rename
  `*ProjectWardrobeItem` / `projectWardrobeLocation` to `*MountWardrobeItem` /
  `mountWardrobeLocation`, delete the stale "DB fallback" comments, and
  implement `WardrobeLocation.create/update/delete` on `createAtLocation` etc.
  The repository's `create/update/delete(…, ownerCharacterId)` become thin
  adapters that resolve a location and delegate; new code never passes the hint.
- Collapse into it: `resolve-container.ts` (becomes this module),
  `resolveContainerMountPointId` and `WardrobeItemHome.update` in
  `item-images.ts`, `locationKey` and `createAtDestination`/`deleteFromSource`
  in transfers, `makeOwnerStoreSteps` in the route factory.
- `ensure-project-store.ts` and `ensure-group-store.ts` are the same 74 lines
  modulo one constant: one `ensureOwnerOfficialStore(kind, …)`.
  `project-wardrobe.ts` and `group-wardrobe.ts` are pure renames of
  `shared-wardrobe.ts`: delete them and call it directly.
- Fix the transfer probe order (bug 192) while rewriting `resolveSourceItem`
  on top of locations; the group tier should iterate
  `resolveGroupMountsForCharacter` as locations, not raw mounts.

### Phase B. One wearable pool per request

```ts
// lib/wardrobe/pool.ts
export interface WearablePool {
  characterId: string;
  tiers: ResolvedSharedWardrobeTiers;
  /** character > group > project > general, archived included */
  byId: ReadonlyMap<string, WardrobeItem>;
  wearable(): WardrobeItem[];                // mergeWearablePool semantics (archived dropped)
  get(id): WardrobeItem | undefined;
  getMany(ids): WardrobeItem[];
  findByTitle(title): WardrobeItem | undefined;   // own first, then shared
  owns(item): boolean;                            // the one "is this mine" predicate
}
export async function loadWearablePool(repos, characterId, projectMountPointIds?, opts?: { operator?: boolean; chatId?: string }): Promise<WearablePool>;
```

- Resolves the group tier itself (it is a function of `characterId` alone, see
  `tiered-mount-pool.ts:277`), so callers pass only the project tier. This
  removes the `await sharedWardrobeTiersForCharacter(cid, projectIds)`
  boilerplate at seven sites and the three group resolutions per character in
  `apply-outfit-selections.ts`.
- Reads each tier exactly once. `findByIdForCharacter`, `findByIdsForCharacter`,
  `findArchetypeById`, `resolveWardrobeItemAcrossTiers` and the
  `resolveComponentItems` copy in the create handler become `pool.get` /
  `pool.getMany` / `pool.findByTitle`. `hydrateComponentGraph` and
  `loadBundleLookup` become pure walks over `pool.byId` (no I/O at all; the
  pool already holds every tier). `resolveEquippedOutfitForCharacter` takes a
  pool instead of repos.
- `apply-outfit-selections.ts` drops `getSharedPool`/`getGroupTier`/`getPool`
  for one memoised `loadWearablePool` per character, with the shared tiers
  loaded once and shared across the batch (a `loadSharedTiers` cache the pool
  loader accepts).
- The outfit-summary action's cast-union pool becomes `loadCastPool(chat)`
  built from the same loader, and its hand-rolled expansion becomes a call to
  `resolveEquippedOutfitForCharacter`. Its slot routing currently differs from
  the canonical one (it keeps only leaves whose `types` include the equipped
  slot); pick the canonical rule and change the summary.
- **Bug 187 fix lands here:** `readCharacterVaultWardrobe` stops calling
  `findArchetypes` to seed component resolution. Parsing keeps an unresolved
  reference as its UUID instead of dropping it (`expandComposites` already
  tolerates unknown ids; a hand-edited slug that matches nothing still warns),
  and the cycle check in `wardrobe-writes.ts` uses the pool for peers. With
  that the recursion guard (`seedArchetypes: false`), the "Do NOT simplify"
  warning on `findWearablePoolForCharacter`, and the parse-time gap note in
  `shared-wardrobe.ts` all go away.
- The repository shrinks to: `findByCharacterId`, `readSharedTiers(mounts,
  includeArchived)` (one generic shadowed loop replacing `findArchetypes`,
  `findArchetypesInMounts` and `findArchetypesInMountsAttributed`, with an
  optional origin tagger), and the location-delegating writes. "Archetype"
  stops meaning three things; it was General-only once and now isn't.

### Phase C. One outfit-change pipeline

- `lib/wardrobe/outfit-change-effects.ts`: move `notifyWardrobeChanged`,
  `recordPendingWardrobeAnnouncement`, `scheduleWardrobeAnnouncement`,
  `flushPendingWardrobeAnnouncements` out of `lib/tools/handlers/`. The
  orchestrator, `outfit.ts`, `participants.ts`, `chats/route.ts` and the
  create handler all call it. Fixes bug 193 by construction once the executor's
  seven `wardrobe_*` branches become one table that always forwards the
  announcement set.
- `lib/wardrobe/wear-ops.ts`: `resolveWearable(pool, ref)` (not-found,
  archived, slot coverage, one set of messages), a single mode → primitive
  table, and `applyDisplacement(repos, chatId, cid, ComputeDisplacedOptions,
  source)` wrapping `computeDisplacedSlots` so the four persisted primitives
  stop repeating load → pure → commit. Both the tools and `?action=equip` use
  it; bug 191 closes. Document that the route's `remove_from_slot` is
  single-slot while the tool's `remove` is all-slots, or unify them.
- `lib/wardrobe/archive-item.ts` on `archivedPatch` plus the notifier; the
  tool and the routes both call it; delete `WardrobeRepository.archive` /
  `unarchive` (the latter has no callers). Bug 188.
- `lib/wardrobe/item-mutations.ts`: `buildCompositeTypes(components,
  designated)` (widen, never narrow; bug 195), `validateComponentRefs(pool,
  ids)`, and a `createItem` / `updateItem` pair that the tool handlers, the
  routes, and the import flow all go through. The create tool currently builds
  its item literal by hand and has drifted from `wardrobeItemFromCreateBody`
  (`||` vs `??` on empty strings, forced `replace: false`); the startup mover
  has a third copy. After this there is one.
- Add `isComposite` (rename of `isBundle`), `addIdToSlot`, `removeIdFromSlot`,
  `equippedSlotsEqual` to `lib/schemas/wardrobe.types.ts` (client-safe) and
  replace the ~20 inline `componentItemIds.length > 0` checks and the
  five inline slot edits. Split the pure slot math out of
  `outfit-displacement.ts` into `slot-ops.ts` so client bundles stop importing
  a module that imports the server logger.
- `breakApartBundleInSlots` uses direct components only; since 4.8.1 bundles
  dissolve transitively. Re-implement it as a single-bundle dissolve so the
  two agree, and mark `group-equipped.ts` / `bundle-mutations.ts` as the
  legacy whole-bundle-id path.

### Phase D. One route factory, four tiers

`mount-wardrobe-route-factory.ts` already owns the handler bodies for two
tiers. With Phase A's location it serves all four; move it to
`lib/wardrobe/routes/`.

- Config shrinks to `{ scope, paramsToId, logTag, logIdKey }`. The character
  tier adds `?scope=group` as an extra action and the archived-character 409.
- Differences to settle, each a one-line decision in the factory: cycle errors
  → 400 everywhere (character/General currently 500); existence check before
  `imageChoiceError` everywhere; the `userId` ownership check
  `resolveWardrobeLocation` performs becomes universal (the character routes
  don't check today).
- One `serializeWardrobeItem(item, origin, { wear })` so POST and PUT return
  the same shape as GET (origin and wear are missing from POST/PUT today, and
  the project POST alone returns the refreshed list, which
  `useProjectWardrobe` depends on; Phase F removes that consumer).
- The general and character route files become 10-line configs; about 540
  lines go.

### Phase E. Images and prompts

Wardrobe pictures already go through `generateImageWithConciergeFailover` and
`resolveWardrobeImageProfile`; the duplication is around them and shared with
the avatar and Lantern jobs.

- Pass `chatId` through `generateWardrobeItemImage` and resolve the Concierge
  policy against the chat (bug 189). Small, do it first.
- `lib/image-gen/image-attempt.ts`: `makeLoggedImageAttempt(...)` (the
  create-provider / build-params / generate / two-`logLLMCall` closure copied
  in four jobs) and `decodeProviderImage(response)` (the `images[0]` →
  base64 → `convertToWebP` → sha256 tail copied six times). Decide the log
  type here once so bug 196 closes.
- `lib/files/generated-file-row.ts`: `createGeneratedFileRow(...)` for the
  three near-identical "persist a generated image as a `files` row" blocks
  (avatar, preview-avatar, story-background); `addWardrobeItemImage` adopts it.
- `preview-avatar/route.ts` calls the provider by hand with no failover, its
  own profile pick, a hardcoded 1024×1792 and a `description` label bug 132
  removed elsewhere. Route it through the attempt helper and
  `resolveAvatarImageProfile` (new, in `profile-resolution.ts`, replacing the
  two hand-rolled avatar profile pickers).
- `lib/characters/physical-description.ts`: `pickPhysicalDescription(desc,
  profile)` for the seven ad-hoc variant choosers; move `avatar-prompt.ts` and
  `avatar-cache.ts` out of `lib/wardrobe/` (they are avatar concerns) and
  share the solo-figure intro and art-direction cap between the avatar and
  worn-item prompts.
- `wardrobe-image-bridge.ts` becomes a wrapper over `storeMountFile`
  (`collisionStrategy: 'unique-suffix'`) plus the host-RPC shim; its private
  random-suffix leaf exists only because `resolveUniqueRelativePath` doesn't
  reserve.
- Import-from-image: use the shared vision resolver and a `sendVisionRequest`
  split out of `describeImageWithProfile` (bug 197); upload the photograph
  once and link, not N+1 times.
- Viewer cleanup: `FullScreenImageViewer` takes an `onMissingCleanup`
  override; wardrobe passes its own `delete-image` action (bug 194).

### Phase F. Client

- `queryKeys.wardrobe.list(containerKey, { includeArchived })` and one
  `useWardrobeTier(container, opts)` query. Today no wardrobe list uses
  TanStack Query; five `useState`/`useEffect` loaders read overlapping
  endpoints with different tier sets, and `wardrobe.all` invalidation reaches
  only images and wear history. `useCharacterWardrobeItems` becomes N tier
  queries plus the server's merge rule (it currently lets an archived personal
  copy shadow a shared item, the opposite of `mergeWearablePool`); the editor's
  candidate list reuses it, which fixes bug 190 by giving it the group tier.
- Delete the unused ~70% of `use-outfit.ts` (its equip methods, cache,
  `expandSummaryComposites` copy of `expandComposites`) and the orphan
  `app/salon/[id]/hooks/useOutfit.ts`; what remains is a `useQuery` on
  `?action=outfit`.
- Decompose `wardrobe-control-dialog.tsx` (1881 lines) into hooks that already
  have pure cores: `useStagedLiveOutfits`, `useFittingRoom`,
  `useComposerHandlers` (shared with `outfit-selector.tsx`, which is a third
  copy of the six slot handlers), `useWardrobeItemActions`, and an
  `AvatarGenerationPane` file. Container, character, project, group and
  image-profile dropdown data move to existing query keys.
- `lib/wardrobe/item-draft.ts` (`emptyDraft`, `draftFromItem`, `validateDraft`
  via `wardrobeItemFieldsSchema`, `draftToPayload`) for the three form-state
  copies and six hand-built create bodies; `<SlotBadge>` and
  `<SlotCheckboxGroup>` for the four slot-checkbox and five slot-label
  spellings; `containerForListedItem(item)` that honours `origin` (the dialog
  has one origin-aware branch and four that assume General).
- Retire `ProjectWardrobeManager` / `useProjectWardrobe` (a feature-poor copy
  mounted only on the Prospero card) in favour of the shared browser on a
  project container.
- Add an `escapeCapture` option to `useClickOutside` and drop the four copied
  popover-dismissal blocks.

### Phase G. Naming and docs

- composite (code) / outfit (user-facing); "bundle" only for the legacy
  ≥2-slot card. `findArchetypes` → `readSharedTiers`. `*Project*` writers →
  `*Mount*`.
- Fix the stale comments: composites "stored as their own id" (they dissolve),
  `replace` "composite-only" vs honoured for leaves, cycle rejection "in the
  repository" (it's in the vault writer), `wearable-pool.ts` omitting groups.
- Add a CLAUDE.md chokepoint entry: locations via `resolveWardrobeLocation`,
  reads via `loadWearablePool`, outfit side effects via
  `outfit-change-effects`, never `ownerCharacterId` hints or a hand-walked tier.
- `help/wardrobe.md` only changes where behaviour changes (archive
  idempotency, archived items not wearable from the dialog, composite slots
  widening).

## 4. What goes away

Dead now (no production callers): `WardrobeRepository.unarchive`,
`findByCharacterIdRaw` (once `refresh-vault-wardrobe` is retired),
`dissolveBundlesInSlots`, `replaceItemIntoSlots`, `rebaseStagedSlots`,
`slotsCoveredBy`, `sortForDefaultOutfit`, `OUTFIT_LLM_TIMEOUT_MS`,
`isNeverWorn`, `sortWardrobeItems`, the `*_WEARER_LABEL` constants,
`OutfitSlotName`, `ResolvedSharedWardrobeTiers`, `SharedWardrobeTierOptions`,
`NO_ITEM_SENTINELS`, `emptyEquippedState`, the three `SharedWardrobeTiers`
aliases, `WardrobeOverlayOptions.defaultsOnly`, `include_presets` on
`wardrobe_list`, `WardrobeItemEditor.isShared`, `OutfitComposer.showBundleActions`,
`ProjectWardrobeManager.emptyMessage`, the default exports of
`wardrobe-image-viewer.tsx` and `OutfitSlotsPreview.tsx`, and
`app/salon/[id]/hooks/useOutfit.ts`.

Vestigial: `AbstractBaseRepository<'wardrobe_items'>` on a table that
`drop-wardrobe-items-table-v1` drops (`findAll` returns `[]`, so
`backup-service.ts:184` and `delete-service.ts:154` are no-ops; check both and
remove the calls); `move-shared-wardrobe-to-general.ts` running every boot
behind a flag.

Replaced by the phases: `project-wardrobe.ts`, `group-wardrobe.ts`,
`resolve-container.ts`, `ensure-group-store.ts`, the hand-rolled pool in
`apply-outfit-selections.ts`, the second expander in `outfit.ts`, the tier
switches in `item-images.ts` and transfers, ~540 lines of character/General
route files, `ProjectWardrobeManager.tsx`, `useProjectWardrobe.ts`, and most
of `use-outfit.ts`.

## 5. Risks and how to check

- **Phase B changes read semantics on purpose** (unresolved component refs
  survive parsing; outfit summary routes leaves by their own `types`). Both
  need a golden: a character composite with a group-tier part, read twice,
  must round-trip unchanged.
- **Phase A changes the repository's write API.** `restore/restore.ts:928`
  and the import writers call `createProjectWardrobeItem` directly; migrate
  them with the rename rather than leaving the old names as aliases.
- **The route factory's byte-for-byte contract** was deliberate when it was
  introduced; Phase D breaks it in three documented ways (400 on cycles,
  existence check order, ownership check). Note them in the changelog.
- **Client bundle size and server imports:** moving `isComposite` and the slot
  math into `wardrobe.types.ts` / `slot-ops.ts` must not pull `@/lib/logger`
  into the client. `npx tsc` won't catch it; a Storybook or `next build`
  smoke will.
- Tests to lean on: `__tests__/unit/lib/wardrobe/**`,
  `__tests__/unit/lib/tools/handlers/wardrobe-*`,
  `__tests__/unit/components/wardrobe/wardrobe-control-dialog.{race,worn-bundles}`,
  and the tool snapshot test (`wardrobe_list` loses `include_presets`, so
  `npx jest -u` on it).
