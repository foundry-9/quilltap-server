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
 * Design constraint that shapes everything below: **no expression evaluation,
 * anywhere.** Outcome tests are AND-composed comparator objects, and the only
 * indirection is a `{ "$param": "name" }` reference. There is no string
 * grammar to parse, so there is nothing to inject into.
 */

import { z } from 'zod';
import { MAX_DIE_SIDES, MIN_DIE_SIDES, parseDiceNotation } from './dice';

/** Well-known folder, at a store's root, holding custom-tool definitions. */
export const TOOLS_FOLDER = 'Tools';

/** Filename suffix that marks a document as a custom-tool definition. */
export const TOOL_FILE_SUFFIX = '.tool.json';

/** Cap on parameters per tool. */
export const MAX_PARAMETERS = 8;

/** Cap on outcomes per tool. */
export const MAX_OUTCOMES = 32;

/** Cap on tools in a single resolved roster. */
export const MAX_ROSTER_SIZE = 64;

/** Cap on an outcome message, in characters. */
export const MAX_MESSAGE_LENGTH = 1000;

/** Cap on a tool description, in characters. */
export const MAX_DESCRIPTION_LENGTH = 500;

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
 * number. The ONLY form of indirection in the format.
 */
export const ParamRefSchema = z.object({
  $param: IdentifierSchema.describe('Name of a declared numeric parameter.'),
});

export type ParamRef = z.infer<typeof ParamRefSchema>;

/** A roll field: a literal number, or a reference to a numeric parameter. */
const NumberOrParamRefSchema = z.union([z.number().finite(), ParamRefSchema]);

export type NumberOrParamRef = z.infer<typeof NumberOrParamRefSchema>;

/** True when a roll field is a `$param` reference rather than a literal. */
export function isParamRef(value: unknown): value is ParamRef {
  return typeof value === 'object' && value !== null && '$param' in value;
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
      .union([z.number(), z.string(), z.boolean()])
      .describe('Required. Used whenever a run omits this parameter.'),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .optional()
      .describe('What this parameter means, in the fiction.'),
    min: z.number().finite().optional().describe('Numeric types only. Run-time values are clamped up to this.'),
    max: z.number().finite().optional().describe('Numeric types only. Run-time values are clamped down to this.'),
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

    // The declared default must satisfy the parameter's own declared type.
    const defaultType = typeof param.default;
    if (numeric && defaultType !== 'number') {
      ctx.addIssue({ code: 'custom', message: `default must be a number for type ${param.type}`, path: ['default'] });
    }
    if (param.type === 'integer' && defaultType === 'number' && !Number.isInteger(param.default)) {
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
export const RollRangeSchema = z.object({
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

/** Either form of roll. */
export const RollSchema = z.union([RollDiceSchema, RollRangeSchema]);

export type Roll = z.infer<typeof RollSchema>;

/**
 * An outcome test. Either the literal `true` (catch-all) or an object of
 * comparators that AND together — `>= 0.3 && <= 0.6` is `{ gte: 0.3, lte: 0.6 }`.
 *
 * There is no OR and no nesting: ordered, first-match-wins outcomes make OR
 * unnecessary, and this keeps the evaluator eval-free.
 */
export const ComparatorSchema = z
  .object({
    gt: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    lt: z.number().finite().optional(),
    lte: z.number().finite().optional(),
    eq: z.number().finite().optional(),
    neq: z.number().finite().optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), {
    message: 'must specify at least one comparator (gt, gte, lt, lte, eq, neq)',
  });

export type Comparator = z.infer<typeof ComparatorSchema>;

export const WhenSchema = z.union([z.literal(true), ComparatorSchema]);

export type When = z.infer<typeof WhenSchema>;

/** The semantic states an outcome may carry. Maps to qt classes at render. */
export const OutcomeStateSchema = z.enum(['success', 'partial', 'failure', 'info']);

export type OutcomeState = z.infer<typeof OutcomeStateSchema>;

export const CustomToolOutcomeSchema = z.object({
  when: WhenSchema.describe('`true` for a catch-all, or comparators that AND together.'),
  message: z
    .string()
    .min(1)
    .max(MAX_MESSAGE_LENGTH)
    .describe('Narrative result. Supports {{value}}, {{roll}}, {{dice}}, and {{params.name}}.'),
  state: OutcomeStateSchema.describe('Semantic state, used to accent the result bubble.'),
});

export type CustomToolOutcome = z.infer<typeof CustomToolOutcomeSchema>;

/** Default visibility for a tool's result. */
export const VisibilitySchema = z.enum(['public', 'whisper']);

export type Visibility = z.infer<typeof VisibilitySchema>;

/**
 * The custom-tool definition.
 *
 * Unknown top-level keys are tolerated (Zod strips rather than rejects by
 * default), which reserves room for v2 keys — notably `persist` — without
 * breaking older builds. `collectUnknownKeys` surfaces them for a debug log.
 */
export const QtapCustomToolSchema = z
  .object({
    $schema: z.string().optional().describe('Editor hint; ignored at runtime.'),
    name: IdentifierSchema.describe("The tool's identity. Not the filename."),
    description: z
      .string()
      .min(1)
      .max(MAX_DESCRIPTION_LENGTH)
      .describe('What the tool does IN THE FICTION — how the model decides to reach for it.'),
    disabled: z.boolean().optional().describe('true suppresses this name at this tier and below.'),
    revealOdds: z
      .boolean()
      .optional()
      .describe('false hides the roll spec and outcome table from the model. Default true.'),
    defaultVisibility: VisibilitySchema.optional().describe('Default result visibility. Default "public".'),
    parameters: z
      .record(IdentifierSchema, CustomToolParameterSchema)
      .refine((params) => Object.keys(params).length <= MAX_PARAMETERS, {
        message: `at most ${MAX_PARAMETERS} parameters`,
      })
      .optional(),
    roll: RollSchema.optional().describe('Numeric range object, or dice notation. Default: 0–1 uniform.'),
    outcomes: z
      .array(CustomToolOutcomeSchema)
      .min(1, 'at least one outcome is required')
      .max(MAX_OUTCOMES, `at most ${MAX_OUTCOMES} outcomes`)
      .describe('Ordered; first match wins. The last entry must be a `true` catch-all.'),
  })
  .superRefine((tool, ctx) => {
    validateOutcomeOrdering(tool.outcomes, ctx);
    validateParamRefs(tool, ctx);
  });

export type QtapCustomTool = z.infer<typeof QtapCustomToolSchema>;

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

/**
 * Rule: every `$param` reference must name a declared parameter of a numeric
 * type. A reference to a string parameter cannot be rolled with.
 */
function validateParamRefs(tool: { parameters?: Record<string, CustomToolParameter>; roll?: Roll }, ctx: z.RefinementCtx): void {
  if (!tool.roll || typeof tool.roll === 'string') return;

  const declared = tool.parameters ?? {};

  for (const [field, value] of Object.entries(tool.roll)) {
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

/** Top-level keys the v1 format knows about. Anything else is reserved for v2. */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'name',
  'description',
  'disabled',
  'revealOdds',
  'defaultVisibility',
  'parameters',
  'roll',
  'outcomes',
]);

/**
 * Report top-level keys this build doesn't understand, so discovery can log
 * them. They are tolerated, not rejected: `persist` is a planned v2 key, and an
 * older build must not choke on a newer file.
 */
export function collectUnknownKeys(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return [];
  return Object.keys(raw as Record<string, unknown>).filter((k) => !KNOWN_TOP_LEVEL_KEYS.has(k));
}
