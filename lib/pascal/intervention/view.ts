/**
 * Operator intervention — the wire shapes the hold dialog reads.
 *
 * Client-safe: types only. The server builds these in
 * `app/api/v1/chats/[id]/custom-tools/interventions.ts`; the dialog
 * (`components/chat/CustomToolInterventionDialog.tsx`) renders them. The
 * client never computes a run itself — every edit asks the server to
 * recompute (`?action=intervention-preview`).
 */

import type {
  CustomToolEffect,
  CustomToolParameter,
  InterventionFieldKey,
  OutcomeState,
  Visibility,
  When,
} from '../custom-tool.types';

/** One declared effect, as this run resolved it. */
export interface InterventionEffectView {
  index: number;
  kind: 'write' | 'wardrobe' | 'inventory' | 'log';
  /** What the effect touches: a write's target, or the gesture's action. */
  label: string;
  /** Whether it fires in this run. */
  fired: boolean;
  /** Why it does not, when it does not. */
  skipped?: string;
  /** A write's resolved value. */
  value?: number | string | boolean;
  /** A gesture's resolved references. */
  items?: string[];
  /** A log line, rendered. */
  log?: string;
}

/** A run, as the dialog shows it. */
export interface InterventionRunView {
  params: Record<string, number | string | boolean>;
  rollForm: 'range' | 'dice';
  notation?: string;
  raw: number;
  diceRolls?: number[];
  diceBreakdown: string;
  value: number;
  outcomeIndex: number;
  /** When the outcome is forced: the row the table itself would pick. */
  tableOutcomeIndex?: number;
  state: OutcomeState;
  message: string;
  chipLabel?: string;
  title: string;
  visibility: Visibility;
  announcer: 'pascal' | 'character';
  llm?: { ok: boolean; output: string; prompt: string };
  effects: InterventionEffectView[];
}

/** The result of a preview, Re-ask or resolve recompute. */
export interface InterventionPreview {
  run: InterventionRunView;
  staleAnswer: boolean;
  /** The prompt a Re-ask would pose now. */
  promptNow?: string;
  clampedParams: string[];
  warnings: string[];
}

/** One held run, as `GET ?action=interventions` lists it. */
export interface InterventionHoldView {
  id: string;
  tool: string;
  title: string;
  characterName: string | null;
  entrance: 'llm' | 'trigger';
  triggerPhrase?: string;
  createdAt: number;
  /** What the dialog may show and an override may name. */
  eligible: { fields: InterventionFieldKey[]; params: string[]; effects: number[] };
  /** Whether a character announcer is possible (a run somebody made). */
  hasCharacter: boolean;
  /** The operator's own file: the odds are shown whatever `revealOdds` says. */
  definition: {
    parameters: Record<string, CustomToolParameter>;
    outcomes: Array<{ when: When; state: OutcomeState; message: string; brief?: string }>;
    effects: CustomToolEffect[];
    revealOdds: boolean;
    hasLlm: boolean;
    diceSides?: number;
  };
  baseline: InterventionPreview;
  /** Every consult so far — the original, then one per Re-ask. */
  consults: Array<{ ok: boolean; output: string; prompt: string }>;
}
