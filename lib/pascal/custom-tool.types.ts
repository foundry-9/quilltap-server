/**
 * Custom Tools — the definition schema for Pascal's table.
 *
 * A custom tool is a single JSON document (`Tools/*.tool.json` at the root of
 * any document store) describing a named action with parameters, a random roll,
 * and an ordered table of outcomes mapping the roll to a message and a semantic
 * state. This module is the single source of truth for that format: the Zod
 * schema here validates every definition at load time, and the published
 * JSON Schema at `public/schemas/qtap-custom-tool.schema.json` mirrors it for
 * editor completion.
 *
 * Design constraint that shapes everything below: tests are AND-composed
 * comparator objects; a one-level any-of array of them is OR; there is no
 * nesting and no expression grammar. Indirection is limited to closed
 * forms — a `{ "$param": "name" }` reference, a
 * `{ "$state": "path", "fallback": <literal> }` reference and its Inventory
 * twin `{ "$inventory": "<ref>.metadata.<key>", "fallback": <literal> }`. The **one** place a
 * string grammar exists is an effect's `value`, evaluated by the closed,
 * eval-free parser in `lib/pascal/expressions.ts`: arithmetic, string
 * concatenation, parentheses, literals, and `{{ref}}` substitution. There are
 * no identifiers, no function calls, and no member access — the only names
 * that grammar admits are the same `{{...}}` reference families
 * `renderTemplate` already substitutes, so there is still nothing callable and
 * nothing reachable beyond the run's own subjects.
 */

import { z } from 'zod';
import {
  PROGRESSION_ID_PATTERN,
  PROGRESSIONS_METADATA_KEY,
  WRITABLE_PROGRESSION_FIELDS,
  isWritableProgressionField,
  parseProgressKey,
  type WritableProgressionField,
} from '@/lib/progressions/schema';
import { MAX_DIE_SIDES, MIN_DIE_SIDES, parseDiceNotation } from './dice-notation';
import { parsePath } from '@/lib/state/state-paths';
import { MAX_EFFECT_EXPRESSION_LENGTH, parseExpression } from './expressions';
import { scanPlaceholders as scanPlaceholdersInText, splitInventoryReference } from './placeholders';
import { parseAggregateKey } from './inventory-aggregate';
import { WardrobeItemTypeEnum, type WardrobeItemType } from '@/lib/schemas/wardrobe.types';

export { MAX_EFFECT_EXPRESSION_LENGTH };

// The `{{placeholder}}` classifier lives in its own dependency-free module so
// `expressions.ts` can use it without importing the schema; it is re-exported
// here because this is where readers of the format look for it.
export {
  PLACEHOLDER_PATTERN,
  classifyPlaceholder,
  scanPlaceholders,
  type PlaceholderRef,
  type ScannedPlaceholder,
} from './placeholders';

/** Well-known folder, at a store's root, holding custom-tool definitions. */
export const TOOLS_FOLDER = 'Tools';

/** Filename suffix that marks a document as a custom-tool definition. */
export const TOOL_FILE_SUFFIX = '.tool.json';

/** Cap on parameters per tool. */
export const MAX_PARAMETERS = 8;

/** Cap on outcomes per tool. */
export const MAX_OUTCOMES = 32;

/**
 * Cap on groups in one any-of array — a gate, an outcome `when`, or an effect
 * `when` written as an array of AND-groups.
 */
export const MAX_WHEN_GROUPS = 8;

/** Cap on tools in a single resolved roster. */
export const MAX_ROSTER_SIZE = 64;

/** Cap on an outcome message, in characters. */
export const MAX_MESSAGE_LENGTH = 1000;

/** Cap on a tool description, in characters. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** Cap on a tool's display title, in characters. */
export const MAX_TITLE_LENGTH = 80;

/**
 * Cap on a `chipLabel` TEMPLATE's text, in characters. The rendered result is
 * uncapped here — the UI truncates it via CSS, which is where display concerns
 * belong.
 */
export const MAX_CHIP_LABEL_LENGTH = 160;

/** Cap on effects per tool. */
export const MAX_EFFECTS = 16;

/** Cap on trigger phrases per tool. */
export const MAX_TRIGGERS = 8;

/** Shortest trigger phrase, in characters — keeps `"a"` and `"ok"` out. A length, not a word count. */
export const MIN_TRIGGER_PHRASE_LENGTH = 3;

/** Longest trigger phrase, in characters. */
export const MAX_TRIGGER_PHRASE_LENGTH = 80;

/** Cap on an effect's `target` string, in characters. */
export const MAX_EFFECT_TARGET_LENGTH = 200;

/** Cap on the item references one wardrobe effect may list. */
export const MAX_WARDROBE_EFFECT_ITEMS = 8;

/** Cap on one wardrobe item reference (a title or id template), in characters. */
export const MAX_WARDROBE_ITEM_REF_LENGTH = 200;

/** Cap on an LLM consult prompt, in characters (measured before templating). */
export const MAX_LLM_PROMPT_LENGTH = 4000;

/**
 * Default cap on the answer an LLM consult may contribute, in characters. The
 * model's reply is trimmed and truncated before it is tested or rendered.
 * A definition that wants a longer (or shorter) leash sets `llm.maxOutput`;
 * this is only what applies when it doesn't say.
 */
export const MAX_LLM_OUTPUT_LENGTH = 8000;

/**
 * Hard ceiling on `llm.maxOutput`. Generous on purpose — a consult may well BE
 * the deliverable (a generated document, a deep outline) — but still bounded:
 * the answer lands in `pascalMeta` on a chat_messages row, and rows must not
 * become arbitrarily large because one oracle would not stop talking.
 */
export const MAX_LLM_OUTPUT_CEILING = 100_000;

/**
 * Identifier rules shared by tool names and parameter names: lowercase, starts
 * with a letter, 1–64 characters.
 */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

const IdentifierSchema = z
  .string()
  .regex(IDENTIFIER_PATTERN, 'must be lowercase, start with a letter, and be 1–64 characters');

/**
 * A reference to a declared numeric parameter, usable anywhere a roll takes a
 * number. One of the two forms of indirection in the format (the other is
 * {@link StateRefSchema}).
 */
export const ParamRefSchema = z.strictObject({
  $param: IdentifierSchema.describe('Name of a declared numeric parameter.'),
});

export type ParamRef = z.infer<typeof ParamRefSchema>;

/**
 * A reference into the merged persistent state (chat → project → group →
 * general), usable anywhere a `$param` reference is. Its `fallback` is required
 * and load-bearing: it types the reference at load time (a numeric fallback
 * makes it a number, a string fallback a string, and so on) and guarantees that
 * run-time resolution can never fail — an absent path or a value of the wrong
 * type simply resolves to the fallback. A run is therefore always dealable.
 */
export const StateRefSchema = z.strictObject({
  $state: z
    .string()
    .min(1)
    .describe('Dot/bracket path into merged state, e.g. "player.health" or "inventory[0].name".'),
  fallback: z
    .union([z.number().finite(), z.string(), z.boolean()])
    .describe('Required. Used whenever the path is absent or holds a value of a different type.'),
});

export type StateRef = z.infer<typeof StateRefSchema>;

/** The longest Inventory reference (an object id, title or name, or a `when` key). */
export const MAX_INVENTORY_REF_LENGTH = 200;

/**
 * A reference into one `metadata` key of one Inventory object the rolling
 * character carries or can reach — `"<ref>.metadata.<key>"`, split at the
 * FIRST `.metadata.` (the `{{inventory.*}}` placeholder's rule). Accepted
 * wherever a `$state` reference is, and typed the same way: by its required
 * fallback, which run-time resolution falls back to whenever the object, the
 * key, or a value of the fallback's type is missing. Only `metadata` is
 * addressable here — a title is never a number to roll against. A top-level
 * `roll` may be one with a dice-notation fallback ("1d4"), so a sword's
 * `metadata.damage` of "2d6" can be the roll itself.
 */
export const InventoryRefSchema = z.strictObject({
  $inventory: z
    .string()
    .min(1)
    .max(MAX_INVENTORY_REF_LENGTH + 120)
    .refine((path) => splitInventoryReference(path)?.field === 'metadata', {
      message: 'must be "<object>.metadata.<key>", e.g. "sword.metadata.damage"',
    })
    .describe('"<object>.metadata.<key>": the object by id, title or name, then one of its metadata keys.'),
  fallback: z
    .union([z.number().finite(), z.string(), z.boolean()])
    .describe('Required. Used whenever the object or key is absent or holds a value of a different type.'),
});

export type InventoryRef = z.infer<typeof InventoryRefSchema>;

/** True when a value is a `$inventory` reference. */
export function isInventoryRef(value: unknown): value is InventoryRef {
  return typeof value === 'object' && value !== null && '$inventory' in value;
}

/** A roll field: a literal number, a `$param`, a `$state` or a `$inventory` reference. */
const NumberOrParamRefSchema = z.union([z.number().finite(), ParamRefSchema, StateRefSchema, InventoryRefSchema]);

export type NumberOrParamRef = z.infer<typeof NumberOrParamRefSchema>;

/** True when a roll field is a `$param` reference rather than a literal. */
export function isParamRef(value: unknown): value is ParamRef {
  return typeof value === 'object' && value !== null && '$param' in value;
}

/** True when a value is a `$state` reference rather than a literal or `$param`. */
export function isStateRef(value: unknown): value is StateRef {
  return typeof value === 'object' && value !== null && '$state' in value;
}

/** The four parameter types a definition may declare. */
export const ParameterTypeSchema = z.enum(['number', 'integer', 'string', 'boolean']);

export type ParameterType = z.infer<typeof ParameterTypeSchema>;

/**
 * A declared parameter. Every parameter requires a `default` so that a
 * zero-argument run is always possible — the model may reach for a tool without
 * supplying anything, and the table must still deal.
 */
export const CustomToolParameterSchema = z
  .object({
    type: ParameterTypeSchema.describe('Value type of this parameter.'),
    default: z
      .union([z.number(), z.string(), z.boolean(), StateRefSchema, InventoryRefSchema])
      .describe('Required. Used whenever a run omits this parameter. May be a $state or $inventory reference whose fallback matches this type.'),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .optional()
      .describe('What this parameter means, in the fiction.'),
    min: z.number().finite().optional().describe('Numeric types only. Run-time values are clamped up to this.'),
    max: z.number().finite().optional().describe('Numeric types only. Run-time values are clamped down to this.'),
    intervene: z
      .boolean()
      .optional()
      .describe(
        'Operator intervention only: false hides this parameter from the hold dialog. Absent or true shows it. ' +
          'Ignored unless the tool\'s intervention block is enabled.'
      ),
  })
  .superRefine((param, ctx) => {
    const numeric = param.type === 'number' || param.type === 'integer';

    // `min`/`max` are meaningless on a string or boolean; silently ignoring them
    // would let an author believe a bound is in force when it is not.
    if (!numeric && (param.min !== undefined || param.max !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: `min/max are only valid on number/integer parameters, not ${param.type}`,
      });
    }

    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      ctx.addIssue({ code: 'custom', message: 'min must not exceed max', path: ['min'] });
    }

    // The declared default must satisfy the parameter's own declared type. A
    // `$state` default is typed by its fallback (which run-time resolution is
    // guaranteed to fall back to), so the fallback is what must match the type.
    const defaultValue =
      isStateRef(param.default) || isInventoryRef(param.default) ? param.default.fallback : param.default;
    const defaultType = typeof defaultValue;
    if (numeric && defaultType !== 'number') {
      ctx.addIssue({ code: 'custom', message: `default must be a number for type ${param.type}`, path: ['default'] });
    }
    if (param.type === 'integer' && defaultType === 'number' && !Number.isInteger(defaultValue)) {
      ctx.addIssue({ code: 'custom', message: 'default must be a whole number for type integer', path: ['default'] });
    }
    if (param.type === 'string' && defaultType !== 'string') {
      ctx.addIssue({ code: 'custom', message: 'default must be a string for type string', path: ['default'] });
    }
    if (param.type === 'boolean' && defaultType !== 'boolean') {
      ctx.addIssue({ code: 'custom', message: 'default must be a boolean for type boolean', path: ['default'] });
    }
  });

export type CustomToolParameter = z.infer<typeof CustomToolParameterSchema>;

/**
 * Form A — a uniform roll over a numeric range, with an optional transform.
 *
 * The transform runs in a fixed order: multiply, then offset, then round.
 */
export const RollRangeSchema = z.strictObject({
  min: NumberOrParamRefSchema.optional().describe('Low bound, inclusive. Default 0.'),
  max: NumberOrParamRefSchema.optional().describe('High bound, exclusive. Default 1.'),
  multiplier: NumberOrParamRefSchema.optional().describe('Raw value is multiplied by this. Default 1.'),
  offset: NumberOrParamRefSchema.optional().describe('Added after multiplication. Default 0.'),
  round: z.boolean().optional().describe('Round the final value to a whole number. Default false.'),
});

export type RollRange = z.infer<typeof RollRangeSchema>;

/**
 * Form B — dice notation, rolled by the shared dice module. Validated here so a
 * typo is a load-time rejection rather than a run-time surprise.
 *
 * `$param` references inside the notation string are a v2 idea; v1 dice are
 * literal.
 */
export const RollDiceSchema = z
  .string()
  .refine((notation) => parseDiceNotation(notation) !== null, {
    message: `must be dice notation like "3d6+2" or "1d20" (${MIN_DIE_SIDES}–${MAX_DIE_SIDES} sides, 1–100 dice)`,
  });

/**
 * Either form of roll, or a `$inventory` reference whose (dice-notation)
 * fallback stands in when the object's metadata holds no rollable notation.
 */
export const RollSchema = z.union([RollDiceSchema, RollRangeSchema, InventoryRefSchema]);

export type Roll = z.infer<typeof RollSchema>;

/** The comparator keys, in the order tests are described to a reader. */
export const COMPARATOR_KEYS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'ncontains'] as const;

/** One comparator key. */
export type ComparatorKey = (typeof COMPARATOR_KEYS)[number];

/** The four keys that order two values, and so demand numbers on both sides. */
export const ORDERING_KEYS: ReadonlySet<ComparatorKey> = new Set<ComparatorKey>(['gt', 'gte', 'lt', 'lte']);

/** The two keys that search one string inside another, and so demand strings. */
export const CONTAINMENT_KEYS: ReadonlySet<ComparatorKey> = new Set<ComparatorKey>(['contains', 'ncontains']);

/**
 * A comparator operand for an ordering test: a literal number, or a `$param`
 * reference. The reference form is what makes an opposed check expressible —
 * `{ "gte": { "$param": "difficulty" } }` tests against a number the caller
 * supplied rather than one the author fixed at authoring time.
 */
const NumberOperandSchema = z.union([z.number().finite(), ParamRefSchema, StateRefSchema, InventoryRefSchema]);

/**
 * A comparator operand for eq/neq, which may address a parameter of any
 * declared type — `{ "eq": "brass" }` is a legitimate test of a string — or a
 * `$state` reference typed by its fallback.
 */
const AnyOperandSchema = z.union([
  z.number().finite(),
  z.string(),
  z.boolean(),
  ParamRefSchema,
  StateRefSchema,
  InventoryRefSchema,
]);

/**
 * A comparator operand for contains/ncontains: the substring to look for — a
 * literal string, a `$param` reference to a declared string parameter, or a
 * `$state` reference whose fallback is a string. The literal must be non-empty
 * because every string contains "", which makes an empty needle a typo wearing
 * a comparator's clothes.
 */
const StringOperandSchema = z.union([
  z.string().min(1, 'the substring to look for must not be empty'),
  ParamRefSchema,
  StateRefSchema,
  InventoryRefSchema,
]);

/** Shape shared by every comparator. Ordering keys are numeric on both sides. */
const NUMERIC_COMPARATOR_SHAPE = {
  gt: NumberOperandSchema.optional(),
  gte: NumberOperandSchema.optional(),
  lt: NumberOperandSchema.optional(),
  lte: NumberOperandSchema.optional(),
  eq: NumberOperandSchema.optional(),
  neq: NumberOperandSchema.optional(),
};

/** True when a comparator object actually tests something. */
const hasComparator = (c: Record<string, unknown>): boolean =>
  COMPARATOR_KEYS.some((key) => c[key] !== undefined);

const AT_LEAST_ONE = { message: 'must specify at least one comparator (gt, gte, lt, lte, eq, neq)' };

const AT_LEAST_ONE_WIDE = {
  message: 'must specify at least one comparator (gt, gte, lt, lte, eq, neq, contains, ncontains)',
};

/**
 * A comparator against a number — the rolled value, or the raw draw. Keys AND
 * together: `>= 0.3 && <= 0.6` is `{ gte: 0.3, lte: 0.6 }`. Deliberately
 * carries no contains/ncontains: the subject is always a number, and a number
 * holds no substrings.
 */
export const NumericComparatorSchema = z.strictObject(NUMERIC_COMPARATOR_SHAPE).refine(hasComparator, AT_LEAST_ONE);

export type NumericComparator = z.infer<typeof NumericComparatorSchema>;

/**
 * A comparator against a declared parameter. Identical to the numeric form
 * except that eq/neq widen to strings and booleans, since a parameter need not
 * be a number — and contains/ncontains appear, testing whether a string
 * parameter holds (or lacks) a substring. The substring is a literal or a
 * `$param` reference, so a table can ask whether one input appears inside
 * another.
 */
export const ParamComparatorSchema = z
  .strictObject({
    ...NUMERIC_COMPARATOR_SHAPE,
    eq: AnyOperandSchema.optional(),
    neq: AnyOperandSchema.optional(),
    contains: StringOperandSchema.optional(),
    ncontains: StringOperandSchema.optional(),
  })
  .refine(hasComparator, AT_LEAST_ONE_WIDE);

export type ParamComparator = z.infer<typeof ParamComparatorSchema>;

/**
 * A comparator against one key of the invoking character's metadata sheet.
 * Shape-identical to {@link ParamComparatorSchema} — the same keys, the same
 * widened eq/neq, the same contains/ncontains, the same `$param` operands.
 *
 * It is a separate schema because the two differ entirely in what can be known
 * at load time. A `params` test names something the file itself declares, so a
 * misspelling is a rejection. A `metadata` test names a key on a character the
 * file has never met: nothing here can be checked beyond the comparator's own
 * shape, and the run-time rule (a key that is absent, non-primitive, or of the
 * wrong type simply fails to match) closes the gap. See `matchesWhen`.
 */
export const MetadataComparatorSchema = ParamComparatorSchema;

export type MetadataComparator = z.infer<typeof MetadataComparatorSchema>;

/**
 * A comparator against the LLM consult's result. The comparator keys test the
 * answer string (see below for how types are reconciled at run time); `ok` is
 * an extra, non-comparator key testing whether the consult succeeded at all.
 *
 * Like `metadata`, the subject's run-time type is unknowable at load time — the
 * answer is whatever the model says — so type rules are enforced fail-soft at
 * run time: an ordering comparator against an answer that does not parse as a
 * number simply declines the row. eq/neq compare numerically when both sides
 * are numbers, and otherwise case-insensitively as trimmed strings, because an
 * author who asked for "YES" should not lose to a model that said "yes".
 * contains/ncontains search the answer for a substring under the same
 * case-insensitive reconciliation — the natural test of prose, where equality
 * would demand the whole sentence verbatim.
 */
export const LlmComparatorSchema = z
  .strictObject({
    ...NUMERIC_COMPARATOR_SHAPE,
    eq: AnyOperandSchema.optional(),
    neq: AnyOperandSchema.optional(),
    contains: StringOperandSchema.optional(),
    ncontains: StringOperandSchema.optional(),
    ok: z
      .boolean()
      .optional()
      .describe('true: this row only applies when the consult succeeded. false: only when it failed.'),
  })
  .refine((c) => hasComparator(c) || c.ok !== undefined, {
    message: 'must test something: a comparator on the answer, or `ok`',
  });

export type LlmComparator = z.infer<typeof LlmComparatorSchema>;

/**
 * Metadata keys are the USER's vocabulary, not an identifier we get to shape:
 * `metadata.json` is hand-authored and `hasAnsibleAccess` is a perfectly
 * ordinary key. So unlike `params`, whose keys must match a declared
 * `IdentifierSchema` name, these are any non-empty string.
 */
const MetadataKeySchema = z.string().min(1);

/**
 * A key into the derived progress sheet: `"<id>.<field>"`, where `<id>` is a
 * progression identifier and `<field>` one of the engine's derived fields.
 *
 * Unlike a metadata key, this vocabulary is the FORMAT's rather than the
 * user's, so the shape can be checked at load time. What still cannot be
 * checked is whether this character carries that progression, or whether the
 * field exists on it — those are facts about a character the definition has
 * never met, and they fail soft exactly as an absent metadata key does.
 */
const ProgressKeySchema = z.string().superRefine((key, ctx) => {
  // Delegated rather than re-expressed: `parseProgressKey` is the one place
  // the "<id>.<field>" shape and the progression-identifier rule live, so this
  // schema and the Workbench's condition validator cannot drift apart.
  const parsed = parseProgressKey(key);
  if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.reason });
});

/**
 * A key into the derived `inventoryAggregate` sheet: `"<scope>.<field>"` —
 * `equipped.names`, `owned.metadata.toolAbilities`,
 * `equipped.metadata.toolVersion.max`. The format's vocabulary, so checked at
 * load time; delegated to `parseAggregateKey`, the one place the grammar
 * lives. Always literal — it names a scope and a field, never an object.
 */
const AggregateKeySchema = z.string().superRefine((key, ctx) => {
  const parsed = parseAggregateKey(key);
  if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.reason });
});

const INVENTORY_AGGREGATE_DESCRIPTION =
  'Test one attribute across every object in a scope of the rolling character\'s bag, keyed "<scope>.<field>": ' +
  'scope equipped, owned (own tier, equipped or not) or reachable (everything they can see); field count, names, ' +
  'titles, metadata.<key> (a list of the objects\' values) or metadata.<key>.min/.max/.sum/.count (a number). ' +
  'A list compares entry by entry: eq holds when any entry equals the operand, neq when none does, contains / ' +
  'ncontains likewise; ordering needs a fold. With no character or chat, every test declines.';

/** The four states an `inventory` test compares against. */
export const InventoryStateValueSchema = z.enum(['equipped', 'carried', 'reachable', 'absent']);
export type InventoryStateValue = z.infer<typeof InventoryStateValueSchema>;

/**
 * An `inventory` key: an object reference (id, title or name). In an outcome
 * or effect `when` it is a TEMPLATE (`{{params.weapon}}` lets a parameter
 * choose); in a gate it must be literal (see `validateGates`).
 */
const InventoryKeySchema = z.string().min(1).max(MAX_INVENTORY_REF_LENGTH);

/**
 * A test of one object's state: `eq` / `neq` only (an ordering key is a
 * rejection — a state has no order). The operand is one of the four states
 * or a `$param` naming a string parameter.
 */
export const InventoryStateComparatorSchema = z
  .strictObject({
    eq: z.union([InventoryStateValueSchema, ParamRefSchema]).optional(),
    neq: z.union([InventoryStateValueSchema, ParamRefSchema]).optional(),
  })
  .refine((c) => c.eq !== undefined || c.neq !== undefined, {
    message: 'must test something: `eq` or `neq` against equipped, carried, reachable or absent',
  });

export type InventoryStateComparator = z.infer<typeof InventoryStateComparatorSchema>;

/** The state test a gate may pose: literal states only. */
export const GateInventoryStateComparatorSchema = z
  .strictObject({
    eq: InventoryStateValueSchema.optional(),
    neq: InventoryStateValueSchema.optional(),
  })
  .refine((c) => c.eq !== undefined || c.neq !== undefined, {
    message: 'must test something: `eq` or `neq` against equipped, carried, reachable or absent',
  });

/** The count test a gate may pose: literal numbers only, no containment. */
export const GateInventoryCountComparatorSchema = z
  .strictObject({
    gt: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    lt: z.number().finite().optional(),
    lte: z.number().finite().optional(),
    eq: z.number().finite().optional(),
    neq: z.number().finite().optional(),
  })
  .refine(hasComparator, AT_LEAST_ONE);

/**
 * A comparator in an availability gate. The same eight keys as everywhere else,
 * but every operand is a LITERAL.
 *
 * A gate is evaluated before a run exists: there are no resolved parameters to
 * point a `$param` at, and no run whose state cascade a `$state` reference could
 * be resolved against. Rejecting those forms at load time is the honest move —
 * silently tolerating one would leave an author with a gate that reads as though
 * it consults the caller's input when nothing of the sort can have happened yet.
 */
export const GateComparatorSchema = z
  .strictObject({
    gt: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    lt: z.number().finite().optional(),
    lte: z.number().finite().optional(),
    eq: z.union([z.number().finite(), z.string(), z.boolean()]).optional(),
    neq: z.union([z.number().finite(), z.string(), z.boolean()]).optional(),
    contains: z.string().min(1, 'the substring to look for must not be empty').optional(),
    ncontains: z.string().min(1, 'the substring to look for must not be empty').optional(),
  })
  .refine(hasComparator, AT_LEAST_ONE_WIDE);

export type GateComparator = z.infer<typeof GateComparatorSchema>;

/**
 * One group of an availability gate: tests that must ALL hold.
 *
 * Keyed by subject, AND-composed, and fail-soft in exactly the way an
 * outcome's `metadata` test is — a key the character lacks does not match.
 * The subjects are the ones a pre-roll test can honestly have: the character's
 * `metadata.json`, the progress sheet derived from it, and their Inventory. A
 * gate is answered BEFORE the deal: there is no roll to test, no parameters
 * (nobody has called anything), and no consult, so every operand is a literal.
 */
export const ToolGateGroupSchema = z
  .strictObject({
    metadata: z
      .record(MetadataKeySchema, GateComparatorSchema)
      .optional()
      .describe("Test the invoking character's metadata.json, keyed by metadata key. All tests must hold."),
    progress: z
      .record(ProgressKeySchema, GateComparatorSchema)
      .optional()
      .describe(
        "Test the invoking character's timed progressions, keyed \"<id>.<field>\" — e.g. { \"cannon.complete\": " +
          '{ "eq": true } }. Derived fresh from the wall clock at roster time. A progression the character does ' +
          'not carry does not match.'
      ),
    inventory: z
      .record(InventoryKeySchema, GateInventoryStateComparatorSchema)
      .optional()
      .describe(
        "Test an object's state for the invoking character in this chat, keyed by a LITERAL object reference " +
          '(id, title or name) — e.g. { "sword": { "eq": "equipped" } }. With no character or chat, every test declines.'
      ),
    inventoryCount: z
      .record(InventoryKeySchema, GateInventoryCountComparatorSchema)
      .optional()
      .describe('Test how many kin (same name) of an object the invoking character has equipped in this chat.'),
    inventoryAggregate: z
      .record(AggregateKeySchema, GateComparatorSchema)
      .optional()
      .describe(INVENTORY_AGGREGATE_DESCRIPTION),
  })
  .refine(
    (gate) =>
      Object.keys(gate.metadata ?? {}).length +
        Object.keys(gate.progress ?? {}).length +
        Object.keys(gate.inventory ?? {}).length +
        Object.keys(gate.inventoryCount ?? {}).length +
        Object.keys(gate.inventoryAggregate ?? {}).length >
      0,
    { message: 'must test at least one metadata key, progress field, inventory object, or inventory aggregate' }
  );

export type ToolGateGroup = z.infer<typeof ToolGateGroupSchema>;

/**
 * An availability gate: whether this invoker is offered the tool at all.
 *
 * One group (every test must hold), or an any-of array of groups — the gate
 * holds when ANY group holds. AND binds tighter than OR; there is no nesting.
 */
export const ToolGateSchema = z.union([
  ToolGateGroupSchema,
  z.array(ToolGateGroupSchema).min(1).max(MAX_WHEN_GROUPS, `at most ${MAX_WHEN_GROUPS} groups`),
]);

export type ToolGate = z.infer<typeof ToolGateSchema>;

/** A gate's groups, in order — one for a bare object. Every reader of a gate goes through here. */
export function gateGroups(gate: ToolGate): ToolGateGroup[] {
  return Array.isArray(gate) ? gate : [gate];
}

/**
 * The subjects an outcome row and an effect condition share — bare comparators
 * on the value, plus `roll`, `params`, `metadata`, and `llm`. One shape, spread
 * into both schemas, so the two can never disagree about a subject's type or
 * its description.
 */
const WHEN_SUBJECTS_SHAPE = {
  ...NUMERIC_COMPARATOR_SHAPE,
  roll: NumericComparatorSchema.optional().describe('Test the raw pre-transform draw rather than the final value.'),
  params: z
    .record(IdentifierSchema, ParamComparatorSchema)
    .optional()
    .describe('Test the resolved parameters, keyed by parameter name.'),
  metadata: z
    .record(MetadataKeySchema, MetadataComparatorSchema)
    .optional()
    .describe("Test the invoking character's metadata.json, keyed by metadata key. A key the character lacks does not match."),
  progress: z
    .record(ProgressKeySchema, MetadataComparatorSchema)
    .optional()
    .describe(
      'Test the invoking character\'s timed progressions, keyed "<id>.<field>" — percent, complete, remainingMs, ' +
        'state and the rest, derived from the wall clock at run start. A progression the character does not carry ' +
        'does not match, exactly as an absent metadata key does not.'
    ),
  llm: LlmComparatorSchema.optional().describe(
    "Test the LLM consult's answer (or, via `ok`, whether it succeeded). Only valid on a tool that declares an `llm` block."
  ),
  inventory: z
    .record(InventoryKeySchema, InventoryStateComparatorSchema)
    .optional()
    .describe(
      "Test an object's state for the rolling character in this chat — equipped, carried (own vault), reachable " +
        '(a shared store) or absent — keyed by object reference (a template). A run nobody made declines every test.'
    ),
  inventoryCount: z
    .record(InventoryKeySchema, NumericComparatorSchema)
    .optional()
    .describe('Test how many kin (same name) of an object the rolling character has equipped in this chat.'),
  inventoryAggregate: z
    .record(AggregateKeySchema, MetadataComparatorSchema)
    .optional()
    .describe(INVENTORY_AGGREGATE_DESCRIPTION),
};

/** True when a `when` object tests at least one of the shared subjects. */
function testsSomething(when: {
  roll?: unknown;
  llm?: unknown;
  params?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  inventory?: Record<string, unknown>;
  inventoryCount?: Record<string, unknown>;
  inventoryAggregate?: Record<string, unknown>;
}): boolean {
  return (
    (when.inventory !== undefined && Object.keys(when.inventory).length > 0) ||
    (when.inventoryAggregate !== undefined && Object.keys(when.inventoryAggregate).length > 0) ||
    (when.inventoryCount !== undefined && Object.keys(when.inventoryCount).length > 0) ||
    hasComparator(when as Record<string, unknown>) ||
    when.roll !== undefined ||
    when.llm !== undefined ||
    (when.params !== undefined && Object.keys(when.params).length > 0) ||
    (when.metadata !== undefined && Object.keys(when.metadata).length > 0) ||
    (when.progress !== undefined && Object.keys(when.progress).length > 0)
  );
}

/**
 * An outcome test. Either the literal `true` (catch-all) or an object naming
 * one or more subjects, ALL of which must hold.
 *
 * Bare comparator keys test the final value, so the common case stays as short
 * as it ever was and every definition written before this key existed still
 * means what it meant. `roll` tests the raw pre-transform draw; `params` tests
 * what the caller supplied, keyed by parameter name; `metadata` tests the
 * invoking character's own fact sheet (`metadata.json`), keyed by whatever the
 * user called it:
 *
 * ```json
 * { "gt": 1, "roll": { "gte": 15 }, "params": { "scale": { "gt": 12 } },
 *   "metadata": { "hasAnsibleAccess": { "eq": true } } }
 * ```
 *
 * A `metadata` key that this character simply doesn't have is not an error —
 * the comparator is false and the table falls through to its catch-all. That is
 * the whole point: a lockpicking table branches on the key its author invented,
 * and must still deal sensibly to the character who's never heard of it.
 *
 * Tests are AND-composed comparator objects; a one-level any-of array of them
 * is OR (see {@link WhenSchema}); there is no nesting and no expression
 * grammar, which keeps the evaluator eval-free.
 */
export const WhenObjectSchema = z
  .strictObject(WHEN_SUBJECTS_SHAPE)
  .refine(testsSomething, {
    message:
      'must test something: a comparator on the value, `roll`, `llm`, a non-empty `params`, `metadata`, `progress`, `inventory`, `inventoryCount`, or `inventoryAggregate`',
  });

export type WhenObject = z.infer<typeof WhenObjectSchema>;

/**
 * An outcome test: `true` (catch-all), one AND-group, or an any-of array of
 * AND-groups — the row wins when ANY group holds. AND binds tighter than OR.
 */
export const WhenSchema = z.union([
  z.literal(true),
  WhenObjectSchema,
  z.array(WhenObjectSchema).min(1).max(MAX_WHEN_GROUPS, `at most ${MAX_WHEN_GROUPS} groups`),
]);

export type When = z.infer<typeof WhenSchema>;

/** An outcome test's groups, in order — `[]` for the catch-all. Every reader of a `when` goes through here. */
export function whenGroups(when: When): WhenObject[] {
  if (when === true) return [];
  return Array.isArray(when) ? when : [when];
}

/** The semantic states an outcome may carry. Maps to qt classes at render. */
export const OutcomeStateSchema = z.enum(['success', 'partial', 'failure', 'info']);

export type OutcomeState = z.infer<typeof OutcomeStateSchema>;

export const CustomToolOutcomeSchema = z.strictObject({
  when: WhenSchema.describe(
    '`true` for a catch-all; or comparators on the value, `roll`, `params`, `metadata` and the other subjects that ' +
      'AND together; or an array of such objects, any one of which may hold (OR).'
  ),
  message: z
    .string()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .describe('Narrative result. Supports {{value}}, {{roll}}, {{dice}}, {{params.name}}, and {{metadata.key}}.'),
  state: OutcomeStateSchema.describe('Semantic state, used to accent the result bubble.'),
  brief: z
    .string()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .optional()
    .describe(
      "An instruction for the LLM consult's narrator: the conclusion this outcome means, in the author's words " +
        '("Report that the entanglement is definitively confirmed"). When this row wins, the consult prompt may quote it as ' +
        '{{outcome.brief}}, so the model is TOLD the verdict the table reached instead of asked to work it out. ' +
        'Takes the placeholders a consult prompt takes. Only meaningful on a tool with an `llm` block, and only ' +
        'readable by the prompt while no row tests `llm` (a table that reads the answer cannot also be read by the question).'
    ),
});

export type CustomToolOutcome = z.infer<typeof CustomToolOutcomeSchema>;

/**
 * An effect's condition. The outcome-row `when` comparator language plus ONE
 * new subject — `outcome`, the winning row's semantic state — because an effect
 * is evaluated after the table has dealt, when there finally IS a winning
 * outcome to test.
 *
 * A separate schema rather than a widened {@link WhenObjectSchema} on purpose:
 * an `outcome` subject inside an outcome row would be a self-referential dead
 * branch (the row cannot test a verdict it has not yet won), and keeping the
 * shapes separate leaves `matchesWhen` untouched.
 */
export const EffectWhenSchema = z
  .strictObject({
    ...WHEN_SUBJECTS_SHAPE,
    outcome: z
      .strictObject({
        eq: OutcomeStateSchema.optional().describe('The winning outcome carries this state.'),
        neq: OutcomeStateSchema.optional().describe('The winning outcome does not carry this state.'),
      })
      .refine((test) => test.eq !== undefined || test.neq !== undefined, {
        message: 'must test something: `eq` or `neq` against an outcome state',
      })
      .optional()
      .describe("Test the WINNING outcome's semantic state — e.g. { \"eq\": \"success\" }."),
  })
  .refine((when) => testsSomething(when) || when.outcome !== undefined, {
    message:
      'must test something: a comparator on the value, `roll`, `llm`, `outcome`, a non-empty `params`, `metadata`, `progress`, `inventory`, `inventoryCount`, or `inventoryAggregate`',
  });

export type EffectWhen = z.infer<typeof EffectWhenSchema>;

/** An effect condition: one group, or an any-of array of groups. */
export const EffectConditionSchema = z.union([
  EffectWhenSchema,
  z.array(EffectWhenSchema).min(1).max(MAX_WHEN_GROUPS, `at most ${MAX_WHEN_GROUPS} groups`),
]);

export type EffectCondition = z.infer<typeof EffectConditionSchema>;

/** An effect condition's groups, in order. Every reader of an effect `when` goes through here. */
export function effectWhenGroups(when: EffectCondition): EffectWhen[] {
  return Array.isArray(when) ? when : [when];
}

/** What a wardrobe effect does to the rolling character's outfit. */
export const WardrobeEffectActionSchema = z.enum(['wear', 'take_off', 'clear_slot']);
export type WardrobeEffectAction = z.infer<typeof WardrobeEffectActionSchema>;

/** The put-on modes a `wear` gesture may name — the `wardrobe_wear` tool's own. */
export const WardrobeEffectModeSchema = z.enum(['wear', 'replace', 'add_to_slot']);
export type WardrobeEffectMode = z.infer<typeof WardrobeEffectModeSchema>;

/**
 * A wardrobe gesture: wear the listed items, take them off, or empty one slot,
 * on the ROLLING character and nobody else.
 *
 * Item references are TEMPLATES, not expressions: each is rendered through
 * `renderTemplate` (so `{{params.garment}}` lets a parameter choose) and then
 * looked up by id, then by case-insensitive title, in the character's wearable
 * pool. The per-action cross-field rules (which action needs `items`, which
 * needs `slot`) live in `validateEffects`, not here, so the issues they raise
 * carry precise paths.
 */
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
  mode: WardrobeEffectModeSchema.optional().describe(
    "wear only. Same meaning as the wardrobe_wear tool: honour the item's replace flag (default), force a swap, or layer into one slot."
  ),
  slot: WardrobeItemTypeEnum.optional().describe(
    'Required for clear_slot and for mode add_to_slot; optional on take_off to restrict the removal to one slot.'
  ),
});

export type CustomToolWardrobeGesture = z.infer<typeof CustomToolWardrobeGestureSchema>;

/** The most object references one `inventory` gesture may name. */
export const MAX_INVENTORY_EFFECT_ITEMS = 8;

/** What an `inventory` effect does for the rolling character. */
export const InventoryEffectActionSchema = z.enum(['equip', 'unequip', 'pick_up']);
export type InventoryEffectAction = z.infer<typeof InventoryEffectActionSchema>;

/**
 * An Inventory gesture: equip, unequip or pick up objects for the ROLLING
 * character in this chat, through the chokepoints the operator's dialog uses.
 * Item references are TEMPLATES, rendered and then resolved through the one
 * reference rule (id → title → name). Kits are allowed for equip and unequip;
 * `pick_up` names archetypes and instantiates into the character's vault
 * root, equipping unless `equip` is false.
 */
export const CustomToolInventoryGestureSchema = z.strictObject({
  action: InventoryEffectActionSchema.describe(
    '"equip" takes up the listed objects (or kits); "unequip" sets them down; "pick_up" makes an instance of each listed archetype in the rolling character\'s vault.'
  ),
  items: z
    .array(z.string().min(1).max(MAX_INVENTORY_REF_LENGTH))
    .min(1)
    .max(MAX_INVENTORY_EFFECT_ITEMS)
    .describe(
      'The objects, each by id, title or name (case-insensitive). A template: {{params.x}} and the other placeholder ' +
        'families are substituted before lookup. pick_up names archetypes.'
    ),
  equip: z.boolean().optional().describe('pick_up only. Equip the new instances. Default true.'),
});

export type CustomToolInventoryGesture = z.infer<typeof CustomToolInventoryGestureSchema>;

/**
 * One side effect, recorded after the table has dealt. Either a WRITE
 * (`target` + `value`), a WARDROBE GESTURE (`wardrobe`), an INVENTORY
 * GESTURE (`inventory`) or a LOG LINE (`log`) — exactly one. One strict object with a refine rather than a union, so a mistake
 * produces one readable issue rather than a union's tree of them.
 *
 * `value` discrimination is the one ergonomic trap in the format: a JSON number
 * or boolean is a literal, stored as-is, but a JSON **string is always an
 * expression** — so literal prose must be quoted INSIDE the expression
 * (`"value": "'broken pick'"`, not `"value": "broken pick"`; the bare form is a
 * load-time parse error, and a loud one).
 */
export const CustomToolEffectSchema = z
  .strictObject({
    when: EffectConditionSchema.optional().describe(
      'Condition for this effect: one object whose tests AND together, or an array of them, any one of which may ' +
        'hold (OR). Omitted = fires on every run.'
    ),
    target: z
      .string()
      .min(1)
      .max(MAX_EFFECT_TARGET_LENGTH)
      .optional()
      .describe(
        'Where to write: "state.<path>" (tiered persistent state, written at the tier where the key already lives), ' +
          '"metadata.<key>" (the rolling character\'s fact sheet), or "progress.<id>.<field>" (one of their timed ' +
          'progressions — writing an id nobody authored creates it; write true to "progress.<id>.remove" to delete it). ' +
          'A write needs both target and value.'
      ),
    value: z
      .union([
        z.number().finite(),
        z.boolean(),
        z.string().min(1).max(MAX_EFFECT_EXPRESSION_LENGTH),
      ])
      .optional()
      .describe(
        'What to write. A JSON number or boolean is a literal. A JSON string is ALWAYS an expression — quote literal ' +
          "prose inside it (\"'broken pick'\"). Expressions take arithmetic, +-concatenation, parentheses, and {{ref}} " +
          'substitution ({{value}}, {{roll}}, {{dice}}, {{llm}}, {{now}}, {{character}}, {{params.x}}, {{metadata.key}}, ' +
          '{{state.path}}, {{progress.id.field}}).'
      ),
    wardrobe: CustomToolWardrobeGestureSchema.optional().describe(
      'A wardrobe gesture on the rolling character instead of a write: wear items, take them off, or clear a slot.'
    ),
    inventory: CustomToolInventoryGestureSchema.optional().describe(
      'An Inventory gesture on the rolling character instead of a write: equip, unequip or pick up objects.'
    ),
    log: z
      .string()
      .min(1)
      .max(MAX_MESSAGE_LENGTH)
      .optional()
      .describe(
        'A line for the log (the one log_read and log_grep search) instead of a write. A template, like an outcome ' +
          'message: plain prose, with {{value}}, {{roll}}, {{character}}, {{params.x}}, {{state.path}} and the other ' +
          'placeholder families substituted. Recorded against this chat and the rolling character.'
      ),
    intervene: z
      .boolean()
      .optional()
      .describe(
        'Operator intervention only: false hides this effect from the hold dialog. Absent or true shows it. ' +
          'Ignored unless the tool\'s intervention block is enabled.'
      ),
  })
  .superRefine((effect, ctx) => {
    const isWrite = effect.target !== undefined || effect.value !== undefined;
    const isWardrobe = effect.wardrobe !== undefined;
    const isInventory = effect.inventory !== undefined;
    const isLog = effect.log !== undefined;
    const kinds = [isWrite, isWardrobe, isInventory, isLog].filter(Boolean).length;
    if (kinds > 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          'an effect is exactly one of a write (target + value), a wardrobe gesture, an inventory gesture, or a log line',
      });
    } else if (kinds === 0) {
      ctx.addIssue({ code: 'custom', message: 'an effect needs target + value, wardrobe, inventory, or log' });
    } else if (isWrite && (effect.target === undefined || effect.value === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a write needs both target and value',
        path: [effect.target === undefined ? 'target' : 'value'],
      });
    }
  });

export type CustomToolEffect = z.infer<typeof CustomToolEffectSchema>;

/** An effect that writes one value. */
export type CustomToolWriteEffect = CustomToolEffect & { target: string; value: number | boolean | string };

/** An effect that changes the rolling character's outfit. */
export type CustomToolWardrobeEffect = CustomToolEffect & { wardrobe: CustomToolWardrobeGesture };

/** An effect that changes what the rolling character carries. */
export type CustomToolInventoryEffect = CustomToolEffect & { inventory: CustomToolInventoryGesture };

/** An effect that writes a line to the log. */
export type CustomToolLogEffect = CustomToolEffect & { log: string };

/** True for a write effect. Use this rather than re-testing keys. */
export function isWriteEffect(effect: CustomToolEffect): effect is CustomToolWriteEffect {
  return (
    effect.wardrobe === undefined &&
    effect.inventory === undefined &&
    effect.log === undefined &&
    effect.target !== undefined &&
    effect.value !== undefined
  );
}

/** True for a wardrobe gesture. Use this rather than re-testing keys. */
export function isWardrobeEffect(effect: CustomToolEffect): effect is CustomToolWardrobeEffect {
  return (
    effect.wardrobe !== undefined &&
    effect.inventory === undefined &&
    effect.log === undefined &&
    effect.target === undefined &&
    effect.value === undefined
  );
}

/** True for an Inventory gesture. Use this rather than re-testing keys. */
export function isInventoryEffect(effect: CustomToolEffect): effect is CustomToolInventoryEffect {
  return (
    effect.inventory !== undefined &&
    effect.wardrobe === undefined &&
    effect.log === undefined &&
    effect.target === undefined &&
    effect.value === undefined
  );
}

/** True for a log line. Use this rather than re-testing keys. */
export function isLogEffect(effect: CustomToolEffect): effect is CustomToolLogEffect {
  return (
    effect.log !== undefined &&
    effect.wardrobe === undefined &&
    effect.inventory === undefined &&
    effect.target === undefined &&
    effect.value === undefined
  );
}

/**
 * The per-action rules of an Inventory gesture — the one statement of them,
 * read by load-time validation and the Workbench's draft check.
 */
export function inventoryGestureProblems(
  gesture: Pick<CustomToolInventoryGesture, 'action' | 'equip'> & { items?: readonly string[] }
): Array<{ field: 'items' | 'equip'; message: string }> {
  const problems: Array<{ field: 'items' | 'equip'; message: string }> = [];
  if ((gesture.items?.length ?? 0) === 0) problems.push({ field: 'items', message: `${gesture.action} needs at least one object` });
  if (gesture.equip !== undefined && gesture.action !== 'pick_up') {
    problems.push({ field: 'equip', message: 'equip is only used with pick_up' });
  }
  return problems;
}

/**
 * The per-action rules of a wardrobe gesture, as `[field, message]` pairs. The
 * single statement of them: load-time validation and the Workbench's draft
 * check both read this, so the two say the same words.
 */
export function wardrobeGestureProblems(
  gesture: Pick<CustomToolWardrobeGesture, 'action' | 'mode' | 'slot'> & { items?: readonly string[] }
): Array<{ field: 'items' | 'mode' | 'slot'; message: string }> {
  const problems: Array<{ field: 'items' | 'mode' | 'slot'; message: string }> = [];
  const hasItems = (gesture.items?.length ?? 0) > 0;
  switch (gesture.action) {
    case 'wear': {
      if (!hasItems) problems.push({ field: 'items', message: 'wear needs at least one item' });
      const mode = gesture.mode ?? 'wear';
      if (mode === 'add_to_slot' && gesture.slot === undefined) {
        problems.push({ field: 'slot', message: 'mode add_to_slot needs a slot' });
      } else if (mode !== 'add_to_slot' && gesture.slot !== undefined) {
        problems.push({ field: 'slot', message: 'slot is only used with mode add_to_slot' });
      }
      break;
    }
    case 'take_off':
      if (!hasItems) problems.push({ field: 'items', message: 'take_off needs at least one item' });
      if (gesture.mode !== undefined) problems.push({ field: 'mode', message: 'mode is only used with wear' });
      break;
    case 'clear_slot':
      if (gesture.slot === undefined) problems.push({ field: 'slot', message: 'clear_slot needs a slot' });
      if (gesture.items !== undefined) problems.push({ field: 'items', message: 'clear_slot takes no items' });
      if (gesture.mode !== undefined) problems.push({ field: 'mode', message: 'mode is only used with wear' });
      break;
  }
  return problems;
}

/** Re-exported for readers that type a gesture's slot without the wardrobe schema module. */
export type { WardrobeItemType };

/** A parsed effect target, with the raw text kept for records and messages. */
export type EffectTarget =
  | { kind: 'state'; path: Array<string | number>; raw: string }
  | { kind: 'metadata'; key: string; raw: string }
  | { kind: 'progress'; id: string; field: WritableProgressionField; raw: string };

/**
 * Parse an effect's `target`. The single parser for the syntax — validation,
 * the applier, and the Workbench all come through here, so "what counts as a
 * writable target" is decided exactly once.
 *
 * - `state.<path>` — the remainder is a state path (`parsePath` dot/bracket
 *   syntax). An empty path is rejected, and so is a first segment starting with
 *   `_`: those keys are the user's own (the `state` tool's underscore guard),
 *   and no AI-adjacent path may write them.
 * - `metadata.<key>` — the remainder is taken WHOLE as the key. Metadata keys
 *   are the user's vocabulary, so dots inside the key are fine precisely
 *   because it is not path-parsed.
 * - `progress.<id>.<field>` — a field of one of the rolling character's timed
 *   progressions. Unlike a metadata key, BOTH halves are the format's own
 *   vocabulary and both are checked here: the id against the progression
 *   identifier rule, the field against the closed writable set (which includes
 *   the `remove` pseudo-field — write `true` to delete the progression).
 *   Writing an id nobody authored CREATES the progression, so there is nothing
 *   to check about existence; what would be a silent no-op is a `quantity`
 *   written whole, or a `percent` written at all, and both are rejected here
 *   with the field list in the reason.
 */
export function parseEffectTarget(
  target: string
): { ok: true; target: EffectTarget } | { ok: false; reason: string } {
  if (target.startsWith('state.')) {
    const rest = target.slice('state.'.length);
    const path = parsePath(rest);
    if (path.length === 0) {
      return { ok: false, reason: 'names no state path after "state."' };
    }
    const first = path[0];
    if (typeof first === 'string' && first.startsWith('_')) {
      return {
        ok: false,
        reason: `writes "${rest}" — state keys starting with an underscore are user-only, and no tool may write them`,
      };
    }
    return { ok: true, target: { kind: 'state', path, raw: target } };
  }

  // Checked BEFORE `metadata.`, which it does not prefix-collide with, but
  // ordering it first keeps the two user-facing families adjacent below.
  if (target.startsWith('progress.')) {
    const rest = target.slice('progress.'.length);
    const dot = rest.indexOf('.');
    if (dot <= 0 || dot === rest.length - 1) {
      return {
        ok: false,
        reason: 'must name "progress.<progression id>.<field>" — e.g. "progress.cannon.endTime"',
      };
    }
    const id = rest.slice(0, dot);
    const field = rest.slice(dot + 1);
    if (!PROGRESSION_ID_PATTERN.test(id)) {
      return {
        ok: false,
        reason: `writes progression "${id}", which is not a valid id — lowercase, starting with a letter, then letters, digits, _ or - (at most 64)`,
      };
    }
    if (!isWritableProgressionField(field)) {
      return {
        ok: false,
        reason: `writes "${field}", which is not a writable progression field — use one of ${WRITABLE_PROGRESSION_FIELDS.join(', ')}`,
      };
    }
    return { ok: true, target: { kind: 'progress', id, field, raw: target } };
  }

  if (target.startsWith('metadata.')) {
    const key = target.slice('metadata.'.length);
    if (key.length === 0) {
      return { ok: false, reason: 'names no metadata key after "metadata."' };
    }
    // The reserved key is not writable through this door. An effect's value is
    // always a PRIMITIVE, so `metadata.progressions` would replace the whole
    // progressions object with a string or a number — wiping every timed span
    // the character carries, past the schema validation and the rollback that
    // guard the `progress.` path, and fail-soft enough on the next read that
    // nobody would notice. `metadata.progressions.cannon` is refused for the
    // adjacent reason: a metadata key is taken WHOLE, so that writes a
    // literal key named "progressions.cannon" and touches no progression at
    // all, which is not what anyone writing it means.
    if (key === PROGRESSIONS_METADATA_KEY || key.startsWith(`${PROGRESSIONS_METADATA_KEY}.`)) {
      return {
        ok: false,
        reason:
          `writes the reserved "${PROGRESSIONS_METADATA_KEY}" key through "metadata." — ` +
          'use "progress.<id>.<field>" instead, which is validated and rolled back on a bad result',
      };
    }
    return { ok: true, target: { kind: 'metadata', key, raw: target } };
  }

  return { ok: false, reason: 'must start with "state.", "metadata." or "progress."' };
}

/** Default visibility for a tool's result. */
export const VisibilitySchema = z.enum(['public', 'whisper']);

export type Visibility = z.infer<typeof VisibilitySchema>;

/**
 * The LLM consult block. When present, every run renders `prompt` (the same
 * placeholder families an outcome message takes, minus `{{llm}}` itself) and
 * poses it to the instance's cheap utility model AFTER the roll and BEFORE the
 * outcome table is evaluated. The result is a pair `{ ok, output }`:
 *
 * - success → `ok: true`, `output` is the model's trimmed answer;
 * - failure (provider error, timeout, empty answer, no model configured) →
 *   `ok: false`, `output` is this block's `errorMessage` — the AUTHOR's words,
 *   never the provider's stack trace, because whatever lands in the fiction is
 *   the author's to write.
 *
 * Either way the pair is testable in `when` (the `llm` subject) and renderable
 * in messages (`{{llm}}`), so a failed consult is an outcome the table can deal
 * with rather than an error bubble: the run itself never fails because the
 * oracle went quiet.
 */
export const CustomToolLlmSchema = z.strictObject({
  prompt: z
    .string()
    .min(1)
    .max(MAX_LLM_PROMPT_LENGTH)
    .describe(
      'What to ask. Supports {{value}}, {{roll}}, {{dice}}, {{params.name}}, {{metadata.key}}, and {{state.path}} — but not {{llm}}. ' +
        'Ask for the answer shape you intend to test: a bare word, a number, a sentence. When the table decides the ' +
        'verdict (no outcome tests `llm`), do not ask the model to compare numbers: give each outcome a `brief` and ' +
        'write {{outcome.brief}} (also {{outcome.state}}, {{outcome.index}}) here — the table has already chosen.'
    ),
  errorMessage: z
    .string()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .describe(
      "The consult's output when the call fails, in the author's own words. Never the technical reason — " +
        'that goes to the roll record and the logs.'
    ),
  maxOutput: z
    .number()
    .int()
    .min(1)
    .max(MAX_LLM_OUTPUT_CEILING)
    .optional()
    .describe(
      `Cap on the answer, in characters. Default ${MAX_LLM_OUTPUT_LENGTH}. Set it low for a verdict, ` +
        'high for a consult whose answer IS the deliverable. The token budget of the call scales with it. ' +
        'Applies to the model\'s answer only, never to errorMessage.'
    ),
});

export type CustomToolLlm = z.infer<typeof CustomToolLlmSchema>;

/**
 * The parts of a run that are not objects in the file — so their intervention
 * flags live in the tool-level `intervention.fields` block rather than on the
 * member itself (parameters and effects carry their own `intervene` flag).
 * Closed: an unknown key is rejected at load, like everywhere else in the format.
 */
export const INTERVENTION_FIELD_KEYS = [
  'roll',
  'value',
  'llmPrompt',
  'llmAnswer',
  'outcome',
  'message',
  'state',
  'chipLabel',
  'title',
  'visibility',
  'announcer',
] as const;

export type InterventionFieldKey = (typeof INTERVENTION_FIELD_KEYS)[number];

/**
 * Operator intervention: an intervenable tool's run, reached by a model's
 * `run_custom` or a trigger phrase, is held for the operator before it is
 * announced. Design of record: docs/developer/features/complete/pascal-operator-intervention.md.
 *
 * Flags on a tool that is not intervenable, and keys naming something the tool
 * lacks (`llmAnswer` with no `llm` block), are accepted and ignored — they can
 * never mislead a run, and switching the master toggle off and on keeps them.
 */
export const CustomToolInterventionSchema = z.strictObject({
  enabled: z
    .boolean()
    .describe('Required. true holds each model- or trigger-reached run for the operator; false keeps the block but switches it off.'),
  fields: z
    .strictObject(
      Object.fromEntries(INTERVENTION_FIELD_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
        InterventionFieldKey,
        z.ZodOptional<z.ZodBoolean>
      >
    )
    .optional()
    .describe('Per-field visibility in the hold dialog. A key set to false hides that field; absent keys are shown.'),
});

export type CustomToolIntervention = z.infer<typeof CustomToolInterventionSchema>;

/**
 * The custom-tool definition.
 *
 * Unknown TOP-LEVEL keys are tolerated, which reserves room for future keys
 * (as it once did for `effects`, which shipped under that tolerance) without
 * breaking older builds. `collectUnknownKeys` surfaces them for a debug log.
 *
 * That tolerance stops at the top level: every nested object below is strict.
 * The forward-compatibility argument does not reach them, and inside a `when`
 * an unrecognised key is overwhelmingly a misspelled comparator — which, if
 * tolerated, silently drops the test and leaves a row of the outcome table
 * looking like a dead branch. It is also what the published JSON Schema has
 * always claimed (`additionalProperties: false`), so an author's editor and
 * the loader now agree.
 */
export const QtapCustomToolSchema = z
  .object({
    $schema: z.string().optional().describe('Editor hint; ignored at runtime.'),
    name: IdentifierSchema.describe("The tool's identity. Not the filename."),
    title: z
      .string()
      .min(1)
      .max(MAX_TITLE_LENGTH)
      .optional()
      .describe('Human-readable name for display. Defaults to a title-cased `name`.'),
    chipLabel: z
      .string()
      .min(1)
      .max(MAX_CHIP_LABEL_LENGTH)
      .optional()
      .describe(
        'Templated label for the outcome chip and the announcement header. Same placeholders as an outcome message. ' +
          'Rendered after the outcome is chosen. Blank/absent = the title labels the chip.'
      ),
    triggers: z
      .array(z.string().min(MIN_TRIGGER_PHRASE_LENGTH).max(MAX_TRIGGER_PHRASE_LENGTH))
      .min(1)
      .max(MAX_TRIGGERS)
      .optional()
      .describe(
        'Phrases that run this tool automatically, with every parameter at its default, when a message from anyone ' +
          'in the chat contains one — exact substrings, case-insensitive, no wildcards. Only honoured when the chat ' +
          'setting "Auto-Run Custom Tools on Trigger Phrases" is on (it is off by default).'
      ),
    description: z
      .string()
      .min(1)
      .max(MAX_DESCRIPTION_LENGTH)
      .describe('What the tool does IN THE FICTION — how the model decides to reach for it.'),
    disabled: z.boolean().optional().describe('true suppresses this name at this tier and below.'),
    availableWhen: ToolGateSchema.optional().describe(
      'Offer this tool ONLY to an invoker who satisfies every test here (or, for an array, every test of any one ' +
        'element). At most one of availableWhen/withheldWhen.'
    ),
    withheldWhen: ToolGateSchema.optional().describe(
      'Withhold this tool from an invoker who satisfies every test here (or, for an array, every test of any one ' +
        'element). At most one of availableWhen/withheldWhen.'
    ),
    revealOdds: z
      .boolean()
      .optional()
      .describe('false hides the roll spec and outcome table from the model. Default true.'),
    defaultVisibility: VisibilitySchema.optional().describe('Default result visibility. Default "public".'),
    announceAsCharacter: z
      .boolean()
      .optional()
      .describe(
        'true: the rolling character announces the outcome under their own name and face, in place of Pascal. ' +
          'A run nobody made (the bare operator) is still announced by Pascal. Default false.'
      ),
    intervention: CustomToolInterventionSchema.optional().describe(
      'Operator intervention: hold each run a model or a trigger phrase reaches, so the operator can adjust, force or ' +
        'veto it before it is announced. Never shown to the model — but a character with read access to the store can ' +
        'read the file, flag and all.'
    ),
    parameters: z
      .record(IdentifierSchema, CustomToolParameterSchema)
      .refine((params) => Object.keys(params).length <= MAX_PARAMETERS, {
        message: `at most ${MAX_PARAMETERS} parameters`,
      })
      .optional(),
    roll: RollSchema.optional().describe('Numeric range object, or dice notation. Default: 0–1 uniform.'),
    llm: CustomToolLlmSchema.optional().describe(
      'Ask an LLM for a generated result after the roll; outcomes may then test it and messages may render it.'
    ),
    effects: z
      .array(CustomToolEffectSchema)
      .max(MAX_EFFECTS, `at most ${MAX_EFFECTS} effects`)
      .optional()
      .describe(
        'Side effects applied after the run: writes into tiered persistent state or the rolling character\'s metadata, ' +
          'wardrobe gestures that change what the rolling character is wearing, or inventory gestures that change what they carry.'
      ),
    outcomes: z
      .array(CustomToolOutcomeSchema)
      .min(1, 'at least one outcome is required')
      .max(MAX_OUTCOMES, `at most ${MAX_OUTCOMES} outcomes`)
      .describe('Ordered; first match wins. The last entry must be a `true` catch-all.'),
  })
  .superRefine((tool, ctx) => {
    validateOutcomeOrdering(tool.outcomes, ctx);
    validateReferences(tool, ctx);
    validateOutcomeBriefs(tool, ctx);
    validateGates(tool, ctx);
    validateEffects(tool, ctx);
    validateTriggers(tool, ctx);
  });

export type QtapCustomTool = z.infer<typeof QtapCustomToolSchema>;

/**
 * The name to show a human — the author's `title`, or one derived from `name`.
 *
 * The single source of the display string: the announcement, the composer
 * popup, and the roster listing all come through here, so `scan_hawking_radiation`
 * reads as "Scan Hawking Radiation" in every one of them without three
 * implementations agreeing by luck. The model never sees this — it calls tools
 * by `name`, and a second string for one tool would only invite it to pass the
 * wrong one.
 */
export function displayTitle(definition: Pick<QtapCustomTool, 'name' | 'title'>): string {
  const authored = definition.title?.trim();
  if (authored) return authored;

  return definition.name
    .split(/[_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Rule: the final outcome must be the literal `true`, and no earlier outcome
 * may be.
 *
 * The trailing catch-all makes a coverage gap structurally impossible — there
 * is always exactly one outcome to land on. An earlier catch-all would make
 * everything below it dead, which is a typo rather than an intent.
 */
function validateOutcomeOrdering(outcomes: CustomToolOutcome[], ctx: z.RefinementCtx): void {
  if (outcomes.length === 0) return;

  outcomes.forEach((outcome, i) => {
    const isCatchAll = outcome.when === true;
    const isLast = i === outcomes.length - 1;

    if (isCatchAll && !isLast) {
      ctx.addIssue({
        code: 'custom',
        message: `outcome ${i} is a catch-all (when: true), so every outcome after it is unreachable`,
        path: ['outcomes', i, 'when'],
      });
    }

    if (isLast && !isCatchAll) {
      ctx.addIssue({
        code: 'custom',
        message: 'the final outcome must be a catch-all (when: true) so every roll lands somewhere',
        path: ['outcomes', i, 'when'],
      });
    }
  });
}

/** True when any outcome row's `when` tests the consult (`llm`, or its `ok`). */
export function outcomeTableTestsLlm(outcomes: ReadonlyArray<Pick<CustomToolOutcome, 'when'>>): boolean {
  return outcomes.some((outcome) => whenGroups(outcome.when).some((group) => group.llm !== undefined));
}

/**
 * Rule: `{{outcome.*}}` and `brief` keep to the run order.
 *
 * When no row tests the consult, the table is dealt first and the prompt may
 * quote the winning row. When some row does, the table needs the answer, so the
 * prompt cannot read the verdict — a reference there would be a hole for ever,
 * and it is rejected at load. A `brief` is rendered before the consult too, so
 * it may quote neither `{{llm}}` nor `{{outcome.*}}`.
 */
function validateOutcomeBriefs(
  tool: { llm?: CustomToolLlm; outcomes: CustomToolOutcome[] },
  ctx: z.RefinementCtx
): void {
  if (tool.llm && outcomeTableTestsLlm(tool.outcomes)) {
    for (const { key, ref } of scanPlaceholdersInText(tool.llm.prompt)) {
      if (ref.kind === 'outcome') {
        ctx.addIssue({
          code: 'custom',
          message:
            `the consult prompt references {{${key}}}, but an outcome tests the consult's answer, so the table ` +
            "cannot be dealt before the consult. Drop the `llm` test, or take the verdict out of the prompt",
          path: ['llm', 'prompt'],
        });
      }
    }
  }

  tool.outcomes.forEach((outcome, i) => {
    if (outcome.brief === undefined) return;
    const path = ['outcomes', i, 'brief'];
    if (!tool.llm) {
      ctx.addIssue({ code: 'custom', message: 'has a `brief`, but the tool declares no `llm` block to read it', path });
    }
    for (const { key, ref } of scanPlaceholdersInText(outcome.brief)) {
      if (ref.kind === 'llm' || ref.kind === 'outcome') {
        ctx.addIssue({
          code: 'custom',
          message: `a brief is written before the consult runs and cannot quote {{${key}}}`,
          path,
        });
      }
    }
  });
}

/**
 * Rule: a definition gates one way or the other, never both.
 *
 * The two clauses are not complements — `withheldWhen` and a negated
 * `availableWhen` differ precisely on the character who lacks the key, which is
 * the whole reason both exist — so a file carrying both is asking two questions
 * whose interaction its author almost certainly has not thought through. It is
 * also the shape the Workbench's single "who may reach for it" control cannot
 * represent, and a form that silently drops half a file is worse than a
 * rejection that says which half.
 */
function validateGates(
  tool: { availableWhen?: ToolGate; withheldWhen?: ToolGate },
  ctx: z.RefinementCtx
): void {
  if (tool.availableWhen && tool.withheldWhen) {
    ctx.addIssue({
      code: 'custom',
      message:
        'declares both availableWhen and withheldWhen — a definition gates one way or the other. ' +
        'Fold the second test into the first, remembering that a key the character lacks never matches.',
      path: ['withheldWhen'],
    });
  }

  // A gate is answered at roster time, before any parameter exists, so a
  // templated key would be its literal text for ever — and resolve to
  // `absent` for ever. Outcome and effect `when` keys stay templates.
  for (const clause of ['availableWhen', 'withheldWhen'] as const) {
    const gate = tool[clause];
    if (!gate) continue;
    gateGroups(gate).forEach((group, g) => {
      const base: Array<string | number> = Array.isArray(gate) ? [clause, g] : [clause];
      for (const subject of ['inventory', 'inventoryCount'] as const) {
        for (const key of Object.keys(group[subject] ?? {})) {
          if (key.includes('{{')) {
            ctx.addIssue({
              code: 'custom',
              message: `a gate's ${subject} key must be a literal object reference; "${key}" carries a placeholder, and a gate has no parameters to fill it`,
              path: [...base, subject, key],
            });
          }
        }
      }
    });
  }
}

/**
 * Rule: a trigger phrase is stored as written, but must equal its own `trim()`
 * — leading or trailing whitespace is a typo that would make "fire " miss
 * "fire." — and no two phrases of one tool may be equal case-insensitively,
 * since matching folds case and the second would never add anything.
 */
function validateTriggers(tool: { triggers?: string[] }, ctx: z.RefinementCtx): void {
  if (!tool.triggers) return;
  const seen = new Map<string, number>();
  tool.triggers.forEach((phrase, index) => {
    if (phrase !== phrase.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: `trigger ${index + 1} has leading or trailing whitespace`,
        path: ['triggers', index],
      });
    }
    const folded = phrase.toLocaleLowerCase();
    const earlier = seen.get(folded);
    if (earlier !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `trigger ${index + 1} repeats trigger ${earlier + 1} (phrases match regardless of case)`,
        path: ['triggers', index],
      });
    } else {
      seen.set(folded, index);
    }
  });
}

/** The value types a subject or an operand can carry, with `integer` folded in. */
export type ValueType = 'number' | 'string' | 'boolean';

/** Fold a declared parameter type down to the type its values actually have. */
export function valueTypeOf(type: ParameterType): ValueType {
  return type === 'integer' ? 'number' : type;
}

/**
 * Rule: every `$param` reference — in a roll field or in a comparator — must
 * name a declared parameter, and the comparison it takes part in must be one
 * that can hold at run time.
 *
 * All of this is authoring error caught at load: a misspelled parameter, an
 * ordering test against a string, `{ "eq": "brass" }` posed to a number. Left
 * to run time these are silent — a test that simply never fires reads as a dead
 * branch in the outcome table rather than the typo it is.
 */
function validateReferences(
  tool: {
    parameters?: Record<string, CustomToolParameter>;
    roll?: Roll;
    llm?: CustomToolLlm;
    outcomes: CustomToolOutcome[];
  },
  ctx: z.RefinementCtx
): void {
  const declared = tool.parameters ?? {};

  validateRollRefs(declared, tool.roll, ctx);

  tool.outcomes.forEach((outcome, i) => {
    const groups = whenGroups(outcome.when);
    groups.forEach((group, g) => {
      const path = Array.isArray(outcome.when) ? ['outcomes', i, 'when', g] : ['outcomes', i, 'when'];
      validateWhenSubjects(declared, group, Boolean(tool.llm), ctx, path);
    });
  });
}

/**
 * The shared walk over one `when` object's subjects — outcome rows and effect
 * conditions carry the same comparator language, so they are checked by the
 * same code rather than two copies that drift.
 */
function validateWhenSubjects(
  declared: Record<string, CustomToolParameter>,
  when: WhenObject | EffectWhen,
  hasLlmBlock: boolean,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  // Bare comparator keys, and `roll`, both address a number.
  validateComparator(declared, when, 'number', 'the rolled value', ctx, path);
  if (when.roll !== undefined) {
    validateComparator(declared, when.roll, 'number', 'the raw roll', ctx, [...path, 'roll']);
  }

  for (const [name, comparator] of Object.entries(when.params ?? {})) {
    const target = declared[name];
    if (!target) {
      ctx.addIssue({
        code: 'custom',
        message: `tests undeclared parameter "${name}"`,
        path: [...path, 'params', name],
      });
      continue;
    }
    validateComparator(declared, comparator, valueTypeOf(target.type), `parameter "${name}"`, ctx, [
      ...path,
      'params',
      name,
    ]);
  }

  // An `llm` test on a tool with no `llm` block could never fire — there is
  // no consult whose answer it might match. That is a typo, not an intent,
  // and left alone it reads as a dead branch in the outcome table.
  if (when.llm !== undefined) {
    if (!hasLlmBlock) {
      ctx.addIssue({
        code: 'custom',
        message: 'tests the LLM consult, but the tool declares no `llm` block',
        path: [...path, 'llm'],
      });
    }
    // The answer's run-time type is the model's business (see the schema
    // comment), so — exactly as with `metadata` — only the `$param` operands
    // are checkable here.
    validateMetadataOperands(declared, when.llm, ctx, [...path, 'llm']);
  }

  // `metadata` gets a shallower check, and there is no way around it: the
  // keys live on a character the file has never seen, so neither the key's
  // existence nor its stored type is knowable here. What IS checkable is the
  // operand — a `$param` reference must still resolve to a declared
  // parameter, exactly as anywhere else. The rest (absent key, wrong type,
  // non-primitive value) is caught fail-soft at run time by `matchesWhen`,
  // where the character is finally in the room.
  for (const [key, comparator] of Object.entries(when.metadata ?? {})) {
    validateMetadataOperands(declared, comparator, ctx, [...path, 'metadata', key]);
  }

  // An aggregate's key is the format's own (checked by its schema); whether a
  // scope holds anything, and what types its values carry, are facts about a
  // character — so, as with `metadata`, only the operands are checkable here.
  for (const [key, comparator] of Object.entries(when.inventoryAggregate ?? {})) {
    validateMetadataOperands(declared, comparator, ctx, [...path, 'inventoryAggregate', key]);
  }

  // `inventory` and `inventoryCount` keys are TEMPLATES: their placeholders
  // must resolve the way an item reference's do. The state operand is a
  // literal state or a `$param` to a string parameter; the count's operands
  // are numbers.
  for (const [key, comparator] of Object.entries(when.inventory ?? {})) {
    validateTemplatePlaceholders(declared, hasLlmBlock, key, ctx, [...path, 'inventory', key]);
    for (const op of ['eq', 'neq'] as const) {
      const operand = comparator[op];
      if (operand === undefined || !isParamRef(operand)) continue;
      const target = declared[operand.$param];
      if (!target) {
        ctx.addIssue({
          code: 'custom',
          message: `references undeclared parameter "${operand.$param}"`,
          path: [...path, 'inventory', key, op],
        });
      } else if (valueTypeOf(target.type) !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: `${op} compares an inventory state with parameter "${operand.$param}", which is ${target.type} rather than a string`,
          path: [...path, 'inventory', key, op],
        });
      }
    }
  }
  for (const [key, comparator] of Object.entries(when.inventoryCount ?? {})) {
    validateTemplatePlaceholders(declared, hasLlmBlock, key, ctx, [...path, 'inventoryCount', key]);
    validateComparator(declared, comparator, 'number', `the equipped count of "${key}"`, ctx, [
      ...path,
      'inventoryCount',
      key,
    ]);
  }
}

/**
 * A template's placeholders resolve as an outcome message's must: a
 * `{{params.x}}` names a declared parameter, a `{{llm}}` needs an `llm` block.
 * Used for inventory keys and references and for log lines.
 */
function validateTemplatePlaceholders(
  declared: Record<string, CustomToolParameter>,
  hasLlmBlock: boolean,
  key: string,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  for (const { ref } of scanPlaceholdersInText(key)) {
    if (ref.kind === 'params' && !declared[ref.name]) {
      ctx.addIssue({ code: 'custom', message: `references undeclared parameter "${ref.name}"`, path });
    } else if (ref.kind === 'llm' && !hasLlmBlock) {
      ctx.addIssue({ code: 'custom', message: 'references {{llm}}, but the tool declares no `llm` block', path });
    }
  }
}

/**
 * Rule: every effect must be applicable. The target parses (including the
 * underscore guard), a string `value` parses as an expression, every
 * `params.x` reference names a declared parameter, and an `{{llm}}` reference
 * or an `llm` `when`-subject requires an `llm` block — the same rule outcome
 * rows follow.
 *
 * Parse failure here is the dice-notation doctrine: syntax errors are typos,
 * caught in the Workbench and at discovery, never at the table.
 */
function validateEffects(
  tool: {
    parameters?: Record<string, CustomToolParameter>;
    llm?: CustomToolLlm;
    effects?: CustomToolEffect[];
  },
  ctx: z.RefinementCtx
): void {
  const declared = tool.parameters ?? {};

  (tool.effects ?? []).forEach((effect, i) => {
    const base = ['effects', i];

    if (effect.when !== undefined) {
      const when = effect.when;
      effectWhenGroups(when).forEach((group, g) => {
        const path = Array.isArray(when) ? [...base, 'when', g] : [...base, 'when'];
        validateWhenSubjects(declared, group, Boolean(tool.llm), ctx, path);
      });
    }

    if (effect.wardrobe !== undefined) {
      validateWardrobeGesture(declared, Boolean(tool.llm), effect.wardrobe, ctx, [...base, 'wardrobe']);
      return;
    }

    if (effect.log !== undefined) {
      validateTemplatePlaceholders(declared, Boolean(tool.llm), effect.log, ctx, [...base, 'log']);
      return;
    }

    if (effect.inventory !== undefined) {
      for (const problem of inventoryGestureProblems(effect.inventory)) {
        ctx.addIssue({ code: 'custom', message: problem.message, path: [...base, 'inventory', problem.field] });
      }
      effect.inventory.items.forEach((item, m) => {
        validateTemplatePlaceholders(declared, Boolean(tool.llm), item, ctx, [...base, 'inventory', 'items', m]);
      });
      return;
    }

    // Shape errors (a write missing its target or value) are the effect
    // schema's own refine; nothing further to check without both halves.
    if (effect.target === undefined || effect.value === undefined) return;

    const target = parseEffectTarget(effect.target);
    if (!target.ok) {
      ctx.addIssue({ code: 'custom', message: `target ${target.reason}`, path: [...base, 'target'] });
    }

    // A JSON string value is ALWAYS an expression — the quoting trap. The bare
    // prose an author meant as a literal fails to parse right here, loudly.
    if (typeof effect.value === 'string') {
      const parsed = parseExpression(effect.value);
      if (!parsed.ok) {
        ctx.addIssue({
          code: 'custom',
          message: `value is not a valid expression: ${parsed.reason}`,
          path: [...base, 'value'],
        });
      } else {
        for (const ref of parsed.expr.refs) {
          if (ref.startsWith('params.')) {
            const name = ref.slice('params.'.length);
            if (!declared[name]) {
              ctx.addIssue({
                code: 'custom',
                message: `value references undeclared parameter "${name}"`,
                path: [...base, 'value'],
              });
            }
          } else if (ref === 'llm' && !tool.llm) {
            ctx.addIssue({
              code: 'custom',
              message: 'value references {{llm}}, but the tool declares no `llm` block',
              path: [...base, 'value'],
            });
          }
        }
      }
    }
  });
}

/**
 * Rule: a wardrobe gesture carries exactly the fields its action uses
 * ({@link wardrobeGestureProblems}), and every item reference's placeholders
 * resolve the way an outcome message's must — a `{{params.x}}` names a
 * declared parameter, a `{{llm}}` needs an `llm` block. Unknown placeholder
 * families are NOT rejected: the `renderTemplate` doctrine leaves them as
 * written, and the item simply fails to resolve at the table.
 */
function validateWardrobeGesture(
  declared: Record<string, CustomToolParameter>,
  hasLlmBlock: boolean,
  gesture: CustomToolWardrobeGesture,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  for (const problem of wardrobeGestureProblems(gesture)) {
    ctx.addIssue({ code: 'custom', message: problem.message, path: [...path, problem.field] });
  }

  (gesture.items ?? []).forEach((item, m) => {
    for (const { ref } of scanPlaceholdersInText(item)) {
      if (ref.kind === 'params' && !declared[ref.name]) {
        ctx.addIssue({
          code: 'custom',
          message: `item references undeclared parameter "${ref.name}"`,
          path: [...path, 'items', m],
        });
      } else if (ref.kind === 'llm' && !hasLlmBlock) {
        ctx.addIssue({
          code: 'custom',
          message: 'item references {{llm}}, but the tool declares no `llm` block',
          path: [...path, 'items', m],
        });
      }
    }
  });
}

/**
 * Check only what a metadata comparator can be checked on at load: that every
 * `$param` operand names a declared parameter. Deliberately silent about the
 * subject's type — see the caller.
 */
function validateMetadataOperands(
  declared: Record<string, CustomToolParameter>,
  comparator: MetadataComparator,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  for (const key of COMPARATOR_KEYS) {
    const operand = (comparator as Record<string, unknown>)[key];
    if (operand === undefined) continue;
    resolveOperandType(declared, operand, ctx, [...path, key]);
  }
}

/**
 * Roll fields are numeric, so every reference in one must resolve to a number:
 * a `$param` must name a numeric parameter, and a `$state` ref must carry a
 * numeric fallback (the only thing knowable about it at load time).
 */
function validateRollRefs(
  declared: Record<string, CustomToolParameter>,
  roll: Roll | undefined,
  ctx: z.RefinementCtx
): void {
  if (!roll || typeof roll === 'string') return;

  // A whole-roll `$inventory`: the object's metadata names the dice, and the
  // fallback must be dice notation this build can roll.
  if (isInventoryRef(roll)) {
    if (typeof roll.fallback !== 'string' || parseDiceNotation(roll.fallback) === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'a roll drawn from $inventory needs a dice-notation fallback, like "1d4"',
        path: ['roll', 'fallback'],
      });
    }
    return;
  }

  for (const [field, value] of Object.entries(roll)) {
    if (isStateRef(value) || isInventoryRef(value)) {
      const kind = isStateRef(value) ? '$state' : '$inventory';
      if (typeof value.fallback !== 'number') {
        ctx.addIssue({
          code: 'custom',
          message: `roll.${field} uses a ${kind} reference whose fallback is ${typeof value.fallback} rather than a number`,
          path: ['roll', field],
        });
      }
      continue;
    }

    if (!isParamRef(value)) continue;

    const target = declared[value.$param];
    if (!target) {
      ctx.addIssue({
        code: 'custom',
        message: `roll.${field} references undeclared parameter "${value.$param}"`,
        path: ['roll', field],
      });
      continue;
    }

    if (target.type !== 'number' && target.type !== 'integer') {
      ctx.addIssue({
        code: 'custom',
        message: `roll.${field} references parameter "${value.$param}", which is ${target.type} rather than numeric`,
        path: ['roll', field],
      });
    }
  }
}

/**
 * Check one comparator against the type of what it tests: every operand must
 * resolve, and the comparison must be one the two types can sustain.
 */
function validateComparator(
  declared: Record<string, CustomToolParameter>,
  comparator: NumericComparator | ParamComparator,
  subjectType: ValueType,
  subjectLabel: string,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): void {
  for (const key of COMPARATOR_KEYS) {
    const operand = (comparator as Record<string, unknown>)[key];
    if (operand === undefined) continue;

    const operandType = resolveOperandType(declared, operand, ctx, [...path, key]);
    if (operandType === null) continue;

    if (ORDERING_KEYS.has(key)) {
      if (subjectType !== 'number' || operandType !== 'number') {
        ctx.addIssue({
          code: 'custom',
          message: `${key} orders ${subjectLabel} against a ${operandType}, and only numbers can be ordered`,
          path: [...path, key],
        });
      }
      continue;
    }

    if (CONTAINMENT_KEYS.has(key)) {
      if (subjectType !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: `${key} searches ${subjectLabel}, which is a ${subjectType} — only a string can contain a substring`,
          path: [...path, key],
        });
      } else if (operandType !== 'string') {
        ctx.addIssue({
          code: 'custom',
          message: `${key} looks for a ${operandType} inside ${subjectLabel}, and a substring must be a string`,
          path: [...path, key],
        });
      }
      continue;
    }

    if (subjectType !== operandType) {
      ctx.addIssue({
        code: 'custom',
        message: `${key} compares ${subjectLabel}, which is a ${subjectType}, with a ${operandType} — this can never hold`,
        path: [...path, key],
      });
    }
  }
}

/**
 * The type an operand carries: a literal's own, or that of the parameter it
 * references. null means the operand is broken and has already been reported.
 */
function resolveOperandType(
  declared: Record<string, CustomToolParameter>,
  operand: unknown,
  ctx: z.RefinementCtx,
  path: Array<string | number>
): ValueType | null {
  if (isParamRef(operand)) {
    const target = declared[operand.$param];
    if (!target) {
      ctx.addIssue({
        code: 'custom',
        message: `references undeclared parameter "${operand.$param}"`,
        path,
      });
      return null;
    }
    return valueTypeOf(target.type);
  }

  // A `$state` operand carries the type of its (required) fallback — that is
  // what run-time resolution is guaranteed to produce when the path misses.
  if (isStateRef(operand) || isInventoryRef(operand)) {
    const fallbackType = typeof operand.fallback;
    if (fallbackType === 'number' || fallbackType === 'string' || fallbackType === 'boolean') {
      return fallbackType;
    }
    // Unreachable: the schema types the fallback before this runs.
    return null;
  }

  const literal = typeof operand;
  if (literal === 'number' || literal === 'string' || literal === 'boolean') return literal;

  // Unreachable: the schema types operands before this runs.
  return null;
}

/**
 * Render a rejection as the sentence an author reads on the load-error badge.
 *
 * Exists because of unions. `when` is `true | object` and `roll` is
 * `string | object`, and when both branches fail Zod reports a bare "Invalid
 * input" at the union and buries the actual complaint — the misspelled
 * comparator, the malformed dice notation — one level down in `issue.errors`.
 * A rejection nobody can read is barely better than no rejection at all, so
 * every branch's message is surfaced, joined by "or" since either would have
 * satisfied the schema.
 */
export function formatDefinitionIssues(error: z.ZodError): string {
  return flattenIssues(error.issues).join('; ');
}

/** True for a union branch whose only complaint is "this is not an array". */
function isNotAnArray(branch: readonly z.core.$ZodIssue[]): boolean {
  return (
    branch.length === 1 &&
    branch[0].code === 'invalid_type' &&
    branch[0].path.length === 0 &&
    branch[0].expected === 'array'
  );
}

function flattenIssues(issues: readonly z.core.$ZodIssue[], prefix: Array<string | number> = []): string[] {
  return issues.map((issue) => {
    const path = [...prefix, ...issue.path];
    const located = (message: string) => (path.length ? `${path.join('.')}: ${message}` : message);

    if (issue.code === 'invalid_union') {
      // An any-of array is an alternative SPELLING, not an alternative
      // meaning: when the value simply was not an array, that branch has
      // nothing to say and only buries the real complaint.
      const relevant = issue.errors.filter((branch) => !isNotAnArray(branch));
      // Sub-issue paths are relative to the union, so carry the prefix down.
      const branches = (relevant.length > 0 ? relevant : issue.errors)
        .map((branch) => flattenIssues(branch).join('; '))
        .filter((branch) => branch.length > 0);
      if (branches.length > 0) return located(branches.join(' — or — '));
    }

    if (issue.code === 'invalid_key' && issue.issues.length > 0) {
      // A record key's own refinement (an aggregate or progress key) says WHY;
      // "Invalid key in record" alone does not.
      return located(issue.issues.map((inner) => inner.message).join('; '));
    }

    return located(issue.message);
  });
}

/**
 * Top-level keys the v1 format knows about, in the schema's declaration order
 * (`$schema` first). Read off the schema itself so a new key can never be
 * known to the loader and unknown to the Workbench. Anything else is reserved
 * for v2.
 */
export const KNOWN_TOP_LEVEL_KEYS: readonly string[] = Object.keys(QtapCustomToolSchema.shape);

const KNOWN_TOP_LEVEL_KEY_SET: ReadonlySet<string> = new Set(KNOWN_TOP_LEVEL_KEYS);

/**
 * Report top-level keys this build doesn't understand, so discovery can log
 * them. They are tolerated, not rejected: `persist` is a planned v2 key, and an
 * older build must not choke on a newer file.
 */
export function collectUnknownKeys(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return [];
  return Object.keys(raw as Record<string, unknown>).filter((k) => !KNOWN_TOP_LEVEL_KEY_SET.has(k));
}
