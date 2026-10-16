# Feature: Pascal side effects — dressing and undressing (`effects[].wardrobe`)

**Status:** Implemented in 4.11 (2026-10-15). Design of record; see [Implementation notes](#implementation-notes) for where the build departed from the text.
**Owner subsystem:** Pascal the Croupier (custom tools, `lib/pascal/`), with the wardrobe (`lib/wardrobe/`) as the store it writes into.
**Extends:** [pascal-custom-tool-enhancements.md](pascal-custom-tool-enhancements.md) §F3 (side effects). Read that first, then [pascal-custom-tools.md](pascal-custom-tools.md) and [wardrobe-refactor.md](wardrobe-refactor.md). This document describes only the delta.
**Implementation note:** Written to be executed by Claude Code (Opus) with no further design input. Where a choice existed it has been made — see [Design decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, logging, the wardrobe and Pascal chokepoints, no stubs).

## Motivation

A custom tool can already record a roll's consequences into tiered state, onto the rolling character's fact sheet, and into their progressions. It cannot touch what they are wearing. Yet the wardrobe is where a great many rolls *want* to land: "the dress tears" (take it off), "she draws the Cloak of Night from the chest" (wear it), "the transformation completes" (strip everything, put on the beast-form outfit), "he is knighted" (put on the regalia). Today the model must be asked to make a separate `wardrobe_wear` call after Pascal announces — a call it may forget, fudge, or make for the wrong garment.

This feature adds a second *kind* of effect beside the existing value write: a **wardrobe gesture** — wear an outfit or a set of items, take them off, or clear a slot — applied server-side after the deal, through the same chokepoints every other outfit change uses. It also makes a custom tool a one-click way for the operator to dress or undress a character: a tool with no roll to speak of (`"roll": {"min": 1, "max": 1}`, one `when: true` outcome) and a wardrobe effect is exactly "run a custom tool to wear something or remove it".

## Doctrine (read first)

1. **Every outfit change goes through `applyDisplacement`** (`lib/wardrobe/outfit-displacement.ts`) via `wearItem` / `takeOffItem` (`lib/wardrobe/wear-ops.ts`), and the side effects of a change (avatar refresh, Aurora's announcement) through `notifyWardrobeChanged` (`lib/wardrobe/outfit-change-effects.ts`). This feature adds **no new writer**. It is a third caller of the existing ones, beside the `wardrobe_wear` / `wardrobe_take_off` tools and the chat's `?action=equip`.
2. **The rolling character wears it.** A wardrobe effect dresses or undresses the character the tool was run *as* — the same character a `metadata.` effect writes to — and nobody else. A tool one character runs cannot undress another. A run nobody made (the composer popup without `asCharacterId`) dresses nobody, exactly as it writes to nobody's sheet.
3. **Items are references, not expressions.** An item is named by title (case-insensitive) or id, rendered through `renderTemplate` so a parameter or a fact-sheet key may *choose* the garment (`"{{params.garment}}"`) — but it is a template, not an expression: no arithmetic, no quoting trap. Resolution is `findInPool` against the rolling character's wearable pool (character > group > project > general), the same lookup the tools use.
4. **Fail-soft per item, never per run.** An item that cannot be resolved (not in the pool, archived, slot mismatch) is skipped with a debug log and the rest of the gesture proceeds. The roll already happened; Pascal still announces. The applier never throws.

## 1. Definition schema

### 1.1 Shape

`CustomToolEffectSchema` (`lib/pascal/custom-tool.types.ts`, currently a strict object of `when` / `target` / `value`) becomes a strict object in which an effect is **either** a value write (`target` + `value`, as today) **or** a wardrobe gesture (`wardrobe`), never both and never neither. Keep it one `z.strictObject` with optional members and a `superRefine`, **not** a `z.union` — union failures produce issue trees that `formatDefinitionIssues` renders badly, and the Workbench wants one object to round-trip.

```ts
export const MAX_WARDROBE_EFFECT_ITEMS = 8;
export const MAX_WARDROBE_ITEM_REF_LENGTH = 200;

export const WardrobeEffectActionSchema = z.enum(['wear', 'take_off', 'clear_slot']);
export type WardrobeEffectAction = z.infer<typeof WardrobeEffectActionSchema>;

export const CustomToolWardrobeGestureSchema = z.strictObject({
  action: WardrobeEffectActionSchema.describe(
    '"wear" puts the listed items on the rolling character; "take_off" takes them off; "clear_slot" empties one slot.'
  ),
  items: z
    .array(z.string().min(1).max(MAX_WARDROBE_ITEM_REF_LENGTH))
    .min(1)
    .max(MAX_WARDROBE_EFFECT_ITEMS)
    .optional()
    .describe(
      'The garments or outfits, each by title (case-insensitive) or id, in order. A template: {{params.x}}, ' +
        '{{metadata.key}} and the other placeholder families are substituted before lookup. Required for wear and take_off.'
    ),
  mode: z
    .enum(['wear', 'replace', 'add_to_slot'])
    .optional()
    .describe('wear only. Same meaning as the wardrobe_wear tool: honour the item\'s replace flag (default), force a swap, or layer into one slot.'),
  slot: WardrobeItemTypeEnum.optional().describe(
    'Required for clear_slot and for mode add_to_slot; optional on take_off to restrict the removal to one slot.'
  ),
});

export const CustomToolEffectSchema = z
  .strictObject({
    when: EffectWhenSchema.optional(),
    target: z.string().min(1).max(MAX_EFFECT_TARGET_LENGTH).optional(),   // unchanged text
    value: z.union([...]).optional(),                                       // unchanged text
    wardrobe: CustomToolWardrobeGestureSchema.optional(),
  })
  .superRefine((effect, ctx) => {
    const isWrite = effect.target !== undefined || effect.value !== undefined;
    const isWardrobe = effect.wardrobe !== undefined;
    if (isWrite && isWardrobe) ctx.addIssue({ code: 'custom', message: 'an effect is either a write (target + value) or a wardrobe gesture, not both' });
    if (!isWrite && !isWardrobe) ctx.addIssue({ code: 'custom', message: 'an effect needs target + value, or wardrobe' });
    if (isWrite && (effect.target === undefined || effect.value === undefined)) ctx.addIssue({ code: 'custom', message: 'a write needs both target and value' });
  });
```

`WardrobeItemTypeEnum` comes from `lib/schemas/wardrobe.types.ts`, which is already client-safe (the Workbench imports `custom-tool.types.ts`). Export two narrowing helpers beside the schema and use them everywhere instead of re-testing keys:

```ts
export type CustomToolWriteEffect = CustomToolEffect & { target: string; value: number | boolean | string };
export type CustomToolWardrobeEffect = CustomToolEffect & { wardrobe: CustomToolWardrobeGesture };
export function isWriteEffect(e: CustomToolEffect): e is CustomToolWriteEffect;
export function isWardrobeEffect(e: CustomToolEffect): e is CustomToolWardrobeEffect;
```

`MAX_EFFECTS` (16) is unchanged and counts both kinds together.

### 1.2 Load-time validation (`validateEffects`)

Extend the existing walk. For a wardrobe effect:

- `wear`: `items` required. `mode` defaults to `wear`. `slot` required iff `mode === 'add_to_slot'`; otherwise `slot` must be absent (it would be silently ignored, which is a typo worth catching).
- `take_off`: `items` required. `slot` optional. `mode` must be absent.
- `clear_slot`: `slot` required. `items` and `mode` must be absent.
- Every item string is scanned with `scanPlaceholders`. A `{{params.x}}` must name a declared parameter (any type — numbers render through `formatValue`, as in an outcome message). A `{{llm}}` reference requires an `llm` block (the existing rule). Unknown placeholder families are **not** rejected (the `renderTemplate` doctrine: they stay verbatim and then simply fail to resolve at run time) — the Workbench adds a warning pass only.
- `when` is validated by the shared comparator walk exactly as for a write effect.

Issue paths are `effects.N.wardrobe.items.M`, `effects.N.wardrobe.slot`, etc.; `formatDefinitionIssues` needs no change beyond test coverage.

### 1.3 Published JSON Schema and the agreement test

`public/schemas/qtap-custom-tool.schema.json`: widen `$defs/Effect` — `target` and `value` become optional, add `wardrobe` (`$ref: "#/$defs/WardrobeGesture"`, a new def mirroring §1.1 with the slot enum spelled out), and express the exclusivity as `oneOf: [{ required: ["target", "value"], not: { required: ["wardrobe"] } }, { required: ["wardrobe"], not: { anyOf: [{ required: ["target"] }, { required: ["value"] }] } }]`. The per-action cross-field rules (`clear_slot` needs `slot`, etc.) are `description` text, not schema-checked — an accepted divergence to assert in `__tests__/unit/lib/pascal/custom-tool-definition.test.ts`'s agreement corpus, alongside the existing "expression grammar is description-only" one. Add corpus entries for: a valid `wear`, a valid `take_off` with `slot`, a valid `clear_slot`, a `wear` with `add_to_slot` and no slot (rejected), a `clear_slot` with `items` (rejected), an effect with both `target` and `wardrobe` (rejected), an empty effect (rejected).

Update `docs/developer/CUSTOM_TOOL_SPEC.json` (it carries the `effects` array) with one `wardrobe` effect whose `description` explains the item-reference form, and its catalogue row in `.claude/commands/update-documentation.md`.

## 2. Execution core (pure — still writes nothing)

`lib/pascal/custom-tools.ts`:

- `ResolvedEffect` gains a third variant:

  ```ts
  export type ResolvedEffect =
    | { index: number; target: EffectTarget; value: ExprValue }                          // write, unchanged
    | { index: number; wardrobe: ResolvedWardrobeGesture }                                // new
    | { index: number; skipped: string };

  export interface ResolvedWardrobeGesture {
    action: WardrobeEffectAction;
    /** Rendered, trimmed item references in file order. Empty strings are dropped here, with a debug log. */
    items: string[];
    mode?: 'wear' | 'replace' | 'add_to_slot';
    slot?: WardrobeItemType;
  }
  ```

- `isApplicableEffect` is split: `isApplicableWriteEffect` (today's predicate, renamed; every current caller updated) and `isApplicableWardrobeEffect`. Keep `isApplicableEffect` as the union of the two for the Proving Bench's "would apply" count.
- `resolveEffects`: after `matchesEffectWhen` holds, branch on `isWardrobeEffect`. Render each item with the same `renderTemplate` subjects the outcome message got (`value`, `roll`, `dice`, `params`, `metadata`, `progress`, `now`, `llm`, `state`), trim, drop empties. A gesture whose `items` all rendered empty (for `wear` / `take_off`) is **skipped** with reason `'every item reference rendered empty'`. Nothing else can fail here — there is no expression to evaluate.
- `simulateOutcomes` continues to ignore effects.

The module header's "no writes, no message posting" contract still holds.

## 3. Applier

### 3.1 Where the gestures land — new `lib/pascal/wardrobe-effects.ts`

A new module rather than more branches in `side-effects.ts`: the state/metadata applier is a read-once-batch-commit over whole-object stores, and the wardrobe is a sequence of gestures through a chokepoint with its own read-your-writes story. Different doctrines, different files.

```ts
export interface ApplyWardrobeEffectsParams {
  userId: string;
  chatId: string;
  toolName: string;
  /** The rolling character. null → every gesture skips fail-soft. */
  characterId: string | null;
  gestures: Array<{ index: number; wardrobe: ResolvedWardrobeGesture }>;
  /** The turn's announcement set, when inside a model turn (threaded from the executor). */
  pendingWardrobeAnnouncements?: Set<string>;
}

/** Never throws. Returns the gestures that landed, in effect order, for `pascalMeta.effects`. */
export async function applyWardrobeEffects(params: ApplyWardrobeEffectsParams): Promise<AppliedEffect[]>;
```

Behaviour (normative):

1. **No character, no gesture.** `characterId === null` → return `[]` after one debug log (`'no rolling character, wardrobe effects skipped'`). Same asymmetry as a metadata write.
2. **One pool per run.** `loadWearablePool(repos, characterId, undefined, { chatId })` — exactly what `loadToolPool` in `wardrobe-handler-shared.ts` does (reuse it; export it if it is not already). Read once. A pool that cannot be loaded (vault unavailable) → warn, return `[]`.
3. **Gestures in file order, items in list order, each through the wear-ops front half:**
   - `wear`: `resolveWearable(pool, { itemId: ref, itemTitle: ref }, mode, slot)` — pass the rendered reference as **both** id and title; `findInPool` tries id first, then title, which is the resolution rule the tools already have. On `ok: false` → skip that item with the resolution's `message` as the reason (so an archived garment gets bug 191's wording). On `ok` → `wearItem(repos, chatId, pool, item, mode, slot, 'tool')`.
   - `take_off`: `findInPool`, then `takeOffItem(repos, chatId, characterId, item.id, slot ? [slot] : item.types)`. Archived items may be taken off (archiving never undresses anyone, and undressing an archived item is fine). **A composite is taken off by taking off its leaves:** worn composites are stored dissolved (`wardrobe.types.ts` header), so filtering the composite's own id out of a slot removes nothing. Walk `componentGraph(pool, [item.id])` (`lib/wardrobe/pool.ts`), and for every leaf currently equipped (`findEquippedSlots`, `wardrobe-handler-shared.ts`) call `takeOffItem` on that leaf's occupied slots (restricted to `slot` when given). This mirrors what the Wardrobe dialog's `takeOffBundleFromSlots` (`bundle-mutations.ts`) does client-side. **Verify at implementation time** whether `wardrobe_take_off`'s `remove` already does this for a composite; if it does not, fix the tool's handler too, so the two agree.
   - `clear_slot`: `applyDisplacement(repos, chatId, characterId, { mode: 'clear_slot', slot })`.
4. **Sequential, and safe in the job child.** Each primitive loads the current slots and commits, so the gestures in one run see each other — in the parent because the write landed, and in the forked job child because `chats.getEquippedOutfitForCharacter` answers from the per-job equipped-outfit overlay ([BACKGROUND_JOBS_CHILD.md](../../BACKGROUND_JOBS_CHILD.md) §"Batched writes and read-your-writes") — the same guarantee the `wardrobe_wear` handler's loop relies on. Do **not** batch the slot math locally: `commitEquippedOutfit` must be called once per gesture so the wear ledger credits each transition (its contract, [wardrobe-wear-ledger.md](wardrobe-wear-ledger.md)).
5. **Source is `'tool'`.** A Pascal effect is a tool wearing something. No new `EquipSource` member — the ledger counts it as a wear exactly as it counts `wardrobe_wear`.
6. **Effects once, after the loop, only if something landed:** `notifyWardrobeChanged(repos, { userId, chatId, characterId, pendingWardrobeAnnouncements }, 'pascal.wardrobe-effects')`. With the turn's set this joins the turn's single Aurora announcement (the model's `wardrobe_wear` calls and Pascal's effect collapse into one); without it (the composer popup) the announcement is enqueued at once, as `?action=equip` does. The avatar refresh follows the chat's existing opt-in.
7. **Audit entries.** Each landed item (or slot) produces one `AppliedEffect`:

   ```ts
   {
     target: 'wardrobe.wear' | 'wardrobe.take_off' | 'wardrobe.clear_slot',
     previous: <EquippedSlots before this gesture>,
     next: {
       item?: { id: string; title: string },      // absent on clear_slot
       slot?: WardrobeItemType,                    // add_to_slot / clear_slot / restricted take_off
       slotsAffected: WardrobeItemType[],
       effect: 'layered' | 'replaced' | 'removed' | 'cleared',
       slots: <EquippedSlots after this gesture>,
     },
   }
   ```

   `AppliedEffect` already types `previous` / `next` as `unknown` and the `pascalMeta.effects` schema (chat.types.ts, chats-messages.ops.ts, `qtap-export.schema.json`) already carries `{ target, previous?, next, tier? }` — **no schema or migration change**, only the doc-comments and the DDL.md prose, which must mention the three new `target` spellings.
8. **Never throws.** Every primitive call is individually try/caught; a failure logs `warn` with the item and drops it from the applied list.

### 3.2 `applyCustomToolEffects` (`side-effects.ts`)

- Signature gains `userId: string` (required — both callers have it) and `pendingWardrobeAnnouncements?: Set<string>`.
- Partition `effects` with the two predicates. The write partition runs exactly as today. **Then** call `applyWardrobeEffects` with the gesture partition. Writes commit before gestures so a `metadata.` write and a `wardrobe` gesture in one tool cannot interleave their store reads.
- Return the concatenation **in effect order** (sort the two applied lists back together by `index` — carry `index` on the pending entries; `AppliedEffect` itself does not expose it).

### 3.3 Entrances

- **LLM entrance** (`lib/tools/handlers/run-custom-handler.ts`): `RunCustomToolContext` gains `pendingWardrobeAnnouncements?: Set<string>`; `lib/chat/tool-executor.ts` passes `context.pendingWardrobeAnnouncements` at the `run_custom` call site (it already threads the same set to the wardrobe handlers — line ~726). Pass `userId` and the set into `applyCustomToolEffects`.
- **Manual route** (`app/api/v1/chats/[id]/custom-tools/route.ts`): pass `userId: ctx.user.id`, no set. `characterId` keeps the existing asymmetry (`body.asCharacterId` only), which §Doctrine 2 restates.
- **Workbench preview / audit** (`app/api/v1/custom-tools/route.ts`): unchanged — `handlePreview` spreads the resolved (dry) effects; nothing applies.

Ordering and failure semantics are unchanged: effects (writes, then gestures) apply **before** the Pascal post; a failed post leaves them standing.

## 4. What the model and the operator are told

### 4.1 Roster description (`lib/tools/run-custom-tool.ts`)

- `RUN_CUSTOM_PREAMBLE`: amend the side-effects sentence to "…adjusting the scene's persistent state, the rolling character's own records, **or what they are wearing**, server-side, as part of the roll." The snapshot test changes (`npx jest lib/tools/__tests__/tool-definitions-snapshot.test.ts -u`); the diff must be description text only; accept the one-time prompt-cache bust (roster-change precedent).
- Per tool, under `revealOdds !== false`, the existing `Side effects:` line gains clauses: `wears Cloak of Night, Boots`, `takes off {{params.garment}}`, `clears hair`. Item references verbatim (placeholders included — vocabulary, not odds). Under `revealOdds: false`, nothing beyond the preamble.

### 4.2 Vocabulary (`lib/pascal/tool-vocabulary.ts`)

Three new flat lists on `ToolVocabulary`, sorted, references verbatim: `wears: string[]`, `takesOff: string[]`, `clearsSlots: string[]`. Item strings are also scanned with `collectPlaceholders` (a `{{params.garment}}` is a quoted parameter; a `{{metadata.x}}` a read). Update `isEmptyVocabulary`. The roster GET payload change is additive; `CustomToolReferences` in `components/chat/CustomToolRunDialog.tsx` gains the three optional fields and the reference panel a "may dress" / "may undress" / "may clear" line each, in the panel's existing phrasing.

## 5. Workbench

- **`lib/pascal/tool-draft.ts`** — `DraftEffect` gains a discriminator and the gesture fields:

  ```ts
  interface DraftEffect {
    id: string;
    when: …;                                  // unchanged
    kind: 'write' | 'wardrobe';
    // write
    target: string; valueKind: …; value: string;
    // wardrobe
    wardrobe: { action: WardrobeEffectAction; items: string[]; mode: 'wear' | 'replace' | 'add_to_slot'; slot: WardrobeItemType | '' };
  }
  ```

  Both halves always present on the draft (empty when unused) so switching kind in the form loses nothing until save. `effectToDraft` / `effectFromDraft` round-trip; `definitionFromDraft` emits only the active half. `validateDraftEffects` mirrors §1.2 exactly (same messages), plus a **warning** for an item reference carrying an unknown placeholder family. `DraftIssue.where` `{ section: 'effect'; id }` already exists.
- **`components/custom-tools/SideEffectsSection.tsx`** — each row gets a leading **Kind** select ("Write a value" / "Change the outfit"). For a wardrobe row: Action select; Items as a small list editor (one text input per item, add/remove, reorder not needed) with the hint "a title or id — `{{params.x}}` lets a parameter choose"; Mode select (wear only); Slot select over `WARDROBE_SLOT_TYPES` using the wardrobe's display labels (`formatSlotLabels`, `lib/schemas/wardrobe.types.ts`; see [wardrobe-list-legibility.md](wardrobe-list-legibility.md)), shown only when the action/mode wants one. Add/remove/error affordances are the card's existing ones.
- **ProvingBench** `MiniPascalBubble` dry-run block gains the gesture form: `→ wardrobe: wear “Cloak of Night”, “Boots” (would apply)` / `→ wardrobe: clear hair (would apply)`. The bench **cannot** tell whether the garment exists — it has no character — so the copy says "would attempt", and the help doc says why.
- `help/pascals-workbench.md`: the Side effects card's new Kind select and what the bench can and cannot prove.

## 6. Salon

Nothing new is rendered. The bubble stays the author's outcome message; Aurora's announcement follows through the existing job and names what changed. `pascalMeta.effects` carries the audit.

## 7. Documentation

- `help/custom-tools.md` — in "Recording consequences — side effects", a new subsection **"Dressing and undressing"**: the `wardrobe` key, the three actions, the mode and slot rules, "the rolling character and nobody else", title-or-id references and the `{{params.garment}}` trick, per-item fail-soft, that outfits (composites) wear and take off as wholes, and a complete one-click example — a `wear_regalia` tool with `"roll": { "min": 1, "max": 1 }`, one `when: true` outcome, and a `wear` effect — as the "run a custom tool to wear something" recipe. Steampunk voice. Keep `url` frontmatter and the In-Chat Navigation section.
- `help/wardrobe.md` — one paragraph cross-linking: a custom tool may now change an outfit; Aurora announces it like any other change.
- `help/chat-state.md` — no change (no state semantics changed).
- `docs/developer/features/complete/pascal-custom-tools.md` — the "Deferred to v2" and Security-constraints sections: note that an effect may now also be a wardrobe gesture, and that item references are templates (not expressions). Amend, don't delete.
- `docs/developer/features/complete/pascal-custom-tool-enhancements.md` §3.2/§3.4 — a "Correction" note pointing here.
- `docs/developer/DDL.md` — the `pascalMeta` prose (line ~949): the three `wardrobe.*` targets and their `next` shape.
- `docs/CHANGELOG.md` — plain voice, one entry.
- `docs/FEATURES.md` — the Pascal paragraph, one sentence.
- `.claude/commands/update-documentation.md` — rows for this spec (and move it to `complete/` on completion), the updated specimen, and the help pages touched.
- CLAUDE.md — the wardrobe chokepoint bullet lists the writers; add "and Pascal's `wardrobe` effects (`lib/pascal/wardrobe-effects.ts`)" to the sentence naming `wearItem` / `takeOffItem` callers.

## 8. Engineering tasks (phased; each phase compiles and tests green)

1. **Schema** — `custom-tool.types.ts` (gesture schema, exclusivity refine, narrowing helpers, `validateEffects` extension, caps), published JSON Schema, agreement-test corpus, `CUSTOM_TOOL_SPEC.json`.
2. **Core** — `ResolvedEffect` variant, predicate split, `resolveEffects` branch, `custom-tools-effects.test.ts` cases (rendered items, empty-after-render skip, `when` gating).
3. **Applier** — `lib/pascal/wardrobe-effects.ts` + `__tests__/unit/lib/pascal/wardrobe-effects.test.ts` (no character → nothing; pool load failure → nothing; wear by title / by id / archived skip / slot mismatch skip; take_off whole vs restricted; composite take-off removes leaves; clear_slot; per-item fail-soft continues; `notifyWardrobeChanged` called once and only when something landed; audit entry shapes; `'tool'` source). Mock the wear-ops and pool modules — bare `jest.mock` factories, global `jest` (project Jest conventions). `side-effects.ts` partition + ordering + `userId` param; `side-effects.test.ts` updated.
4. **Entrances** — `RunCustomToolContext.pendingWardrobeAnnouncements`, executor call site, both entrances' `applyCustomToolEffects` calls; DDL prose; pascalMeta doc-comments.
5. **Roster + vocabulary** — preamble/description lines + snapshot `-u`; `tool-vocabulary.ts` + test; dialog reference panel.
6. **Workbench** — draft round-trip + validation + tests; `SideEffectsSection` kind select and gesture fields; ProvingBench dry-run line.
7. **Docs** — everything in §7.

## 9. Verification

- `npx tsc`; `npm run lint`.
- `npx jest __tests__/unit/lib/pascal __tests__/unit/lib/services/pascal lib/tools/__tests__` (snapshot `-u` once; diff must be description text only).
- Live, against the V4test instance (never Friday): author a tool with a `wear` effect naming an outfit (composite) by title and a garment via `{{params.garment}}`, a `take_off` effect gated on `outcome.eq: failure`, and a `clear_slot` on `hair`. Run it (a) via `run_custom` from an LLM character — confirm one Aurora announcement for the turn even when the model also called `wardrobe_wear`; (b) via the composer popup **as** a character — confirm the avatar refresh and the immediate announcement; (c) via the popup **without** `asCharacterId` — confirm nothing changes and the debug log says why; (d) via the Proving Bench — confirm nothing persists; (e) in an autonomous room — confirm the gestures land through the parent's replay and the wear ledger credits each one once. Confirm `pascalMeta.effects` survives a `.qtap` export, and that an archived garment in `items` is skipped with bug 191's message while the other items still go on.

## Design decisions (resolved)

1. **A second effect kind, not a fourth `target.` family.** `target` + `value` is a write of one primitive; a gesture names several items and has modes and slots. Forcing it through `value` would have meant comma-separated titles inside a quoted expression string — the one ergonomic trap this format already regrets. A `wardrobe` object is self-describing.
2. **Templates, not expressions, for item references.** Choosing a garment by parameter is the whole reason to render at all; nobody needs to concatenate a title.
3. **Rolling character only.** The one principled line that already exists (`metadata.`, `progress.`): a tool writes to the sheet of whoever ran it. Cross-character undressing is a consent problem the format should not have.
4. **Sequential primitives, not a local batch.** The wear ledger's one-wear-per-transition contract and the job child's equipped-outfit overlay both exist precisely so callers can go gesture by gesture through the chokepoint. A local batch would have to re-derive `wornBundles` and lose the per-gesture credit.
5. **`'tool'` as the equip source.** The ledger does not distinguish which tool; adding `'pascal'` would be provenance for its own sake and touch the ledger's enum, its DDL and its exports.
6. **No new UI in the Salon.** Aurora already announces outfit changes; the audit lives in `pascalMeta`.

## Implementation notes

Where the build differs from, or settles a question left open by, the text above.

- **Three entrances, one call site.** The spec predates the shared run service. `pendingWardrobeAnnouncements` and `userId` are threaded through `runCustomTool` (`lib/pascal/run-service.ts`), which every entrance already calls; only the `run_custom` handler passes a set (from `tool-executor.ts`). The manual route and the trigger runner pass none, so their announcement is enqueued at once.
- **Per-action rules have one statement.** `wardrobeGestureProblems` (`custom-tool.types.ts`) returns the per-action problems as `{ field, message }`; load-time validation and the Workbench's draft check both read it, so the two say the same words.
- **`applyWardrobeEffects` returns `{ index, applied }[]`**, not bare `AppliedEffect[]`, so `applyCustomToolEffects` can merge writes and changes back into effect order (a stable sort on `index`; one gesture's entries keep their order). The write half was factored into `applyWriteEffects`, which returns the same shape.
- **Composite take-off is a shared helper.** `takeOffWearable` (`lib/wardrobe/wear-ops.ts`) takes a single garment off its slots (or the named one) and a composite off by every equipped item in its component graph, the composite's own id included in case it was stored whole. The `wardrobe_take_off` tool's `remove` did not do this — it filtered the composite's id out of slots holding only its leaves, removing nothing — and now calls the same helper.
- **Only changes are recorded.** A gesture that leaves the slots exactly as they were (re-wearing what is on, taking off what is not) produces no audit entry and does not, alone, trigger `notifyWardrobeChanged`. It is logged at debug as "the outfit was already so".
- **Slots are read once per run** (`loadCurrentSlots`), then carried forward from each primitive's return value — `applyDisplacement` returns the slots it computed, which is the job-child-safe echo. Each primitive still loads and commits on its own, as §3.1.4 requires.
- **`ResolvedWardrobeGesture.items` is always present**, empty for `clear_slot`.
- **The specimen.** `CUSTOM_TOOL_SPEC.json` had no `effects` array, and an effect object carries no `description`, so the wardrobe effect is explained through a new `gloves` string parameter whose description names it and whose value the `take_off` effect quotes.
- **Agreement corpus.** The two per-action rejections the spec listed for the corpus (`add_to_slot` without `slot`, `clear_slot` with `items`) are description-only in the mirror, so they live in the "deliberately weaker" assertions rather than the agreement table.
- **Parameter rename and references** in the Workbench (`renameParameterEverywhere`, `findParameterReferences`) cover wardrobe item templates.
- **Snapshot.** `tool-definitions-snapshot.test.ts` snapshots the static `run_custom` definition, which does not include the preamble, so no snapshot changed. The preamble sentence is asserted in `custom-tools-effects.test.ts`.

