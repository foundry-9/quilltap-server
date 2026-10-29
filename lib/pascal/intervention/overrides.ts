/**
 * Operator intervention — what the operator may change about a held run.
 *
 * `InterventionOverridesSchema` is both the request body schema for the
 * preview / Re-ask / resolve actions and the shape the dialog builds. Every
 * present key is a PIN: recompute never overwrites it, and everything
 * downstream of it that is not pinned is recomputed (spec §3.2).
 *
 * `checkOverrides` is the server's enforcement of the author's flags: an
 * override naming a hidden field is refused, not quietly dropped — the flag is
 * a rule, not a UI hint.
 *
 * Client-safe: Zod and the format's types only.
 */

import { z } from 'zod';
import {
  MAX_CHIP_LABEL_LENGTH,
  MAX_LLM_OUTPUT_CEILING,
  MAX_LLM_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  OutcomeStateSchema,
  VisibilitySchema,
  type QtapCustomTool,
} from '../custom-tool.types';
import { MAX_DICE_COUNT } from '../dice-notation';
import { interventionEligibility } from './eligibility';

/** A rendered message may quote a long consult answer, so its cap is the answer's plus room for the template. */
const MAX_OVERRIDE_MESSAGE_LENGTH = MAX_LLM_OUTPUT_CEILING + 4000;

const LiteralSchema = z.union([z.number().finite(), z.string(), z.boolean()]);

export const EffectPinSchema = z.strictObject({
  mode: z.enum(['auto', 'on', 'off']),
  value: LiteralSchema.optional(),
  items: z.array(z.string().max(400)).max(16).optional(),
  log: z.string().max(MAX_OVERRIDE_MESSAGE_LENGTH).optional(),
});

export const InterventionOverridesSchema = z.strictObject({
  params: z.record(z.string(), LiteralSchema).optional(),
  roll: z.number().finite().optional(),
  dice: z.array(z.number().int()).min(1).max(MAX_DICE_COUNT).optional(),
  value: z.number().finite().optional(),
  llmPrompt: z.string().min(1).max(MAX_LLM_PROMPT_LENGTH).optional(),
  llmAnswer: z.strictObject({ ok: z.boolean(), output: z.string().max(MAX_LLM_OUTPUT_CEILING) }).optional(),
  outcomeIndex: z.number().int().min(0).optional(),
  message: z.string().min(1).max(MAX_OVERRIDE_MESSAGE_LENGTH).optional(),
  state: OutcomeStateSchema.optional(),
  chipLabel: z.string().min(1).max(MAX_CHIP_LABEL_LENGTH).optional(),
  title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
  visibility: VisibilitySchema.optional(),
  announcer: z.enum(['pascal', 'character']).optional(),
  /** Keyed by effect index (file order) — JSON object keys are strings. */
  effects: z.record(z.string().regex(/^\d+$/, 'effect keys are indices'), EffectPinSchema).optional(),
});

export type InterventionOverrides = z.infer<typeof InterventionOverridesSchema>;
export type EffectPinInput = z.infer<typeof EffectPinSchema>;

/** The operator's decision on a held run. */
export const InterventionDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deal'), overrides: InterventionOverridesSchema }),
  z.strictObject({ kind: z.literal('as-rolled') }),
  z.strictObject({ kind: z.literal('veto') }),
]);

export type InterventionDecisionInput = z.infer<typeof InterventionDecisionSchema>;

/** What a held run was dealt in — enough to say which overrides fit it. */
export interface DealtShape {
  rollForm: 'range' | 'dice';
  /** Dice form: how many faces the notation rolls. */
  diceCount?: number;
}

/**
 * Null when every override names a shown, applicable field of this run;
 * otherwise the reason it is refused (the API's 400).
 */
export function checkOverrides(
  definition: QtapCustomTool,
  dealt: DealtShape,
  overrides: InterventionOverrides
): string | null {
  const eligible = interventionEligibility(definition, dealt.rollForm);
  const shown = new Set<string>(eligible.fields);

  for (const name of Object.keys(overrides.params ?? {})) {
    if (!eligible.params.includes(name)) return `parameter "${name}" is not open to intervention`;
  }

  if ((overrides.roll !== undefined || overrides.dice !== undefined) && !shown.has('roll')) {
    return 'the roll is not open to intervention';
  }
  if (overrides.roll !== undefined && dealt.rollForm !== 'range') return 'a dice roll is set by its faces, not a number';
  if (overrides.dice !== undefined) {
    if (dealt.rollForm !== 'dice') return 'this roll is not dice';
    if (overrides.dice.length !== dealt.diceCount) {
      return `this roll takes ${dealt.diceCount} dice, not ${overrides.dice.length}`;
    }
  }

  const fieldOf: Array<[keyof InterventionOverrides, string]> = [
    ['value', 'value'],
    ['llmPrompt', 'llmPrompt'],
    ['llmAnswer', 'llmAnswer'],
    ['outcomeIndex', 'outcome'],
    ['message', 'message'],
    ['state', 'state'],
    ['chipLabel', 'chipLabel'],
    ['title', 'title'],
    ['visibility', 'visibility'],
    ['announcer', 'announcer'],
  ];
  for (const [key, field] of fieldOf) {
    if (overrides[key] !== undefined && !shown.has(field)) return `the ${field} is not open to intervention`;
  }

  if (overrides.outcomeIndex !== undefined && !definition.outcomes[overrides.outcomeIndex]) {
    return `there is no outcome row ${overrides.outcomeIndex}`;
  }

  for (const key of Object.keys(overrides.effects ?? {})) {
    const index = Number(key);
    if (!eligible.effects.includes(index)) return `effect ${index} is not open to intervention`;
  }

  return null;
}
