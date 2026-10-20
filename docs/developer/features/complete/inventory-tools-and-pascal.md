# Feature: Inventory tools and Pascal inventory support — characters and custom tools reach the bag

**Status:** Approved 2026-10-18 (decisions in §2 settled with the operator). **Built 2026-10-18** — see *As built* at the end. **Depends on [inventory.md](inventory.md)** being built first: everything here is a caller of that spec's chokepoints (`equipItems`, `unequipItems`, `instantiate`, `createItem`, `updateItem`, `setItemArchived`, `loadInventoryPool`, `resolveItem`, `readEquippedSet`, `notifyInventoryChanged`).
**Owner subsystem:** Pascal the Croupier — the `inventory_*` tool family a character calls, and the `inventory` subject, operand, placeholders and effect a custom tool uses. Prospero (tool plumbing) and the Workbench are party to it.
**Companion designs:** [pascal-custom-tools.md](pascal-custom-tools.md) (`when`, templating, `$state`, gates, roster), [pascal-custom-tool-enhancements.md](pascal-custom-tool-enhancements.md) §F3 (effects), [pascal-wardrobe-effects.md](pascal-wardrobe-effects.md) and [pascal-wardrobe-effect-picker.md](pascal-wardrobe-effect-picker.md) (the gesture effect and its Workbench picker, which this spec mirrors), and the nine `wardrobe_*` tools (the family this spec mirrors). Read them before building; this document describes only the delta.
**Implementation note:** Written to be executed by Claude Code. Follow the CLAUDE.md standing rules throughout: tool definitions with a Zod input schema as the single source of truth (`xxxToolInputSchema`, `zodToOpenAISchema`, one-line `validateXxxInput`), registered in the snapshot test and re-recorded with `npx jest -u`; changelog in plain voice; help docs with `url` + In-Chat Navigation; debug logging on every touched backend path; the Pascal doctrine that the execution core writes nothing and the applier never throws; `npx tsc` not `npm run build`. The decisions in §2 are settled. **Do not reopen them**; if one proves unworkable, stop and say so.

---

## 1. The feature in one paragraph

[inventory.md](inventory.md) gives the operator an Inventory; this spec hands it to the game. A character gains nine `inventory_*` tools, gated by a new `canManageInventory` flag, to see what they carry and can reach, read one object, equip and unequip, pick up an instance of a reachable archetype, make a new object of their own, amend or archive one of their own, and give one of their own to another participant. A Pascal custom tool gains the same reach from the author's side: a `when` row or an availability gate may ask whether an object is *equipped*, *carried* or *absent*, or how many kin are equipped; a message or effect may quote an object's fields; a roll may draw a die from an object's `metadata`; and an effect may equip, unequip or pick up objects for the rolling character, fail-soft per item, through the chokepoints the operator's dialog already uses. The Workbench learns the new effect kind with the wardrobe picker's chip, and the Proving Bench a mock inventory so an author can prove a gate without a character.

## 2. Decisions of record

Settled with the operator on 2026-10-18 ("that all sounds good, go with that"). Every row was the spec author's recommendation, accepted.

| Question | Decision |
|---|---|
| The tool family | `inventory_list`, `inventory_read`, `inventory_equip`, `inventory_unequip`, `inventory_pick_up` (instantiate a reachable archetype into my own vault, optionally equipping), `inventory_create` (a new standalone object in my own vault), `inventory_update` (my own objects only), `inventory_archive` (my own objects only), `inventory_give`. **Not offered to characters:** delete, detach, forced archetype delete, kit authoring, folder operations, tier transfers, `canCopy`-governed copies. |
| Giving | `inventory_give` ships now: move an object from my vault to another participant's vault and drop it from my equipped set in this chat. Own-vault objects only, never shared-tier ones; a give is a move so `canCopy` never applies; refused toward an archived character or a non-participant; the receiver's equipped set is untouched. The one tool that writes to another character's vault. |
| Gating | A new per-character flag **`canManageInventory`**, default on (null reads as on, as `canDressThemselves` does), gating the whole family, reads included, mirrored everywhere `canDressThemselves` is. Brahma and the Scenario Builder set the family off. |
| Announcements | One Pascal announcement per turn collapsing the model's `inventory_*` calls and any Pascal inventory effect in that turn, through a pending set threaded exactly as `pendingWardrobeAnnouncements` is; outside a turn the announcement posts at once. |
| Containment in `when` | A new **`inventory` subject** keyed by object reference whose value is one of four states: `equipped` (in the rolling character's equipped set for this chat), `carried` (in the character's **own** vault, not equipped), `reachable` (in a group, project or General store, not equipped) and `absent`. Tested with `eq` / `neq` only. Reference resolution id → title → name, case-insensitive; several matches resolve to the best state (`equipped` > `carried` > `reachable` > `absent`). A reference is a template (`{{params.weapon}}`) in an outcome or effect `when`; **a gate key may not carry a placeholder** (§5.4). *Review note:* the first draft had a state whose `carried` covered every shared object a character could reach, so a lantern in the project store was "carried" by the whole cast; the own-tier `carried` and the shared-tier `reachable` are now distinct. |
| Counting | A new numeric **`inventoryCount` subject** keyed by reference: the number of **equipped** kin (same resolved name) for the rolling character in this chat. Ordering comparators and `eq` / `neq`; `$param` and `$state` operands allowed as elsewhere. |
| Gates | `availableWhen` / `withheldWhen` accept `inventory` and `inventoryCount` beside `metadata` and `progress`. Resolved lazily at roster time: the pool and the chat's equipped set are read only when a gated definition names either subject. Operands are literals, as the gate rule already says. |
| Reading an object | **Placeholders** `{{inventory.<ref>.title}}`, `.name`, `.description`, `.state`, `.metadata.<key>` in messages, the `llm` prompt and effect templates. **Operand** `{ "$inventory": "<ref>.metadata.<key>", "fallback": <literal> }` wherever `$state` is allowed (roll fields, comparator operands, parameter defaults), typed by its fallback, so a sword's `metadata.damage` of `"2d6"` can be the roll itself. |
| Effects | `effects[].inventory`, a gesture mirroring `effects[].wardrobe`: `{ "action": "equip" \| "unequip" \| "pick_up", "items": [refs], "equip"?: boolean }`. Items by reference (templates), kits allowed for `equip` / `unequip`, fail-soft per item, applied to the rolling character in the current chat. `pick_up` names archetypes and instantiates into the rolling character's vault root, equipping when `equip: true` (default `true`). `give`, `archive` and `create` stay out of effects. |
| Workbench | The Side effects card's Kind select gains **Change the inventory**; the item row is the wardrobe picker's reference chip over an inventory picker (the same vantage selector). The Proving Bench gains **Mock inventory**, a list of `{ ref, state }` rows beside Mock metadata and Mock state, so `when` rows and gates on `inventory` / `inventoryCount` can be proved without a character. |
| Smaller defaults | A character-created or picked-up object lands at its vault root. A new `inventory` row in `REALTIME_TOPICS`, mapped to `queryKeys.inventory.lists` and `folderLists`, published from the parent chokepoints for a job-child file write. Audit entries in `pascalMeta.effects` use targets `inventory.equip`, `inventory.unequip`, `inventory.pick_up`; no schema or migration change. The existing `self_inventory` tool keeps its name; the help disambiguates in one sentence. |

## 3. Vocabulary

As [inventory.md §3](inventory.md#3-vocabulary), plus:

- **Reference** (`ref`) — a string naming one object: its id, else its title, else its name, case-insensitive, after template rendering. The one resolution rule, `resolveInventoryRef` (§5.1).
- **State** — `equipped` (in the rolling character's equipped set for this chat), `carried` (in their own vault, not equipped), `reachable` (in a shared tier, not equipped), `absent` (no match). A **null context** (a run nobody made, or a vault that could not be read) is none of these: every `inventory` and `inventoryCount` comparator simply declines (§5.3).
- **Rolling character** — the character a custom tool ran *as*; the one whose pool, equipped set and vault every inventory read and write here uses. A run nobody made (the composer popup without `asCharacterId`) reads `absent` everywhere and applies no gesture.

## 4. What already exists (read before building)

- **Wardrobe tool family, the template for §5.2:** definitions `lib/tools/wardrobe-{list,read,wear,take-off,create,update,archive,rollback,history}-tool.ts`, handlers `lib/tools/handlers/wardrobe-*-handler.ts` with `wardrobe-handler-shared.ts` (`loadToolPool`, `finalizeWardrobeMutation`, `formatWardrobeMutationResults`, `buildWardrobeMutationFailure`, `sharedWardrobeItemReadOnlyMessage`) and `wardrobe-tool-table.ts`. Registration sites, every one of which a new family must touch: `lib/tools/index.ts`, `lib/tools/plugin-tool-builder.ts:241–258` (per-tool enable flags), `lib/chat/tool-executor.ts` (name list ~:248 and table), `app/api/v1/tools/route.ts`, `lib/tools/simple-json-parser.ts` / `simple-json-prompt.ts`, `lib/tools/legacy/text-block-parser.ts` / `text-block-prompt.ts`, `lib/services/chat-message/orchestrator.service.ts:986, 1077` (the flag read and the enable pass), `streaming.service.ts`, `components/chat/ToolMessage.tsx` (the Salon bubble), and `lib/tools/__tests__/tool-definitions-snapshot.test.ts`.
- **The flag:** `canDressThemselves` (`lib/schemas/character.types.ts:226`, nullable boolean, null = on), read at `orchestrator.service.ts:986`; documented in `help/wardrobe.md:297`.
- **Announcement threading:** `pendingWardrobeAnnouncements` on the tool context (`tool-executor.ts:188`), the turn containers (`lib/wardrobe/turn-containers.ts`, `newWardrobeTurnContainers()`, held by a grep-test), `notifyWardrobeChanged` / `flushPendingWardrobeAnnouncements` (`lib/wardrobe/outfit-change-effects.ts`).
- **Pascal core (`lib/pascal/custom-tools.ts`):** `RosterContext` (:145), `loadInvokerMetadata` (:363, the lazy sheet read the gate uses), `resolveCustomToolRoster` (:388), `resolveStateValue` (:97, the `$state` operand), `resolveParams` (:638), `OutcomeSubjects` (:795), `MetadataTested` (:836), `matchesWhen` (:1058), `EffectSubjects` / `matchesEffectWhen` (:1109, :1127), `ResolvedEffect` / `ResolvedWardrobeGesture` (:1149, :1155), the three `isApplicable*Effect` predicates (:1164–1178). The module header's contract: no writes, no message posting.
- **Comparison table:** `lib/pascal/metadata-match.ts` (client-safe; `compareOrdered`, `metadataComparatorHolds`), wrapped by `matchesMetadataComparator` (roll time) and `evaluateToolGate` (`lib/pascal/tool-gate.ts:62`, roster time).
- **Placeholders:** `lib/pascal/placeholders.ts` (`PlaceholderRef`, `classifyPlaceholder` :46, `scanPlaceholders` :94); rendering in `renderTemplate` (`custom-tools.ts`).
- **Expressions and operands:** `lib/pascal/expressions.ts`; `$param` / `$state` references, `resolveOperandType`, `validateRollRefs`, the parameter-default `superRefine` (`custom-tool.types.ts`).
- **Effects:** `CustomToolEffectSchema` with the `wardrobe` member and `isWriteEffect` / `isWardrobeEffect` (`custom-tool.types.ts`); applier `lib/pascal/side-effects.ts` (`AppliedEffect` :93, `applyCustomToolEffects` :147, which partitions writes then gestures); `lib/pascal/wardrobe-effects.ts` (`applyWardrobeEffects`, the model for §5.6); entrances `lib/tools/handlers/run-custom-handler.ts`, `app/api/v1/chats/[id]/custom-tools/route.ts`, `app/api/v1/custom-tools/route.ts` (preview / audit).
- **Roster description and vocabulary:** `lib/tools/run-custom-tool.ts` (`RUN_CUSTOM_PREAMBLE`, the per-tool `Side effects:` line), `lib/pascal/tool-vocabulary.ts` (`ToolVocabulary` :35, `isEmptyVocabulary` :101, `collectToolVocabulary` :127), `components/chat/CustomToolRunDialog.tsx` (`CustomToolReferences`).
- **Workbench:** `lib/pascal/tool-draft.ts` (`ConditionSubject` :131, `DraftCondition` :156, `DraftGateCondition` :185, `DraftEffect` :206, `DraftWardrobeGesture` :229), `components/custom-tools/{SideEffectsSection,OutcomesSection,GateSection,ProvingBench,WardrobeVantageSelect}.tsx` and `comparator-labels.ts`, the picker design ([pascal-wardrobe-effect-picker.md](pascal-wardrobe-effect-picker.md) §1 vantage, §2 client-side reference resolution, §3 chip), `lib/pascal/bench-wardrobe.ts` (the bench's wardrobe lens).
- **Published schema and corpus:** `public/schemas/qtap-custom-tool.schema.json`, `docs/developer/CUSTOM_TOOL_SPEC.json`, agreement test `__tests__/unit/lib/pascal/custom-tool-definition.test.ts`.
- **Realtime:** `REALTIME_TOPICS` (`lib/schemas/realtime.types.ts:26`), `lib/realtime/topic-map.ts` (the chat row :72–80), `topicsForCompletedJob` and `dispatchInvalidations` (parent-side, for a child's file writes).
- **From inventory.md, consumed here:** `loadInventoryPool` / `loadCastInventoryPools`, `resolveItem` / `resolvedPool` / `kinOf`, `readEquippedSet` / `kitState`, `equipItems` / `unequipItems` (`InventoryChangeContext { provenance, announce }`), `applyInventoryDefaults`, `instantiate`, `createItem`, `updateItem`, `setItemArchived`, `notifyInventoryChanged`, `ChatsRepository.setEquippedInventory` (buffered `set*` write in the job child), `queryKeys.inventory.*`, the `409` codes.

## 5. Design

### 5.1 One reference resolver — `lib/inventory/refs.ts`

```ts
export type InventoryState = 'equipped' | 'carried' | 'reachable' | 'absent';
export interface InventoryRefMatch { item: ResolvedInventoryItem; equipped: boolean }

/** id → title → name, case-insensitive, over the resolved pool; archetypes and archived excluded unless asked. */
export function resolveInventoryRef(ref: string, pool: ResolvedInventoryPool, equippedIds: ReadonlySet<string>, opts?: { includeArchetypes?: boolean }): InventoryRefMatch[];
/** The best state among the matches: equipped > carried > reachable > absent. */
export function stateOf(matches: InventoryRefMatch[]): InventoryState;
/** Equipped kin of the first match's resolved name. */
export function equippedKinCount(ref: string, pool, equippedIds): number;
/** For a gesture: the match to act on — first equipped one for unequip, first unequipped one for equip, own tier before shared. */
export function pickForGesture(matches: InventoryRefMatch[], action: 'equip' | 'unequip'): InventoryRefMatch | null;
```

Pure and client-safe (the Workbench runs it against the mock inventory). Every tool handler, the `when` subject, the gate, the placeholders, the operand and the effect call it; **nothing else re-derives id-or-title-or-name**. A `ref` that resolves to nothing is `absent`, never an error.

`lib/inventory/context.ts`: `loadInventoryContext(characterId, chatId): Promise<InventoryContext>` — the pool, its resolved form and the character's equipped set for this chat, loaded **once per tool call or per run** and handed to everything in §5.2–5.6. In the job child the equipped set reads through the per-job overlay the buffered `setEquippedInventory` writes into, so two gestures in one run see each other; verify the overlay exists for this column as it does for `equippedOutfit` ([BACKGROUND_JOBS_CHILD.md](../../BACKGROUND_JOBS_CHILD.md) §"Batched writes and read-your-writes") and add it if not.

### 5.2 The tool family

Each tool: `lib/tools/inventory-<verb>-tool.ts` (schema, `parameters`, one-line validator, description) and `lib/tools/handlers/inventory-<verb>-handler.ts`, with `inventory-handler-shared.ts` (`loadInventoryContext` wrapper, result formatting, failure envelope, the read-only message for shared objects) and `inventory-tool-table.ts` mirroring the wardrobe's. Every mutation returns the object's resolved summary (`id`, `name`, `title`, `state`, `tier`) so the model can chain calls without a list.

| Tool | Input (Zod) | Behaviour |
|---|---|---|
| `inventory_list` | `equipped?: boolean`, `kind?: 'item' \| 'kit' \| 'archetype'`, `folder?: string`, `tier?: 'own' \| 'group' \| 'project' \| 'general'`, `include_archived?: boolean` (own only) | The resolved pool filtered, each row `id`, `name`, `title`, `state`, `kind`, `tier`, `folder`, `is_own`, a one-line `description` excerpt; kits carry their `all/some/none`; archetypes are listed as *pick-up-able* with no state. Shared rows carry the `[shared — read-only]` tag the wardrobe uses. |
| `inventory_read` | `ref: string` | The resolved object in full: both descriptions, `metadata`, `parentId` and the archetype's title, `maxEquipped`, `canCopy`, kit members with states, pictures' presence (never bytes). |
| `inventory_equip` | `refs: string[]` (1–8) | `equipItems` with `{ provenance: 'character', announce: true }`, through the pending set. Returns equipped / created / skipped / alreadyEquipped and renders the `409`s (`CAP_EXCEEDED`, `NOT_EQUIPPABLE`) as tool failures in their own words. |
| `inventory_unequip` | `refs: string[]` (1–8) | `unequipItems`; kits expand; never fails on state. |
| `inventory_pick_up` | `ref: string` (an archetype), `title?: string`, `equip?: boolean` (default true) | Plans before it writes: when `equip`, the cap is checked first against the archetype's resolved `name` (the instance will carry it) — `equippedKinCount(name) + 1 ≤ maxEquipped` — and a breach fails the call with the cap's wording and **creates nothing**. Then `instantiate` into the own vault root with `overrides: { title }`, then `equipItems` on the new id. Refuses a non-archetype (`INVALID_PARENT`'s wording). |
| `inventory_create` | `name`, `title?`, `description?`, `image_description?`, `emoji?`, `max_equipped?`, `metadata?: Record<string, primitive>`, `equip?: boolean` | `createItem` at the own vault root: never an archetype, never a kit, never `canCopy: true`, no `svg`. Then `equipItems` when `equip`. |
| `inventory_update` | `ref`, the same optional fields as create minus `equip` | Own objects only (`pool.owns`), else the read-only message. Cannot touch `isArchetype`, `parentId`, `itemIds`, `canCopy`, `svg`, `imageFileId`. On an instance the patch is an override. |
| `inventory_archive` | `ref`, `archived: boolean` | Own objects only; `setItemArchived`; an archived object leaves every chat's resolved set on read. |
| `inventory_give` | `ref`, `to: string` (participant name or id) | Own, non-archived, non-kit object; receiver a live, non-archived participant of this chat other than me. Order matters because the id is kept on a move and a pool-resolved unequip would no longer see the object: **first** the file moves through the transfers path (`move`, id kept, folder kept) from my location to theirs; **then** the id is dropped from the giver's entry in **every** chat, not only this one, each chat under its carried-set lock (`dropCarriedEverywhere`, as built — see *Review fixes*) — otherwise a later give-back, id kept again, would reappear as equipped in each chat that still listed it; **then** one Pascal line of its own through `notifyInventoryChanged` (*"Vivienne hands the lantern to Marcus."*). The receiver's sets are untouched; they equip it themselves. |

Gating: `canManageInventory` on the character — a real `characters` column like `canDressThemselves` (`migrations/scripts/add-character-wardrobe-flags.ts`): migration `add-character-inventory-flag-v1` (`ALTER TABLE characters ADD COLUMN canManageInventory INTEGER DEFAULT NULL`, a `PRETTY_LABELS` entry, no loop), a `DDL.md` row, `CharacterSchema` (nullable boolean beside `canDressThemselves`), `qtap-export.schema.json` and the `.qtap` character writer and importer, the character archive bundle and backup restore (whole-row, nothing to add beyond the schema), and the Aurora character editor's toggle beside *Can dress themselves* with the same hint shape. Read once beside `canDressThemselves` at `orchestrator.service.ts:986` and threaded as `canManageInventory` to the plugin tool builder's nine new per-tool flags. The Scenario Builder and both Brahma surfaces set them off. The simple-JSON and legacy text-block prompts and parsers get aliases (`equip_item`, `unequip_item`, `pick_up`, `list_inventory`; `[[EQUIP_ITEM]]`, `[[UNEQUIP_ITEM]]`) in the wardrobe's pattern; the Salon tool bubble gets one line per tool (*"Equipped Excalibur."*, *"Picked up a magic bow."*, *"Handed the lantern to Marcus."*).

Announcement threading: `WardrobeTurnContainers` grows a `pendingInventoryAnnouncements: Set<string>` (keyed `chatId:characterId`) created by the same `newWardrobeTurnContainers()` factory — rename nothing, the grep-test keeps holding — and `notifyInventoryChanged` records into it inside a turn and posts from `flushPendingWardrobeAnnouncements`' sibling `flushPendingInventoryAnnouncements`, called at the same point. One Pascal `inventory-change` message per character per turn naming everything equipped, unequipped and picked up.

### 5.3 The `inventory` and `inventoryCount` subjects

`custom-tool.types.ts`:

- `When` gains `inventory?: Record<string, { eq?: InventoryStateOrParam; neq?: InventoryStateOrParam }>` (a `z.strictObject`; the operand is one of the four literals or `{ "$param": "<string param>" }`) and `inventoryCount?: Record<string, OrderedComparators>` (the `roll` subject's comparator shape plus `eq` / `neq`, operands literal number, `$param` number or `$state` with a numeric fallback). Keys are references, `min(1).max(200)`, scanned with `scanPlaceholders` for `{{params.x}}` validity as item strings in a wardrobe gesture are.
- Load-time rules: `inventory` takes `eq` / `neq` only (an ordering key is a rejection); `inventoryCount` takes no `contains`. A `$param` operand on `inventory` must be a string parameter; on `inventoryCount` a number. Issue paths `outcomes.N.when.inventory.<ref>.eq` etc.; `formatDefinitionIssues` needs tests only.
- `OutcomeSubjects` gains `inventory?: InventoryContext | null` (the §5.1 context; `null` for a run nobody made). `matchesWhen` resolves each key's reference (rendered through the run's template subjects first — the key is a template) and compares the state, or `equippedKinCount`, with the one comparison table in `metadata-match.ts` (string `eq` / `neq` for the state; `compareOrdered` for counts). **Fail-soft like `metadata`, and in the same direction:** a null context is a *missing subject*, not a value — every `inventory` and `inventoryCount` comparator **declines** (false), including `eq: "absent"`, `neq`, and `lt: 1`, exactly as `metadataComparatorHolds` declines every comparator on a missing key. Only a real context ever yields `absent` or `0`. So an `availableWhen` on either subject is closed and a `withheldWhen` is not satisfied for a run nobody made or a vault that could not be read. Debug-log the resolution per key.
- `EffectSubjects` inherits both, so an effect's `when` may test them.
- Published schema: `$defs/When` gains the two members with `additionalProperties` of the two comparator defs; `CUSTOM_TOOL_SPEC.json` gains one row of each; the agreement corpus gains a valid `inventory` row, an `inventory` with `gt` (rejected), an `inventoryCount` with `contains` (rejected), an `inventory` `$param` to a number parameter (rejected).

### 5.4 Gates

`tool-gate.ts`: `evaluateToolGate` accepts `inventory` and `inventoryCount` beside `metadata` and `progress`, operands literal only (a `$param` or `$state` there is the existing load-time rejection, extended to the new subjects), **and keys literal only**: a gate key carrying any `{{…}}` placeholder is a load-time rejection (`availableWhen.inventory.<key>`), because a gate is answered at roster time when no parameters exist and the literal string would otherwise resolve to `absent` for ever. Outcome and effect `when` keys stay templates. `RosterContext` gains `inventory?: InventoryContext | null` and `chatId?: string`; `resolveCustomToolRoster` loads it lazily, once, **only when a gated definition names either subject** (the `loadInvokerMetadata` pattern), with `{ characterId, chatId }` from the context; a context without a chat (the Workbench library listing) or a vault that cannot be read degrades to `null`, and a null context declines every inventory comparator (§5.3) — so `availableWhen` stays closed and `withheldWhen` stays unsatisfied, the same reading `tool-gate.ts` gives a missing metadata key. The popup's per-perspective roster passes each participant's `characterId` with the chat.

### 5.5 Reading an object: placeholders and the operand

- `placeholders.ts`: `PlaceholderRef` gains `{ kind: 'inventory'; ref: string; field: 'title' | 'name' | 'description' | 'state' | 'metadata'; key?: string }`. One parsing rule, checked in this order: **(1)** if the remainder contains `.metadata.`, the **first** occurrence splits it — everything before is the ref, everything after is the metadata key (so `inventory.sword.metadata.state` is key `state` on `sword`, and `inventory.sword.metadata.name` key `name`); a ref therefore may not contain `.metadata.`, and the Workbench warns on one. **(2)** otherwise, the remainder must end in `.title` / `.name` / `.description` / `.state`, the trailing field is taken and the rest is the ref (a ref may still contain other dots). Anything else is `unknown`. Tests cover `sword.metadata.state`, `sword.metadata.name`, `old.sword.title`, `sword.metadata` (unknown) and `sword` (unknown).
- `renderTemplate`: `state` renders the state; `title` renders the title or, absent one, the name (so a message can always say *the sword*); `description` the narrative one (never `imageDescription`); `metadata.<key>` a primitive or verbatim with a debug log. An `absent` ref renders every field but `state` verbatim, with a debug log — the `{{metadata.*}}` doctrine.
- `custom-tool.types.ts`: `InventoryRef = { "$inventory": "<ref>.metadata.<key>", "fallback": number | string | boolean }`, a `z.strictObject`, accepted wherever `StateRef` is (roll fields, comparator operands, parameter defaults) and typed by its fallback through `resolveOperandType` / `validateRollRefs` / the parameter-default `superRefine`. Only `metadata.<key>` is addressable by the operand (a title is never a number to roll against); the string splits at the **first** `.metadata.`, the same rule as the placeholder's, and a value with none is a load-time rejection. `resolveInventoryValue(ref, ctx)` (pure, never throws) returns the value only when `typeof` matches the fallback, else the fallback; the dice form accepts a string fallback like `"1d6"` and parses the resolved string through the shared dice module at run time, a parse failure falling back as well (debug log). A `$inventory` reference is rejected in a gate like `$state` is.
- Published schema: `$defs/InventoryRef` beside `StateRef`; every `oneOf` that lists `StateRef` lists it; corpus entries for a roll drawn from `$inventory` and for an `$inventory` in a gate (rejected).

### 5.6 The `inventory` effect

`custom-tool.types.ts`:

```ts
export const InventoryEffectActionSchema = z.enum(['equip', 'unequip', 'pick_up']);
export const CustomToolInventoryGestureSchema = z.strictObject({
  action: InventoryEffectActionSchema,
  items: z.array(z.string().min(1).max(200)).min(1).max(8),   // refs; templates
  equip: z.boolean().optional(),                               // pick_up only; default true
});
```

`CustomToolEffectSchema` gains `inventory?`; the `superRefine` becomes "exactly one of write / wardrobe / inventory". `isInventoryEffect` / `CustomToolInventoryEffect` beside the existing narrowers. Load-time: `equip` only on `pick_up`; items scanned for `{{params.x}}` validity. `MAX_EFFECTS` unchanged, counting all three kinds.

Core (`custom-tools.ts`): `ResolvedEffect` gains `{ index; inventory: ResolvedInventoryGesture }` (rendered, trimmed refs; a gesture whose refs all rendered empty is skipped with that reason); `isApplicableInventoryEffect`; `isApplicableEffect` is the union of three. `simulateOutcomes` still ignores effects.

Applier, new `lib/pascal/inventory-effects.ts` (the §3 shape of `pascal-wardrobe-effects.md`, normative):

1. **No character, no gesture.** `characterId === null` → `[]` after one debug log.
2. **One context per run** (`loadInventoryContext`); unloadable → warn, `[]`.
3. **Gestures in file order, items in list order:** `equip` → `resolveInventoryRef` with archetypes excluded, `pickForGesture(…, 'equip')`, collect; `unequip` likewise; `pick_up` → `resolveInventoryRef` with `includeArchetypes: true`, keep archetype matches only. Then **one** `equipItems` / `unequipItems` call per gesture with `{ provenance: 'pascal', announce: true }` and the pending set, and for `pick_up` the cap is checked **before** anything is written (`equippedKinCount(archetype.name) + planned ≤ maxEquipped`, when `equip !== false`), then one `instantiate` per archetype followed by one `equipItems` over the new ids. A cap breach fails **that gesture** before any write (the equip chokepoint is atomic, and `pick_up` plans ahead of its instantiations so no instance lands unequipped) and the applier records it as skipped with the `409`'s message, then continues with the next gesture — fail-soft per gesture, never per run. Every unresolved item is skipped with a debug log.
4. **Sequential, and safe in the job child** through the §5.1 overlay.
5. **Audit entries**, one per landed object: `{ target: 'inventory.equip' | 'inventory.unequip' | 'inventory.pick_up', previous: <equipped ids before>, next: { item: { id, title }, created?: boolean, equipped: <ids after> } }`. `AppliedEffect` already types `previous` / `next` as `unknown`; the `pascalMeta.effects` schema, export schema and DDL prose need only the three new target spellings mentioned.
6. **Never throws.**

`applyCustomToolEffects` partitions three ways and runs writes, then wardrobe gestures, then inventory gestures, merging the applied lists back by `index`. The order exists so the three appliers' store reads never interleave (the `side-effects.ts` header's rule); it is **not** visibility — every effect's `when` was already decided by the pure core in `resolveEffects` before any applier ran, so no write is ever visible to a later effect's `when` in the same run. Entrances pass `pendingInventoryAnnouncements` beside the wardrobe set (`RunCustomToolContext`, the executor's `run_custom` site, the manual route with no set).

### 5.7 What the model and the operator are told

- `RUN_CUSTOM_PREAMBLE`: the side-effects sentence gains "or what they carry". Snapshot re-recorded; description text only.
- Per tool under `revealOdds !== false`: `Side effects:` gains `equips X, Y`, `unequips X`, `picks up X`; a `Reads:` clause names inventory references appearing in `when`, gates, placeholders and operands (vocabulary, not odds).
- `ToolVocabulary` gains `inventoryReads: string[]` (refs tested or quoted), `equips`, `unequips`, `picksUp` (refs), sorted, verbatim; `isEmptyVocabulary` updated; `CustomToolReferences` and the run dialog's reference panel gain the matching lines ("may equip", "may unequip", "may pick up", "reads the inventory for").

### 5.8 Workbench

- `tool-draft.ts`: `ConditionSubject` gains `inventory` and `inventoryCount` (with the ref as the "key" the condition row already has for `metadata`); `DraftGateCondition` likewise; `DraftEffect.kind` gains `'inventory'` with `DraftInventoryGesture { action; items: string[]; equip: boolean }` and `emptyDraftInventoryGesture()`; round-trip, `definitionFromDraft` emitting only the active half, `validateDraftEffects` mirroring §5.6 with a warning for an unknown placeholder family in a ref; `LiteralOperandField` learns the state select for an `inventory` condition.
- `OutcomesSection` / `GateSection`: the subject select gains **Inventory state** and **Inventory count**; the operand control for the former is a four-way select, for the latter the number field.
- `SideEffectsSection`: Kind select gains **Change the inventory**; action select; items as reference chips with the inventory picker — generalise the wardrobe picker's chip and resolver (`pascal-wardrobe-effect-picker.md` §2–3) over a `kind: 'wardrobe' | 'inventory'` so the vantage selector (`WardrobeVantageSelect`) serves both; the inventory picker lists the vantage's pool with pictures (a picker is a selection surface, per inventory.md §2) and marks archetypes, which `pick_up` requires and the other two actions grey out; `equip` checkbox on `pick_up`.
- `ProvingBench`: **Mock inventory** — rows of `{ ref, state }` plus an optional `count`, fed as `OutcomeSubjects.inventory` through a `mockInventoryContext(rows)` builder in a client-safe `lib/pascal/bench-inventory.ts`; the dry run shows `→ inventory: equip "Excalibur" (would attempt)` and gate verdicts against the mock. The bench cannot tell whether an object exists, and the help says so.
- `app/api/v1/custom-tools/route.ts` preview / audit: optional `inventory` mock on the body beside `metadata` and `state`.

### 5.9 Realtime

`REALTIME_TOPICS` gains `'inventory'`; `topic-map.ts` maps it to `queryKeys.inventory.lists` and `folderLists`. Published from the parent after `createItem` / `instantiate` / `updateItem` / `setItemArchived` / the transfer move land (in the parent directly; for a job-child write via `topicsForCompletedJob`, which learns that an inventory file write implies the topic). The chat topic already covers `inventory.equipped(chatId)`.

### 5.10 Logging

Every handler logs `{ chatId, characterId, tool, refs, resolved, outcome }` at `debug`, refusals at `info`; the applier logs per gesture and per skipped item at `debug`, unloadable context at `warn`; the gate logs its lazy load once per roster resolution.

## 6. Out of scope

- `inventory_give` to a character outside the chat, or to a shared tier.
- Effects that create, archive, detach or give.
- A quantity model (counting remains kin by name).
- Trigger phrases binding to inventory tools (they already bind to custom tools, which can carry an inventory effect).
- Pascal reading another participant's inventory; every subject is the rolling character's.

## 7. Phases

Each ends with `npx tsc`, the suites named, and a dev-server walkthrough. Phases A–C can begin as soon as inventory.md's phases A–D are merged; D–F need its routes and UI.

- **A. Resolver, context, flag.** §5.1, `canManageInventory` (migration with its `PRETTY_LABELS` entry, `DDL.md`, export schema and writer/importer, schema, editor toggle, orchestrator read, builder flags), `removeEquippedInventoryId`, the pending set in the turn containers, `flushPendingInventoryAnnouncements`. Tests: resolver precedence and ambiguity, state, kin count, `pickForGesture`; the containers grep-test still holds.
- **B. The tool family.** §5.2, every registration site, snapshot re-recorded, Salon bubble lines, prompts and parsers. Tests per handler (own-only refusals, give's refusals, cap wording, archetype pick-up, one announcement per turn), Brahma and Scenario Builder off.
- **C. Pascal read side.** §5.3–5.5: subjects, gates, placeholders, operand; published schema and corpus; vocabulary and roster description (§5.7). Tests: `matchesWhen` on both subjects including the null context, gate lazy load, placeholder classification edge cases (dotted refs), `$inventory` typing and dice-string fallback.
- **D. Pascal write side.** §5.6, the applier and entrances, audit entries. Tests: fail-soft per gesture, cap breach skips one gesture, `pick_up` with and without `equip`, the three-way partition order, job-child read-your-writes.
- **E. Workbench and bench.** §5.8. Component tests for the new kind, subjects and mock inventory; the picker generalisation leaves the wardrobe picker's tests green.
- **F. Realtime and docs.** §5.9; `help/inventory.md` gains the tool family and the flag (Pascal's voice, one sentence disambiguating `self_inventory`); `help/pascals-workbench.md` and the custom-tools help gain the subjects, operand, placeholders, effect and mock inventory; `docs/developer/CUSTOM_TOOL_SPEC.json`, `API.md` (the tools API), `docs/CHANGELOG.md`; CLAUDE.md's Pascal glossary row and `pascal` sender note; move this file to `features/complete/` with an *As built* section.

## 8. Acceptance

- A character with the flag on lists their bag, picks up *magic bow* from the project store (an instance appears in their vault, equipped), and the turn carries one Pascal line naming it; with the flag off, no `inventory_*` tool is offered.
- `inventory_give` moves *lantern* to Marcus: the file is in Marcus's vault with its id, Vivienne's set no longer holds it, Marcus's set is unchanged, one Pascal line posts; giving a project-store object or giving to an archived character is refused in words.
- A custom tool with `availableWhen: { inventory: { "sword": { "eq": "equipped" } } }` is offered to the character carrying an equipped sword instance and not to one without; the composer popup without a character does not list it.
- A tool whose roll is `{ "$inventory": "sword.metadata.damage", "fallback": "1d4" }` rolls `2d6` for the character whose sword carries that string and `1d4` for one whose sword has no such key; its message renders `{{inventory.sword.title}}` as *Excalibur*.
- A tool with `{ "inventory": { "action": "pick_up", "items": ["{{params.loot}}"] } }` run as Vivienne with `loot: "magic bow"` creates and equips an instance; run with a `loot` naming nothing, Pascal still announces the roll and the audit shows no inventory entry; with a cap already reached, that gesture is skipped with the cap's wording, **no instance is created**, and the run's other effects and Pascal's post are unaffected.
- The Proving Bench with a mock inventory of `[{ ref: "sword", state: "equipped" }]` deals the `equipped` row and reports the gate as open; clearing the mock reports it withheld.
- The published JSON Schema and Zod agree on the whole corpus, with the documented per-action rules the only divergences.

## As built (2026-10-18)

All six phases landed in one change. Where the code differs from the text above, the code is the record:

- **Mutation names.** The spec's `createItem` / `updateItem` / `setItemArchived` are `createInventoryItem` / `updateInventoryItem` / `setInventoryItemArchived` in `lib/inventory/item-mutations.ts`.
- **The pending set is a map.** `pendingInventoryAnnouncements` is a `Map<chatId:characterId, PendingInventoryChange>` rather than a `Set<string>`: an Inventory line names what changed (taken up, set down, picked up), which a bare key cannot carry, where the wardrobe's announcement re-reads the outfit. It is created by `newWardrobeTurnContainers()` beside the wardrobe containers, threaded by `turnContainersOf`, netted per character (taken up then set down in one turn is no change), and drained by `flushPendingInventoryAnnouncements` (`equip-effects.ts`) right after `flushPendingWardrobeAnnouncements` in the orchestrator. The avatar refresh is deferred to the flush too. Gives never join the map; each posts at once.
- **The context.** `InventoryContext` (in the client-safe `refs.ts`) exposes `state(ref)`, `equippedKinCount(ref)` and `item(ref)` (equipped first, then own, then shared); the server's `loadInventoryContext` adds the pool and equipped ids, the bench's `mockInventoryContext` does not (its `item()` is always null). The run service loads it only when the definition's vocabulary names the Inventory.
- **Kits in references.** A kit reads `equipped` when all of its members are carried. `inventory_unequip` and the `unequip` effect fall back to a matching kit so it sets down whatever members it holds.
- **Pick-up is a chokepoint of its own.** `pickUpItems` (`equip.ts`) does the cap check, the instantiations and the one `setEquippedInventory` inside the chat's lock, so `inventory_pick_up` and the `pick_up` effect never create an unequipped instance on a cap breach, including in the job child where a buffered file write is not yet readable. `equipItems` gained `known` for the same reason (`inventory_create` with `equip`).
- **Transfers.** The move/copy body of `app/api/v1/inventory/transfers/route.ts` became `transferInventoryItem` (`lib/inventory/transfers.ts`), shared with `inventory_give`. Its same-location and duplicate-id refusals are now `INVALID_SHAPE` 400s with a code.
- **Tool flags.** The nine per-tool flags live in `lib/tools/inventory-tool-flags.ts` (`inventoryToolFlags(canManageInventory)`), spread into every options object; `buildTools` takes `canManageInventory` positionally after `canCreateOutfits`, so every caller states it.
- **Roll form.** The whole-roll `$inventory` is a third member of `RollSchema` and a third Workbench roll form, *From an object*.
- **Picker.** The inventory rows reuse the wardrobe's vantage and `WardrobeVantageSelect`; the chip and picker are Inventory twins (`InventoryEffectFields`, `components/inventory/inventory-reference-picker.tsx`, `useInventoryVantageItems`) rather than a `kind` parameter on the wardrobe's, whose slot and outfit logic has no Inventory counterpart.
- **Realtime.** `topicsForWriteBatch` infers the `inventory` topic from a job-child `docMount*` write whose arguments name an `Inventory/` path; the parent publishes it from the tool handlers, `pickUpItems` and the give.
- **Gates in the popup.** A perspective without a character (the composer popup as nobody) gets a null context, so an `availableWhen` on the Inventory withholds the tool there.

### Review fixes (2026-10-18)

- **Give order.** The move runs first and the giver's carried sets are cleared after it succeeds, so a refused transfer (`KIT_STRANDED`, a collision, a picture failure) leaves the giver carrying the object. The §5.2 order above (clear first) is superseded: the clear is by id, so the move does not hide the object from it.
- **One lock per chat.** `removeEquippedInventoryId` now rewrites one chat, and `dropCarriedEverywhere` (`equip.ts`) finds the chats (`findChatIdsCarryingInventoryId`) and rewrites each under `withChatInventoryLock`, like every other writer of the map.
- **Archive drops the id.** `inventory_archive` clears the object from the character's carried set in every chat, so restoring it does not quietly re-equip it.
- **Netting.** A pick-up set down again in the same turn leaves the pick-ups too, and a give strikes its object from the giver's pending entry, so neither is announced at turn end. Each pending entry keeps the provenances folded into it.
- **Job child reads its own files.** The proxy overlays `docMountDocuments.findManyByMountPointsInFolder` with the job's buffered `linkDocumentContent` writes and `deleteWithGC` deletes, so a pool loaded later in a job (a second gesture, `inventory_create` then `inventory_equip`, the applier's re-read) sees instances the job created. `known` stays for the create-and-equip call itself.
- **Text-block arguments.** The `inventory_*` tools coerce only `max_equipped` (number) and `archived` / `equip` (boolean); every other value stays text.
- **Efficiency.** A pool's id map is built once (`refs.ts`), and `inventory_give` matches a receiver id without loading the cast, loading it in parallel for a name.
- **The project roster (2026-10-18, after the dogfood).** The roster gates the project's shelf the way it gates the project wardrobe, and the rule is "the roster closes the shelf, not the hand" (`lib/inventory/roster-gate.ts`). `loadInventoryContext` (every `inventory_*` tool and every Pascal read, gate and effect) hides project-tier objects the character is not carrying when `projectRosterAdmits` refuses them. `equipItems` and `pickUpItems` refuse a non-`operator` gesture that would take from that shelf (`OFF_ROSTER`, before anything is written); a Pascal gesture refused this way is skipped like any other failed gesture. What a character already carries stays visible and can be set down, because the carried set is rewritten whole and hiding it would drop it. The operator's gestures, arrival defaults, the prompt section and the image pipelines are not gated.


## Title lint (2026-10-19)

Because `resolveInventoryRef` stops at the first round that matches anything, a title equal to a string some reference means by name shadows that name with no error. `lintInventoryTitle` (`lib/inventory/title-lint.ts`) is handed the object before and after a write and judges the change to the set of reachable titled objects.

- **Events.** A title *enters* when the object becomes reachable under a title it did not answer to (create, rename, restore, cleared override, copy, move into `Inventory/`) or its name changes under a standing title. It *leaves* when the object stops answering to it (rename, archive, delete, move out). An archetype counts: its title is inherited. Other edits are neither, and write only the census line.
- **Normalization** is the resolver's fold (`trim` + `toLowerCase`) first, then whitespace collapse, NFKD with marks stripped, and lower-case again, so the lint never calls two strings different that the resolver calls equal.
- **Kind names.** An entering title equal to the resolved name of anything in the location's pool (`loadPoolForLocation`, archived included), the object's own new name included, is a flat reject (`kind-name shadow`).
- **Gate keys.** `collectToolGateKeys` (`lib/pascal/tool-gate-keys.ts`) lists every literal `inventory` / `inventoryCount` key in either gate clause of every enabled store's tools, instance-wide; schema-invalid definitions are not live. A key equal to the entering title is resolved against the pool with the object left out: hits mean `live gate shadow` (reject), none means `gate key naming` (pass, one `info` row).
- **Leaving.** A leaving title a gate keys on logs `gate dark`, `gate redirected: <owner>`, `gate unverifiable: <what>` (an unread mount or tool file, so the case cannot be told) or `gate key moved`. Never a refusal.
- **Fail closed.** An entering title is refused (`TITLE_CHECK_UNAVAILABLE`) naming what could not be read: a pool tier whose read failed (`InventoryPool.unreadMounts`), a consulted mount that does not exist (`consultedMounts`, because a missing store reads as an empty folder), a failed `Tools/` listing, a tool file listed but missing on open, or a file whose bytes or JSON cannot be read (`CustomToolLoadError.stage`).
- **Evidence.** Every call logs one `debug` `[InventoryTitleLint] Census` line naming the pools and tool stores read and their sizes, so a lint that looked and passed is distinguishable from one never called.
- **Two layers.** The mutations (`item-mutations.ts`) lint with full context (the chat's project tier). The document-write layer lints the household's hands: `database-store.ts` calls `lintInventoryDocumentChange` (`title-lint-documents.ts`) before every write, delete, move and boundary-crossing folder move of an `Inventory/*.json` or `Tools/*.tool.json` file, reading the file's prior state first (unreadable prior state refuses a titled write) and pairing before and after by object id. The mutations' projection runs inside `withInventoryWritesLinted` (`lint-scope.ts`) so it is not linted twice.
- **Limits.** The pool is the writing location's: a shared tier's pool is its own folder plus General, so a shared-tier title is not checked against characters' vaults, and the document layer reads a character's pool without a chat's project tier. A transfer (`preserve`) and an instance with no own title are not linted. Outcome and effect `when` keys and effect references are not gate keys. Filesystem-backed stores hold no Inventory and are not hooked.

## Addition — `inventoryAggregate` (2026-10-20)

[pascal-gate-broadening.md](./pascal-gate-broadening.md) adds a fourth
Inventory read: `inventoryAggregate`, keyed `<scope>.<field>` (scopes
`equipped` ⊆ `owned` ⊆ `reachable`; fields `count`, `names`, `titles`,
`metadata.<key>` and its `.min` / `.max` / `.sum` / `.count` folds). It reads
`InventoryContext.scopeObjects(scope)` — on the real context the carriable
objects of the pool (no archetypes, archived objects or kits; instances
resolved), memoised per scope; on the bench's mock bag the rows placed by
state, an equipped row repeated by its `count`. Mock rows gain an optional
`metadata` object. A null context declines every aggregate test, as with
`inventory` / `inventoryCount`. Aggregate keys name no object, so the gate-key
census (`tool-gate-keys.ts`) does not collect them and the title lint is
unchanged; the census walks every group of an any-of gate.
