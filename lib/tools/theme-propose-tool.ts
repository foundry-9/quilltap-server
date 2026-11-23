/**
 * @fileoverview Tool definition for Calliope's `theme_propose`: a change set
 * (`ChangeSetSchema`, `lib/themes/assist/change-set.ts`) judged against the
 * draft (`judgeChangeSet`). One that applies and brings in no error is
 * recorded on the conversation as a proposal for the author — the persisted
 * TOOL row is the record — and shown with any warnings; one that does not
 * apply, or brings in an error, is returned as a failure and shown to nobody.
 * Nothing is written to the draft: the author keeps or discards it in the
 * editor. Calliope's surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateThemeProposeInput` is a one-line `safeParse(...).success`
 * delegate. The schema is the change set's own.
 */

import type { ToolEffectSpec } from './effect-types';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { ChangeSetSchema, type ChangeSet } from '@/lib/themes/assist/change-set';

export const themeProposeToolInputSchema = ChangeSetSchema;

export type ThemeProposeInput = ChangeSet;

export function validateThemeProposeInput(input: unknown): boolean {
  return themeProposeToolInputSchema.safeParse(input).success;
}

export const themeProposeToolDefinition = {
  type: 'function',
  function: {
    name: 'theme_propose',
    description:
      'Propose a change to the draft for the author to keep or discard. A title, a reason, and the operations in ' +
      'order: set-token / reset-token, add-primitive / set-primitive / rename-primitive / remove-primitive, ' +
      'set-choice, and for the stylesheet replace-css (an exact stretch, found once) or set-css (the whole sheet). ' +
      'It is checked against the draft first: if it does not apply or would bring in an error you get the reason ' +
      'back and the author sees nothing; otherwise the author sees it, with any warnings and contrast it changes. ' +
      'It never changes the draft itself. One coherent change per proposal.',
    parameters: zodToOpenAISchema(themeProposeToolInputSchema),
  },
};

/**
 * Changes nothing the tool effect ranks: the draft is untouched, and the
 * record is the conversation's own tool row (Spec J §2.2).
 */
export const themeProposeToolEffect: ToolEffectSpec = 'none';
