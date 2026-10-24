/**
 * Custom Tools API v1 — operator intervention (Pascal the Croupier).
 *
 * The operator's side of a held run. A model's `run_custom` or a trigger phrase
 * reaching an intervenable tool deals the run and then holds it inside the
 * turn (`lib/pascal/intervention/registry.ts`); these actions read and resolve
 * the hold. Mounted by `route.ts` through `withActionDispatch`.
 *
 * GET  ?action=interventions          — this chat's pending holds, oldest first.
 * POST ?action=intervention-preview   — recompute under `{ id, overrides }`. Pure.
 * POST ?action=intervention-reask     — pose the consult again, then recompute.
 * POST ?action=intervention-resolve   — `{ id, decision }`: deal, as rolled, or veto.
 *
 * The final run is always recomputed here from the frozen snapshot — never
 * taken from the client — and an override naming a field the author hid is a
 * 400: the flag is a rule, not a UI hint. Design of record:
 * docs/developer/features/complete/pascal-operator-intervention.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { RequestContext } from '@/lib/api/middleware';
import { badRequest, conflict, notFound, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import {
  CustomToolRunError,
  isApplicableEffect,
  poseLlmConsult,
  type CustomToolRunResult,
  type ResolvedEffect,
} from '@/lib/pascal/custom-tools';
import { parseDiceNotation } from '@/lib/pascal/dice-notation';
import type { QtapCustomTool } from '@/lib/pascal/custom-tool.types';
import { buildCustomToolLlmInvoker } from '@/lib/pascal/llm-consult';
import { interventionEligibility } from '@/lib/pascal/intervention/eligibility';
import {
  InterventionDecisionSchema,
  InterventionOverridesSchema,
  checkOverrides,
  type InterventionOverrides,
} from '@/lib/pascal/intervention/overrides';
import {
  presentationFor,
  recomputeRun,
  type RecomputedRun,
  type RunPresentation,
} from '@/lib/pascal/intervention/recompute';
import {
  addConsult,
  getIntervention,
  interventionStatus,
  listInterventions,
  settleIntervention,
  type PendingIntervention,
} from '@/lib/pascal/intervention/registry';
import type {
  InterventionEffectView,
  InterventionHoldView,
  InterventionPreview,
  InterventionRunView,
} from '@/lib/pascal/intervention/view';

const HANDLER = 'api.v1.chats.custom-tools.interventions';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function effectView(definition: QtapCustomTool, effect: ResolvedEffect): InterventionEffectView {
  const authored = definition.effects?.[effect.index];
  const kind: InterventionEffectView['kind'] = authored?.wardrobe
    ? 'wardrobe'
    : authored?.inventory
      ? 'inventory'
      : authored?.log !== undefined
        ? 'log'
        : 'write';
  const label =
    kind === 'write'
      ? (authored?.target ?? 'write')
      : kind === 'wardrobe'
        ? `wardrobe ${authored?.wardrobe?.action ?? ''}`.trim()
        : kind === 'inventory'
          ? `inventory ${authored?.inventory?.action ?? ''}`.trim()
          : 'log';
  const base = { index: effect.index, kind, label };
  if (!isApplicableEffect(effect)) return { ...base, fired: false, skipped: effect.skipped };
  if ('value' in effect) return { ...base, fired: true, value: effect.value };
  if ('wardrobe' in effect) return { ...base, fired: true, items: effect.wardrobe.items };
  if ('inventory' in effect) return { ...base, fired: true, items: effect.inventory.items };
  return { ...base, fired: true, log: effect.log };
}

function runView(definition: QtapCustomTool, run: CustomToolRunResult, presentation: RunPresentation): InterventionRunView {
  return {
    params: run.params,
    rollForm: run.rollForm,
    ...(run.notation ? { notation: run.notation } : {}),
    raw: run.raw,
    ...(run.diceRolls ? { diceRolls: run.diceRolls } : {}),
    diceBreakdown: run.diceBreakdown,
    rollSpan: run.rollSpan,
    value: run.value,
    valueSpan: run.valueSpan,
    outcomeIndex: run.outcomeIndex,
    ...(run.tableOutcomeIndex !== undefined ? { tableOutcomeIndex: run.tableOutcomeIndex } : {}),
    state: run.state,
    message: run.message,
    ...(run.chipLabel !== undefined ? { chipLabel: run.chipLabel } : {}),
    title: presentation.title,
    visibility: presentation.visibility,
    announcer: presentation.announcer,
    ...(run.llm ? { llm: { ok: run.llm.ok, output: run.llm.output, prompt: run.llm.prompt } } : {}),
    effects: (run.effects ?? []).map((effect) => effectView(definition, effect)),
  };
}

function previewOf(definition: QtapCustomTool, recomputed: RecomputedRun): InterventionPreview {
  return {
    run: runView(definition, recomputed.result, recomputed.presentation),
    staleAnswer: recomputed.staleAnswer,
    ...(recomputed.promptNow !== undefined ? { promptNow: recomputed.promptNow } : {}),
    clampedParams: recomputed.clampedParams,
    warnings: recomputed.warnings,
  };
}

function holdView(pending: PendingIntervention): InterventionHoldView {
  const { definition, baseline } = pending;
  const notation = baseline.notation ? parseDiceNotation(baseline.notation) : null;
  return {
    id: pending.id,
    tool: definition.name,
    title: presentationFor(definition, baseline.visibility).title,
    characterName: pending.characterName,
    entrance: pending.entrance,
    ...(pending.triggerPhrase ? { triggerPhrase: pending.triggerPhrase } : {}),
    createdAt: pending.createdAt,
    eligible: interventionEligibility(definition, baseline.rollForm),
    hasCharacter: pending.characterId !== null,
    definition: {
      parameters: definition.parameters ?? {},
      outcomes: definition.outcomes.map((outcome) => ({
        when: outcome.when,
        state: outcome.state,
        message: outcome.message,
        ...(outcome.brief !== undefined ? { brief: outcome.brief } : {}),
      })),
      effects: definition.effects ?? [],
      revealOdds: definition.revealOdds !== false,
      hasLlm: definition.llm !== undefined,
      ...(notation ? { diceSides: notation.sides } : {}),
    },
    baseline: {
      run: runView(definition, baseline, presentationFor(definition, baseline.visibility)),
      staleAnswer: false,
      ...(baseline.llmPromptRendered !== undefined ? { promptNow: baseline.llmPromptRendered } : {}),
      clampedParams: [],
      warnings: [],
    },
    consults: pending.consults.map((consult) => ({ ok: consult.ok, output: consult.output, prompt: consult.prompt })),
  };
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/** The hold, if it belongs to this chat. */
function findHold(chatId: string, id: string): PendingIntervention | null {
  const pending = getIntervention(id);
  return pending && pending.chatId === chatId ? pending : null;
}

/** Refuse an override the author's flags or the run's shape do not allow. */
function refusal(pending: PendingIntervention, overrides: InterventionOverrides): string | null {
  return checkOverrides(pending.definition, {
    rollForm: pending.baseline.rollForm,
    ...(pending.baseline.diceRolls ? { diceCount: pending.baseline.diceRolls.length } : {}),
  }, overrides);
}

/** Recompute against the hold's frozen snapshot, the recorded draw and the answer in use. */
function recompute(pending: PendingIntervention, overrides: InterventionOverrides): Promise<RecomputedRun> {
  const consult = pending.consults[pending.consults.length - 1];
  return recomputeRun({
    definition: pending.definition,
    snapshot: pending.snapshot,
    draw: pending.draw,
    ...(consult ? { consult } : {}),
    overrides,
    dealtOutcomeIndex: pending.baseline.outcomeIndex,
  });
}

const previewSchema = z.object({ id: z.string().min(1), overrides: InterventionOverridesSchema });
const resolveSchema = z.object({ id: z.string().min(1), decision: InterventionDecisionSchema });

async function readBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: badRequest('The request body is not JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest(parsed.error.issues.map((issue) => issue.message).join('; ')) };
  }
  return { ok: true, data: parsed.data };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleListInterventions(
  _req: NextRequest,
  _ctx: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const holds = listInterventions(id).map(holdView);
  logger.debug('Custom tool holds listed', { context: HANDLER, chatId: id, holds: holds.length });
  return successResponse({ holds });
}

export async function handleInterventionPreview(
  req: NextRequest,
  _ctx: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const body = await readBody(req, previewSchema);
  if (!body.ok) return body.response;
  const pending = findHold(id, body.data.id);
  if (!pending) return notFound('Held run');

  const refused = refusal(pending, body.data.overrides);
  if (refused) return badRequest(refused);

  try {
    const recomputed = await recompute(pending, body.data.overrides);
    logger.debug('Custom tool hold previewed', {
      context: HANDLER,
      chatId: id,
      holdId: pending.id,
      pinned: Object.keys(body.data.overrides),
      staleAnswer: recomputed.staleAnswer,
    });
    return successResponse({ preview: previewOf(pending.definition, recomputed) });
  } catch (error) {
    if (error instanceof CustomToolRunError) return badRequest(error.message);
    throw error;
  }
}

export async function handleInterventionReask(
  req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const body = await readBody(req, previewSchema);
  if (!body.ok) return body.response;
  const pending = findHold(id, body.data.id);
  if (!pending) return notFound('Held run');

  // A hidden consult may still be re-asked: Re-ask poses the prompt as the
  // run now renders it and edits nothing the author hid (a hidden prompt's
  // override is refused below). It is how a run whose prompt quotes something
  // the operator changed gets an answer that fits.
  if (!pending.definition.llm) {
    return badRequest('This tool consults no oracle');
  }
  // A fresh answer replaces a pinned one: Re-ask unpins the answer.
  const { llmAnswer: _unpinned, ...overrides } = body.data.overrides;
  const refused = refusal(pending, overrides);
  if (refused) return badRequest(refused);

  try {
    const before = await recompute(pending, overrides);
    const prompt = before.promptNow ?? pending.definition.llm.prompt;
    const consult = await poseLlmConsult(
      pending.definition,
      prompt,
      buildCustomToolLlmInvoker({ userId: ctx.user.id, chatId: id }),
    );
    if (!addConsult(pending.id, consult)) return conflict('That run has already been settled');
    logger.debug('Custom tool hold re-asked', {
      context: HANDLER,
      chatId: id,
      holdId: pending.id,
      ok: consult.ok,
      reasks: pending.consults.length - 1,
    });
    const after = await recompute(pending, overrides);
    return successResponse({
      preview: previewOf(pending.definition, after),
      consults: pending.consults.map((c) => ({ ok: c.ok, output: c.output, prompt: c.prompt })),
    });
  } catch (error) {
    if (error instanceof CustomToolRunError) return badRequest(error.message);
    logger.warn('Custom tool hold re-ask failed', { context: HANDLER, chatId: id, error: getErrorMessage(error) });
    throw error;
  }
}

export async function handleInterventionResolve(
  req: NextRequest,
  _ctx: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const body = await readBody(req, resolveSchema);
  if (!body.ok) return body.response;
  const { decision } = body.data;

  const pending = findHold(id, body.data.id);
  if (!pending) {
    // Settled already, or never held here: first wins, and says which.
    const status = interventionStatus(body.data.id);
    logger.warn('Custom tool hold resolve refused', { context: HANDLER, chatId: id, holdId: body.data.id, status });
    return status === 'settled' ? conflict('That run has already been settled') : notFound('Held run');
  }

  if (decision.kind !== 'deal') {
    const outcome = settleIntervention(
      pending.id,
      decision.kind === 'veto' ? { kind: 'veto', cause: 'dialog' } : { kind: 'as-rolled' },
    );
    if (outcome !== 'resolved') return conflict('That run has already been settled');
    return successResponse({ resolved: decision.kind });
  }

  const refused = refusal(pending, decision.overrides);
  if (refused) return badRequest(refused);

  let run: RecomputedRun;
  try {
    run = await recompute(pending, decision.overrides);
  } catch (error) {
    if (error instanceof CustomToolRunError) return badRequest(error.message);
    throw error;
  }

  const originalConsults = pending.baseline.llm ? 1 : 0;
  const outcome = settleIntervention(pending.id, {
    kind: 'deal',
    overrides: decision.overrides,
    run,
    reasks: Math.max(0, pending.consults.length - originalConsults),
  });
  if (outcome !== 'resolved') return conflict('That run has already been settled');
  return successResponse({ resolved: 'deal' });
}
