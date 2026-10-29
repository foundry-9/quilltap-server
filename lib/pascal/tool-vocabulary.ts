/**
 * Tool vocabulary — what a definition actually quotes.
 *
 * A custom tool's parameters are declared, so a form can be generated from
 * them. What the tool does with them is not: whether `visible_request` ever
 * reaches an outcome message, whether the table reads
 * `{{metadata.hasAnsibleAccess}}`, whether the roll's own value is even
 * mentioned. To the operator filling in the run dialog, all of that is
 * invisible — which is the confusion this module exists to remove.
 *
 * ## Quoted, not merely available
 *
 * Every field below reports an **occurrence**: a placeholder that appears in
 * some string Pascal renders (an outcome message, or the oracle prompt), or a
 * metadata key some `when` clause tests, or a `$state` reference the definition
 * carries. A tool that rolls dice but never writes `{{dice}}` does not quote it,
 * and the dialog does not offer it. The list is what this tool says, not what
 * the format permits.
 *
 * ## What this deliberately is, and is not
 *
 * It is a **vocabulary**: the names a tool quotes. It is emphatically **not the
 * odds** — no roll spec, no thresholds, no outcome table, nothing about which
 * value wins which row. The custom-tools roster endpoint withholds all of that
 * on purpose (see its file header), and this summary keeps that line: it says
 * "this tool reads `hasAnsibleAccess`", never "it succeeds when
 * `hasAnsibleAccess` is true".
 */

import {
  effectWhenGroups,
  gateGroups,
  isInventoryRef,
  isStateRef,
  whenGroups,
  parseEffectTarget,
  scanPlaceholders,
  type QtapCustomTool,
} from './custom-tool.types';
import { parseInventoryOperand } from './inventory-subjects';

const STATE_PREFIX = 'state.';

/** What a definition quotes. Every field means "this tool actually says so". */
export interface ToolVocabulary {
  /** True when some rendered string quotes `{{value}}`. */
  value: boolean;
  /** True when some rendered string quotes `{{roll}}`. */
  roll: boolean;
  /** True when some rendered string quotes `{{dice}}`. */
  dice: boolean;
  /** True when some rendered string quotes `{{llm}}`. */
  llm: boolean;
  /**
   * Declared parameters quoted as `{{params.name}}`. Restricted to declared
   * names: a placeholder naming a parameter that does not exist renders as
   * written, and offering it here would advertise a hole as a feature.
   */
  params: string[];
  /**
   * Keys of the invoking character's `metadata.json` this tool reads — from
   * `when.metadata` tests, from its availability gate, and from
   * `{{metadata.key}}` placeholders. Sorted.
   */
  metadata: string[];
  /**
   * Paths into the merged persistent state this tool reads — from `$state`
   * references and from `{{state.path}}` placeholders. Sorted.
   */
  state: string[];
  /**
   * State paths this tool's effects may WRITE. A write is a different claim
   * than a read — "this tool consults the encounter count" and "this tool
   * changes it" deserve different sentences — so writes get their own list
   * rather than folding into `state`. Sorted.
   */
  stateWrites: string[];
  /** Metadata keys this tool's effects may WRITE on the rolling character. Sorted. */
  metadataWrites: string[];
  /**
   * Progression IDS this tool READS — from `when.progress` tests, from its
   * availability gate, and from `{{progress.<id>.<field>}}` placeholders.
   * Ids, not `<id>.<field>` keys: "this tool consults your cannon" is the
   * honest sentence for a run dialog, where "it consults cannon.percent"
   * edges toward the odds the roster deliberately withholds. Sorted.
   */
  progress: string[];
  /**
   * Progression ids this tool's effects may WRITE. A write is a different
   * claim than a read — "it consults the cannon" and "it re-arms the cannon"
   * deserve different sentences — so writes get their own list. Sorted.
   */
  progressWrites: string[];
  /** True when some rendered string quotes `{{now}}`. */
  now: boolean;
  /** True when some rendered string quotes `{{character}}`. */
  character: boolean;
  /**
   * Item references this tool's wardrobe effects may PUT ON the rolling
   * character, verbatim (a `{{params.garment}}` stays as written — it is
   * vocabulary, not a resolved garment). Sorted.
   */
  wears: string[];
  /** Item references this tool's wardrobe effects may TAKE OFF, verbatim. Sorted. */
  takesOff: string[];
  /** Slots this tool's wardrobe effects may CLEAR. Sorted. */
  clearsSlots: string[];
  /**
   * Inventory object references this tool READS — tested by an `inventory` /
   * `inventoryCount` subject (outcomes, effect conditions, the gate), quoted
   * by `{{inventory.<ref>.*}}`, or drawn from by a `$inventory` operand.
   * Verbatim, sorted.
   */
  inventoryReads: string[];
  /**
   * `inventoryAggregate` keys this tool tests (`equipped.names`,
   * `owned.metadata.toolVersion.max`) — outcomes, effect conditions, the
   * gate. A metadata key read through an aggregate is the OBJECTS'
   * vocabulary, not the character's, so it is not added to `metadata`.
   * Sorted.
   */
  inventoryAggregates: string[];
  /** References this tool's inventory effects may EQUIP, verbatim. Sorted. */
  equips: string[];
  /** References this tool's inventory effects may UNEQUIP, verbatim. Sorted. */
  unequips: string[];
  /** Archetype references this tool's inventory effects may PICK UP, verbatim. Sorted. */
  picksUp: string[];
}

/** True when a tool quotes nothing at all, and so has no vocabulary to show. */
export function isEmptyVocabulary(vocabulary: ToolVocabulary): boolean {
  return (
    !vocabulary.value &&
    !vocabulary.roll &&
    !vocabulary.dice &&
    !vocabulary.llm &&
    vocabulary.params.length === 0 &&
    vocabulary.metadata.length === 0 &&
    vocabulary.state.length === 0 &&
    vocabulary.stateWrites.length === 0 &&
    vocabulary.metadataWrites.length === 0 &&
    vocabulary.progress.length === 0 &&
    vocabulary.progressWrites.length === 0 &&
    !vocabulary.now &&
    !vocabulary.character &&
    vocabulary.wears.length === 0 &&
    vocabulary.takesOff.length === 0 &&
    vocabulary.clearsSlots.length === 0 &&
    vocabulary.inventoryReads.length === 0 &&
    vocabulary.inventoryAggregates.length === 0 &&
    vocabulary.equips.length === 0 &&
    vocabulary.unequips.length === 0 &&
    vocabulary.picksUp.length === 0
  );
}

/**
 * Collect everything a definition quotes. Pure and total: a definition that
 * quotes nothing yields `false`s and empty lists rather than absent keys, so a
 * caller never has to distinguish "none" from "not computed".
 */
export function collectToolVocabulary(
  definition: Pick<QtapCustomTool, 'outcomes'> & Partial<QtapCustomTool>
): ToolVocabulary {
  const declared = new Set(Object.keys(definition.parameters ?? {}));
  const found = {
    value: false,
    roll: false,
    dice: false,
    llm: false,
    params: new Set<string>(),
    metadata: new Set<string>(),
    state: new Set<string>(),
    stateWrites: new Set<string>(),
    metadataWrites: new Set<string>(),
    progress: new Set<string>(),
    progressWrites: new Set<string>(),
    now: false,
    character: false,
    wears: new Set<string>(),
    takesOff: new Set<string>(),
    clearsSlots: new Set<string>(),
    inventory: new Set<string>(),
    inventoryAggregates: new Set<string>(),
    equips: new Set<string>(),
    unequips: new Set<string>(),
    picksUp: new Set<string>(),
  };
  // One group's reads — the same for an outcome row, an effect condition and
  // a gate group. Walked over every group of an any-of.
  const collectGroup = (group: {
    metadata?: object;
    progress?: object;
    inventory?: object;
    inventoryCount?: object;
    inventoryAggregate?: object;
  }): void => {
    for (const key of Object.keys(group.metadata ?? {})) found.metadata.add(key);
    for (const key of Object.keys(group.progress ?? {})) found.progress.add(progressionId(key));
    for (const key of Object.keys(group.inventory ?? {})) found.inventory.add(key);
    for (const key of Object.keys(group.inventoryCount ?? {})) found.inventory.add(key);
    for (const key of Object.keys(group.inventoryAggregate ?? {})) found.inventoryAggregates.add(key);
  };

  for (const outcome of definition.outcomes ?? []) {
    // A catch-all tests nothing, so it names nothing — but it still carries a
    // message, and that message may well quote a fact sheet.
    for (const group of whenGroups(outcome.when)) collectGroup(group);
    collectPlaceholders(outcome.message, declared, found);
    if (outcome.brief !== undefined) collectPlaceholders(outcome.brief, declared, found);
  }

  // The availability gate reads the same fact sheet, and naming its keys stays
  // on the right side of the odds line: that a tool consults `toolAbilities` is
  // vocabulary; that it is withheld unless `toolAbilities` contains
  // "programmable" is not, and is not said here. A gated-out tool never reaches
  // a roster listing at all, so this only ever describes one the reader has.
  for (const gate of [definition.availableWhen, definition.withheldWhen]) {
    if (gate) for (const group of gateGroups(gate)) collectGroup(group);
  }

  if (definition.llm) collectPlaceholders(definition.llm.prompt, declared, found);

  // The chip label is a rendered string like any outcome message.
  if (definition.chipLabel) collectPlaceholders(definition.chipLabel, declared, found);

  // Effects: an expression's `{{ref}}`s are the outcome-message vocabulary
  // verbatim, so the one placeholder scanner reads them too; a condition's
  // metadata keys are reads like an outcome row's; and each target is a WRITE,
  // reported on its own lists because it is a different claim than a read.
  // A wardrobe gesture's item references are templates too, scanned the same
  // way, and the gesture itself is reported on the dress/undress lists. A log
  // line is a template whose placeholders are reads and nothing more.
  for (const effect of definition.effects ?? []) {
    if (typeof effect.value === 'string') collectPlaceholders(effect.value, declared, found);
    if (effect.log !== undefined) collectPlaceholders(effect.log, declared, found);
    if (effect.when !== undefined) for (const group of effectWhenGroups(effect.when)) collectGroup(group);

    if (effect.inventory) {
      const { action, items } = effect.inventory;
      for (const item of items) collectPlaceholders(item, declared, found);
      const list = action === 'equip' ? found.equips : action === 'unequip' ? found.unequips : found.picksUp;
      for (const item of items) list.add(item);
      continue;
    }

    if (effect.wardrobe) {
      const { action, items = [], slot } = effect.wardrobe;
      for (const item of items) collectPlaceholders(item, declared, found);
      if (action === 'wear') for (const item of items) found.wears.add(item);
      else if (action === 'take_off') for (const item of items) found.takesOff.add(item);
      else if (slot) found.clearsSlots.add(slot);
      continue;
    }
    if (effect.target === undefined) continue; // a log line, or load-rejected; no write to report

    const target = parseEffectTarget(effect.target);
    if (!target.ok) continue; // load-rejected; nothing honest to report
    if (target.target.kind === 'state') {
      found.stateWrites.add(target.target.raw.slice(STATE_PREFIX.length));
    } else if (target.target.kind === 'progress') {
      found.progressWrites.add(target.target.id);
    } else {
      found.metadataWrites.add(target.target.key);
    }
  }

  // Every `$state` reference, wherever it sits — a parameter default, a roll
  // field, a comparator operand. Walked rather than enumerated: the schema is
  // free to grow new sites, and a list of them here would silently fall behind.
  collectStateRefs(definition, found.state, found.inventory);

  return {
    value: found.value,
    roll: found.roll,
    dice: found.dice,
    llm: found.llm,
    params: sorted(found.params),
    metadata: sorted(found.metadata),
    state: sorted(found.state),
    stateWrites: sorted(found.stateWrites),
    metadataWrites: sorted(found.metadataWrites),
    progress: sorted(found.progress),
    progressWrites: sorted(found.progressWrites),
    now: found.now,
    character: found.character,
    wears: sorted(found.wears),
    takesOff: sorted(found.takesOff),
    clearsSlots: sorted(found.clearsSlots),
    inventoryReads: sorted(found.inventory),
    inventoryAggregates: sorted(found.inventoryAggregates),
    equips: sorted(found.equips),
    unequips: sorted(found.unequips),
    picksUp: sorted(found.picksUp),
  };
}

/**
 * The progression id out of a `"<id>.<field>"` sheet key. A key that somehow
 * carries no dot (load validation forbids it) names the whole string, which is
 * the least surprising thing to report and never throws.
 */
function progressionId(key: string): string {
  const dot = key.indexOf('.');
  return dot > 0 ? key.slice(0, dot) : key;
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** Harvest every placeholder family out of one rendered string. */
function collectPlaceholders(
  text: string,
  declared: ReadonlySet<string>,
  found: {
    value: boolean;
    roll: boolean;
    dice: boolean;
    llm: boolean;
    params: Set<string>;
    metadata: Set<string>;
    state: Set<string>;
    progress: Set<string>;
    now: boolean;
    character: boolean;
    inventory: Set<string>;
  }
): void {
  for (const { ref } of scanPlaceholders(text)) {
    switch (ref.kind) {
      case 'value':
        found.value = true;
        break;
      case 'roll':
        found.roll = true;
        break;
      case 'dice':
        found.dice = true;
        break;
      case 'llm':
        found.llm = true;
        break;
      case 'params':
        if (declared.has(ref.name)) found.params.add(ref.name);
        break;
      case 'metadata':
        found.metadata.add(ref.key);
        break;
      case 'state':
        found.state.add(ref.path);
        break;
      case 'progress':
        found.progress.add(ref.id);
        break;
      case 'now':
        found.now = true;
        break;
      case 'character':
        found.character = true;
        break;
      case 'outcome':
        break;
      case 'inventory':
        found.inventory.add(ref.ref);
        break;
      case 'unknown':
        break;
    }
  }
}

/**
 * Depth-first walk for `{ "$state": "..." }` objects anywhere in the tree,
 * and beside them `{ "$inventory": "<ref>.metadata.<key>" }` (whose ref is
 * an Inventory read).
 */
function collectStateRefs(node: unknown, into: Set<string>, inventory: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectStateRefs(item, into, inventory);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  if (isStateRef(node)) {
    into.add(node.$state);
    return;
  }
  if (isInventoryRef(node)) {
    const parsed = parseInventoryOperand(node.$inventory);
    if (parsed) inventory.add(parsed.ref);
    return;
  }
  for (const value of Object.values(node)) collectStateRefs(value, into, inventory);
}
