/**
 * Chats API v1 — Scenario Action
 *
 * `POST /api/v1/chats/[id]?action=scenario` — change the scene mid-conversation.
 * `GET  /api/v1/chats/[id]?action=scenario-source` — where the scene came from,
 *   and whether the shelf copy has since been revised or removed.
 *
 * The payload mirrors the New Chat dialog's scenario fields exactly and runs
 * through the same `resolveScenarioSelection` chain, so a preset picked from
 * the sidebar lands as the same text it would have at chat creation.
 *
 * Three things have to happen together, or the change is only half-made:
 *   1. `chat.scenarioText` is rewritten — it feeds `{{scenario}}` in the
 *      identity stack — together with `scenarioSource` / `scenarioNotes`, the
 *      recipe that produced it.
 *   2. Every participant's precompiled identity stack is rebuilt, because that
 *      template variable is baked into the compiled copy.
 *   3. The Host announces the revision, so the change is visible to the company
 *      rather than silently rewriting the world between turns.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import {
  hashScenarioBody,
  resolveScenarioSelection,
  sameResolvedScenario,
  ScenarioRefRefusedError,
  type ResolvedScenario,
} from '@/lib/chat/scenario-selection';
import { lookupScenarioRef } from '@/lib/scenarios/location';
import { postHostScenarioRevisionAnnouncement } from '@/lib/services/host-notifications/writer';
import { compileAllIdentityStacks } from '@/lib/services/system-prompt-compiler/compiler';
import { setScenarioSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChatMetadata } from '@/lib/schemas/chat.types';

/**
 * Find which of the room's characters owns a given character-scenario id.
 *
 * At creation there is one "primary character" to look the id up on; an
 * established chat may hold several, and the picker only offers character
 * scenarios when exactly one LLM character is present. Searching the whole
 * active cast keeps the lookup honest either way. A character whose vault is
 * unavailable is skipped rather than allowed to fail the whole change.
 */
async function findCharacterOwningScenario(
  chat: ChatMetadata,
  scenarioId: string,
  repos: RepositoryContainer,
): Promise<string | null> {
  for (const participant of chat.participants) {
    if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
    if (participant.status === 'removed') continue;
    try {
      const character = await repos.characters.findById(participant.characterId);
      if (character?.scenarios?.some((s) => s.id === scenarioId)) {
        return character.id;
      }
    } catch (error) {
      logger.debug('[Chats v1] Skipping character while resolving scenarioId', {
        chatId: chat.id,
        characterId: participant.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

/**
 * Change (or clear) the chat's scenario.
 */
export async function handleSetScenario(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = setScenarioSchema.parse(body);

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const characterId = validatedData.scenarioId
    ? await findCharacterOwningScenario(chat, validatedData.scenarioId, repos)
    : null;

  let next: ResolvedScenario;
  try {
    next = await resolveScenarioSelection(validatedData, {
      repos,
      userId: user.id,
      projectId: chat.projectId,
      characterId,
      logTag: '[Chats v1]',
    });
  } catch (error) {
    if (error instanceof ScenarioRefRefusedError) return badRequest(error.message);
    throw error;
  }

  const previous: ResolvedScenario = {
    scenarioText: chat.scenarioText ?? null,
    scenarioSource: chat.scenarioSource ?? null,
    scenarioNotes: chat.scenarioNotes ?? null,
  };

  // A no-op change earns no announcement and no recompile — re-picking the
  // scene you already have shouldn't post a bubble saying it changed.
  if (sameResolvedScenario(next, previous)) {
    logger.debug('[Chats v1] Scenario unchanged; nothing to do', { chatId });
    return successResponse({
      scenarioText: next.scenarioText,
      changed: false,
      message: 'Scenario unchanged',
    });
  }

  const updatedChat = await repos.chats.update(chatId, {
    scenarioText: next.scenarioText,
    scenarioSource: next.scenarioSource,
    scenarioNotes: next.scenarioNotes,
  });
  if (!updatedChat) {
    return serverError('Failed to update chat');
  }

  // Only the text reaches the prompt. A change of provenance alone (the same
  // words, now traced to their file) needs neither a recompile nor a bubble.
  const textChanged = next.scenarioText !== previous.scenarioText;
  if (textChanged) {
    // `chat.scenarioText` feeds the {{scenario}} template variable, which is
    // baked into every participant's precompiled identity stack — a changed
    // scene means every stack is stale. Non-fatal: the compiler has a
    // read-through fallback, so a failure here costs speed, not correctness.
    try {
      await compileAllIdentityStacks(updatedChat);
    } catch (error) {
      logger.warn('[Chats v1] Failed to recompile identity stacks after scenario change', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await postHostScenarioRevisionAnnouncement({
      chatId,
      scenarioText: next.scenarioText,
    });
  }

  logger.info('[Chats v1] Scenario changed', {
    chatId,
    textChanged,
    hadScenario: previous.scenarioText !== null,
    hasScenario: next.scenarioText !== null,
    scenarioLength: next.scenarioText?.length ?? 0,
    source: validatedData.scenarioRef
      ? 'ref'
      : validatedData.scenarioId
        ? 'character'
        : validatedData.projectScenarioPath
          ? 'project'
          : validatedData.groupScenarioPath
            ? 'group'
            : validatedData.generalScenarioPath
              ? 'general'
              : 'custom',
    sourceMountPointId: next.scenarioSource?.mountPointId ?? null,
  });

  return successResponse({
    scenarioText: next.scenarioText,
    changed: true,
    message: next.scenarioText ? 'Scenario updated' : 'Scenario cleared',
  });
}

/**
 * Where the chat's scene came from. `exists` is false when the source file
 * (or its owner) is gone; `changed` is true when the shelf copy's body no
 * longer hashes to what was picked. A chat with no source — a custom scene,
 * or one from before sources were recorded — answers `source: null`.
 */
export async function handleGetScenarioSource(
  chatId: string,
  { user, repos }: RequestContext,
): Promise<NextResponse> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const source = chat.scenarioSource ?? null;
  const notes = chat.scenarioNotes ?? null;
  if (!source) {
    return successResponse({ source: null, owner: null, scenarioName: null, scenarioId: null, exists: false, changed: false, notes });
  }

  const lookup = await lookupScenarioRef(source, repos, user.id);
  const location = lookup.status === 'refused' ? null : lookup.location;
  const owner = location ? { scope: location.scope, id: location.id, name: location.ownerName } : null;
  const exists = lookup.status === 'ok';
  const changed = lookup.status === 'ok' && hashScenarioBody(lookup.scenario.body) !== source.bodySha256;

  logger.debug('[Chats v1] Scenario source checked', {
    chatId,
    mountPointId: source.mountPointId,
    path: source.path,
    status: lookup.status,
    changed,
  });

  return successResponse({
    source,
    owner,
    scenarioName: lookup.status === 'ok' ? lookup.scenario.name : null,
    // A character scenario's path-derived id, so the picker can show it under
    // its native heading.
    scenarioId: location?.idForPath(source.path) ?? null,
    exists,
    changed,
    notes,
  });
}
