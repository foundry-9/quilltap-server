/**
 * Operator intervention — which parts of a run the hold dialog may show.
 *
 * One reading of the author's flags, shared by the server (which refuses an
 * override naming a hidden field) and the dialog (which never renders one).
 * Pure and client-safe: it imports only the format's types.
 *
 * The rule (spec I6): when the tool is intervenable, every eligible field is
 * shown unless its flag says `false`. Parameters and effects carry their own
 * `intervene` flag; the parts of a run that are not objects in the file (the
 * roll, the value, the outcome choice…) are flagged in `intervention.fields`.
 *
 * Design of record: docs/developer/features/complete/pascal-operator-intervention.md.
 */

import type { InterventionFieldKey, QtapCustomTool } from '../custom-tool.types';

/** Whether a definition asks for its runs to be held. Flags on a tool without this are inert. */
export function isIntervenable(definition: Pick<QtapCustomTool, 'intervention'>): boolean {
  return definition.intervention?.enabled === true;
}

/** What the dialog may show, and what an override may name. */
export interface InterventionEligibility {
  /** Tool-level fields, after the author's flags and the run's shape. */
  fields: InterventionFieldKey[];
  /** Parameter names the operator may set. */
  params: string[];
  /** Effect indices (file order) the operator may switch or edit. */
  effects: number[];
}

/**
 * The eligible set for one run of `definition`. `rollForm` is the form the run
 * was actually dealt in — a `$inventory` roll resolves to dice at deal time, so
 * the definition alone cannot say whether `value` is separately editable.
 *
 * Shape rules, beside the author's flags:
 *   - `value` exists only for the range form: a dice total is the faces plus
 *     the modifier, and editing it alone would make `{{dice}}` lie.
 *   - `llmPrompt` / `llmAnswer` exist only when the tool consults.
 *   - `chipLabel` exists only when the tool declares one.
 */
export function interventionEligibility(
  definition: Pick<QtapCustomTool, 'intervention' | 'parameters' | 'effects' | 'llm' | 'chipLabel'>,
  rollForm: 'range' | 'dice'
): InterventionEligibility {
  const flags = definition.intervention?.fields ?? {};
  const shown = (key: InterventionFieldKey) => flags[key] !== false;

  const applicable: Record<InterventionFieldKey, boolean> = {
    roll: true,
    value: rollForm === 'range',
    llmPrompt: definition.llm !== undefined,
    llmAnswer: definition.llm !== undefined,
    outcome: true,
    message: true,
    state: true,
    chipLabel: definition.chipLabel !== undefined,
    title: true,
    visibility: true,
    announcer: true,
  };

  const fields = (Object.keys(applicable) as InterventionFieldKey[]).filter((key) => applicable[key] && shown(key));
  const params = Object.entries(definition.parameters ?? {})
    .filter(([, spec]) => spec.intervene !== false)
    .map(([name]) => name);
  const effects = (definition.effects ?? [])
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => effect.intervene !== false)
    .map(({ index }) => index);

  return { fields, params, effects };
}
