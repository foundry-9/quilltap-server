# Refactor 4.12 — One tier walk: reach, location and order settled once

**Status:** Done (2026-11-03), all five phases; §5.1 confirmed by the human as proposed. See §9 for what landed and where it departs from the plan. Proposed 2026-11-02. Part of the [4.12 refactor set](../refactor-4-12.md). The line savings are moderate (about 250–350 of roughly 1,200 tier-related lines); the reason to do it is that the sites disagree about what a character can reach, and two GET routes provision stores because of it.

## 1. The problem

Quilltap has one idea, stated in CLAUDE.md four times (wardrobe, inventory, scenarios, custom tools): a character reaches four tiers, **character vault > group stores > project stores > Quilltap General**, nearer shadowing farther. There is already a shared primitive for the forward walk, `resolveTieredMountPool` (`lib/mount-index/tiered-mount-pool.ts`, 474 lines), and this cycle's `resolveToolPresetPool` used it correctly. Around it, though, the cycle added more hand-rolled tier code (`lib/wardrobe/transfers.ts`'s `resolveSourceItem`, the document picker's `accessible-stores`, the shared `ItemFolderLocation`), and the survey behind this spec found the sites disagreeing on seven points:

| Question | Answers in the code today |
|---|---|
| What is the **project tier**? | All `projectDocMountLinks` (`tiered-mount-pool.ts`, both pools, the document picker). The project's **official store only** (`wardrobe/transfers.ts:177`, the client `use-character-wardrobe-items.ts:93-139`, `image-gen/aesthetic.ts:165`). Official ∪ links (`photo-albums.ts`, `self-inventory/builders.ts:972`). |
| **Whose groups** count? | The responding character's (`resolveTieredMountPool`, both pools). The **whole cast's** (`documents.ts handleAccessibleStores:264-343`, the Scenario Builder, `groups/scenarios/route.ts`, `state-cascade`). User-controlled participants only (`group-stores.ts`). None (`photo-albums.ts`). |
| **Order inside the group tier** on a collision? | Membership order, first group claims (`resolveGroupMountsForCharacter`). **Last mount wins** (the wardrobe pool, `wardrobe.repository.ts:62-90`). **Lexicographically smallest mount id wins** (`orderedMounts`, `wardrobe-instructions.ts:58-74`). Sorted by group name (several display sites). So wardrobe and custom tools disagree about which group wins. |
| Is the **project roster** applied? | Yes (`path-resolver`, search, the wardrobe pool from `chatId` unless `operator`). No (custom tools, presets, knowledge, the document picker, the inventory pool by design). |
| Is a disabled store or disabled General **checked**? | Yes (`resolveGeneralLibrary`, Prospero, `getAccessibleMountPoints`, the preset pool). No (`resolveTieredMountPool`, both pools, all three location resolvers). |
| Does a **read provision**? | Never, per CLAUDE.md. Except `wardrobe-route-factory.ts:321-323` (`ensure: scope !== 'character'` on the collection GET and `?action=instructions`) and `groups/scenarios/route.ts:73` (`ensure: true` on GET). |
| **Archived characters**? | Scenarios: null. Wardrobe and inventory: readable, write throws. Scenario Builder and `resolveSelfVaultMountPointId`: excluded. |

And six families of copy:

- **A. Owner → official store resolver.** `resolve()` in `lib/wardrobe/location.ts:193-246`, `lib/inventory/location.ts:214-262`, `lib/scenarios/location.ts:420-462`: the same `general / character / project-or-group` skeleton with `ensureOwnerOfficialStore`, differing only in the folder to ensure, whether a folder failure is swallowed or rethrown, and whether an archived character is refused. About 145 lines for what is one 45-line function with three parameters.
- **B. Group tier tagged with its group.** `groupLocationsForCharacter` (wardrobe `:253-265`, inventory `:268-280`, identical) and the origin maps in `wardrobe/pool.ts:283`, `inventory/pool.ts:253`, `wardrobe-route-factory.ts:299`.
- **C. Hand-written group loops** that re-implement `resolveGroupMountsForCharacter`: `core-whisper.ts:257-296` (with cross-group dedupe, sorted by name) and `self-inventory/builders.ts:154-187` (without dedupe).
- **D. Cast-union pools.** `scenario-builder/mount-pool.ts` (~75 lines, exists because the primitive's group tier is keyed on one character), the id-gathering half of `handleAccessibleStores` (~45), `group-stores.ts` (~15).
- **E. Pool → ordered probe list**, done five ways: `orderedMounts` (lexicographic), `wardrobe-instructions.ts` (lexicographic, own copy), `search-scriptorium buildKnowledgeTiers` and `knowledge-injector:152-164` (buckets with boosts; the injector also re-runs `dedupeTierTriple` on an already-deduped pool), `transfers.resolveSourceItem` (strongest-first probe with a different project tier).
- **F. Reverse classifiers** (mount → owner/tier): `scenarios/location.ts classify:475-504`, `inventory/dependents.ts mountOwnerResolver:117-149`, `inventory/title-lint-documents.ts locationForMount:49-70` (which calls every non-vault, non-General store `project`), plus `classifyMountTier` in the primitive.

## 2. Goal

Settle each of the seven questions once, in code: one `lib/mount-index/reach.ts` beside `tiered-mount-pool.ts` that owns the forward walk for one character *and* for a cast, the owner-to-store resolver, the within-tier order, the reverse classifier, and the `enabled` and roster gates as named options. Every site in families A–F calls it. The three `resolveXxxLocation` names stay as the addressing chokepoints CLAUDE.md names; they become thin wrappers.

## 3. Non-goals

- The read/shadow layers of the wardrobe and inventory pools (`readSharedTiers`, `loadPoolForLocation`'s "a shared tier sees itself plus General", the unread-mount tracking). Only their ~15 lines of tier gathering change.
- `scenario-selection.ts:173-205` (a field-precedence chain, project before group, deliberately), `photo-albums.ts` (no group tier, a default save target), `aesthetic.ts` (two tiers), and the instance-wide listers (`listAllEnabledStores`, `everywhere.collectOwners`, `workbench.surveyAttachments`, the Almanack's mount ownership). They are not reach walks.
- The client hook `useCharacterWardrobeItems`. Its project tier disagrees with the server (official store only vs all links); that is noted for the [browser-family spec](../refactor-4-12-browser-family.md), where the recommendation is to merge on the server as the Inventory already does.

## 4. Known state (verified 2026-11-02)

`resolveTieredMountPool(ctx, opts)` (`tiered-mount-pool.ts:310-410`): inputs `{userId, characterId, characterMountPointId, characterIds, projectId}`, options `requireOwnership`, `includeParticipants`; read-only, fails soft, no roster gate, no `enabled` check; returns `TieredMountPool {characterMountPointId, participantMountPointIds, groupMountPointIds, projectMountPointIds, globalMountPointId}` after `dedupeTierTriple` (`:118-161`, character > group > global, project dropped on any collision). Lines `:348-360` re-implement `resolveProjectMountPointIds` inline. Direct callers: `context-manager.ts:530`, `path-resolver.ts:371`, `search-scriptorium-handler.ts:176`, `custom-tools.ts:534`, `tool-preset-pool.ts:72`. `flattenTierPool:427-457`, `classifyMountTier:464-474`, `resolveGroupMountsForCharacter:237-268` (membership order, first group claims a shared mount), `resolveMountPointIdsForGroup:206-216`, `resolveProjectMountPointIds:169-181`.

`item-folder-location.ts` does not walk tiers; `locationKey` is `` `${scope}:${mountPointId}` `` (`:77`).

## 5. Design

### 5.1 Decisions of record (proposed; §8 asks the human to confirm each)

| Question | Rule |
|---|---|
| Project tier | **All linked stores**, official first. Everywhere. `transfers.resolveSourceItem`, `aesthetic.ts` and the wardrobe client hook change behaviour (they gain the linked stores). |
| Whose groups | A *character's* reach is the character's groups. A *cast's* reach (Scenario Builder, the document picker, `groups/scenarios`) is the union over the live cast, through one `resolveCastPool`. The operator picker is a cast surface and stays one. |
| Within-tier order | **Membership order; first group claims.** `orderedMounts` and `wardrobe-instructions` drop their lexicographic sort; the wardrobe pool's last-wins read is reversed to match. (This is the one rule that changes which garment wins a two-group collision; it is called out in the CHANGELOG and help.) |
| Roster | An explicit option, `roster: 'gated' | 'open'`; no implicit default. Each caller states it; today's behaviour is preserved per site except where it was an accident (none found). |
| `enabled` | An explicit option, `enabled: 'require' | 'ignore'`; same treatment. |
| Provisioning | `ensure` is the only way a store is created, and only writers pass it. The two GET routes are fixed (bugs to file). |
| Archived characters | A read resolves the vault (so archived items stay visible where they are today); a write through `writableMountPointId` throws, as now. Scenarios keep refusing, by option. |

### 5.2 The module

`lib/mount-index/reach.ts`:

- `resolveOwnerStore(scope, id, userId, { ensure?: { folder, onFolderFailure: 'swallow' | 'throw' }, archived: 'allow' | 'refuse' })` → `{ mountPointId, owner } | null`. Family A collapses onto it; the three `resolveXxxLocation` functions become wrappers that pass their folder and build their location type.
- `groupMountsFor(characterId)` → `Array<{ group, mountPointIds }>` (already `resolveGroupMountsForCharacter`; moved and the two hand loops in family C deleted) and `groupOriginMap(groups)` (family B, one copy).
- `resolveCastPool({ userId, projectId, characterIds, groupIds }, opts)` → `TieredMountPool` with the participant tier populated (family D; `scenario-builder/mount-pool.ts` becomes a call; `handleAccessibleStores` and `group-stores.ts` build their options from it).
- `orderMounts(pool)` → `Array<{ tier, mountPointId }>` in the settled order, and `bucketMounts(pool)` for the two knowledge consumers that need tiers with boosts (family E).
- `classifyMount(mountPointId, userId)` → `{ tier, scope, ownerId, archived? } | null` (family F; `scenarios.classify`, `mountOwnerResolver` and `locationForMount` become filters over it).
- `resolveTieredMountPool` stays as the forward walk, loses its inline project copy, and gains the `roster` and `enabled` options so callers stop applying them around it.

### 5.3 Chokepoint

A grep-test (`reach-chokepoint.test.ts`): outside `lib/mount-index/`, no call to `repos.groupCharacterMembers.findByCharacterId` followed by `officialMountPointId` or `groupDocMountLinks` (the signature of a hand group loop), and no `projectDocMountLinks.findByProjectId` except the listed display sites. A CLAUDE.md line: "What a character or a cast can reach is `lib/mount-index/reach.ts`; a tier is never walked by hand, a store is never resolved by `officialMountPointId` at a call site, and only a writer passes `ensure`."

## 6. Phases

1. **File and fix the two provisioning GETs** (small, independent).
2. **Family A** (owner resolver) and **B** (group origins): pure moves, no behaviour change; the three location suites pass unchanged.
3. **Family D** (cast pool) and the picker; **C** (hand loops). Behaviour-neutral except `self-inventory` gaining cross-group dedupe (a fix).
4. **Within-tier order** (family E) and the project-tier rule: the behaviour changes, each with a test that names the old and new winner, a CHANGELOG line and a help note in `help/wardrobe.md` and `help/custom-tools.md`.
5. **Family F**, options for roster/enabled, the chokepoint test, CLAUDE.md.

## 7. Verification

Unit suites for the five location/pool modules, `tool-preset-pool.test.ts`, `item-folder-location.test.ts`, the scenario-builder mount-pool test, `documents/route.test.ts`, plus new tests per family. Live on V4test: a character in two groups whose stores both hold a garment of the same id (which wins, before and after Phase 4); a project with a linked store holding a wardrobe item transferred from a character (gains reach after Phase 4).

## 8. Decisions needed from the human

Each row of §5.1, especially the within-tier order (membership-first is the primitive's rule and the one CLAUDE.md implies; lexicographic is what custom tools do today) and the project-tier rule (all links vs official only; all links is what the pools and the picker already do).

## 9. Outcome (2026-11-03)

The human confirmed every row of §5.1 as proposed (membership-order within a tier; all linked project stores, official first; filing the two bugs).

- **Phase 1.** Filed #135 (wardrobe collection GET and `?action=instructions` GET) and #136 (the cast scenario GET and the per-owner scenario collection GET, which also provisioned). Both fixed: reads pass no `ensure`; an owner with no store answers empty.
- **Phase 2.** `lib/mount-index/reach.ts` holds `resolveOwnerStore` (family A; the three `resolveXxxLocation` functions are wrappers passing their folder, `onFolderFailure` and `archived`), `groupMountsFor` / `groupOriginMap` (family B; the pools, the route factory's `?scope=group` and both `groupLocationsForCharacter` use them). `groupMountsFor` is `resolveGroupMountsForCharacter` re-exported, not moved, so the forward walk and reach share one definition without an import cycle; it gained `includeEmpty`.
- **Phase 3.** `resolveCastPool` / `castGroupMounts` (family D): `resolveScenarioBuilderMountPool` is a one-line wrapper, the document picker walks the cast pool, `group-stores` and `groups/scenarios` use the group half. Family C: `core-whisper` and `self-inventory` call `groupMountsFor` (self-inventory gains cross-group dedupe; it keeps groups with no stores via `includeEmpty`, as it lists membership).
- **Phase 4.** `orderMounts` / `bucketMounts` (family E). `resolveProjectMountPointIds` is official-first then every link, and `resolveTieredMountPool` uses it instead of its inline copy. Custom tools, presets and dressing instructions drop the lexicographic sort; the wardrobe and inventory pools (and the `?scope=group` read) read each tier reversed so the earlier mount wins; the transfer probe walks groups strongest-first and every project store. Tests name the old and new winner in `pool.test.ts`, `inventory/pool-order.test.ts`, `wardrobe-instructions.test.ts`, `custom-tools-discovery.test.ts` and the transfer route test.
- **Phase 5.** `classifyMount` (family F): `scenarios.classify`, `mountOwnerResolver` and the title lint's `locationForMount` filter over it (the title lint now tags an official group store `group`, with its id, rather than `project` / `null`). `resolveTieredMountPool` takes required `roster: 'gated' | 'open'` and `enabled: 'require' | 'ignore'`; the path resolver and the scriptorium search pass `gated` instead of gating around the call, the preset pool passes `require` instead of checking each mount. Grep-test `reach-chokepoint.test.ts`; CLAUDE.md line added.

**Departures.**

- `image-gen/aesthetic.ts` was left on the official store only. §5.1 listed it among the sites that gain linked stores, but §3 lists it as a non-goal ("two tiers"), and its editors write only the official store, so a linked store's file would take effect while being invisible to the editor.
- The roster stays applied inside the wardrobe pool (`resolveProjectTierForChat`) and the inventory roster gate; those are the pools' own read layers (§3), not `resolveTieredMountPool` callers.
- The chokepoint test does not try to catch every `officialMountPointId` read at a call site — there are many legitimate ones (heal passes, display) — only the two signatures in §5.3.
