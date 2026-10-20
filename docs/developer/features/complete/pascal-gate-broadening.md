# Feature: Broader custom-tool gates — inventory aggregates, OR, numeric folds

**Status:** Built 2026-10-20 (decisions in §2 settled with the operator). See *As built* at the end.
**Owner subsystem:** Pascal the Croupier — the availability gate (`availableWhen` / `withheldWhen`), the outcome and effect `when` tests, and Pascal's Workbench. The Inventory is read, never written.
**Companion designs:** [pascal-custom-tools.md](pascal-custom-tools.md) (`when`, gates, roster), [inventory-tools-and-pascal.md](inventory-tools-and-pascal.md) §5.1–5.5 (the Inventory context, the `inventory` / `inventoryCount` subjects, the bench's mock bag), [inventory.md](inventory.md) (what an object is; `metadata` is the only free-form field), [character-progressions.md](character-progressions.md) (the `progress` sheet — the precedent this spec copies for a *derived* subject). Read them before building; this document describes only the delta.
**Implementation note:** Written to be executed by Claude Code (Opus). Follow the CLAUDE.md standing rules throughout: the Zod schema in `lib/pascal/custom-tool.types.ts` is the single source of truth and `public/schemas/qtap-custom-tool.schema.json` its published mirror (the agreement test in `__tests__/unit/lib/pascal/custom-tool-definition.test.ts` holds them together); one comparison table (`lib/pascal/metadata-match.ts`), never a second; fail-soft everywhere a character's data is read; debug logging on every touched backend path; changelog in plain voice; help docs with `url` + In-Chat Navigation; `npx tsc` not `npm run build`. The decisions in §2 are settled. **Do not reopen them**; if one proves unworkable, stop and say so.

---

## 1. The feature in one paragraph

A gate today asks three things about the Inventory: the state of *one named object* (`inventory`), how many kin of *one named object* are equipped (`inventoryCount`), and — through `metadata` — one key on the character's own sheet. It cannot ask "is anything they are carrying a suppressor?", "do their equipped names include *ansible resonator*?", or "what is the highest `toolVersion` among what they hold?", and it cannot say *or*. This spec adds **one new subject, `inventoryAggregate`**, a derived sheet over the objects in a scope (equipped, owned, reachable) whose keys fold the objects' names, titles and `metadata` into lists and numbers — `equipped.names`, `owned.metadata.toolAbilities`, `equipped.metadata.toolVersion.max` — compared through the one comparison table with a per-entry rule for lists; and **OR**, as an any-of array of the existing AND-groups, in gates and in outcome and effect `when` tests alike. Nothing is evaluated, nothing is grouped beyond one level, and every file written before this spec means exactly what it meant.

## 2. Decisions of record

| Topic | Decision |
|---|---|
| Shape of the aggregate | **A derived sheet, not a filter.** `inventoryAggregate` is keyed `<scope>.<field>` exactly as `progress` is keyed `<id>.<field>`: a fourth sheet read through `metadataComparatorHolds`, built fresh from the Inventory context the gate and the run already load. One test reads one attribute across the scope. A per-object conjunction ("an equipped object whose `toolAbilities` contains *suppress* **and** whose `toolVersion` ≥ 3") is **out of scope** (§6). A `where` filter can be added later under the same subject without re-shaping these files. |
| Scopes | Three, **cumulative**: `equipped` ⊆ `owned` ⊆ `reachable`. `equipped` is the character's equipped set in this chat; `owned` is everything in their own tier (equipped or not); `reachable` is the whole pool the context can see — own, group, project (roster-gated as today), General. Archetypes, archived objects and kits are never members (what `resolveInventoryRef` excludes; a kit's members stand for it). Instances are their **resolved** form, so an instance inherits its archetype's `metadata` (`resolveItem`). The scope is named `owned`, not `carried`, because the *state* `carried` means "own but not equipped" while the scope includes the equipped. |
| Fields | `count`; `names`; `titles` (title, else name — the `{{inventory.<ref>.title}}` rule); `metadata.<key>` (a list of the objects' values, one per object carrying the key); `metadata.<key>.min` / `.max` / `.sum` / `.count` (numeric folds). No other field. |
| Lists compare per entry | A list-valued key (`names`, `titles`, plain `metadata.<key>`) is compared **entry by entry**: `eq` holds when *any* entry equals the operand, `neq` when *no* entry does, `contains` when *any* entry contains the substring, `ncontains` when *no* entry does; the four ordering keys **decline** on a list (fold it first). No join, no delimiter, no new comparator key: a join plus `contains` would also match *ansible resonator mk2*, and per-entry containment cannot false-match across a delimiter. Equality and containment stay exact and case-minded, as on `metadata`. |
| Folds are numbers | `.min` / `.max` / `.sum` fold the **finite numeric** values among the objects carrying the key and are **absent** (decline, both directions) when there are none. `.count` counts the objects carrying the key with a usable value and is always present. `<scope>.count` is always present. |
| Fail-soft, in the inventory direction | A null Inventory context (no character, no chat, an unreadable vault, no mock rows) declines **every** `inventoryAggregate` test, exactly as `inventory` / `inventoryCount` do. With a real context, an empty scope is a **fact**: `equipped.count` reads `0`, `equipped.names` is an empty list (`eq` declines, `neq` and `ncontains` hold vacuously), and the folds are absent. |
| OR | **An any-of array of the existing objects.** `availableWhen` / `withheldWhen` accept `ToolGate \| ToolGate[]`; an outcome `when` accepts `true \| WhenObject \| WhenObject[]`; an effect `when` accepts `EffectWhen \| EffectWhen[]`. The array holds when **any** element holds; an element holds when **all** its tests hold (today's rule, unchanged). Evaluated left to right, short-circuit. **AND binds tighter than OR**; there is no nesting (an array may not contain an array) and no parentheses. The two spellings in the original request disagree under any fixed rule; the chosen rule reads `a AND b OR a AND c` as `(a AND b) OR (a AND c)` and `b OR c AND a` as `b OR (c AND a)` — an author who means `(b OR c) AND a` writes `a AND b OR a AND c`, and the Workbench draws each OR as a new line so the grouping is visible. At most `MAX_WHEN_GROUPS = 8` elements. |
| Operands | In a gate, literals only (today's rule). In a `when`, the `$param` / `$state` / `$inventory` operands `metadata` already takes. Keys are literal everywhere (an aggregate key names a scope and a field, not an object). |
| Where it is read | Gates (roster time, lazily, only when a gated definition names the subject — the `loadInvokerInventory` pattern already covers it, widened to the new subject), outcome rows and effect conditions (run time, from `OutcomeSubjects.inventory`), the Proving Bench (from the mock rows, which gain a `metadata` column), and nowhere else. |
| Who is told | `describeWhen` (`lib/tools/run-custom-tool.ts`) renders an aggregate test as *your equipped objects' metadata.toolVersion.max ≥ 4* and an OR as *(… and …) or (… and …)*; the vocabulary (`tool-vocabulary.ts`) lists aggregate keys under a new `inventoryAggregates` list. A gated-out tool is still never described. |
| Title lint | Untouched. The census (`tool-gate-keys.ts`) still collects only `inventory` / `inventoryCount` keys — an aggregate key names no object, so no title can shadow it. The census must simply learn to walk an array gate. |
| Placeholders | **Out of scope** (§6): no `{{inventoryAggregate.…}}` in messages this round. |
| Lists on the character sheet | The plain `metadata` subject learns the **same per-entry rule**: a `metadata.json` key holding an array of primitives (`knownLanguages: ["Trade Cant"]`), which today never matches, now matches by entry under `eq` / `neq` / `contains` / `ncontains` and still declines ordering. One rule in the one table; strictly widening (no existing row that matched stops matching). Arrays containing objects, arrays or `null` still decline whole. |


## 3. Vocabulary

- **Scope** — which objects a fold runs over: `equipped`, `owned`, `reachable`.
- **Field** — what is read off each object: `count`, `names`, `titles`, `metadata.<key>`, or a numeric **fold** of `metadata.<key>` (`.min` / `.max` / `.sum` / `.count`).
- **Aggregate key** — `<scope>.<field>`, the key of the `inventoryAggregate` sheet.
- **Group** — one AND-composed test object (a `ToolGate`, a `WhenObject`, an `EffectWhen`) — what every gate and `when` has always been.
- **Any-of** — an array of groups; holds when any group holds.

## 4. What already exists (read before building)

- **Gate evaluation:** `evaluateToolGate` / `gateHolds` ([lib/pascal/tool-gate.ts](../../../../lib/pascal/tool-gate.ts)) — AND over four subjects, each through its own fail-soft table.
- **Run-time evaluation:** `matchesWhen` ([lib/pascal/custom-tools.ts](../../../../lib/pascal/custom-tools.ts) ~L1238) and `matchesEffectWhen` (~L1362); `OutcomeSubjects.inventory` (~L1000) is the context both read.
- **The one comparison table:** `metadataComparatorHolds` / `compareOrdered` / `isPrimitive` ([lib/pascal/metadata-match.ts](../../../../lib/pascal/metadata-match.ts)). Client-safe.
- **Inventory subjects and the context:** [lib/pascal/inventory-subjects.ts](../../../../lib/pascal/inventory-subjects.ts); `InventoryContext` / `inventoryContextFrom` / `resolveInventoryRef` / `stateOf` ([lib/inventory/refs.ts](../../../../lib/inventory/refs.ts)); the server loader `loadInventoryContext` ([lib/inventory/context.ts](../../../../lib/inventory/context.ts)); the bench's mock `mockInventoryContext` ([lib/pascal/bench-inventory.ts](../../../../lib/pascal/bench-inventory.ts)).
- **The schema:** `GateComparatorSchema`, `ToolGateSchema`, `WHEN_SUBJECTS_SHAPE`, `WhenObjectSchema`, `WhenSchema`, `EffectWhenSchema`, `testsSomething`, the gate literal-key rule in `QtapCustomToolSchema.superRefine` (~L1365) ([lib/pascal/custom-tool.types.ts](../../../../lib/pascal/custom-tool.types.ts)). Published mirror: [public/schemas/qtap-custom-tool.schema.json](../../../../public/schemas/qtap-custom-tool.schema.json).
- **The draft model:** `ConditionSubject`, `DraftCondition`, `DraftGateCondition`, `conditionsFromWhen` / `whenFromConditions`, `gateConditionsFromGate` / `gateFromConditions`, `validateGate`, `validateCondition`, `gateConditionSlotKey` / `conditionSlotKey`, `reseatOperandForComparator` ([lib/pascal/tool-draft.ts](../../../../lib/pascal/tool-draft.ts)).
- **The chips:** [components/custom-tools/GateSection.tsx](../../../../components/custom-tools/GateSection.tsx) (`GateChip`, `comparatorsFor`, `withSubject`), [components/custom-tools/OutcomesSection.tsx](../../../../components/custom-tools/OutcomesSection.tsx), [components/custom-tools/LiteralOperandField.tsx](../../../../components/custom-tools/LiteralOperandField.tsx), [components/custom-tools/ProvingBench.tsx](../../../../components/custom-tools/ProvingBench.tsx) (mock inventory card ~L551).
- **Every other reader of a gate or `when`:** `collectToolVocabulary` ([lib/pascal/tool-vocabulary.ts](../../../../lib/pascal/tool-vocabulary.ts)), `describeWhen` ([lib/tools/run-custom-tool.ts](../../../../lib/tools/run-custom-tool.ts) ~L153), `collectToolGateKeys` ([lib/pascal/tool-gate-keys.ts](../../../../lib/pascal/tool-gate-keys.ts)), `gateNamesInventory` (inventory-subjects.ts), the API preview / audit ([app/api/v1/custom-tools/route.ts](../../../../app/api/v1/custom-tools/route.ts)), the Workbench library summary ([lib/pascal/workbench.ts](../../../../lib/pascal/workbench.ts) — `gate: 'available' | 'withheld' | null`, unchanged), the Almanack's `metadataGated` count ([lib/tools/almanack/phase4-scriptorium.ts](../../../../lib/tools/almanack/phase4-scriptorium.ts) — truthiness, unchanged).
- **Tests:** `__tests__/unit/lib/pascal/custom-tools-gate.test.ts`, `custom-tools-inventory.test.ts`, `custom-tool-definition.test.ts`, `tool-draft.test.ts`, `tool-draft-inventory.test.ts`, `tool-vocabulary.test.ts`, `tool-gate-keys.test.ts`; `__tests__/unit/components/custom-tools/workbench-inventory.test.tsx`.
- **Docs:** [help/custom-tools.md](../../../../help/custom-tools.md) ("Asking what the character has on them", "Who may reach for it at all"), [help/pascals-workbench.md](../../../../help/pascals-workbench.md) ("Who may reach for it", "The outcome table", "Mock inventory"), [docs/developer/CUSTOM_TOOL_SPEC.json](../../CUSTOM_TOOL_SPEC.json) (the annotated specimen, validated by the agreement test).

## 5. Design

### 5.1 The aggregate key — one parser, client-safe

New module `lib/pascal/inventory-aggregate.ts` (pure, no logger, no node built-ins; the Workbench runs it in the browser):

```ts
export const AGGREGATE_SCOPES = ['equipped', 'owned', 'reachable'] as const;
export type AggregateScope = (typeof AGGREGATE_SCOPES)[number];
export const AGGREGATE_FOLDS = ['min', 'max', 'sum', 'count'] as const;
export type AggregateFold = (typeof AGGREGATE_FOLDS)[number];

export type AggregateField =
  | { kind: 'count' }
  | { kind: 'names' }
  | { kind: 'titles' }
  | { kind: 'metadata'; key: string }                       // the list of values
  | { kind: 'metadata'; key: string; fold: AggregateFold }; // a number

export type ParsedAggregateKey = { scope: AggregateScope; field: AggregateField };

/** `<scope>.<field>`; null (with a reason) when it names nothing. */
export function parseAggregateKey(key: string): { ok: true; parsed: ParsedAggregateKey } | { ok: false; reason: string };
```

Parsing rule, in order: **(1)** split at the first `.`; the head must be a scope. **(2)** The remainder is `count`, `names` or `titles` exactly, or begins `metadata.` with a non-empty rest. **(3)** In the rest, if the **last** dotted segment is a fold word and something precedes it, that segment is the fold and the rest is the key; otherwise the whole rest is the key. So `equipped.metadata.toolVersion.max` is the fold `max` of key `toolVersion`, and `equipped.metadata.a.b` is key `a.b`. Consequence, documented in help and warned by the Workbench: a metadata key whose last segment is literally `min` / `max` / `sum` / `count` cannot be read as a plain list (the same kind of rule as a ref not containing `.metadata.`). Anything else is `{ ok: false }` and a **load-time rejection** (the key is the file's own vocabulary, like a `progress` key — `parseProgressKey` is the precedent, delegated from an `AggregateKeySchema.superRefine`).

### 5.2 What the context exposes

`InventoryContext` ([lib/inventory/refs.ts](../../../../lib/inventory/refs.ts)) gains one method:

```ts
/** The objects in a scope, as the aggregate sheet reads them. Pure; never throws. */
scopeObjects(scope: AggregateScope): readonly AggregateObject[];

export interface AggregateObject {
  name: string;
  /** Title, else name. */
  title: string;
  metadata: Readonly<Record<string, unknown>>;
}
```

- **Real context** (`inventoryContextFrom`): from `pool.items` filtered to carriable objects (`!isArchetype && kind !== 'kit' && !archivedAt`, the `resolveInventoryRef` rule), then `equipped` = `equippedIds.has(id)`, `owned` = `pool.owns(id)` **or** equipped, `reachable` = all. Objects are already resolved (metadata merged from the archetype). Memoised per scope on the context (one filter per scope per run).
- **Mock context** (`mockInventoryContext`): `MockInventoryRowSchema` gains `metadata: z.record(z.string(), z.union([primitive, z.array(primitive)])).optional()`. A row is an object named `ref` (title = ref) carrying that metadata; its state places it: `equipped` → all three scopes, `carried` → `owned` and `reachable`, `reachable` → `reachable` only, `absent` → none. An equipped row with `count: n` contributes **n copies** (so `equipped.count` and `inventoryCount` agree, and `.sum` can be proved); any other row contributes one. `item()` stays null.

### 5.3 Evaluation — one new function, reusing the table

In `inventory-aggregate.ts`:

```ts
export function inventoryAggregateHolds(
  comparator: MetadataComparator,       // resolved or literal; see hooks
  key: string,
  ctx: InventoryContext | null | undefined,
  hooks: MetadataMatchHooks,            // the same hooks object metadataComparatorHolds takes
): boolean
```

1. Null context → `onDecline('no inventory to aggregate (…)')`, false. (The same message family `inventoryStateHolds` uses.)
2. `parseAggregateKey` fails → decline (cannot happen for a loaded file; the bench may pass a draft).
3. Compute the sheet value:
   - `count` → `scopeObjects(scope).length`.
   - `names` / `titles` → the list of strings.
   - `metadata.<key>` (no fold) → for each object carrying the key: a primitive value becomes one entry; an **array of primitives** contributes each primitive (one level — `toolAbilities: ["suppress", "amplify"]` is the natural way to store it); `null`, objects and nested arrays contribute nothing. The list is in pool order.
   - `metadata.<key>.<fold>` → over the entries that are finite numbers: `min` / `max` / `sum`; `count` is the number of objects contributing at least one entry. `min` / `max` / `sum` with no numeric entries are **absent**.
4. Compare:
   - A number (or an absent fold) → `metadataComparatorHolds(comparator, key, { [key]: value } or {}, hooks)` — the existing table, verbatim.
   - A list → the **per-entry rule**, stated once in the table (below): an ordering key declines (`'<key> orders a list; fold it with .min/.max/.sum/.count first'`); `eq` holds iff some entry `===` the operand; `neq` iff no entry does; `contains` / `ncontains` require a string operand (else decline) and hold iff some / no string entry includes it. Non-string entries are skipped by containment, exactly as the table declines them singly.

**The per-entry rule lives in the table.** `metadataComparatorHolds` itself gains it: a subject that is an array of primitives (and only primitives) is compared entry by entry as stated above; an array holding anything else still declines whole, as it does today. `inventoryAggregateHolds` therefore always delegates — `metadataComparatorHolds(comparator, key, { [key]: value }, hooks)` with `value` a number, a list, or absent — and `inventory-aggregate.ts` only builds the value. One table, no second implementation; the character-sheet `metadata` subject gains list matching for free (§2). Update the table's doc comment and the help's "the key holds a list" bullet accordingly.

### 5.4 Schema

In `custom-tool.types.ts`:

- `AggregateKeySchema = z.string().superRefine(parseAggregateKey …)` beside `ProgressKeySchema`.
- `WHEN_SUBJECTS_SHAPE` gains `inventoryAggregate: z.record(AggregateKeySchema, MetadataComparatorSchema).optional().describe(…)` — the same comparator `metadata` takes (operands may be references). `testsSomething` counts it.
- `ToolGateSchema` gains `inventoryAggregate: z.record(AggregateKeySchema, GateComparatorSchema).optional()` — literal operands, as every gate subject. The "at least one" refine counts it.
- **Any-of:**
  - `ToolGateGroupSchema` is today's `ToolGateSchema` (renamed); `ToolGateSchema = z.union([ToolGateGroupSchema, z.array(ToolGateGroupSchema).min(1).max(MAX_WHEN_GROUPS)])`. Export `gateGroups(gate: ToolGate): ToolGateGroup[]`.
  - `WhenSchema = z.union([z.literal(true), WhenObjectSchema, z.array(WhenObjectSchema).min(1).max(MAX_WHEN_GROUPS)])`. Export `whenGroups(when: When): WhenObject[]` (`[]` for `true`).
  - `CustomToolEffectSchema.when` becomes `z.union([EffectWhenSchema, z.array(EffectWhenSchema).min(1).max(MAX_WHEN_GROUPS)])`. Export `effectWhenGroups`.
  - A one-element array is legal and means its element (the Workbench never emits one; `definitionFromDraft` collapses it).
- The gate literal-key `superRefine` (~L1365) and the both-clauses rule walk `gateGroups`. `collectToolGateKeys`, `gateNamesInventory`, `collectToolVocabulary`, `describeWhen`, `hasToolGate`, the run-tool's whole-table rendering, and the bench's "does this draft name an inventory subject" check all go through the three `*Groups` helpers. **Nothing reads `.metadata` / `.inventory` / … off a raw gate or `when` any more**; add a grep-test (`custom-tool-definition.test.ts`) that no file under `lib/`, `app/`, `components/` outside `custom-tool.types.ts` and `tool-draft.ts` accesses `availableWhen.` / `withheldWhen.` / `.when.` followed by a subject name.
- Amend the two doctrine texts: the module header's "AND-composed comparator objects" and `WhenObjectSchema`'s "There is still no OR and no nesting" become: *tests are AND-composed comparator objects; a one-level any-of array of them is OR; there is no nesting and no expression grammar.* Mirror the paragraph in pascal-custom-tools.md §"`when` — comparators, not expressions" and §"Security constraints".
- Mirror everything in `public/schemas/qtap-custom-tool.schema.json`; extend `CUSTOM_TOOL_SPEC.json` with one any-of outcome and one `inventoryAggregate` test (the agreement test validates it and checks every outcome reachable — keep the catch-all last).

### 5.5 Evaluators

- `tool-gate.ts`: `evaluateToolGate` evaluates `gateGroups(clause).some(group => gateHolds(group, …))`; `gateHolds` gains the `inventoryAggregate` loop (literal operands → identity resolver, like `metadata`). `ToolGateVerdict` gains `heldGroup?: number` (the index of the group that held, for the bench readout); absent when nothing held. `hasToolGate` unchanged in meaning.
- `custom-tools.ts`: `matchesWhen(when, subjects)` becomes `whenGroups`-aware — `true` → true; else `groups.some(g => matchesWhenGroup(g, …))` where `matchesWhenGroup` is today's body plus the `inventoryAggregate` loop (operands through `resolveOperand`, as `metadata`; key literal). `matchesEffectWhen` likewise over `effectWhenGroups`, splitting `outcome` off each group as it does now. Debug-log per test (`tool`, `key`, `value` or list length, `holds`), and once per any-of (`groups`, `heldGroup`).
- The roster loader (`custom-tools.ts` ~L548–581): "does this gate name an inventory subject" → `gateNamesInventory` includes `inventoryAggregate`, over every group.
- `simulateOutcomes` and `measure-twice` inherit through `matchesWhen`.

### 5.6 Workbench — draft model

`tool-draft.ts`:

- `ConditionSubject` gains `{ kind: 'inventoryAggregate'; key: string }`; `DraftGateCondition.subject` gains `'inventoryAggregate'`.
- **Joiners.** `DraftCondition` and `DraftGateCondition` gain `joiner: 'and' | 'or'` (ignored on the first chip of a list; default `'and'`). `whenFromConditions` / `gateFromConditions` split the flat list at each `'or'` into groups, build each group as today, and emit a bare object for one group or an array for several; an empty group (two ORs in a row, or a leading OR) is a validation error. `conditionsFromWhen` / `gateConditionsFromGate` flatten `whenGroups` / `gateGroups` back, marking each group's first chip `'or'` (except the first group). Round-trip test: array → chips → array, byte-equal after key sort.
- **Slots are per group.** `conditionSlotKey` / `gateConditionSlotKey` callers (the duplicate-chip guard in both sections, `validateGate`, `validateDraft`'s outcome pass) compare only within a group. Helper `groupsOf(conditions)` returns `DraftCondition[][]` for the UI and the validators.
- `validateCondition` / `validateGate` for `inventoryAggregate`: key must parse (`parseAggregateKey`, reason verbatim); an ordering comparator on a list-valued key (`names`, `titles`, plain `metadata.<key>`) is an **error** ("fold it with .min/.max/.sum/.count"); containment on a numeric key (`count`, a fold) is an error; a `$param` operand's type must suit (string for containment, number for ordering — the existing `params` type rules); a key whose last segment is a fold word gets a **warning** that it reads as a fold. Gate: operand literal, as today.
- `definitionFromDraft` emits `inventoryAggregate` beside `inventoryCount`; `draftFromDefinition` reads it.
- Effect conditions stay hand-written-verbatim behind the badge (today's rule); an any-of effect `when` round-trips untouched.

### 5.7 Workbench — chips

- **`GateSection.tsx` and `OutcomesSection.tsx`:** the `AND` label between chips becomes a small two-state toggle (`AND` / `OR`), writing `joiner`. An `OR` starts a new visual row (the chips of a group share a line; groups stack), with a hairline between groups, so the grouping is legible without parentheses. The hint under the gate reads: *Tests on one line must all hold; any line that holds opens the door.* Mode labels become "Only show if any line passes…" is **not** done — keep *Only show if…* / *Do not show if…*; the hint carries the rule.
- **Subject select** gains `inventory aggregate` (gate and outcome). Its key input: placeholder `equipped.metadata.toolVersion.max`; title explains the three scopes, the four fields and the folds in one sentence each. A small **Insert key** helper beside it (a `<select>` of `<scope>.<field>` skeletons: `equipped.count`, `equipped.names`, `equipped.titles`, `equipped.metadata.`, `… .min` etc.) fills the box — optional but cheap; the metadata key is then typed.
- `comparatorsFor('inventoryAggregate', key)`: every comparator; the validator (5.6) greys nothing but flags the illegal pairing with the chip's error state and message. `withSubject` keeps the key.
- `LiteralOperandField` unchanged (type picker shown for eq/neq, as `metadata`).
- **ProvingBench:** the mock-inventory row gains a `metadata` text field (JSON object; blank = `{}`; invalid JSON = row error, bench refuses to run — the Mock state card's rule). The gate verdict line names the group that held (*passed on line 2*) when the gate is an any-of. The "needs inventory" detector walks groups.
- Nothing else in the editor changes.

### 5.8 What the model and the operator are told

- `describeWhen` (`run-custom-tool.ts`): a group renders as today; an any-of renders each group in parentheses joined by ` or ` (a single-test group goes without parentheses). `inventoryAggregate` tests read `your equipped objects' names`, `your owned objects' metadata.toolAbilities`, `your equipped objects' metadata.toolVersion.max`, `how many objects you have equipped` (for `.count`), through `describeComparator`. An `eq` on a list renders *includes*; `neq` *includes no*; `contains` *has an entry containing*; `ncontains` *has no entry containing*.
- `collectToolVocabulary`: new `inventoryAggregates: string[]` (the keys, sorted); `isEmptyVocabulary` counts it; the Workbench's vocabulary panel lists it under the inventory reads. Metadata keys read through aggregates are **not** added to `metadata` (that list is the character's sheet).
- The roster's `debug` lines (`Custom tool withheld by its availability gate`) add `heldGroup` / `groups`.

### 5.9 Logging

Every new backend path logs at `debug` with `context: 'custom-tools'`: the aggregate value computed per test (scope, field, list length or number, `holds`), the group that opened a gate or a row, and the lazy inventory load already logged. No `info` or above.

### 5.10 Realtime, data, exports

No table, column, migration, export or backup change: a tool is a `Tools/*.tool.json` document in a store and is exported as such. `DDL.md` untouched.

## 6. Out of scope (this round)

- A per-object filter (`where: { "metadata.toolAbilities": { contains } , "metadata.toolVersion": { gte } }`) — the sheet cannot express it; add later as a fourth field form under the same subject.
- Nesting or parentheses — one level of any-of only.
- `{{inventoryAggregate.…}}` placeholders in messages, chip labels and expressions (joined `; ` when it comes; nothing here depends on it).
- Aggregating the *wardrobe* or *other participants'* bags.
- Writing through an aggregate (effects) — never.

## 7. Phases

1. **Parser, context, evaluator** (§5.1–5.3): `inventory-aggregate.ts`, `scopeObjects` on both contexts, `inventoryAggregateHolds`; unit tests for the parser (every form in §5.1 plus the rejections), the scopes (cumulative; archetype / kit / archived excluded; instance inherits metadata; roster-closed shelf absent), the folds (absent on no numbers; `count` semantics), and the per-entry rule in `metadata-match.ts` (every comparator, empty list, a list with a non-primitive member, null context) — exercised through both `inventoryAggregateHolds` and a plain `metadata` test on a list-valued sheet key.
2. **Schema and any-of** (§5.4): the subject in both shapes, the three `*Groups` helpers, the array forms, the literal-key rule over groups, JSON Schema mirror, `CUSTOM_TOOL_SPEC.json`, the grep-test. Agreement test green.
3. **Evaluators** (§5.5): gate and run-time, verdict `heldGroup`, roster lazy load, logging. Tests in `custom-tools-gate.test.ts` / `custom-tools-inventory.test.ts`: the three request examples verbatim (a `toolAbilities` containing *suppress* equipped / owned; equipped names include *ansible resonator*; `toolVersion` max/min/sum over two equipped objects), any-of short-circuit order, fail-closed / fail-open readings preserved for `availableWhen` / `withheldWhen` with an any-of.
4. **Readers** (§5.8): `describeWhen`, vocabulary, gate-key census, bench detector. Tests.
5. **Workbench** (§5.6–5.7): draft model with joiners, round-trips, validators, the chips' toggle and grouping, the subject, the bench's metadata column and verdict line. Tests in `tool-draft.test.ts` and `workbench-inventory.test.tsx`.
6. **Docs:** help (`custom-tools.md`: a new subsection *Asking about everything they carry — `inventoryAggregate`* after `inventory`, and an *Or* paragraph in the `when` section and the gate section; `pascals-workbench.md`: the toggle, the subject, the mock metadata column), pascal-custom-tools.md and inventory-tools-and-pascal.md "Addition" notes, `CHANGELOG.md` (plain voice), `update-documentation.md` entries for `CUSTOM_TOOL_SPEC.json`, then move this file to `complete/` with an *As built* section.

## 8. Acceptance

- A gate `{ "inventoryAggregate": { "equipped.metadata.toolAbilities": { "contains": "suppress" } } }` offers the tool to a character with an equipped object whose `toolAbilities` is `"suppress, amplify"` **or** `["suppress", "amplify"]`, and withholds it from one whose only such object is unequipped; `owned.…` offers it to both; `reachable.…` offers it to one who can merely see it on the General shelf.
- `{ "equipped.names": { "eq": "ansible resonator" } }` holds for an equipped *Ansible Resonator* (case-folded? **no** — exact, as `metadata` is; the help says so) and does not hold for *ansible resonator mk2*.
- With `toolVersion` 2 and 4 equipped: `.max gte 4` holds, `.min gt 2` declines, `.sum eq 6` holds, `.count eq 2` holds; with neither numeric, `.max` declines in both directions and `.count eq 0` holds.
- `availableWhen: [ {A, B}, {A, C} ]` is offered when A∧B or A∧C; `withheldWhen` with the same array withholds in the same cases; a null context declines every group.
- An outcome `when: [ { "gte": 0.9 }, { "inventory": { "lucky charm": { "eq": "equipped" } } } ]` wins on a high roll **or** a charm; an effect with an any-of `when` fires on either.
- A character whose `metadata.json` holds `knownLanguages: ["Trade Cant", "Latin"]` now matches `{ "metadata": { "knownLanguages": { "eq": "Latin" } } }` and `{ "contains": "Cant" }`, declines `{ "gt": 1 }`, and a list holding an object still declines everything.
- Every file in the repository's fixtures and specimens loads unchanged; the Workbench round-trips an any-of gate and an any-of outcome byte-equal; the published schema agrees with Zod.
- The bench proves all of the above with mock rows carrying `metadata`, and says which line opened the gate.

## As built (2026-10-20)

Built as specified; where the text left a choice, this is what was chosen.

- **Modules.** `lib/pascal/inventory-aggregate.ts` (client-safe): `AGGREGATE_SCOPES`, `AGGREGATE_FOLDS`, `parseAggregateKey`, `aggregateValue`, `inventoryAggregateHolds`, plus `isListAggregate` / `aggregateKeyEndsInFold` for the Workbench and `describeAggregateValue` for logging. `InventoryContext.scopeObjects` lives on both contexts (`refs.ts`, memoised per scope; `bench-inventory.ts`).
- **The per-entry rule is in the one table.** `metadataComparatorHolds` compares an array of primitives entry by entry (`listComparatorHolds`); an empty array qualifies, so `neq` / `ncontains` hold against it. Arrays holding anything else still decline whole. Two existing execution tests that asserted a list never matches were rewritten to the new rule.
- **`.count` counts numbers.** §2 says "objects carrying the key with a usable value", §5.3 "objects contributing at least one entry", and §8 wants `.count eq 0` with neither value numeric. Read as one rule: `.count` is the number of objects contributing at least one *finite number*, which makes all four folds numeric folds and satisfies §8 whatever "neither numeric" means.
- **Schema.** `ToolGateGroupSchema` / `ToolGateSchema` (union), `WhenSchema` (three-way union), `EffectConditionSchema` (new name for the effect `when` union; `EffectWhenSchema` stays the group), `gateGroups` / `whenGroups` / `effectWhenGroups`, `MAX_WHEN_GROUPS = 8`. Load-time issue paths inside an array carry the group index (`outcomes.0.when.1.params.ghost`). `formatDefinitionIssues` drops a union branch whose only complaint is "expected array" (so a bad bare object reads as before) and now surfaces a record key's own refinement under "Invalid key in record" — which also fixes the progress-key messages the progressions addition noted were lost.
- **Load time for an aggregate** checks the key (parser) and `$param` operands only, as `metadata` does. Ordering a list or searching a number is a Workbench error, not a load-time rejection: it fails soft at run time.
- **Gate verdict.** `heldGroup` is reported only for an array clause (a bare object has one group), so every existing verdict assertion is unchanged. The roster's withheld log line adds `groups` and `heldGroup`. `gateNamesProgress` joins `gateNamesInventory` in `tool-gate.ts` so the roster reads no raw gate field.
- **Run time.** `matchesWhen` / `matchesEffectWhen` split into `matchesWhenGroup` / `matchesEffectWhenGroup` plus `anyGroupHolds` (left to right, short-circuit, one debug line per any-of). `collectMetadataTested` unions the metadata keys of every group. `loadRunInventory` (`run-service.ts`) now also loads the bag when the vocabulary lists aggregates — without it a run would have declined every aggregate test.
- **Readers.** `describeWhen` as specified (`includes`, `includes no`, `has an entry containing`, `has no entry containing`; `.count` fold reads "how many of your … objects carry a numeric metadata.<key>"); the roster description adds a `Takes stock of:` line. `ToolVocabulary.inventoryAggregates`; the chat run dialog's reference panel says which aggregates a tool takes stock of. The gate-key census walks groups and ignores aggregate keys.
- **Draft model.** `joiner` is optional (absent = `and`) so every chip saved before OR existed is unchanged; only the first chip of each later group carries `'or'`. `groupsOf` splits; groups cannot be empty by construction, and a group whose chips are all incomplete is dropped on serialisation (validation blocks save anyway). Line-count cap is a validation error. `subjectValueType` for an aggregate: a count or fold is `number`, `names` / `titles` are `string`, a plain metadata list is unknowable.
- **Workbench.** `components/custom-tools/ConditionGroups.tsx` (the lines and the `JoinerToggle`) and `AggregateKeyField.tsx` (key box plus *Insert key…*, which keeps a typed metadata key when a fold skeleton is chosen) are shared by both sections. The outcome chip offers all eight comparators for an aggregate. The bench's mock row has a metadata line (blank = `{}`, invalid → red, the bench refuses to roll), and the verdict line names the line that held.
- **Specimen.** `CUSTOM_TOOL_SPEC.json` gains one any-of outcome with two `inventoryAggregate` tests, after the `inventoryCount` row. Since `edit_custom_tool`'s `action: "schema"` (landed the same day) returns this specimen and the JSON Schema mirror to the model, both reach the model with no further change.
- **Tests.** `inventory-aggregate.test.ts` (parser, scopes, folds, the per-entry rule, null context, §8 through the gate, any-of verdicts); additions to `custom-tools-inventory.test.ts` (outcome / effect any-of, short-circuit, aggregates with `$param`, the roster description, lazy load on a second-group aggregate), `custom-tool-definition.test.ts` (agreement corpus, issue paths, the grep-test), `tool-draft-inventory.test.ts` (round trip byte-equal after key sort, per-line slots, validators), `tool-gate-keys.test.ts` and `workbench-inventory.test.tsx`.
