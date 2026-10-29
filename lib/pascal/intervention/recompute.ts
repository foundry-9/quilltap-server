/**
 * Operator intervention — recompute a held run under the operator's overrides.
 *
 * Pure apart from the engine's own logging: it never calls a model and never
 * writes. It calls {@link executeCustomTool} with the recorded draw, the
 * consult in use and the pins, so a recomputed run is dealt by the same engine
 * as every other run, not a copy of it (spec §3.2). The preview, Re-ask and
 * resolve actions all come through here, so the final run is always computed
 * server-side from the frozen snapshot — never taken from the client.
 *
 * Design of record: docs/developer/features/complete/pascal-operator-intervention.md.
 */

import {
  executeCustomTool,
  isApplicableEffect,
  type CustomToolRunResult,
  type CustomToolState,
  type EffectPin,
  type LlmConsultResult,
  type RecordedDraw,
  type ResolvedEffect,
  type RunPins,
} from '../custom-tools';
import { displayTitle, type QtapCustomTool, type Visibility } from '../custom-tool.types';
import type { InventoryContext } from '../inventory-subjects';
import type { ProgressPrimitive } from '@/lib/progressions/engine';
import type { InterventionOverrides } from './overrides';
import { describeSpan, withinSpan } from './spans';

/** Everything a run was dealt against, frozen at deal time — a mid-hold edit elsewhere is not picked up. */
export interface RunSnapshot {
  /** Parameters as supplied by the entrance (null = every default). */
  params: Record<string, unknown> | null;
  /** The entrance's explicit privacy, or undefined for the definition's default. */
  private: boolean | undefined;
  metadata: Record<string, unknown>;
  progress: Record<string, ProgressPrimitive>;
  now: number;
  character: string | null;
  state: CustomToolState;
  inventory: InventoryContext | null;
}

export type Announcer = 'pascal' | 'character';

/** How the run will be presented — the run service's concerns, beside the engine's result. */
export interface RunPresentation {
  title: string;
  visibility: Visibility;
  announcer: Announcer;
}

export interface RecomputeInput {
  definition: QtapCustomTool;
  snapshot: RunSnapshot;
  draw: RecordedDraw;
  /** The answer in use: the latest consult. Absent for a tool with no consult. */
  consult?: LlmConsultResult;
  overrides: InterventionOverrides;
  /** The row the run was first dealt — a pinned message written against it may not fit a new winner. */
  dealtOutcomeIndex?: number;
}

export interface RecomputedRun {
  result: CustomToolRunResult;
  presentation: RunPresentation;
  /** The consult's answer was produced by a different prompt than the one now in force. */
  staleAnswer: boolean;
  /** The prompt a Re-ask would pose now: the pinned prompt, or the one rendered under the overrides. */
  promptNow?: string;
  /** Parameter names whose supplied override was clamped or coerced. */
  clampedParams: string[];
  /** Advisory notes for the dialog (spec §3.3). Never blocking. */
  warnings: string[];
}

/** The overrides' engine half, keyed the way the engine wants it. */
export function pinsFromOverrides(overrides: InterventionOverrides): RunPins {
  const effects: Record<number, EffectPin> = {};
  for (const [key, pin] of Object.entries(overrides.effects ?? {})) effects[Number(key)] = pin;
  return {
    ...(overrides.roll !== undefined ? { roll: overrides.roll } : {}),
    ...(overrides.dice !== undefined ? { dice: overrides.dice } : {}),
    ...(overrides.value !== undefined ? { value: overrides.value } : {}),
    ...(overrides.llmAnswer !== undefined ? { llmAnswer: overrides.llmAnswer } : {}),
    ...(overrides.outcomeIndex !== undefined ? { outcomeIndex: overrides.outcomeIndex } : {}),
    ...(overrides.message !== undefined ? { message: overrides.message } : {}),
    ...(overrides.state !== undefined ? { state: overrides.state } : {}),
    ...(overrides.chipLabel !== undefined ? { chipLabel: overrides.chipLabel } : {}),
    ...(Object.keys(effects).length > 0 ? { effects } : {}),
  };
}

/** The presentation a definition gives a run, under any presentation overrides. */
export function presentationFor(
  definition: QtapCustomTool,
  visibility: Visibility,
  overrides: Pick<InterventionOverrides, 'title' | 'announcer'> = {}
): RunPresentation {
  return {
    title: overrides.title ?? displayTitle(definition),
    visibility,
    announcer: overrides.announcer ?? (definition.announceAsCharacter === true ? 'character' : 'pascal'),
  };
}

/**
 * Recompute a held run. Throws `CustomToolRunError` when the overrides make the
 * run undealable (a parameter that will not coerce) — the caller reports it.
 */
export async function recomputeRun(input: RecomputeInput): Promise<RecomputedRun> {
  const { definition, snapshot, overrides } = input;
  const supplied = { ...(snapshot.params ?? {}), ...(overrides.params ?? {}) };
  const privacy =
    overrides.visibility !== undefined ? overrides.visibility === 'whisper' : snapshot.private;

  const result = await executeCustomTool(definition, supplied, {
    metadata: snapshot.metadata,
    progress: snapshot.progress,
    now: snapshot.now,
    ...(snapshot.character ? { character: snapshot.character } : {}),
    state: snapshot.state,
    inventory: snapshot.inventory,
    ...(privacy !== undefined ? { private: privacy } : {}),
    draw: input.draw,
    ...(input.consult ? { consult: input.consult } : {}),
    pins: pinsFromOverrides(overrides),
  });

  const clampedParams = Object.entries(overrides.params ?? {})
    .filter(([name, given]) => result.params[name] !== given)
    .map(([name]) => name);

  const promptNow = definition.llm ? (overrides.llmPrompt ?? result.llmPromptRendered) : undefined;
  // A pinned answer is the operator's own and is never "out of date".
  const staleAnswer =
    definition.llm !== undefined &&
    overrides.llmAnswer === undefined &&
    input.consult !== undefined &&
    promptNow !== undefined &&
    promptNow !== input.consult.prompt;

  const warnings: string[] = [];
  if (
    result.tableOutcomeIndex !== undefined &&
    result.tableOutcomeIndex !== result.outcomeIndex &&
    definition.revealOdds !== false
  ) {
    warnings.push(
      `The table would have dealt row ${result.tableOutcomeIndex + 1} here; the odds are shown to the model, so a forced row may look out of place.`
    );
  }
  if (
    overrides.message !== undefined &&
    input.dealtOutcomeIndex !== undefined &&
    result.outcomeIndex !== input.dealtOutcomeIndex
  ) {
    warnings.push('The message is pinned, but a different outcome row now wins; check that the words still fit it.');
  }
  if (overrides.roll !== undefined && !withinSpan(overrides.roll, result.rollSpan)) {
    warnings.push(`The pinned draw lies outside what the table could deal (${describeSpan(result.rollSpan)}).`);
  }
  if (overrides.value !== undefined && !withinSpan(overrides.value, result.valueSpan)) {
    warnings.push(`The pinned value lies outside what the modifiers could reach (${describeSpan(result.valueSpan)}).`);
  }
  if (staleAnswer) {
    warnings.push('The consult\'s answer was given to a different prompt. Re-ask, or deal it as it stands.');
  }

  return {
    result,
    presentation: presentationFor(definition, result.visibility, overrides),
    staleAnswer,
    ...(promptNow !== undefined ? { promptNow } : {}),
    clampedParams,
    warnings,
  };
}

/** One effect as the record keeps it: whether it fired, and what it would write. */
export interface EffectSummary {
  index: number;
  fired: boolean;
  target: string;
  next?: unknown;
}

/** Summarise resolved effects for the record and the diff. */
export function summarizeEffects(definition: QtapCustomTool, effects: ResolvedEffect[] | undefined): EffectSummary[] {
  return (effects ?? []).map((effect) => {
    const authored = definition.effects?.[effect.index];
    const target = authored?.target ?? (authored?.wardrobe ? 'wardrobe' : authored?.inventory ? 'inventory' : 'log');
    if (!isApplicableEffect(effect)) return { index: effect.index, fired: false, target };
    if ('value' in effect) return { index: effect.index, fired: true, target, next: effect.value };
    if ('wardrobe' in effect) return { index: effect.index, fired: true, target, next: effect.wardrobe.items };
    if ('inventory' in effect) return { index: effect.index, fired: true, target, next: effect.inventory.items };
    return { index: effect.index, fired: true, target, next: effect.log };
  });
}

/** A run as the record and the diff see it. */
export interface RunFacts {
  params: Record<string, number | string | boolean>;
  raw: number;
  diceRolls?: number[];
  value: number;
  outcomeIndex: number;
  state: CustomToolRunResult['state'];
  message: string;
  chipLabel?: string;
  toolTitle: string;
  visibility: Visibility;
  announcer: Announcer;
  llm?: { ok: boolean; output: string; prompt: string };
  effects?: EffectSummary[];
}

export function factsOf(definition: QtapCustomTool, run: CustomToolRunResult, presentation: RunPresentation): RunFacts {
  const effects = summarizeEffects(definition, run.effects);
  return {
    params: run.params,
    raw: run.raw,
    ...(run.diceRolls ? { diceRolls: run.diceRolls } : {}),
    value: run.value,
    outcomeIndex: run.outcomeIndex,
    state: run.state,
    message: run.message,
    ...(run.chipLabel !== undefined ? { chipLabel: run.chipLabel } : {}),
    toolTitle: presentation.title,
    visibility: presentation.visibility,
    announcer: presentation.announcer,
    ...(run.llm ? { llm: { ok: run.llm.ok, output: run.llm.output, prompt: run.llm.prompt } } : {}),
    ...(effects.length > 0 ? { effects } : {}),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The field keys that differ between the run as dealt and the run as
 * announced: `params.<name>`, `roll`, `value`, `llmAnswer`, `outcome`,
 * `message`, `state`, `chipLabel`, `title`, `visibility`, `announcer`,
 * `effects.<index>`. Empty means nothing changed.
 */
export function changedFields(dealt: RunFacts, final: RunFacts): string[] {
  const changed: string[] = [];
  for (const name of new Set([...Object.keys(dealt.params), ...Object.keys(final.params)])) {
    if (!same(dealt.params[name], final.params[name])) changed.push(`params.${name}`);
  }
  if (dealt.raw !== final.raw || !same(dealt.diceRolls, final.diceRolls)) changed.push('roll');
  if (dealt.value !== final.value) changed.push('value');
  if (!same(dealt.llm && { ok: dealt.llm.ok, output: dealt.llm.output }, final.llm && { ok: final.llm.ok, output: final.llm.output })) {
    changed.push('llmAnswer');
  }
  if (dealt.outcomeIndex !== final.outcomeIndex) changed.push('outcome');
  if (dealt.message !== final.message) changed.push('message');
  if (dealt.state !== final.state) changed.push('state');
  if (dealt.chipLabel !== final.chipLabel) changed.push('chipLabel');
  if (dealt.toolTitle !== final.toolTitle) changed.push('title');
  if (dealt.visibility !== final.visibility) changed.push('visibility');
  if (dealt.announcer !== final.announcer) changed.push('announcer');
  const finalEffects = new Map((final.effects ?? []).map((effect) => [effect.index, effect]));
  for (const effect of dealt.effects ?? []) {
    const after = finalEffects.get(effect.index);
    if (!after || after.fired !== effect.fired || !same(after.next, effect.next)) changed.push(`effects.${effect.index}`);
  }
  return changed;
}
