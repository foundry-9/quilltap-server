/**
 * Pascal's Workbench — the editable draft model.
 *
 * The Builder never edits a definition object directly: it edits a `ToolDraft`,
 * a form-friendly mirror in which numbers are text (as inputs hold them),
 * conditions are flat chips, and unknown top-level keys ride in an opaque bag.
 * This module is the bijection between the two shapes:
 *
 * - {@link draftFromDefinition} — a schema-valid document into a draft.
 * - {@link serializeDraft} — a draft into the canonical document §6.2 emits:
 *   `$schema` first, known keys in declaration order, defaulted optionals
 *   omitted, unknown keys appended verbatim, 2-space indent, trailing newline.
 * - {@link validateDraft} — every blocking error and advisory warning the form
 *   can detect, so the UI renders states rather than re-deriving rules.
 *
 * CLIENT-SAFE: imports only the (equally client-safe) schema module and the
 * pure dice-notation grammar. The browser validates with the same code the
 * roster loader runs — that is the whole design.
 */

import type { z } from 'zod';
import {
  COMPARATOR_KEYS,
  CONTAINMENT_KEYS,
  IDENTIFIER_PATTERN,
  MAX_CHIP_LABEL_LENGTH,
  MAX_TRIGGERS,
  MIN_TRIGGER_PHRASE_LENGTH,
  MAX_TRIGGER_PHRASE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EFFECTS,
  MAX_LLM_OUTPUT_CEILING,
  MAX_LLM_PROMPT_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_OUTCOMES,
  MAX_PARAMETERS,
  MAX_TITLE_LENGTH,
  MAX_WHEN_GROUPS,
  ORDERING_KEYS,
  QtapCustomToolSchema,
  collectUnknownKeys,
  isInventoryRef,
  isParamRef,
  isStateRef,
  inventoryGestureProblems,
  parseEffectTarget,
  scanPlaceholders,
  valueTypeOf,
  wardrobeGestureProblems,
  type InventoryEffectAction,
  type InventoryRef,
  type WardrobeEffectAction,
  type WardrobeEffectMode,
  type WardrobeItemType,
  type ComparatorKey,
  type CustomToolEffect,
  type CustomToolOutcome,
  type CustomToolParameter,
  type EffectCondition,
  type EffectWhen,
  type NumberOrParamRef,
  type OutcomeState,
  type ParamComparator,
  type ParameterType,
  type GateComparator,
  type QtapCustomTool,
  type StateRef,
  type ToolGate,
  type ToolGateGroup,
  type ValueType,
  type Visibility,
  type WhenObject,
  effectWhenGroups,
  gateGroups,
  whenGroups,
} from './custom-tool.types';
import { aggregateKeyEndsInFold, isListAggregate, parseAggregateKey } from './inventory-aggregate';
import { parseDiceNotation } from './dice-notation';
import { INVENTORY_STATE_VALUES, parseInventoryOperand } from './inventory-subjects';
import { foldTriggerText, triggersContainedIn } from './trigger-phrases';
import { parseProgressKey } from '@/lib/progressions/schema';
import { parseExpression } from './expressions';
import { escapeRegex } from '@/lib/utils/regex';
import { GENERAL_CONTAINER, type WardrobeContainer } from '@/lib/wardrobe/wardrobe-container';
import type { CustomToolDestinations } from './workbench';

export type { ComparatorKey };

/** The `$schema` value the Builder writes when a file carries none. */
export const DEFAULT_SCHEMA_VALUE = '/schemas/qtap-custom-tool.schema.json';

let draftIdCounter = 0;
/**
 * Stable-enough ids for React keys within one session. Opaque: `prefix` only
 * helps a human reading the DOM, and every draft shape (this module's and the
 * Workbench sections') draws from the one counter.
 */
export function nextDraftId(prefix: string): string {
  draftIdCounter += 1;
  return `${prefix}-${draftIdCounter}`;
}

// ---------------------------------------------------------------------------
// Draft shapes
// ---------------------------------------------------------------------------

export interface DraftParameter {
  id: string;
  name: string;
  type: ParameterType;
  /**
   * Loose form value: text for number/integer/string, boolean for boolean, or a
   * `$state` reference object carried verbatim (the visual builder does not
   * author `$state` defaults, but round-trips them without loss).
   */
  defaultValue: string | boolean | StateRef | InventoryRef;
  description: string;
  /** Loose numeric text; '' means unset. Numeric types only. */
  min: string;
  max: string;
}

/**
 * A roll field or comparator operand: a literal (as text), a `$param` pick, or
 * a `$state` reference. The builder does not author the `state` kind, but
 * carries it verbatim so a hand-written `$state` roll field survives a round
 * trip; `fallback` is the numeric fallback as text.
 */
export type NumberOrParamValue =
  | { kind: 'literal'; text: string }
  | { kind: 'param'; name: string }
  | { kind: 'state'; path: string; fallback: string }
  /** A `$inventory` reference, carried verbatim like `$state`. */
  | { kind: 'inventory'; path: string; fallback: string };

export interface DraftRollRange {
  min: NumberOrParamValue;
  max: NumberOrParamValue;
  multiplier: NumberOrParamValue;
  offset: NumberOrParamValue;
  round: boolean;
}

/** What a condition chip tests. */
export type ConditionSubject =
  | { kind: 'value' }
  | { kind: 'roll' }
  | { kind: 'param'; name: string }
  | { kind: 'metadata'; key: string }
  /** A derived field of one of the character's timed progressions, keyed `<id>.<field>`. */
  | { kind: 'progress'; key: string }
  /** The LLM consult's answer. */
  | { kind: 'llm' }
  /** Whether the LLM consult succeeded — serializes to the comparator's `ok` key. */
  | { kind: 'llm-ok' }
  /** An Inventory object's state for the rolling character, keyed by reference (a template). */
  | { kind: 'inventory'; key: string }
  /** How many kin of an object the rolling character has equipped, keyed by reference. */
  | { kind: 'inventoryCount'; key: string }
  /** One attribute across a scope of the bag, keyed `<scope>.<field>` (always literal). */
  | { kind: 'inventoryAggregate'; key: string };

/**
 * How a chip joins the one before it. `or` starts a new group (a new line in
 * the Workbench); `and` — or absent, which every chip saved before OR existed
 * is — keeps it in the current one. Ignored on the first chip of a list.
 * AND binds tighter than OR.
 */
export type ConditionJoiner = 'and' | 'or';

/** A literal operand — the three kinds an author types straight into a chip. */
export type LiteralOperand =
  | { kind: 'number'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'boolean'; value: boolean };

/** A condition chip's right-hand side. */
export type ConditionOperand =
  | LiteralOperand
  | { kind: 'param'; name: string }
  /** A `$state` reference, carried verbatim (builder does not author it). */
  | { kind: 'state'; path: string; fallback: number | string | boolean }
  /** A `$inventory` reference, carried verbatim (builder does not author it). */
  | { kind: 'inventory'; path: string; fallback: number | string | boolean };

export interface DraftCondition {
  id: string;
  subject: ConditionSubject;
  comparator: ComparatorKey;
  operand: ConditionOperand;
  /** How this chip joins the one before it; absent means `and`. */
  joiner?: ConditionJoiner;
}

/**
 * Split a flat chip list into its groups at each `or` — the lines of the
 * Workbench and the elements of an any-of array. A list with no `or` is one
 * group; an empty list is none.
 */
export function groupsOf<C extends { joiner?: ConditionJoiner }>(conditions: readonly C[]): C[][] {
  const groups: C[][] = [];
  conditions.forEach((condition, index) => {
    if (index === 0 || condition.joiner === 'or') groups.push([]);
    groups[groups.length - 1].push(condition);
  });
  return groups;
}

/** Mark the first chip of every group after the first `or`, and flatten. */
function joinGroups<C extends { joiner?: ConditionJoiner }>(groups: readonly C[][]): C[] {
  return groups.flatMap((group, g) =>
    group.map((condition, i) => (g > 0 && i === 0 ? { ...condition, joiner: 'or' as const } : condition))
  );
}

/** One group, a bare object; several, an any-of array; none, undefined. */
function collapseGroups<T>(groups: readonly T[]): T | T[] | undefined {
  if (groups.length === 0) return undefined;
  return groups.length === 1 ? groups[0] : [...groups];
}

export interface DraftOutcome {
  id: string;
  /** True only for the pinned tail. Its conditions array stays empty. */
  catchAll: boolean;
  conditions: DraftCondition[];
  state: OutcomeState;
  message: string;
  /** The narrator's instruction for this outcome (`{{outcome.brief}}`); '' = none, and nothing is emitted. */
  brief: string;
}

/**
 * How the availability gate is posed. `none` emits neither key — the tool is
 * offered to everyone, which is what every file written before the gate existed
 * says by saying nothing.
 */
export type GateMode = 'none' | 'available' | 'withheld';

/**
 * One test in the availability gate. Deliberately narrower than
 * {@link DraftCondition}: the subject is always a metadata key, and the operand
 * is always a literal, because a gate is answered before there are parameters
 * or state to reference.
 */
export interface DraftGateCondition {
  id: string;
  /**
   * Which sheet this test reads. `metadata` is the character's own fact
   * sheet; `progress` is the derived progression sheet, keyed `<id>.<field>`;
   * `inventory` an object's state and `inventoryCount` its equipped kin, keyed
   * by a literal object reference.
   */
  subject: 'metadata' | 'progress' | 'inventory' | 'inventoryCount' | 'inventoryAggregate';
  /** The key this test reads, in that subject's own vocabulary. */
  key: string;
  comparator: ComparatorKey;
  operand: LiteralOperand;
  /** How this chip joins the one before it; absent means `and`. */
  joiner?: ConditionJoiner;
}

/**
 * One side effect, form-shaped.
 *
 * The form authors only the common `when` shapes — Always, or "on a given
 * outcome state". A hand-written richer condition (comparators, metadata,
 * llm…) is carried VERBATIM with a read-only badge, the established
 * `$state`-default precedent: the builder round-trips what it cannot author.
 */
export interface DraftEffect {
  id: string;
  when:
    | { kind: 'always' }
    | { kind: 'outcome-state'; state: OutcomeState }
    | { kind: 'verbatim'; when: EffectCondition };
  /**
   * Which half is active: a value write, a wardrobe gesture, an inventory
   * gesture, or a log line. All halves are always present on the draft so
   * switching kind in the form loses nothing until save; only the active half
   * is emitted.
   */
  kind: 'write' | 'wardrobe' | 'inventory' | 'log';
  /** The target verbatim: `state.…` or `metadata.…`. */
  target: string;
  /** How `value` serializes: a JSON number, a JSON boolean, or an expression string. */
  valueKind: 'literal-number' | 'literal-boolean' | 'expression';
  /** Loose form text ('true'/'false' for booleans, numeric text, or expression source). */
  value: string;
  /** The wardrobe gesture's fields. `mode` 'wear' and slot '' are the omitted forms. */
  wardrobe: DraftWardrobeGesture;
  /** The inventory gesture's fields. */
  inventory: DraftInventoryGesture;
  /** The log line's template (like an outcome message). Trimmed on save. */
  log: string;
}

/** An Inventory gesture, form-shaped. `equip` is emitted only on pick_up, and only when false. */
export interface DraftInventoryGesture {
  action: InventoryEffectAction;
  /** Object references (templates), as typed. Blank rows are dropped on save. */
  items: string[];
  equip: boolean;
}

/** The empty inventory half every draft effect carries. */
export function emptyDraftInventoryGesture(): DraftInventoryGesture {
  return { action: 'equip', items: [''], equip: true };
}

/** A wardrobe gesture, form-shaped. */
export interface DraftWardrobeGesture {
  action: WardrobeEffectAction;
  /** Item references (templates), as typed. Blank rows are dropped on save. */
  items: string[];
  mode: WardrobeEffectMode;
  slot: WardrobeItemType | '';
}

/** The empty wardrobe half a fresh (or write-kind) draft effect carries. */
export function emptyDraftWardrobeGesture(): DraftWardrobeGesture {
  return { action: 'wear', items: [''], mode: 'wear', slot: '' };
}

/** A fresh effect row of either kind, for the Workbench's Add button. */
export function newDraftEffect(kind: DraftEffect['kind'] = 'write'): DraftEffect {
  return {
    id: nextDraftId('effect'),
    when: { kind: 'always' },
    kind,
    target: '',
    valueKind: 'expression',
    value: '',
    wardrobe: emptyDraftWardrobeGesture(),
    inventory: emptyDraftInventoryGesture(),
    log: '',
  };
}

/**
 * Whose reach the Workbench shows when it displays or picks a wardrobe
 * reference: a character, or one shared wardrobe. Editor state, like the
 * roll form — never saved, never on {@link ToolDraft}, so `serializeDraft`
 * cannot see it. A tool has no character until it is run; the vantage is a
 * lens for the author, not a binding.
 */
export type WardrobeVantage =
  | { kind: 'character'; characterId: string }
  | { kind: 'container'; container: WardrobeContainer }
  | { kind: 'none' };

/**
 * The opening vantage for a definition stored in `mountPointId`: the one
 * character who can run a tool in their own vault, the shared wardrobe every
 * member of a group or project store will certainly reach, Quilltap General
 * for a General-store tool, and nothing for an unattached or unsaved file.
 * A character's vault wins over any other attachment the same mount carries —
 * it is the narrower, truer reach.
 */
export function defaultWardrobeVantage(
  mountPointId: string | null,
  destinations: CustomToolDestinations,
): WardrobeVantage {
  if (!mountPointId) return { kind: 'none' };
  const character = destinations.characters.find((c) => c.mountPointId === mountPointId);
  if (character) return { kind: 'character', characterId: character.characterId };
  const group = destinations.groups.find((g) => g.stores.some((store) => store.mountPointId === mountPointId));
  if (group) return { kind: 'container', container: { scope: 'group', id: group.groupId } };
  const project = destinations.projects.find((p) => p.stores.some((store) => store.mountPointId === mountPointId));
  if (project) return { kind: 'container', container: { scope: 'project', id: project.projectId } };
  if (destinations.general?.mountPointId === mountPointId) return { kind: 'container', container: GENERAL_CONTAINER };
  return { kind: 'none' };
}

export interface ToolDraft {
  name: string;
  title: string;
  /** Templated chip/heading label. '' = omitted — the title labels the chip. */
  chipLabel: string;
  /** Trigger phrases, as written. Empty = no `triggers` key emitted. */
  triggers: string[];
  description: string;
  disabled: boolean;
  /** Which availability clause the tool declares, if any. */
  gateMode: GateMode;
  /** The gate's tests. Kept while `gateMode` is 'none', like the roll fields. */
  gateConditions: DraftGateCondition[];
  revealOdds: boolean;
  defaultVisibility: Visibility;
  /** The rolling character announces the outcome instead of Pascal. False = no key emitted. */
  announceAsCharacter: boolean;
  parameters: DraftParameter[];
  /** `inventory`: the dice an object names (`{ "$inventory": …, "fallback": "1d4" }`). */
  rollForm: 'range' | 'dice' | 'inventory';
  /** The `$inventory` roll's path and dice fallback. Kept while another form is chosen. */
  rollInventory: { path: string; fallback: string };
  /** Dice-notation text. Kept even while `rollForm` is 'range' (§4.3). */
  rollDice: string;
  /** Range fields. Kept even while `rollForm` is 'dice' (§4.3). */
  rollRange: DraftRollRange;
  /** Whether the tool consults an LLM. Off = no `llm` key is emitted. */
  llmEnabled: boolean;
  /** The consult's prompt template. Kept even while disabled, like the roll fields. */
  llmPrompt: string;
  /** The author's own words for a failed consult. Kept even while disabled. */
  llmErrorMessage: string;
  /** Loose numeric text for `llm.maxOutput`; '' means the default cap. */
  llmMaxOutput: string;
  /** Side effects, in application order. Empty = no `effects` key emitted. */
  effects: DraftEffect[];
  /** Ordered; the last entry is always the catch-all. */
  outcomes: DraftOutcome[];
  /** The `$schema` value to re-emit. */
  schemaValue: string;
  /** Unknown top-level keys, verbatim and in original order (§6.3). */
  unknownKeys: Array<[string, unknown]>;
}

// ---------------------------------------------------------------------------
// New-draft defaults (§8)
// ---------------------------------------------------------------------------

export function defaultRollRange(): DraftRollRange {
  return {
    min: { kind: 'literal', text: '' },
    max: { kind: 'literal', text: '' },
    multiplier: { kind: 'literal', text: '' },
    offset: { kind: 'literal', text: '' },
    round: false,
  };
}

/**
 * A fresh draft: range roll at its defaults (no `roll` key emitted), no
 * parameters, odds revealed, public — plus one empty non-catch-all row (in
 * error state, so the author is led to write a real outcome) above the
 * mandatory catch-all.
 */
export function newDraft(): ToolDraft {
  return {
    name: '',
    title: '',
    chipLabel: '',
    triggers: [],
    description: '',
    disabled: false,
    gateMode: 'none',
    gateConditions: [],
    revealOdds: true,
    defaultVisibility: 'public',
    announceAsCharacter: false,
    parameters: [],
    rollForm: 'range',
    rollDice: '',
    rollInventory: { path: '', fallback: '' },
    rollRange: defaultRollRange(),
    llmEnabled: false,
    llmPrompt: '',
    llmErrorMessage: '',
    llmMaxOutput: '',
    effects: [],
    outcomes: [
      { id: nextDraftId('outcome'), catchAll: false, conditions: [], state: 'success', message: '', brief: '' },
      {
        id: nextDraftId('outcome'),
        catchAll: true,
        conditions: [],
        state: 'info',
        message: 'The wheel gives {{value}}.',
        brief: '',
      },
    ],
    schemaValue: DEFAULT_SCHEMA_VALUE,
    unknownKeys: [],
  };
}

// ---------------------------------------------------------------------------
// Definition → draft
// ---------------------------------------------------------------------------

/** Format a number the way an input holds it. */
function numberText(value: number): string {
  return String(value);
}

function rollFieldToValue(field: NumberOrParamRef | undefined): NumberOrParamValue {
  if (field === undefined) return { kind: 'literal', text: '' };
  if (isParamRef(field)) return { kind: 'param', name: field.$param };
  if (isStateRef(field)) return { kind: 'state', path: field.$state, fallback: String(field.fallback) };
  if (isInventoryRef(field)) return { kind: 'inventory', path: field.$inventory, fallback: String(field.fallback) };
  return { kind: 'literal', text: numberText(field) };
}

function operandToDraft(
  operand: number | string | boolean | { $param: string } | StateRef | InventoryRef
): ConditionOperand {
  if (isStateRef(operand)) return { kind: 'state', path: operand.$state, fallback: operand.fallback };
  if (isInventoryRef(operand)) return { kind: 'inventory', path: operand.$inventory, fallback: operand.fallback };
  if (isParamRef(operand)) return { kind: 'param', name: operand.$param };
  if (typeof operand === 'number') return { kind: 'number', text: numberText(operand) };
  if (typeof operand === 'boolean') return { kind: 'boolean', value: operand };
  return { kind: 'string', text: operand };
}

function comparatorToConditions(subject: ConditionSubject, comparator: ParamComparator): DraftCondition[] {
  const conditions: DraftCondition[] = [];
  for (const key of COMPARATOR_KEYS) {
    const operand = (comparator as Record<string, unknown>)[key];
    if (operand === undefined) continue;
    conditions.push({
      id: nextDraftId('cond'),
      subject,
      comparator: key,
      operand: operandToDraft(operand as number | string | boolean | { $param: string } | StateRef | InventoryRef),
    });
  }
  return conditions;
}

/**
 * Flatten a `when` into chips — one group, or every group of an any-of, the
 * first chip of each later group joined by `or`. Key order inside one
 * comparator follows {@link COMPARATOR_KEYS}; subjects follow the object's own
 * order (value first, then roll, params, metadata — the schema's declaration
 * order).
 */
export function conditionsFromWhen(when: WhenObject | WhenObject[]): DraftCondition[] {
  return joinGroups(whenGroups(when).map(conditionsFromWhenGroup));
}

function conditionsFromWhenGroup(when: WhenObject): DraftCondition[] {
  const conditions: DraftCondition[] = [];

  conditions.push(...comparatorToConditions({ kind: 'value' }, when as ParamComparator));

  if (when.roll !== undefined) {
    conditions.push(...comparatorToConditions({ kind: 'roll' }, when.roll as ParamComparator));
  }

  for (const [name, comparator] of Object.entries(when.params ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'param', name }, comparator));
  }

  for (const [key, comparator] of Object.entries(when.metadata ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'metadata', key }, comparator));
  }

  for (const [key, comparator] of Object.entries(when.progress ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'progress', key }, comparator));
  }

  if (when.llm !== undefined) {
    // `ok` is not a comparator key, so it gets its own chip kind; the loop
    // below only walks COMPARATOR_KEYS and never sees it.
    if (when.llm.ok !== undefined) {
      conditions.push({
        id: nextDraftId('cond'),
        subject: { kind: 'llm-ok' },
        comparator: 'eq',
        operand: { kind: 'boolean', value: when.llm.ok },
      });
    }
    conditions.push(...comparatorToConditions({ kind: 'llm' }, when.llm as ParamComparator));
  }

  for (const [key, comparator] of Object.entries(when.inventory ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'inventory', key }, comparator as ParamComparator));
  }

  for (const [key, comparator] of Object.entries(when.inventoryCount ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'inventoryCount', key }, comparator as ParamComparator));
  }

  for (const [key, comparator] of Object.entries(when.inventoryAggregate ?? {})) {
    conditions.push(...comparatorToConditions({ kind: 'inventoryAggregate', key }, comparator));
  }

  return conditions;
}

/**
 * Flatten an availability gate into chips. Key order inside one comparator
 * follows {@link COMPARATOR_KEYS}; keys follow the object's own order, and
 * `metadata` tests precede `progress` ones so a round trip is stable.
 */
export function gateConditionsFromGate(gate: ToolGate): DraftGateCondition[] {
  return joinGroups(gateGroups(gate).map(gateConditionsFromGroup));
}

function gateConditionsFromGroup(gate: ToolGateGroup): DraftGateCondition[] {
  const conditions: DraftGateCondition[] = [];

  const subjects: Array<[DraftGateCondition['subject'], Record<string, unknown> | undefined]> = [
    ['metadata', gate.metadata],
    ['progress', gate.progress],
    ['inventory', gate.inventory],
    ['inventoryCount', gate.inventoryCount],
    ['inventoryAggregate', gate.inventoryAggregate],
  ];

  for (const [subject, tests] of subjects) {
    for (const [key, comparator] of Object.entries(tests ?? {})) {
      for (const comparatorKey of COMPARATOR_KEYS) {
        const operand = (comparator as Record<string, unknown>)[comparatorKey];
        if (operand === undefined) continue;
        conditions.push({
          id: nextDraftId('gate'),
          subject,
          key,
          comparator: comparatorKey,
          operand:
            typeof operand === 'number'
              ? { kind: 'number', text: numberText(operand) }
              : typeof operand === 'boolean'
                ? { kind: 'boolean', value: operand }
                : { kind: 'string', text: String(operand) },
        });
      }
    }
  }

  return conditions;
}

/**
 * Reassemble gate chips into a `ToolGate` — the inverse of
 * {@link gateConditionsFromGate}. Chips on the same key merge into one
 * comparator object; incomplete chips (blank key, unparseable number) are
 * skipped, which is safe because {@link validateDraft} blocks save while any
 * exist.
 */
export function gateFromConditions(conditions: DraftGateCondition[]): ToolGate | undefined {
  const groups = groupsOf(conditions)
    .map(gateGroupFromConditions)
    .filter((group): group is ToolGateGroup => group !== undefined);
  return collapseGroups(groups);
}

function gateGroupFromConditions(conditions: DraftGateCondition[]): ToolGateGroup | undefined {
  const sheets: Record<DraftGateCondition['subject'], Record<string, Record<string, unknown>>> = {
    metadata: {},
    progress: {},
    inventory: {},
    inventoryCount: {},
    inventoryAggregate: {},
  };

  for (const condition of conditions) {
    const key = condition.key.trim();
    if (!key) continue;

    let operand: number | string | boolean;
    if (condition.operand.kind === 'number') {
      const n = parseNumberText(condition.operand.text);
      if (!Number.isFinite(n)) continue;
      operand = n;
    } else if (condition.operand.kind === 'boolean') {
      operand = condition.operand.value;
    } else {
      if (condition.operand.text === '' && CONTAINMENT_KEYS.has(condition.comparator)) continue;
      operand = condition.operand.text;
    }

    // A chip saved before the progress subject existed carries no `subject`;
    // metadata is what it always meant.
    const sheet = sheets[condition.subject ?? 'metadata'] ?? sheets.metadata;
    sheet[key] = sheet[key] ?? {};
    sheet[key][condition.comparator] = operand;
  }

  const gate: Record<string, unknown> = {};
  for (const subject of ['metadata', 'progress', 'inventory', 'inventoryCount', 'inventoryAggregate'] as const) {
    if (Object.keys(sheets[subject]).length > 0) gate[subject] = sheets[subject];
  }

  return Object.keys(gate).length > 0 ? (gate as ToolGateGroup) : undefined;
}

/**
 * True when an effect's condition is exactly "the winning outcome IS this
 * state" — the one shape (besides Always) the form authors directly. Anything
 * richer rides verbatim.
 */
function isPlainOutcomeEq(when: EffectWhen): when is EffectWhen & { outcome: { eq: OutcomeState } } {
  const keys = Object.keys(when).filter((key) => (when as Record<string, unknown>)[key] !== undefined);
  return (
    keys.length === 1 &&
    keys[0] === 'outcome' &&
    when.outcome?.eq !== undefined &&
    when.outcome.neq === undefined
  );
}

function effectToDraft(effect: CustomToolEffect): DraftEffect {
  let when: DraftEffect['when'];
  if (effect.when === undefined) {
    when = { kind: 'always' };
  } else if (!Array.isArray(effect.when) && isPlainOutcomeEq(effect.when)) {
    when = { kind: 'outcome-state', state: effect.when.outcome.eq };
  } else {
    // Carried verbatim with a read-only badge — the $state-default precedent.
    when = { kind: 'verbatim', when: effect.when };
  }

  if (effect.wardrobe) {
    const { action, items, mode, slot } = effect.wardrobe;
    return {
      id: nextDraftId('effect'),
      when,
      kind: 'wardrobe',
      target: '',
      valueKind: 'expression',
      value: '',
      wardrobe: {
        action,
        items: items && items.length > 0 ? [...items] : [''],
        mode: mode ?? 'wear',
        slot: slot ?? '',
      },
      inventory: emptyDraftInventoryGesture(),
      log: '',
    };
  }

  if (effect.inventory) {
    const { action, items, equip } = effect.inventory;
    return {
      id: nextDraftId('effect'),
      when,
      kind: 'inventory',
      target: '',
      valueKind: 'expression',
      value: '',
      wardrobe: emptyDraftWardrobeGesture(),
      inventory: { action, items: items.length > 0 ? [...items] : [''], equip: equip !== false },
      log: '',
    };
  }

  if (typeof effect.log === 'string') {
    return {
      id: nextDraftId('effect'),
      when,
      kind: 'log',
      target: '',
      valueKind: 'expression',
      value: '',
      wardrobe: emptyDraftWardrobeGesture(),
      inventory: emptyDraftInventoryGesture(),
      log: effect.log,
    };
  }

  return {
    id: nextDraftId('effect'),
    when,
    kind: 'write',
    target: effect.target ?? '',
    valueKind:
      typeof effect.value === 'number'
        ? 'literal-number'
        : typeof effect.value === 'boolean'
          ? 'literal-boolean'
          : 'expression',
    value: effect.value === undefined ? '' : String(effect.value),
    wardrobe: emptyDraftWardrobeGesture(),
    inventory: emptyDraftInventoryGesture(),
    log: '',
  };
}

/**
 * The `inventory` object a draft gesture emits: blank rows dropped, `equip`
 * only on pick_up and only when it is the non-default `false`.
 */
function inventoryFromDraft(gesture: DraftInventoryGesture): Record<string, unknown> {
  const items = gesture.items.map((item) => item.trim()).filter((item) => item.length > 0);
  return {
    action: gesture.action,
    items,
    ...(gesture.action === 'pick_up' && !gesture.equip ? { equip: false } : {}),
  };
}

/**
 * The `wardrobe` object a draft gesture emits: only the fields its action
 * uses, blank item rows dropped, the default mode omitted. Fields the action
 * does not use are left out rather than emitted and rejected — the form hides
 * them, so a stale value there is not the author's intent.
 */
function wardrobeFromDraft(gesture: DraftWardrobeGesture): Record<string, unknown> {
  const items = gesture.items.map((item) => item.trim()).filter((item) => item.length > 0);
  switch (gesture.action) {
    case 'wear':
      return {
        action: 'wear',
        items,
        ...(gesture.mode !== 'wear' ? { mode: gesture.mode } : {}),
        ...(gesture.mode === 'add_to_slot' && gesture.slot ? { slot: gesture.slot } : {}),
      };
    case 'take_off':
      return { action: 'take_off', items, ...(gesture.slot ? { slot: gesture.slot } : {}) };
    case 'clear_slot':
      return { action: 'clear_slot', ...(gesture.slot ? { slot: gesture.slot } : {}) };
  }
}

/** The `effects` entry a draft effect emits — the inverse of {@link effectToDraft}. */
function effectFromDraft(effect: DraftEffect): CustomToolEffect {
  let when: EffectCondition | undefined;
  if (effect.when.kind === 'outcome-state') {
    when = { outcome: { eq: effect.when.state } } as EffectWhen;
  } else if (effect.when.kind === 'verbatim') {
    when = effect.when.when;
  }

  if (effect.kind === 'wardrobe') {
    return {
      ...(when !== undefined ? { when } : {}),
      wardrobe: wardrobeFromDraft(effect.wardrobe),
    } as CustomToolEffect;
  }

  if (effect.kind === 'inventory') {
    return {
      ...(when !== undefined ? { when } : {}),
      inventory: inventoryFromDraft(effect.inventory),
    } as CustomToolEffect;
  }

  if (effect.kind === 'log') {
    return {
      ...(when !== undefined ? { when } : {}),
      log: effect.log.trim(),
    } as CustomToolEffect;
  }

  let value: number | boolean | string;
  if (effect.valueKind === 'literal-number') {
    value = parseNumberText(effect.value);
  } else if (effect.valueKind === 'literal-boolean') {
    value = effect.value === 'true';
  } else {
    value = effect.value;
  }

  return {
    ...(when !== undefined ? { when } : {}),
    target: effect.target,
    value,
  } as CustomToolEffect;
}

function outcomeToDraft(outcome: CustomToolOutcome): DraftOutcome {
  return {
    id: nextDraftId('outcome'),
    catchAll: outcome.when === true,
    conditions: outcome.when === true ? [] : conditionsFromWhen(outcome.when),
    state: outcome.state,
    message: outcome.message,
    brief: outcome.brief ?? '',
  };
}

function parameterToDraft(name: string, spec: CustomToolParameter): DraftParameter {
  return {
    id: nextDraftId('param'),
    name,
    type: spec.type,
    // A `$state` or `$inventory` default is carried verbatim; otherwise it is loose form text.
    defaultValue: isStateRef(spec.default) || isInventoryRef(spec.default)
      ? spec.default
      : spec.type === 'boolean'
        ? Boolean(spec.default)
        : String(spec.default),
    description: spec.description ?? '',
    min: spec.min === undefined ? '' : numberText(spec.min),
    max: spec.max === undefined ? '' : numberText(spec.max),
  };
}

/** The two ways a definition's text can fail, and what it is when it doesn't. */
export type ParsedDefinitionText =
  | { ok: true; raw: unknown; definition: QtapCustomTool }
  /** Not JSON at all; `reason` is the parser's own message. */
  | { ok: false; stage: 'json'; reason: string }
  /** JSON, but not a definition; `raw` is kept so unknown keys can still be read off it. */
  | { ok: false; stage: 'schema'; raw: unknown; error: z.ZodError };

/**
 * Parse-then-validate a definition's text — the one place the editor turns
 * bytes into a checked document, so JSON mode, repair mode, the form switch,
 * and the save path cannot disagree about what "valid" means.
 */
export function parseDefinitionText(text: string): ParsedDefinitionText {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, stage: 'json', reason: error instanceof Error ? error.message : String(error) };
  }
  const validated = QtapCustomToolSchema.safeParse(raw);
  if (!validated.success) return { ok: false, stage: 'schema', raw, error: validated.error };
  return { ok: true, raw, definition: validated.data };
}

/**
 * Build a draft from a raw parsed JSON document. Returns null unless the
 * document passes `QtapCustomToolSchema` — an invalid file belongs in JSON
 * repair mode, never in the form.
 */
export function draftFromDefinition(raw: unknown): ToolDraft | null {
  const parsed = QtapCustomToolSchema.safeParse(raw);
  if (!parsed.success) return null;
  const definition = parsed.data;

  const rawRecord = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  // The loader's own notion of "unknown" (which already excludes `$schema`),
  // kept as [key, value] pairs in the file's order so they re-emit verbatim.
  const unknown = new Set(collectUnknownKeys(raw));
  const unknownKeys: Array<[string, unknown]> = Object.entries(rawRecord).filter(([key]) => unknown.has(key));

  const isDice = typeof definition.roll === 'string';
  const inventoryRoll = isInventoryRef(definition.roll) ? definition.roll : undefined;
  const range =
    typeof definition.roll === 'object' && definition.roll !== null && !isInventoryRef(definition.roll)
      ? definition.roll
      : undefined;

  // At most one clause can be present — the schema rejects a file carrying both
  // — so the mode is simply whichever one is.
  const gate = definition.availableWhen ?? definition.withheldWhen;

  return {
    name: definition.name,
    title: definition.title ?? '',
    chipLabel: definition.chipLabel ?? '',
    triggers: [...(definition.triggers ?? [])],
    description: definition.description,
    disabled: definition.disabled ?? false,
    gateMode: definition.availableWhen ? 'available' : definition.withheldWhen ? 'withheld' : 'none',
    gateConditions: gate ? gateConditionsFromGate(gate) : [],
    revealOdds: definition.revealOdds ?? true,
    defaultVisibility: definition.defaultVisibility ?? 'public',
    announceAsCharacter: definition.announceAsCharacter ?? false,
    parameters: Object.entries(definition.parameters ?? {}).map(([name, spec]) => parameterToDraft(name, spec)),
    rollForm: isDice ? 'dice' : inventoryRoll ? 'inventory' : 'range',
    rollDice: isDice ? (definition.roll as string) : '',
    rollInventory: inventoryRoll
      ? { path: inventoryRoll.$inventory, fallback: String(inventoryRoll.fallback) }
      : { path: '', fallback: '' },
    rollRange: range
      ? {
          min: rollFieldToValue(range.min),
          max: rollFieldToValue(range.max),
          multiplier: rollFieldToValue(range.multiplier),
          offset: rollFieldToValue(range.offset),
          round: range.round ?? false,
        }
      : defaultRollRange(),
    llmEnabled: definition.llm !== undefined,
    llmPrompt: definition.llm?.prompt ?? '',
    llmErrorMessage: definition.llm?.errorMessage ?? '',
    llmMaxOutput: definition.llm?.maxOutput === undefined ? '' : numberText(definition.llm.maxOutput),
    effects: (definition.effects ?? []).map(effectToDraft),
    outcomes: definition.outcomes.map(outcomeToDraft),
    schemaValue:
      typeof rawRecord.$schema === 'string' && rawRecord.$schema.length > 0
        ? rawRecord.$schema
        : DEFAULT_SCHEMA_VALUE,
    unknownKeys,
  };
}

// ---------------------------------------------------------------------------
// Draft → definition (canonical serialization, §6.2)
// ---------------------------------------------------------------------------

/** Parse loose numeric text. NaN for blank or unparseable. */
export function parseNumberText(text: string): number {
  if (text.trim() === '') return NaN;
  return Number(text);
}

function valueToRollField(value: NumberOrParamValue): NumberOrParamRef | undefined {
  if (value.kind === 'param') return value.name ? { $param: value.name } : undefined;
  if (value.kind === 'state') {
    const fallback = parseNumberText(value.fallback);
    return Number.isFinite(fallback) ? { $state: value.path, fallback } : undefined;
  }
  if (value.kind === 'inventory') {
    const fallback = parseNumberText(value.fallback);
    return Number.isFinite(fallback) ? { $inventory: value.path, fallback } : undefined;
  }
  const n = parseNumberText(value.text);
  return Number.isFinite(n) ? n : undefined;
}

function operandFromDraft(
  operand: ConditionOperand
): number | string | boolean | { $param: string } | StateRef | InventoryRef | undefined {
  switch (operand.kind) {
    case 'param':
      return operand.name ? { $param: operand.name } : undefined;
    case 'state':
      return { $state: operand.path, fallback: operand.fallback };
    case 'inventory':
      return { $inventory: operand.path, fallback: operand.fallback };
    case 'number': {
      const n = parseNumberText(operand.text);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      return operand.value;
    case 'string':
      return operand.text;
  }
}

/**
 * Reassemble chips into a `when` — the exact inverse of
 * {@link conditionsFromWhen}: one object for one group, an any-of array for
 * several. Conditions on the same subject merge into one comparator object;
 * incomplete chips (blank operand, blank metadata key) are skipped, which is
 * safe because {@link validateDraft} blocks save while any exist.
 */
export function whenFromConditions(conditions: DraftCondition[]): WhenObject | WhenObject[] | undefined {
  const groups = groupsOf(conditions)
    .map(whenGroupFromConditions)
    .filter((group): group is WhenObject => group !== undefined);
  return collapseGroups(groups);
}

function whenGroupFromConditions(conditions: DraftCondition[]): WhenObject | undefined {
  const when: Record<string, unknown> = {};
  const roll: Record<string, unknown> = {};
  const params: Record<string, Record<string, unknown>> = {};
  const metadata: Record<string, Record<string, unknown>> = {};
  const progress: Record<string, Record<string, unknown>> = {};
  const inventory: Record<string, Record<string, unknown>> = {};
  const inventoryCount: Record<string, Record<string, unknown>> = {};
  const inventoryAggregate: Record<string, Record<string, unknown>> = {};
  const llm: Record<string, unknown> = {};

  for (const condition of conditions) {
    const operand = operandFromDraft(condition.operand);
    if (operand === undefined) continue;

    switch (condition.subject.kind) {
      case 'value':
        when[condition.comparator] = operand;
        break;
      case 'roll':
        roll[condition.comparator] = operand;
        break;
      case 'llm':
        llm[condition.comparator] = operand;
        break;
      case 'llm-ok':
        // The chip is "succeeded = <bool>" (or ≠, its complement); either way
        // it serializes to the comparator's single boolean `ok` key.
        if (typeof operand === 'boolean') {
          llm.ok = condition.comparator === 'neq' ? !operand : operand;
        }
        break;
      case 'param': {
        const name = condition.subject.name;
        if (!name) continue;
        params[name] = params[name] ?? {};
        params[name][condition.comparator] = operand;
        break;
      }
      case 'metadata': {
        const key = condition.subject.key;
        if (!key) continue;
        metadata[key] = metadata[key] ?? {};
        metadata[key][condition.comparator] = operand;
        break;
      }
      case 'progress': {
        const key = condition.subject.key;
        if (!key) continue;
        progress[key] = progress[key] ?? {};
        progress[key][condition.comparator] = operand;
        break;
      }
      case 'inventory':
      case 'inventoryCount': {
        const key = condition.subject.key;
        if (!key) continue;
        const sheet = condition.subject.kind === 'inventory' ? inventory : inventoryCount;
        sheet[key] = sheet[key] ?? {};
        sheet[key][condition.comparator] = operand;
        break;
      }
      case 'inventoryAggregate': {
        const key = condition.subject.key.trim();
        if (!key) continue;
        inventoryAggregate[key] = inventoryAggregate[key] ?? {};
        inventoryAggregate[key][condition.comparator] = operand;
        break;
      }
    }
  }

  if (Object.keys(roll).length > 0) when.roll = roll;
  if (Object.keys(params).length > 0) when.params = params;
  if (Object.keys(metadata).length > 0) when.metadata = metadata;
  if (Object.keys(progress).length > 0) when.progress = progress;
  if (Object.keys(llm).length > 0) when.llm = llm;
  if (Object.keys(inventory).length > 0) when.inventory = inventory;
  if (Object.keys(inventoryCount).length > 0) when.inventoryCount = inventoryCount;
  if (Object.keys(inventoryAggregate).length > 0) when.inventoryAggregate = inventoryAggregate;

  return Object.keys(when).length > 0 ? (when as WhenObject) : undefined;
}

function parameterFromDraft(param: DraftParameter): CustomToolParameter {
  const numeric = param.type === 'number' || param.type === 'integer';

  let defaultValue: number | string | boolean | StateRef | InventoryRef;
  if (isStateRef(param.defaultValue) || isInventoryRef(param.defaultValue)) {
    // Carried verbatim — the builder never authored it, and must not lose it.
    defaultValue = param.defaultValue;
  } else if (param.type === 'boolean') {
    defaultValue = Boolean(param.defaultValue);
  } else if (numeric) {
    defaultValue = parseNumberText(String(param.defaultValue));
  } else {
    defaultValue = String(param.defaultValue);
  }

  const spec: CustomToolParameter = { type: param.type, default: defaultValue };
  if (param.description.trim() !== '') spec.description = param.description;
  if (numeric) {
    const min = parseNumberText(param.min);
    const max = parseNumberText(param.max);
    if (Number.isFinite(min)) spec.min = min;
    if (Number.isFinite(max)) spec.max = max;
  }
  return spec;
}

/** The `roll` value a draft emits, or undefined when wholly default (§6.2). */
function rollFromDraft(draft: ToolDraft): QtapCustomTool['roll'] | undefined {
  if (draft.rollForm === 'dice') {
    return draft.rollDice.trim() === '' ? undefined : draft.rollDice.trim();
  }
  if (draft.rollForm === 'inventory') {
    const path = draft.rollInventory.path.trim();
    return path === '' ? undefined : { $inventory: path, fallback: draft.rollInventory.fallback.trim() };
  }

  const range: Record<string, unknown> = {};
  const min = valueToRollField(draft.rollRange.min);
  const max = valueToRollField(draft.rollRange.max);
  const multiplier = valueToRollField(draft.rollRange.multiplier);
  const offset = valueToRollField(draft.rollRange.offset);

  // Omit fields at their defaults so a re-saved minimal file stays minimal.
  if (min !== undefined && !(min === 0)) range.min = min;
  if (max !== undefined && !(max === 1)) range.max = max;
  if (multiplier !== undefined && !(multiplier === 1)) range.multiplier = multiplier;
  if (offset !== undefined && !(offset === 0)) range.offset = offset;
  if (draft.rollRange.round) range.round = true;

  return Object.keys(range).length > 0 ? (range as QtapCustomTool['roll']) : undefined;
}

/**
 * Serialize a draft to the plain object Save writes. Canonical: known keys in
 * declaration order, defaulted optionals omitted, unknown keys appended in
 * their original order, `$schema` first.
 */
export function definitionFromDraft(draft: ToolDraft): Record<string, unknown> {
  const doc: Record<string, unknown> = {};

  doc.$schema = draft.schemaValue || DEFAULT_SCHEMA_VALUE;
  doc.name = draft.name;
  if (draft.title.trim() !== '') doc.title = draft.title;
  if (draft.chipLabel.trim() !== '') doc.chipLabel = draft.chipLabel;
  if (draft.triggers.length > 0) doc.triggers = [...draft.triggers];
  doc.description = draft.description;
  if (draft.disabled) doc.disabled = true;
  if (draft.gateMode !== 'none') {
    const gate = gateFromConditions(draft.gateConditions);
    if (gate) doc[draft.gateMode === 'available' ? 'availableWhen' : 'withheldWhen'] = gate;
  }
  if (!draft.revealOdds) doc.revealOdds = false;
  if (draft.defaultVisibility !== 'public') doc.defaultVisibility = draft.defaultVisibility;
  if (draft.announceAsCharacter) doc.announceAsCharacter = true;

  if (draft.parameters.length > 0) {
    const parameters: Record<string, CustomToolParameter> = {};
    for (const param of draft.parameters) {
      if (!param.name) continue;
      parameters[param.name] = parameterFromDraft(param);
    }
    if (Object.keys(parameters).length > 0) doc.parameters = parameters;
  }

  const roll = rollFromDraft(draft);
  if (roll !== undefined) doc.roll = roll;

  if (draft.llmEnabled) {
    const llm: Record<string, unknown> = { prompt: draft.llmPrompt, errorMessage: draft.llmErrorMessage };
    // Omitted while blank — the default cap is the runtime's, not the file's.
    const maxOutput = parseNumberText(draft.llmMaxOutput);
    if (Number.isFinite(maxOutput)) llm.maxOutput = maxOutput;
    doc.llm = llm;
  }

  if (draft.effects.length > 0) {
    doc.effects = draft.effects.map(effectFromDraft);
  }

  doc.outcomes = draft.outcomes.map((outcome) => {
    // Omitted while blank — a brief is optional, and most tables have none.
    const brief = outcome.brief.trim() === '' ? {} : { brief: outcome.brief };
    if (outcome.catchAll) {
      return { when: true, message: outcome.message, state: outcome.state, ...brief };
    }
    return {
      when: whenFromConditions(outcome.conditions) ?? {},
      message: outcome.message,
      state: outcome.state,
      ...brief,
    };
  });

  for (const [key, value] of draft.unknownKeys) {
    doc[key] = value;
  }

  return doc;
}

/** The exact bytes Save writes: 2-space indent, trailing newline. */
export function serializeDraft(draft: ToolDraft): string {
  return `${JSON.stringify(definitionFromDraft(draft), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Validation (§6.1 and the §8 checklist)
// ---------------------------------------------------------------------------

export interface DraftIssue {
  /** Blocking errors gate save; warnings are advisory underlines. */
  severity: 'error' | 'warning';
  /** Where in the form the issue lives, for anchoring UI state. */
  where:
    | { section: 'identity'; field: 'name' | 'title' | 'chipLabel' | 'description' }
    | { section: 'triggers'; index?: number }
    | { section: 'gate'; conditionId?: string }
    | { section: 'options' }
    | { section: 'parameter'; id: string; field: 'name' | 'default' | 'min' | 'max' }
    | { section: 'roll'; field?: 'dice' | 'inventory' | 'min' | 'max' | 'multiplier' | 'offset' }
    | { section: 'llm'; field: 'prompt' | 'errorMessage' | 'maxOutput' }
    | { section: 'effect'; id: string; field?: 'log' }
    | { section: 'outcome'; id: string; conditionId?: string }
    | { section: 'message'; id: string }
    | { section: 'brief'; id: string };
  message: string;
}

const err = (where: DraftIssue['where'], message: string): DraftIssue => ({ severity: 'error', where, message });
const warn = (where: DraftIssue['where'], message: string): DraftIssue => ({ severity: 'warning', where, message });

/** Names of declared numeric parameters. */
export function numericParamNames(draft: ToolDraft): string[] {
  return draft.parameters
    .filter((p) => p.type === 'number' || p.type === 'integer')
    .map((p) => p.name)
    .filter((name) => name.length > 0);
}

function validateNumberOrParam(
  value: NumberOrParamValue,
  field: 'min' | 'max' | 'multiplier' | 'offset',
  draft: ToolDraft,
  issues: DraftIssue[]
): void {
  if (value.kind === 'param') {
    if (!value.name) {
      issues.push(err({ section: 'roll', field }, `${field} needs a parameter picked`));
    } else if (!numericParamNames(draft).includes(value.name)) {
      issues.push(err({ section: 'roll', field }, `${field} references "${value.name}", which is not a declared numeric parameter`));
    }
    return;
  }
  if (value.kind === 'state' || value.kind === 'inventory') {
    // A `$state` or `$inventory` roll field is valid iff its fallback is a
    // finite number — the same load-time rule `validateRollRefs` enforces.
    if (!Number.isFinite(parseNumberText(value.fallback))) {
      issues.push(err({ section: 'roll', field }, `${field} $${value.kind} fallback must be a number`));
    }
    return;
  }
  if (value.text.trim() !== '' && !Number.isFinite(parseNumberText(value.text))) {
    issues.push(err({ section: 'roll', field }, `${field} is not a number`));
  }
}

/**
 * How one templated field treats `{{llm}}`: legitimate whenever the oracle is
 * on (messages, the chip label), or never — the consult prompt cannot quote an
 * answer that does not exist yet.
 */
type LlmPlaceholderRule = 'warn-if-disabled' | 'forbid';

/**
 * The placeholder audit every templated field shares — outcome messages, the
 * chip label, and the consult prompt. Warnings only: an unknown placeholder
 * renders as written, per the runtime convention, and the load-time schema
 * imposes no reference rule on any of these strings.
 *
 * Metadata keys are undeclared by nature: every `{{metadata.<key>}}` is
 * presumptively legitimate, and an absent key rendering verbatim at run time
 * is the runtime's convention, not an authoring error (§4.4.2). `{{state.…}}`
 * is the same kind of thing, but only the chip label has ever admitted it
 * (`allowState`); the message and prompt audits still flag it as unknown.
 */
function auditPlaceholders(
  text: string,
  where: DraftIssue['where'],
  draft: ToolDraft,
  issues: DraftIssue[],
  rules: { llm: LlmPlaceholderRule; allowState: boolean }
): void {
  const declaredParams = new Set(draft.parameters.map((p) => p.name));
  for (const { key, ref } of scanPlaceholders(text)) {
    switch (ref.kind) {
      case 'value':
      case 'roll':
      case 'metadata':
      // `progress.<id>.<field>` and `{{now}}` are always resolvable at run
      // time — the sheet is derived, not authored — so neither can be
      // warned about from the draft the way an undeclared parameter can.
      case 'progress':
      case 'now':
      // `{{character}}` names whoever rolls; a run nobody made renders it as
      // written, which is the runtime's convention rather than an authoring slip.
      case 'character':
      // `{{inventory.<ref>.<field>}}` reads the rolling character's bag at run
      // time; an absent object renders as written, the metadata convention.
      case 'inventory':
        break;
      // `{{outcome.*}}` names the winning row; the consult prompt's own
      // rules (it cannot be read when a row tests the consult) are in
      // `validateLlmPromptPlaceholders`, and a brief's in `validateOutcomeBrief`.
      case 'outcome':
        break;
      case 'dice':
        if (draft.rollForm === 'range') {
          issues.push(warn(where, '{{dice}} renders as an empty string outside the dice form'));
        }
        break;
      case 'llm':
        if (rules.llm === 'forbid') {
          issues.push(warn(where, '{{llm}} is not available here — the consult cannot quote its own answer'));
        } else if (!draft.llmEnabled) {
          issues.push(warn(where, '{{llm}} renders as written unless the LLM consult is enabled'));
        }
        break;
      case 'params':
        if (!declaredParams.has(ref.name)) {
          issues.push(warn(where, `{{${key}}} names no declared parameter — it will render as written`));
        }
        break;
      case 'state':
        if (!rules.allowState) {
          issues.push(warn(where, `{{${key}}} is not a placeholder this build knows — it will render as written`));
        }
        break;
      case 'unknown':
        issues.push(warn(where, `{{${key}}} is not a placeholder this build knows — it will render as written`));
        break;
    }
  }
}

function validateMessagePlaceholders(outcome: DraftOutcome, draft: ToolDraft, issues: DraftIssue[]): void {
  auditPlaceholders(outcome.message, { section: 'message', id: outcome.id }, draft, issues, {
    llm: 'warn-if-disabled',
    allowState: false,
  });
}

/**
 * The chip label's placeholder audit — the same families an outcome message
 * takes, `{{llm}}` included (the label renders after the consult, so quoting
 * the answer is legitimate iff the oracle is enabled).
 */
function validateChipLabelPlaceholders(draft: ToolDraft, issues: DraftIssue[]): void {
  auditPlaceholders(draft.chipLabel, { section: 'identity', field: 'chipLabel' }, draft, issues, {
    llm: 'warn-if-disabled',
    allowState: true,
  });
}

/**
 * The consult prompt's own placeholder audit — the same families an outcome
 * message takes, minus `{{llm}}`: the consult cannot quote an answer that
 * does not exist yet.
 */
function validateLlmPromptPlaceholders(draft: ToolDraft, issues: DraftIssue[]): void {
  const where: DraftIssue['where'] = { section: 'llm', field: 'prompt' };
  auditPlaceholders(draft.llmPrompt, where, draft, issues, {
    llm: 'forbid',
    allowState: false,
  });

  // `{{outcome.*}}` needs the table dealt first, which a row that tests the
  // consult forbids — the load-time schema rejects it, so the form does too.
  if (draftTableTestsLlm(draft)) {
    for (const { key, ref } of scanPlaceholders(draft.llmPrompt)) {
      if (ref.kind === 'outcome') {
        issues.push(
          err(
            where,
            `{{${key}}} is not available here — an outcome tests the consult's answer, so the table cannot be dealt before the consult`
          )
        );
      }
    }
  }

  // A prompt that compares numbers asks a cheap model to redo arithmetic the
  // table has already done (bug 257). Advisory: the oracle form is legitimate
  // when the model is genuinely judging, but a comparison between two figures is not.
  if (PROMPT_COMPARISON_PATTERN.test(draft.llmPrompt) || PROMPT_DO_THE_MATH_PATTERN.test(draft.llmPrompt)) {
    issues.push(
      warn(
        where,
        'this prompt asks the model to compare numbers — the outcome table can decide that for you. Give each outcome a brief and write {{outcome.brief}} here, so the model narrates a verdict it was told'
      )
    );
  }
}

/** `{{x}} >= {{y}}`, with any of the numeric placeholder families on either side of an ordering or equality sign. */
const PROMPT_COMPARISON_PATTERN =
  /\{\{\s*(?:value|roll|params\.[^}]+|state\.[^}]+|progress\.[^}]+|metadata\.[^}]+)\s*\}\}\s*(?:>=|<=|>|<|==|=|≥|≤)\s*\{\{|\{\{[^}]+\}\}\s*(?:>=|<=|>|<|==|≥|≤)\s*(?:\{\{|-?\d)/;
const PROMPT_DO_THE_MATH_PATTERN = /\b(?:do|actually do|work out|compute)\s+the\s+(?:math|arithmetic|maths|sum)\b/i;

/** True when any outcome row tests the consult's answer (`llm`) or its success (`llm-ok`). */
export function draftTableTestsLlm(draft: Pick<ToolDraft, 'outcomes'>): boolean {
  return draft.outcomes.some((outcome) =>
    outcome.conditions.some((c) => c.subject.kind === 'llm' || c.subject.kind === 'llm-ok')
  );
}

/** True when the consult prompt quotes the winning row's brief. */
export function promptReadsBrief(draft: Pick<ToolDraft, 'llmEnabled' | 'llmPrompt'>): boolean {
  return (
    draft.llmEnabled &&
    scanPlaceholders(draft.llmPrompt).some(({ ref }) => ref.kind === 'outcome' && ref.field === 'brief')
  );
}

/**
 * The audit's brief check: which outcome rows can win (`hits > 0` in the
 * thousand-hand deal) yet carry no brief while the prompt reads
 * `{{outcome.brief}}` — those would put the placeholder, as written, in front
 * of the model. Returns the row indexes; empty when the prompt reads no brief.
 */
export function reachableOutcomesMissingBrief(
  draft: Pick<ToolDraft, 'llmEnabled' | 'llmPrompt' | 'outcomes'>,
  hits: ReadonlyArray<{ index: number; hits: number }>
): number[] {
  if (!promptReadsBrief(draft)) return [];
  return hits
    .filter((entry) => entry.hits > 0 && (draft.outcomes[entry.index]?.brief.trim() ?? '') === '')
    .map((entry) => entry.index);
}

/**
 * A brief's own audit. It renders before the consult, so it cannot quote the
 * answer or the winning row (errors, as at load); it needs the consult
 * enabled to be read at all (an error, as at load); and the usual placeholder
 * rules apply to the rest.
 */
function validateOutcomeBrief(outcome: DraftOutcome, draft: ToolDraft, issues: DraftIssue[]): void {
  if (outcome.brief.trim() === '') return;
  const where: DraftIssue['where'] = { section: 'brief', id: outcome.id };
  if (outcome.brief.length > MAX_MESSAGE_LENGTH) {
    issues.push(err(where, `a brief is over ${MAX_MESSAGE_LENGTH} characters`));
  }
  if (!draft.llmEnabled) {
    issues.push(err(where, 'has a brief, but the LLM consult is not enabled to read it'));
  }
  for (const { key, ref } of scanPlaceholders(outcome.brief)) {
    if (ref.kind === 'llm' || ref.kind === 'outcome') {
      issues.push(err(where, `a brief is written before the consult runs and cannot quote {{${key}}}`));
    }
  }
  auditPlaceholders(outcome.brief, where, draft, issues, { llm: 'forbid', allowState: false });
}

/**
 * The `inventoryAggregate` key audit shared by outcome chips and gate chips:
 * the key must parse (the loader's own reason, verbatim); a list orders
 * nothing; a number holds no text; a metadata key whose last segment is a
 * fold word reads as that fold. Returns false when the chip is broken enough
 * that further checks would only repeat the complaint.
 */
function auditAggregateKey(
  key: string,
  comparator: ComparatorKey,
  where: DraftIssue['where'],
  issues: DraftIssue[]
): boolean {
  const trimmed = key.trim();
  if (trimmed === '') {
    issues.push(err(where, 'an inventory aggregate needs a key, like equipped.names'));
    return false;
  }
  if (trimmed.includes('{{')) {
    issues.push(err(where, 'an aggregate key is literal — it names a scope and a field, never an object'));
    return false;
  }
  const parsed = parseAggregateKey(trimmed);
  if (!parsed.ok) {
    issues.push(err(where, parsed.reason));
    return false;
  }
  const list = isListAggregate(parsed.parsed);
  if (list && ORDERING_KEYS.has(comparator)) {
    issues.push(err(where, `${comparator} cannot order a list; fold it with .min/.max/.sum/.count`));
    return false;
  }
  if (!list && CONTAINMENT_KEYS.has(comparator)) {
    issues.push(err(where, `${trimmed} is a number, and a number holds no text`));
    return false;
  }
  if (aggregateKeyEndsInFold(parsed.parsed) && parsed.parsed.field.kind === 'metadata') {
    issues.push(
      warn(
        where,
        `reads as the .${parsed.parsed.field.fold} of metadata key "${parsed.parsed.field.key}" — a key literally ending in .${parsed.parsed.field.fold} cannot be listed`
      )
    );
  }
  return true;
}

function validateCondition(
  condition: DraftCondition,
  outcome: DraftOutcome,
  draft: ToolDraft,
  issues: DraftIssue[]
): void {
  const where: DraftIssue['where'] = { section: 'outcome', id: outcome.id, conditionId: condition.id };
  const paramByName = new Map(draft.parameters.map((p) => [p.name, p] as const));

  // Subject completeness.
  if (condition.subject.kind === 'metadata' && condition.subject.key.trim() === '') {
    issues.push(err(where, 'a metadata condition needs a key'));
    return;
  }
  if (condition.subject.kind === 'progress') {
    // Same parser the load-time schema uses, so the form and the loader agree
    // about what a progress key is — and the author reads the specific reason
    // rather than one generic sentence covering four different mistakes.
    const parsed = parseProgressKey(condition.subject.key.trim());
    if (!parsed.ok) {
      issues.push(err(where, `a progress condition ${parsed.reason}`));
      return;
    }
  }
  if (condition.subject.kind === 'inventory' || condition.subject.kind === 'inventoryCount') {
    if (condition.subject.key.trim() === '') {
      issues.push(err(where, 'an inventory condition needs an object reference'));
      return;
    }
    for (const { key, ref } of scanPlaceholders(condition.subject.key)) {
      if (ref.kind === 'params' && !paramByName.has(ref.name)) {
        issues.push(err(where, `{{${key}}} names no declared parameter`));
      }
    }
  }
  if (condition.subject.kind === 'inventory') {
    // A state has no order and holds no substring: = or ≠, against one of the
    // four states (or a string parameter).
    if (ORDERING_KEYS.has(condition.comparator) || CONTAINMENT_KEYS.has(condition.comparator)) {
      issues.push(err(where, 'an inventory state can only be tested with = or ≠'));
      return;
    }
    const operand = condition.operand;
    if (operand.kind === 'param') {
      const target = paramByName.get(operand.name);
      if (!operand.name || !target) {
        issues.push(err(where, `compares against "${operand.name || '(no parameter)'}", which is not declared`));
      } else if (valueTypeOf(target.type) !== 'string') {
        issues.push(err(where, `an inventory state compares with a string; "${operand.name}" is ${target.type}`));
      }
    } else if (operand.kind !== 'string' || !(INVENTORY_STATE_VALUES as readonly string[]).includes(operand.text)) {
      issues.push(err(where, 'pick a state: equipped, carried, reachable or absent'));
    }
    return;
  }
  if (condition.subject.kind === 'inventoryCount' && CONTAINMENT_KEYS.has(condition.comparator)) {
    issues.push(err(where, 'an equipped count is a number, and a number holds no text'));
    return;
  }
  if (condition.subject.kind === 'inventoryAggregate') {
    if (!auditAggregateKey(condition.subject.key, condition.comparator, where, issues)) return;
  }
  if ((condition.subject.kind === 'llm' || condition.subject.kind === 'llm-ok') && !draft.llmEnabled) {
    issues.push(err(where, 'tests the LLM consult, but the consult is not enabled'));
    return;
  }
  if (
    condition.subject.kind === 'llm-ok' &&
    (ORDERING_KEYS.has(condition.comparator) || CONTAINMENT_KEYS.has(condition.comparator))
  ) {
    issues.push(err(where, 'whether the consult succeeded can only be tested with = or ≠'));
    return;
  }
  if (condition.subject.kind === 'param') {
    const target = paramByName.get(condition.subject.name);
    if (!target) {
      issues.push(err(where, `tests "${condition.subject.name}", which is not a declared parameter`));
      return;
    }
    // Ordering a non-numeric parameter is a load-time rejection; the UI never
    // offers it, but a parameter's type may have changed under the chip.
    if (ORDERING_KEYS.has(condition.comparator) && valueTypeOf(target.type) !== 'number') {
      issues.push(err(where, `${condition.comparator} orders "${condition.subject.name}", which is not numeric`));
    }
  }

  // Containment gets its own complete audit — subject and operand must both be
  // text where their types are knowable — and then returns, so the eq/neq and
  // ordering rules below never double-report the same chip.
  if (CONTAINMENT_KEYS.has(condition.comparator)) {
    const subjectType = subjectValueType(condition.subject, paramByName);
    if (subjectType !== null && subjectType !== 'string') {
      issues.push(err(where, `${condition.comparator} searches a ${subjectType}, and only text can contain text`));
    }
    const operand = condition.operand;
    if (operand.kind === 'number' || operand.kind === 'boolean') {
      issues.push(err(where, `${condition.comparator} needs text to look for`));
    } else if (operand.kind === 'string' && operand.text === '') {
      issues.push(err(where, 'the substring to look for must not be empty'));
    } else if (operand.kind === 'param') {
      const target = paramByName.get(operand.name);
      if (!operand.name || !target) {
        issues.push(err(where, `compares against "${operand.name || '(no parameter)'}", which is not declared`));
      } else if (valueTypeOf(target.type) !== 'string') {
        issues.push(err(where, `${condition.comparator} needs text to look for; "${operand.name}" is ${target.type}`));
      }
    }
    return;
  }

  // Operand completeness and typing.
  const operand = condition.operand;
  if (operand.kind === 'number' && !Number.isFinite(parseNumberText(operand.text))) {
    issues.push(err(where, 'the comparison needs a number'));
  }
  if (operand.kind === 'param') {
    const target = paramByName.get(operand.name);
    if (!operand.name || !target) {
      issues.push(err(where, `compares against "${operand.name || '(no parameter)'}", which is not declared`));
    } else if (ORDERING_KEYS.has(condition.comparator) && valueTypeOf(target.type) !== 'number') {
      issues.push(err(where, `${condition.comparator} needs a numeric operand; "${operand.name}" is ${target.type}`));
    } else if (
      condition.subject.kind !== 'metadata' &&
      !ORDERING_KEYS.has(condition.comparator)
    ) {
      // eq/neq: subject and operand types must agree — except for metadata
      // subjects, whose stored type is unknowable at authoring time.
      const subjectType = subjectValueType(condition.subject, paramByName);
      if (subjectType !== null && valueTypeOf(target.type) !== subjectType) {
        issues.push(
          err(where, `${condition.comparator} compares a ${subjectType} with "${operand.name}", which is ${target.type}`)
        );
      }
    }
  }
  if (
    (operand.kind === 'string' || operand.kind === 'boolean') &&
    condition.subject.kind !== 'metadata'
  ) {
    const subjectType = subjectValueType(condition.subject, paramByName);
    if (ORDERING_KEYS.has(condition.comparator)) {
      issues.push(err(where, `${condition.comparator} can only order numbers`));
    } else if (subjectType !== null && subjectType !== operand.kind) {
      issues.push(err(where, `${condition.comparator} compares a ${subjectType} with a ${operand.kind} — this can never hold`));
    }
  }
  if (
    operand.kind === 'number' &&
    condition.subject.kind === 'param' &&
    !ORDERING_KEYS.has(condition.comparator)
  ) {
    const subjectType = subjectValueType(condition.subject, paramByName);
    if (subjectType !== null && subjectType !== 'number') {
      issues.push(err(where, `${condition.comparator} compares a ${subjectType} with a number — this can never hold`));
    }
  }
}

/**
 * The availability gate's own audit.
 *
 * Every rule here is one the loader would enforce anyway; what the form adds is
 * saying so beside the chip rather than in a rejection badge after the write.
 * Note what is deliberately NOT checked: whether a character anywhere actually
 * carries the key. Metadata keys are undeclared by nature, and a gate written
 * for a sheet the author has not filled in yet is an ordinary state of affairs.
 */
function validateGate(draft: ToolDraft, issues: DraftIssue[]): void {
  if (draft.gateMode === 'none') return;

  const usable = draft.gateConditions.filter((condition) => condition.key.trim() !== '');
  if (usable.length === 0) {
    issues.push(
      err(
        { section: 'gate' },
        'the gate must test something — add a condition, or set the tool back to “anyone may reach for it”'
      )
    );
  }

  const groups = groupsOf(draft.gateConditions);
  if (groups.length > MAX_WHEN_GROUPS) {
    issues.push(err({ section: 'gate' }, `at most ${MAX_WHEN_GROUPS} lines joined by OR`));
  }
  for (const group of groups) validateGateGroup(group, issues);
}

/** One line of the gate — slots are per line, as they are per group in the file. */
function validateGateGroup(conditions: DraftGateCondition[], issues: DraftIssue[]): void {
  const seenSlots = new Set<string>();
  for (const condition of conditions) {
    const where: DraftIssue['where'] = { section: 'gate', conditionId: condition.id };

    if (condition.subject === 'inventoryAggregate') {
      if (!auditAggregateKey(condition.key, condition.comparator, where, issues)) continue;
    } else if (condition.key.trim() === '') {
      issues.push(
        err(where, condition.subject === 'inventory' || condition.subject === 'inventoryCount'
          ? 'a gate condition needs an object reference'
          : 'a gate condition needs a metadata key')
      );
      continue;
    }

    if (condition.subject === 'inventory' || condition.subject === 'inventoryCount') {
      if (condition.key.includes('{{')) {
        issues.push(err(where, 'a gate is answered before any parameter exists — name the object literally'));
        continue;
      }
      if (condition.subject === 'inventory') {
        if (condition.comparator !== 'eq' && condition.comparator !== 'neq') {
          issues.push(err(where, 'an inventory state can only be tested with = or ≠'));
        } else if (
          condition.operand.kind !== 'string' ||
          !(INVENTORY_STATE_VALUES as readonly string[]).includes(condition.operand.text)
        ) {
          issues.push(err(where, 'pick a state: equipped, carried, reachable or absent'));
        }
        const slot = `${condition.subject}:${gateConditionSlotKey(condition)}`;
        if (seenSlots.has(slot)) issues.push(err(where, 'a line of the gate can test this object with this comparator only once'));
        seenSlots.add(slot);
        continue;
      }
      if (CONTAINMENT_KEYS.has(condition.comparator) || condition.operand.kind !== 'number') {
        issues.push(err(where, 'an equipped count compares with a number'));
        continue;
      }
    }

    const slot = `${condition.subject ?? 'metadata'}:${gateConditionSlotKey(condition)}`;
    if (seenSlots.has(slot)) {
      issues.push(err(where, 'a line of the gate can test this key with this comparator only once'));
    }
    seenSlots.add(slot);

    const operand = condition.operand;
    if (ORDERING_KEYS.has(condition.comparator) && operand.kind !== 'number') {
      issues.push(err(where, `${condition.comparator} can only order numbers`));
    } else if (CONTAINMENT_KEYS.has(condition.comparator)) {
      if (operand.kind !== 'string') {
        issues.push(err(where, `${condition.comparator} needs text to look for`));
      } else if (operand.text === '') {
        issues.push(err(where, 'the substring to look for must not be empty'));
      }
    } else if (operand.kind === 'number' && !Number.isFinite(parseNumberText(operand.text))) {
      issues.push(err(where, 'the comparison needs a number'));
    }
  }
}

/**
 * The side effects' audit — the same rules `validateEffects` enforces at load
 * time, said beside the row instead of on a rejection badge: the target
 * parses (underscore guard included), an expression parses and names only
 * declared parameters, and anything touching the oracle needs it enabled.
 */
function validateDraftEffects(draft: ToolDraft, issues: DraftIssue[]): void {
  if (draft.effects.length > MAX_EFFECTS) {
    issues.push(err({ section: 'options' }, `at most ${MAX_EFFECTS} effects`));
  }

  const declaredParams = new Set(draft.parameters.map((p) => p.name));

  for (const effect of draft.effects) {
    const where: DraftIssue['where'] = { section: 'effect', id: effect.id };

    if (
      effect.when.kind === 'verbatim' &&
      effectWhenGroups(effect.when.when).some((group) => group.llm !== undefined) &&
      !draft.llmEnabled
    ) {
      issues.push(err(where, 'the condition tests the LLM consult, but the consult is not enabled'));
    }

    if (effect.kind === 'wardrobe') {
      validateDraftWardrobeGesture(effect, draft, where, issues);
      continue;
    }

    if (effect.kind === 'inventory') {
      validateDraftInventoryGesture(effect, draft, where, issues);
      continue;
    }

    if (effect.kind === 'log') {
      const logWhere: DraftIssue['where'] = { section: 'effect', id: effect.id, field: 'log' };
      const line = effect.log.trim();
      if (line === '') {
        issues.push(err(logWhere, 'a log line needs some prose to write down'));
      } else {
        if (line.length > MAX_MESSAGE_LENGTH) {
          issues.push(err(logWhere, `a log line is at most ${MAX_MESSAGE_LENGTH} characters`));
        }
        auditPlaceholders(line, logWhere, draft, issues, { llm: 'warn-if-disabled', allowState: true });
      }
      continue;
    }

    if (effect.target.trim() === '') {
      issues.push(err(where, 'an effect needs a target — state.<path> or metadata.<key>'));
    } else {
      const target = parseEffectTarget(effect.target.trim());
      if (!target.ok) issues.push(err(where, `target ${target.reason}`));
    }

    if (effect.valueKind === 'literal-number') {
      if (!Number.isFinite(parseNumberText(effect.value))) {
        issues.push(err(where, 'the value must be a number'));
      }
    } else if (effect.valueKind === 'expression') {
      if (effect.value.trim() === '') {
        issues.push(err(where, "the value needs an expression — quote literal prose: 'broken pick'"));
      } else {
        const parsed = parseExpression(effect.value);
        if (!parsed.ok) {
          issues.push(err(where, `the expression does not parse: ${parsed.reason}`));
        } else {
          for (const ref of parsed.expr.refs) {
            if (ref.startsWith('params.') && !declaredParams.has(ref.slice('params.'.length))) {
              issues.push(err(where, `{{${ref}}} names no declared parameter`));
            } else if (ref === 'llm' && !draft.llmEnabled) {
              issues.push(err(where, '{{llm}} needs the LLM consult enabled'));
            } else if (ref === 'dice' && draft.rollForm === 'range') {
              issues.push(warn(where, '{{dice}} is an empty string outside the dice form'));
            }
          }
        }
      }
    }
  }
}

/**
 * A wardrobe row's audit: the per-action rules in the very words load-time
 * validation uses (`wardrobeGestureProblems`), checked against what the row
 * would EMIT, plus the item references' placeholders — an undeclared
 * parameter or a disabled consult is an error, as at load; an unknown family
 * is only a warning, since it simply fails to resolve at the table.
 */
function validateDraftWardrobeGesture(
  effect: DraftEffect,
  draft: ToolDraft,
  where: DraftIssue['where'],
  issues: DraftIssue[]
): void {
  const emitted = wardrobeFromDraft(effect.wardrobe) as {
    action: WardrobeEffectAction;
    items?: string[];
    mode?: WardrobeEffectMode;
    slot?: WardrobeItemType;
  };
  // The form drops what an action does not use, so a `wear` that forgot its
  // `add_to_slot` slot is the one cross-field mistake left to catch — and
  // an empty item list, which the emitter turns into `items: []`.
  for (const problem of wardrobeGestureProblems({
    ...emitted,
    items: emitted.items && emitted.items.length > 0 ? emitted.items : undefined,
  })) {
    issues.push(err(where, problem.message));
  }

  const declaredParams = new Set(draft.parameters.map((p) => p.name));
  for (const item of effect.wardrobe.items) {
    for (const { key, ref } of scanPlaceholders(item)) {
      if (ref.kind === 'params' && !declaredParams.has(ref.name)) {
        issues.push(err(where, `{{${key}}} names no declared parameter`));
      } else if (ref.kind === 'llm' && !draft.llmEnabled) {
        issues.push(err(where, '{{llm}} needs the LLM consult enabled'));
      } else if (ref.kind === 'unknown') {
        issues.push(warn(where, `{{${key}}} is not a placeholder this build knows — that item will not be found`));
      }
    }
  }
}

/**
 * An inventory row's audit: the per-action rules in load-time validation's own
 * words (`inventoryGestureProblems`), checked against what the row would
 * EMIT, plus the references' placeholders — an undeclared parameter or a
 * disabled consult is an error, an unknown family a warning (that object
 * simply will not be found), and a reference carrying `.metadata.` a warning
 * (it cannot be quoted by `{{inventory.*}}`).
 */
function validateDraftInventoryGesture(
  effect: DraftEffect,
  draft: ToolDraft,
  where: DraftIssue['where'],
  issues: DraftIssue[]
): void {
  const emitted = inventoryFromDraft(effect.inventory) as { action: InventoryEffectAction; items: string[]; equip?: boolean };
  for (const problem of inventoryGestureProblems(emitted)) {
    issues.push(err(where, problem.message));
  }
  const declaredParams = new Set(draft.parameters.map((p) => p.name));
  for (const item of effect.inventory.items) {
    if (item.includes('.metadata.')) {
      issues.push(warn(where, `"${item}" contains ".metadata.", which no {{inventory.*}} placeholder can name`));
    }
    for (const { key, ref } of scanPlaceholders(item)) {
      if (ref.kind === 'params' && !declaredParams.has(ref.name)) {
        issues.push(err(where, `{{${key}}} names no declared parameter`));
      } else if (ref.kind === 'llm' && !draft.llmEnabled) {
        issues.push(err(where, '{{llm}} needs the LLM consult enabled'));
      } else if (ref.kind === 'unknown') {
        issues.push(warn(where, `{{${key}}} is not a placeholder this build knows — that object will not be found`));
      }
    }
  }
}

/**
 * The value type a subject carries, or null where it is unknowable at
 * authoring time — a metadata key's stored value, or whatever the consulted
 * model chooses to answer.
 */
export function subjectValueType(
  subject: ConditionSubject,
  paramByName: Map<string, DraftParameter>
): ValueType | null {
  switch (subject.kind) {
    case 'value':
    case 'roll':
      return 'number';
    case 'param': {
      const target = paramByName.get(subject.name);
      return target ? valueTypeOf(target.type) : null;
    }
    case 'metadata':
    // A progression the definition has never met: whether this character
    // carries `cannon` at all, let alone what `cannon.percent` holds, is
    // unknowable from the file — the same fail-soft position metadata is in.
    case 'progress':
      return null;
    case 'llm':
      // The answer's type is the model's business — unknowable here, like a
      // metadata key's.
      return null;
    case 'llm-ok':
      return 'boolean';
    case 'inventory':
      // A state is one of four strings.
      return 'string';
    case 'inventoryCount':
      return 'number';
    case 'inventoryAggregate': {
      // A count or a fold is a number. A list's entries are names and titles
      // (text) or whatever the objects' metadata holds — unknowable, like a
      // metadata key's.
      const parsed = parseAggregateKey(subject.key.trim());
      if (!parsed.ok) return null;
      if (!isListAggregate(parsed.parsed)) return 'number';
      return parsed.parsed.field.kind === 'metadata' ? null : 'string';
    }
  }
}

/**
 * Re-seat an operand in the widget a newly chosen comparator can actually use:
 * ordering takes a number (or a numeric-param reference) everywhere, and
 * containment looks for text (or a string-param reference) everywhere. Typed
 * text survives the move between number and text; a boolean starts blank.
 * References are left alone — their type is the parameter's business.
 */
export function reseatOperandForComparator<O extends ConditionOperand>(
  operand: O,
  comparator: ComparatorKey
): O | Extract<LiteralOperand, { kind: 'number' | 'string' }> {
  if (ORDERING_KEYS.has(comparator) && (operand.kind === 'string' || operand.kind === 'boolean')) {
    return { kind: 'number', text: operand.kind === 'string' ? operand.text : '' };
  }
  if (CONTAINMENT_KEYS.has(comparator) && (operand.kind === 'number' || operand.kind === 'boolean')) {
    return { kind: 'string', text: operand.kind === 'number' ? operand.text : '' };
  }
  return operand;
}

/** Identity of a gate chip for duplicate detection, within its group: key + comparator. */
export function gateConditionSlotKey(condition: Pick<DraftGateCondition, 'key' | 'comparator'>): string {
  return `${condition.key}:${condition.comparator}`;
}

/** Identity of a chip for duplicate detection, within its group: subject (+key/name) + comparator. */
export function conditionSlotKey(condition: Pick<DraftCondition, 'subject' | 'comparator'>): string {
  const subject = condition.subject;
  switch (subject.kind) {
    case 'value':
      return `value:${condition.comparator}`;
    case 'roll':
      return `roll:${condition.comparator}`;
    case 'param':
      return `param:${subject.name}:${condition.comparator}`;
    case 'metadata':
      return `metadata:${subject.key}:${condition.comparator}`;
    case 'progress':
      return `progress:${subject.key}:${condition.comparator}`;
    case 'inventory':
      return `inventory:${subject.key}:${condition.comparator}`;
    case 'inventoryCount':
      return `inventoryCount:${subject.key}:${condition.comparator}`;
    case 'inventoryAggregate':
      return `inventoryAggregate:${subject.key}:${condition.comparator}`;
    case 'llm':
      return `llm:${condition.comparator}`;
    case 'llm-ok':
      // Comparator-free on purpose: "succeeded = true" and "succeeded ≠ false"
      // are the same test, so a row gets one such chip at most.
      return 'llm-ok';
  }
}

/**
 * Every issue the form can detect. Errors gate save; warnings render as
 * advisories. The serialized draft still passes through
 * `QtapCustomToolSchema.safeParse` before any save, belt-and-braces.
 */
export function validateDraft(draft: ToolDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];

  // Identity.
  if (!IDENTIFIER_PATTERN.test(draft.name)) {
    issues.push(err({ section: 'identity', field: 'name' }, 'name must be lowercase, start with a letter, and be 1–64 characters'));
  }
  if (draft.title.length > MAX_TITLE_LENGTH) {
    issues.push(err({ section: 'identity', field: 'title' }, `title is over ${MAX_TITLE_LENGTH} characters`));
  }
  if (draft.chipLabel.length > MAX_CHIP_LABEL_LENGTH) {
    issues.push(
      err({ section: 'identity', field: 'chipLabel' }, `chip label is over ${MAX_CHIP_LABEL_LENGTH} characters`)
    );
  }
  validateChipLabelPlaceholders(draft, issues);
  validateDraftTriggers(draft, issues);
  if (draft.description.trim() === '') {
    issues.push(err({ section: 'identity', field: 'description' }, 'description is required'));
  } else if (draft.description.length > MAX_DESCRIPTION_LENGTH) {
    issues.push(err({ section: 'identity', field: 'description' }, `description is over ${MAX_DESCRIPTION_LENGTH} characters`));
  }

  // Availability gate.
  validateGate(draft, issues);

  // Parameters.
  if (draft.parameters.length > MAX_PARAMETERS) {
    issues.push(err({ section: 'options' }, `at most ${MAX_PARAMETERS} parameters`));
  }
  const seenNames = new Set<string>();
  for (const param of draft.parameters) {
    if (!IDENTIFIER_PATTERN.test(param.name)) {
      issues.push(err({ section: 'parameter', id: param.id, field: 'name' }, 'parameter names are lowercase identifiers'));
    } else if (seenNames.has(param.name)) {
      issues.push(err({ section: 'parameter', id: param.id, field: 'name' }, `"${param.name}" is declared twice`));
    }
    seenNames.add(param.name);

    const numeric = param.type === 'number' || param.type === 'integer';
    if (numeric) {
      const defaultNumber = parseNumberText(String(param.defaultValue));
      if (!Number.isFinite(defaultNumber)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'default' }, 'default must be a number'));
      } else if (param.type === 'integer' && !Number.isInteger(defaultNumber)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'default' }, 'default must be a whole number'));
      }
      const min = param.min.trim() === '' ? undefined : parseNumberText(param.min);
      const max = param.max.trim() === '' ? undefined : parseNumberText(param.max);
      if (min !== undefined && !Number.isFinite(min)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'min' }, 'min must be a number'));
      }
      if (max !== undefined && !Number.isFinite(max)) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'max' }, 'max must be a number'));
      }
      if (min !== undefined && max !== undefined && Number.isFinite(min) && Number.isFinite(max) && min > max) {
        issues.push(err({ section: 'parameter', id: param.id, field: 'min' }, 'min must not exceed max'));
      }
    }
  }

  // Roll.
  if (draft.rollForm === 'dice') {
    if (draft.rollDice.trim() === '' || parseDiceNotation(draft.rollDice.trim()) === null) {
      issues.push(err({ section: 'roll', field: 'dice' }, 'must be dice notation like "3d6+2" or "1d20"'));
    }
  } else if (draft.rollForm === 'inventory') {
    // The same two rules the loader holds a `$inventory` roll to.
    if (!parseInventoryOperand(draft.rollInventory.path.trim())) {
      issues.push(err({ section: 'roll', field: 'inventory' }, 'name "<object>.metadata.<key>", e.g. "sword.metadata.damage"'));
    }
    if (parseDiceNotation(draft.rollInventory.fallback.trim()) === null) {
      issues.push(err({ section: 'roll', field: 'inventory' }, 'the fallback must be dice notation like "1d4"'));
    }
  } else {
    validateNumberOrParam(draft.rollRange.min, 'min', draft, issues);
    validateNumberOrParam(draft.rollRange.max, 'max', draft, issues);
    validateNumberOrParam(draft.rollRange.multiplier, 'multiplier', draft, issues);
    validateNumberOrParam(draft.rollRange.offset, 'offset', draft, issues);

    // min > max is only KNOWABLE when both are literal (§8) — with a $param on
    // either side it becomes a run-time concern the bench surfaces honestly.
    const min = draft.rollRange.min.kind === 'literal' ? parseNumberText(draft.rollRange.min.text) : NaN;
    const max = draft.rollRange.max.kind === 'literal' ? parseNumberText(draft.rollRange.max.text) : NaN;
    const effectiveMin = draft.rollRange.min.kind === 'literal' && draft.rollRange.min.text.trim() === '' ? 0 : min;
    const effectiveMax = draft.rollRange.max.kind === 'literal' && draft.rollRange.max.text.trim() === '' ? 1 : max;
    if (
      draft.rollRange.min.kind === 'literal' &&
      draft.rollRange.max.kind === 'literal' &&
      Number.isFinite(effectiveMin) &&
      Number.isFinite(effectiveMax) &&
      effectiveMin > effectiveMax
    ) {
      issues.push(err({ section: 'roll', field: 'min' }, 'the low bound is above the high bound'));
    }
  }

  // LLM consult.
  if (draft.llmEnabled) {
    if (draft.llmPrompt.trim() === '') {
      issues.push(err({ section: 'llm', field: 'prompt' }, 'the consult needs a prompt'));
    } else if (draft.llmPrompt.length > MAX_LLM_PROMPT_LENGTH) {
      issues.push(err({ section: 'llm', field: 'prompt' }, `the prompt is over ${MAX_LLM_PROMPT_LENGTH} characters`));
    }
    if (draft.llmErrorMessage.trim() === '') {
      issues.push(
        err(
          { section: 'llm', field: 'errorMessage' },
          "the consult needs an error message — the tool's own words for when the model cannot answer"
        )
      );
    } else if (draft.llmErrorMessage.length > MAX_MESSAGE_LENGTH) {
      issues.push(
        err({ section: 'llm', field: 'errorMessage' }, `the error message is over ${MAX_MESSAGE_LENGTH} characters`)
      );
    }
    if (draft.llmMaxOutput.trim() !== '') {
      const maxOutput = parseNumberText(draft.llmMaxOutput);
      if (!Number.isInteger(maxOutput) || maxOutput < 1) {
        issues.push(err({ section: 'llm', field: 'maxOutput' }, 'the answer cap must be a whole number of characters, at least 1'));
      } else if (maxOutput > MAX_LLM_OUTPUT_CEILING) {
        issues.push(
          err({ section: 'llm', field: 'maxOutput' }, `the answer cap tops out at ${MAX_LLM_OUTPUT_CEILING.toLocaleString()} characters`)
        );
      }
    }
    validateLlmPromptPlaceholders(draft, issues);
  }

  // Side effects.
  validateDraftEffects(draft, issues);

  // Outcomes.
  if (draft.outcomes.length > MAX_OUTCOMES) {
    issues.push(err({ section: 'options' }, `at most ${MAX_OUTCOMES} outcomes`));
  }
  const tail = draft.outcomes[draft.outcomes.length - 1];
  if (!tail || !tail.catchAll) {
    // Unreachable through the UI — the tail is pinned — but the gate must not
    // depend on the UI behaving.
    issues.push(err({ section: 'options' }, 'the final outcome must be the catch-all'));
  }

  for (const outcome of draft.outcomes) {
    if (!outcome.catchAll && outcome.conditions.length === 0) {
      issues.push(err({ section: 'outcome', id: outcome.id }, 'must test something — add a condition, or delete the row'));
    }
    if (outcome.catchAll && outcome !== tail) {
      issues.push(err({ section: 'outcome', id: outcome.id }, 'only the final outcome may be the catch-all'));
    }

    // Slots are per group: `rank > 3 OR rank > 5` is two lines, not a repeat.
    for (const group of groupsOf(outcome.conditions)) {
      const seenSlots = new Set<string>();
      for (const condition of group) {
        const slot = conditionSlotKey(condition);
        if (seenSlots.has(slot)) {
          issues.push(
            err(
              { section: 'outcome', id: outcome.id, conditionId: condition.id },
              'a line can test this subject with this comparator only once'
            )
          );
        }
        seenSlots.add(slot);
        validateCondition(condition, outcome, draft, issues);
      }
    }
    if (groupsOf(outcome.conditions).length > MAX_WHEN_GROUPS) {
      issues.push(err({ section: 'outcome', id: outcome.id }, `at most ${MAX_WHEN_GROUPS} lines joined by OR`));
    }

    if (outcome.message.trim() === '') {
      issues.push(err({ section: 'message', id: outcome.id }, 'every outcome needs a message'));
    } else if (outcome.message.length > MAX_MESSAGE_LENGTH) {
      issues.push(err({ section: 'message', id: outcome.id }, `message is over ${MAX_MESSAGE_LENGTH} characters`));
    }
    validateMessagePlaceholders(outcome, draft, issues);
    validateOutcomeBrief(outcome, draft, issues);
    if (promptReadsBrief(draft) && outcome.brief.trim() === '') {
      issues.push(
        warn(
          { section: 'brief', id: outcome.id },
          'the consult prompt reads {{outcome.brief}}, but this outcome has no brief — if it wins, the placeholder reaches the model as written'
        )
      );
    }
  }

  return issues;
}

/**
 * Trigger phrases: the loader's rules (count, length, no padding, no repeats
 * ignoring case) as errors, plus the self-echo warning — a phrase quoted in
 * this tool's own outcome message, chip label or consult prompt. Pascal's
 * announcement is never scanned, but a model that narrates it back will say
 * the words, and the tool fires again on its next reply.
 */
function validateDraftTriggers(draft: ToolDraft, issues: DraftIssue[]): void {
  if (draft.triggers.length === 0) return;

  if (draft.triggers.length > MAX_TRIGGERS) {
    issues.push(err({ section: 'triggers' }, `at most ${MAX_TRIGGERS} trigger phrases`));
  }
  const seen = new Set<string>();
  draft.triggers.forEach((phrase, index) => {
    const where = { section: 'triggers' as const, index };
    if (phrase.length < MIN_TRIGGER_PHRASE_LENGTH) {
      issues.push(err(where, `a trigger phrase needs at least ${MIN_TRIGGER_PHRASE_LENGTH} characters`));
    } else if (phrase.length > MAX_TRIGGER_PHRASE_LENGTH) {
      issues.push(err(where, `a trigger phrase is at most ${MAX_TRIGGER_PHRASE_LENGTH} characters`));
    }
    if (phrase !== phrase.trim()) {
      issues.push(err(where, 'a trigger phrase must not begin or end with a space'));
    }
    const folded = foldTriggerText(phrase);
    if (seen.has(folded)) {
      issues.push(err(where, `"${phrase}" is listed twice (phrases match regardless of case)`));
    }
    seen.add(folded);
  });

  const echo = (text: string, where: DraftIssue['where'], what: string): void => {
    for (const phrase of triggersContainedIn(text, draft.triggers)) {
      issues.push(
        warn(
          where,
          `${what} contains the trigger "${phrase}" — a character who repeats Pascal's line will set this tool off again`
        )
      );
    }
  };
  for (const outcome of draft.outcomes) {
    echo(outcome.message, { section: 'message', id: outcome.id }, 'this message');
  }
  echo(draft.chipLabel, { section: 'identity', field: 'chipLabel' }, 'the chip label');
  if (draft.llmEnabled) echo(draft.llmPrompt, { section: 'llm', field: 'prompt' }, 'the consult prompt');
}

/** True when nothing blocks a save. */
export function draftIsValid(draft: ToolDraft): boolean {
  if (validateDraft(draft).some((issue) => issue.severity === 'error')) return false;
  return QtapCustomToolSchema.safeParse(definitionFromDraft(draft)).success;
}

/**
 * Derive a slug from a typed title: `Force the Lock` → `force_the_lock` (§4.1).
 */
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/g, '')
    .slice(0, 64);
}

/**
 * Rename a parameter everywhere it is referenced — roll fields, comparator
 * operands, `params` test subjects, and `{{params.x}}` placeholders — in one
 * atomic pass (§4.2: rename rewrites; deletion breaks loudly).
 */
export function renameParameterEverywhere(draft: ToolDraft, from: string, to: string): ToolDraft {
  const renameValue = (value: NumberOrParamValue): NumberOrParamValue =>
    value.kind === 'param' && value.name === from ? { kind: 'param', name: to } : value;

  const renameOperand = (operand: ConditionOperand): ConditionOperand =>
    operand.kind === 'param' && operand.name === from ? { kind: 'param', name: to } : operand;

  const renameSubject = (subject: ConditionSubject): ConditionSubject =>
    subject.kind === 'param' && subject.name === from ? { kind: 'param', name: to } : subject;

  const placeholder = paramPlaceholderPattern(from);

  return {
    ...draft,
    parameters: draft.parameters.map((p) => (p.name === from ? { ...p, name: to } : p)),
    llmPrompt: draft.llmPrompt.replace(placeholder, `{{params.${to}}}`),
    rollRange: {
      ...draft.rollRange,
      min: renameValue(draft.rollRange.min),
      max: renameValue(draft.rollRange.max),
      multiplier: renameValue(draft.rollRange.multiplier),
      offset: renameValue(draft.rollRange.offset),
    },
    effects: draft.effects.map((effect) => ({
      ...effect,
      log: effect.log.replace(placeholder, `{{params.${to}}}`),
      wardrobe: {
        ...effect.wardrobe,
        items: effect.wardrobe.items.map((item) => item.replace(placeholder, `{{params.${to}}}`)),
      },
    })),
    outcomes: draft.outcomes.map((outcome) => ({
      ...outcome,
      message: outcome.message.replace(placeholder, `{{params.${to}}}`),
      brief: outcome.brief.replace(placeholder, `{{params.${to}}}`),
      conditions: outcome.conditions.map((condition) => ({
        ...condition,
        subject: renameSubject(condition.subject),
        operand: renameOperand(condition.operand),
      })),
    })),
  };
}

/** Every place a parameter is referenced, for the deletion confirm (§4.2). */
export function findParameterReferences(draft: ToolDraft, name: string): string[] {
  const sites: string[] = [];

  for (const [field, value] of Object.entries({
    min: draft.rollRange.min,
    max: draft.rollRange.max,
    multiplier: draft.rollRange.multiplier,
    offset: draft.rollRange.offset,
  })) {
    if (value.kind === 'param' && value.name === name) sites.push(`roll ${field}`);
  }

  if (paramPlaceholderPattern(name).test(draft.llmPrompt)) {
    sites.push('the consult prompt renders it');
  }

  draft.outcomes.forEach((outcome, index) => {
    const label = outcome.catchAll ? 'the catch-all' : `outcome ${index + 1}`;
    for (const condition of outcome.conditions) {
      if (condition.subject.kind === 'param' && condition.subject.name === name) {
        sites.push(`${label}: a condition tests it`);
      }
      if (condition.operand.kind === 'param' && condition.operand.name === name) {
        sites.push(`${label}: a condition compares against it`);
      }
    }
    if (paramPlaceholderPattern(name).test(outcome.message)) {
      sites.push(`${label}: the message renders it`);
    }
    if (paramPlaceholderPattern(name).test(outcome.brief)) {
      sites.push(`${label}: the brief renders it`);
    }
  });

  draft.effects.forEach((effect, index) => {
    if (effect.kind === 'log') {
      if (paramPlaceholderPattern(name).test(effect.log)) sites.push(`effect ${index + 1}: the log line renders it`);
      return;
    }
    if (effect.kind !== 'wardrobe') return;
    if (effect.wardrobe.items.some((item) => paramPlaceholderPattern(name).test(item))) {
      sites.push(`effect ${index + 1}: a wardrobe item names it`);
    }
  });

  return sites;
}

/**
 * A fresh global regex matching every `{{params.<name>}}` occurrence (inner
 * whitespace tolerated, as the renderer trims it). Fresh per call so `test`
 * and `replace` never share `lastIndex`.
 */
function paramPlaceholderPattern(name: string): RegExp {
  return new RegExp(`\\{\\{\\s*params\\.${escapeRegex(name)}\\s*\\}\\}`, 'g');
}
