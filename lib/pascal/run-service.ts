/**
 * The one run service for every custom-tool entrance.
 *
 * A custom tool is reached three ways — a model's `run_custom`
 * (`lib/tools/handlers/run-custom-handler.ts`), the operator's popup
 * (`app/api/v1/chats/[id]/custom-tools/route.ts`), and a trigger phrase
 * overheard in the chat (`lib/pascal/trigger-runner.ts`). Each entrance resolves
 * the roster its own way (their perspective rules differ) and reports a failure
 * its own way (a model result, an HTTP response, a Prospero bubble). Everything
 * between — the state cascade, the deal, the effects, Pascal's post — is the
 * same sequence, and lives here so a fix to it lands at every entrance at once.
 *
 * Order is load-bearing:
 *
 *   1. The state cascade is read ONCE, whole (the effect applier needs the
 *      per-tier objects). Fail-soft: every `$state` ref carries a fallback, so
 *      a run is always dealable; state effects then skip. Beside it, the
 *      rolling character's Inventory context is loaded once — only when the
 *      definition reads or changes the bag — and handed to the core and the
 *      inventory applier; unreadable, it is null (inventory tests decline,
 *      `$inventory` falls back, inventory effects skip).
 *   2. Effects apply BEFORE the Pascal post. If the post then fails, the
 *      effects stand — they happened — and the entrance reports the missing
 *      announcement. A throw inside `executeCustomTool` means no effects were
 *      ever applied.
 *   3. Pascal never announces a run that did not happen. A refused run comes
 *      back as `{ ok: false }` and the entrance hands it to Prospero.
 *   4. Operator intervention: an intervenable run reached by a model or a
 *      trigger phrase is HELD between the deal and the effects, until the
 *      operator deals it (perhaps changed), lets it stand, or vetoes it. A
 *      veto returns `{ ok: 'vetoed' }` before any effect or post. Holds open
 *      only in the parent, never in the job child or an autonomous room
 *      (`lib/pascal/intervention/`).
 *
 * Job-child safe: reads pass through, the writes go through the buffered
 * `getRepositories()` proxy, and nothing here reads back what it wrote.
 */

import { turnContainersOf, type WardrobeTurnContainers } from '@/lib/wardrobe/turn-containers';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getRepositories } from '@/lib/repositories/factory';
import {
  executeCustomTool,
  CustomToolRunError,
  type CustomToolRunResult,
  type DiscoveredCustomTool,
} from '@/lib/pascal/custom-tools';
import { applyCustomToolEffects, type AppliedEffect } from '@/lib/pascal/side-effects';
import { buildCustomToolLlmInvoker } from '@/lib/pascal/llm-consult';
import { flattenProgressions } from '@/lib/progressions/engine';
import { collectToolVocabulary } from '@/lib/pascal/tool-vocabulary';
import { loadInventoryContext, type LoadedInventoryContext } from '@/lib/inventory/context';
import { resolveStateCascade, type StateCascadeResult } from '@/lib/state/state-cascade';
import { buildPascalResultContent, postPascalResult, type PascalMeta } from '@/lib/services/pascal/writer';
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/chat.types';
import { currentTurnKeepAlive, currentTurnStopSignal } from '@/lib/chat/turn-control';
import { isIntervenable } from '@/lib/pascal/intervention/eligibility';
import { hold } from '@/lib/pascal/intervention/registry';
import {
  changedFields,
  factsOf,
  presentationFor,
  type RecomputedRun,
  type RunPresentation,
  type RunSnapshot,
} from '@/lib/pascal/intervention/recompute';

const CONTEXT = 'pascal.run-service';

export interface RunCustomToolParams {
  userId: string;
  chatId: string;
  /**
   * The chat, when the entrance already holds it — saves the cascade a read.
   * Absent → read here.
   */
  chat?: ChatMetadata | null;
  /** The resolved roster entry — the caller resolves the roster (its perspective rules differ per entrance). */
  entry: DiscoveredCustomTool;
  /** Supplied parameters; null/undefined = every default. */
  parameters: Record<string, unknown> | null | undefined;
  /** Explicit privacy, or undefined for the definition's default. */
  private: boolean | undefined;
  /** The rolling character, or null for a run nobody made (metadata/progress effects then skip). */
  characterId: string | null;
  /** The rolling character's hydrated fact sheet ({} for a run nobody made). */
  metadata: Record<string, unknown>;
  /**
   * The rolling character's name, for `{{character}}`, when the entrance
   * already holds it. Absent with a `characterId` → read here.
   */
  characterName?: string | null;
  /** Who the whisper goes to when the run is private. null → the post is not targeted. */
  whisperTargetIds: string[] | null;
  /** Provenance for pascalMeta. */
  invokedBy: 'llm' | 'user' | 'trigger';
  /**
   * Whether this entrance may hold the run for the operator (operator
   * intervention). Entrances decide; the service checks the rest — the
   * definition, the chat settings, the process and the chat type.
   */
  mayHold: boolean;
  /** Recorded in pascalMeta when set. */
  callerParticipantId: string | null;
  /** The phrase that fired a triggered run, as written in the definition. */
  triggerPhrase?: string;
  /** One clock reading for the whole run. Defaults to Date.now(). */
  nowMs?: number;
  /**
   * The turn's wardrobe containers, when the run happens inside a model turn —
   * a `wardrobe` effect then joins the turn's one Aurora announcement and its
   * one history entry.
   */
  pendingWardrobeAnnouncements?: Set<string>;
  pendingWardrobeHistory?: WardrobeTurnContainers['pendingWardrobeHistory'];
  /** The turn's pending Inventory changes — an `inventory` effect joins the turn's one Pascal line. */
  pendingInventoryAnnouncements?: WardrobeTurnContainers['pendingInventoryAnnouncements'];
}

export type RunCustomToolOutcome =
  | { ok: true; result: CustomToolRunResult; posted: MessageEvent | null; appliedEffects: AppliedEffect[] }
  | { ok: false; reason: string; whisper: boolean }
  /** The operator set the table aside: nothing was applied and nothing posted. */
  | { ok: 'vetoed' };

/**
 * Deal one hand: cascade → execute → effects → Pascal's post. Resolves the group
 * scope from `characterId` (a run nobody made gets `{ kind: 'none' }`). Catches
 * CustomToolRunError into `{ ok: false }`; rethrows anything else. Never posts
 * the Prospero error bubble — that stays with the entrance, which knows how to
 * report to its caller.
 */
export async function runCustomTool(params: RunCustomToolParams): Promise<RunCustomToolOutcome> {
  const { userId, chatId, entry, characterId, metadata } = params;
  const nowMs = params.nowMs ?? Date.now();

  // The derived progress sheet, from the SAME snapshot the gates read, against
  // the one clock reading. Costs no reads: progressions live in the metadata.
  const progress = flattenProgressions(metadata, nowMs);

  const characterName = await resolveCharacterName(characterId, params.characterName, chatId);

  // The group tier is scoped to the rolling character's own groups, or skipped
  // for a run nobody made rather than borrowing an arbitrary participant's.
  let cascade: StateCascadeResult | null = null;
  let chat: ChatMetadata | null = params.chat ?? null;
  try {
    chat = chat ?? (await getRepositories().chats.findById(chatId));
    if (chat) {
      cascade = await resolveStateCascade({
        chat,
        groupScope: characterId ? { kind: 'character', characterId } : { kind: 'none' },
      });
    }
  } catch (error) {
    logger.debug('Custom tool run: state cascade unavailable, defaulting to {}', {
      context: CONTEXT,
      chatId,
      tool: entry.definition.name,
      error: getErrorMessage(error),
    });
    cascade = null;
  }

  const inventory = await loadRunInventory(entry.definition, characterId, chatId);

  let result: CustomToolRunResult;
  try {
    result = await executeCustomTool(entry.definition, params.parameters ?? null, {
      inventory,
      private: params.private,
      metadata,
      progress,
      now: nowMs,
      ...(characterName ? { character: characterName } : {}),
      state: cascade?.merged ?? {},
      // Only built when the definition wants one; the invoker resolves the
      // cheap-LLM selection fresh on each consult.
      ...(entry.definition.llm ? { llmInvoke: buildCustomToolLlmInvoker({ userId, chatId }) } : {}),
    });
  } catch (error) {
    if (error instanceof CustomToolRunError) {
      const whisper = params.private ?? entry.definition.defaultVisibility === 'whisper';
      logger.debug('Custom tool run refused', {
        context: CONTEXT,
        chatId,
        tool: entry.definition.name,
        invokedBy: params.invokedBy,
        reason: error.message,
      });
      return { ok: false, reason: error.message, whisper };
    }
    throw error;
  }

  // Operator intervention: the deal is done, nothing is applied or posted yet.
  let presentation: RunPresentation = presentationFor(entry.definition, result.visibility);
  let intervention: PascalMeta['intervention'];
  if (await mayHoldRun(params, chat)) {
    const held = await holdForOperator(params, {
      characterName,
      result,
      snapshot: {
        params: params.parameters ?? null,
        private: params.private,
        metadata,
        progress,
        now: nowMs,
        character: characterName,
        state: cascade?.merged ?? {},
        inventory,
      },
    });
    if (held.kind === 'veto') return { ok: 'vetoed' };
    if (held.kind === 'deal') {
      result = held.run.result;
      presentation = held.run.presentation;
      intervention = held.record;
    }
  }

  // The applier never throws. `characterId` null → metadata, progress and
  // wardrobe effects skip.
  const appliedEffects = result.effects?.length
    ? await applyCustomToolEffects({
        userId,
        chatId,
        toolName: result.tool,
        effects: result.effects,
        cascade,
        characterId,
        metadataSnapshot: metadata,
        nowMs,
        inventory,
        ...turnContainersOf(params),
      })
    : [];

  const whispered = result.visibility === 'whisper';
  const targetParticipantIds = whispered && params.whisperTargetIds?.length ? params.whisperTargetIds : null;

  const toolTitle = presentation.title;
  const { content, opaqueContent } = buildPascalResultContent({
    toolTitle,
    ...(result.chipLabel ? { chipLabel: result.chipLabel } : {}),
    message: result.message,
  });

  // `announceAsCharacter`: the rolling character speaks the outcome in Pascal's
  // place. Still Pascal's record (systemSender, pascalMeta, the chip) — only the
  // face and name on the bubble, and the speaker tag the model reads, change.
  // A run nobody made has no one to speak it, so Pascal does.
  const announcerCharacterId = presentation.announcer === 'character' ? characterId : null;

  const posted = await postPascalResult({
    chatId,
    content,
    opaqueContent,
    targetParticipantIds,
    ...(announcerCharacterId ? { announcerCharacterId } : {}),
    pascalMeta: {
      tool: result.tool,
      toolTitle,
      ...(result.chipLabel ? { chipLabel: result.chipLabel } : {}),
      definitionTier: entry.tier,
      definitionMountId: entry.mountPointId,
      params: result.params,
      rollForm: result.rollForm,
      ...(result.notation ? { notation: result.notation } : {}),
      raw: result.raw,
      ...(result.diceRolls ? { diceRolls: result.diceRolls } : {}),
      value: result.value,
      state: result.state,
      outcomeIndex: result.outcomeIndex,
      ...(result.metadataTested ? { metadataTested: result.metadataTested } : {}),
      ...(result.llm ? { llm: result.llm } : {}),
      ...(appliedEffects.length ? { effects: appliedEffects } : {}),
      invokedBy: params.invokedBy,
      ...(params.invokedBy === 'trigger' && params.triggerPhrase ? { triggerPhrase: params.triggerPhrase } : {}),
      ...(params.callerParticipantId ? { callerParticipantId: params.callerParticipantId } : {}),
      ...(intervention ? { intervention } : {}),
    },
  });

  logger.debug('Custom tool dealt', {
    context: CONTEXT,
    chatId,
    tool: result.tool,
    tier: entry.tier,
    invokedBy: params.invokedBy,
    state: result.state,
    effects: appliedEffects.length,
    whispered,
    announcedBy: announcerCharacterId ? 'character' : 'pascal',
    posted: posted !== null,
  });

  return { ok: true, result, posted, appliedEffects };
}

/**
 * Whether this run may be held for the operator. Every "no" is logged at
 * debug with its reason; only an intervenable definition is worth a line.
 */
async function mayHoldRun(params: RunCustomToolParams, chat: ChatMetadata | null): Promise<boolean> {
  const { entry, chatId } = params;
  if (!isIntervenable(entry.definition)) return false;

  const skip = (reason: string) => {
    logger.debug('Custom tool run not held', { context: CONTEXT, chatId, tool: entry.definition.name, reason });
    return false;
  };
  if (!params.mayHold) return skip('this entrance never holds (the operator\'s own run)');
  // The job child has nobody watching and cannot wait on the parent's dialog.
  if (process.env.QUILLTAP_JOB_CHILD === '1') return skip('running in the job child');
  if (chat?.chatType === 'autonomous') return skip('an autonomous room');

  try {
    const settings = await getRepositories().chatSettings.findByUserId(params.userId);
    if (settings?.customTools === false) return skip('custom tools are off');
    if (settings?.customToolIntervention === false) return skip('the operator switched intervention off');
  } catch (error) {
    // Unreadable settings: the default is on, and a held run is recoverable
    // (the operator can let it stand), where a skipped hold is not.
    logger.debug('Custom tool hold: chat settings unreadable, holding by default', {
      context: CONTEXT,
      chatId,
      error: getErrorMessage(error),
    });
  }
  return true;
}

type HoldOutcome =
  | { kind: 'veto' }
  | { kind: 'as-rolled' }
  | { kind: 'deal'; run: RecomputedRun; record: PascalMeta['intervention'] };

/**
 * Hold the dealt run until the operator answers. A deal that changes nothing
 * is an as-rolled deal and records nothing — the badge marks a change, and
 * "I looked and let it stand" is not one.
 */
async function holdForOperator(
  params: RunCustomToolParams,
  dealt: { characterName: string | null; result: CustomToolRunResult; snapshot: RunSnapshot }
): Promise<HoldOutcome> {
  const { entry, chatId } = params;
  const { result, snapshot } = dealt;
  const signal = currentTurnStopSignal();
  const keepAlive = currentTurnKeepAlive();

  const { decision } = hold(
    {
      chatId,
      userId: params.userId,
      entrance: params.invokedBy === 'trigger' ? 'trigger' : 'llm',
      characterId: params.characterId,
      characterName: dealt.characterName,
      ...(params.triggerPhrase ? { triggerPhrase: params.triggerPhrase } : {}),
      definition: entry.definition,
      definitionTier: entry.tier,
      definitionMountId: entry.mountPointId,
      snapshot,
      draw: result.draw,
      baseline: result,
      consults: result.llm ? [result.llm] : [],
    },
    { ...(signal ? { signal } : {}), ...(keepAlive ? { keepAlive } : {}) }
  );

  const answer = await decision;
  if (answer.kind === 'veto') {
    logger.info('Custom tool run set aside by the operator', {
      context: CONTEXT,
      chatId,
      tool: entry.definition.name,
      invokedBy: params.invokedBy,
      cause: answer.cause,
    });
    return { kind: 'veto' };
  }
  if (answer.kind === 'as-rolled') return { kind: 'as-rolled' };

  const before = factsOf(entry.definition, result, presentationFor(entry.definition, result.visibility));
  const after = factsOf(entry.definition, answer.run.result, answer.run.presentation);
  const changed = changedFields(before, after);
  logger.info('Custom tool run dealt by the operator', {
    context: CONTEXT,
    chatId,
    tool: entry.definition.name,
    changed,
    reasks: answer.reasks,
    staleAnswer: answer.run.staleAnswer,
  });
  if (changed.length === 0) return { kind: 'as-rolled' };

  return {
    kind: 'deal',
    run: answer.run,
    record: {
      resolvedAt: new Date().toISOString(),
      decision: 'deal',
      changed,
      dealt: before,
      ...(answer.reasks > 0 ? { reasks: answer.reasks } : {}),
      ...(answer.run.staleAnswer ? { staleAnswer: true } : {}),
    },
  };
}

/**
 * The rolling character's name for `{{character}}`: the entrance's copy when it
 * has one, else a raw read (a broken vault costs the placeholder, never the
 * run). null for a run nobody made.
 */
async function resolveCharacterName(
  characterId: string | null,
  supplied: string | null | undefined,
  chatId: string
): Promise<string | null> {
  if (!characterId) return null;
  if (supplied !== undefined) return supplied?.trim() || null;
  try {
    const character = await getRepositories().characters.findByIdRaw(characterId);
    return character?.name?.trim() || null;
  } catch (error) {
    logger.debug('Custom tool run: rolling character name unavailable, {{character}} renders as written', {
      context: CONTEXT,
      chatId,
      characterId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * The rolling character's Inventory for this run: loaded once, and only when
 * the definition tests, quotes, draws from or changes it. Null for a run
 * nobody made, a definition that never mentions the bag, or a vault that
 * cannot be read (logged).
 */
async function loadRunInventory(
  definition: DiscoveredCustomTool['definition'],
  characterId: string | null,
  chatId: string
): Promise<LoadedInventoryContext | null> {
  if (!characterId) return null;
  const vocabulary = collectToolVocabulary(definition);
  const needed =
    vocabulary.inventoryReads.length +
      vocabulary.inventoryAggregates.length +
      vocabulary.equips.length +
      vocabulary.unequips.length +
      vocabulary.picksUp.length >
    0;
  if (!needed) return null;
  try {
    return await loadInventoryContext(getRepositories(), characterId, chatId);
  } catch (error) {
    logger.warn('Custom tool run: the rolling character\'s inventory could not be read; inventory tests decline', {
      context: CONTEXT,
      chatId,
      characterId,
      tool: definition.name,
      error: getErrorMessage(error),
    });
    return null;
  }
}
