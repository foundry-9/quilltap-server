/**
 * Scenario selection — the one place a chosen scenario becomes text.
 *
 * Both the New Chat dialog and the in-chat scenario picker offer presets from
 * every kind of owner, plus free-text notes. This module owns the precedence
 * chain and turns each kind of pointer into a `ScenarioRef` resolved through
 * the scenario location (`lib/scenarios/location.ts`):
 *
 *   `scenarioRef` (a browser pick from anywhere)
 *     > character `scenarioId` > project path > group path > general path
 *
 * The free text is NOT part of that chain — whatever the chain resolves is the
 * preset, and the notes are layered beneath it by `combineScenarioText`.
 *
 * The result is a recipe: `scenarioText` (the one thing the prompt reads),
 * `scenarioSource` (which file the preset came from and the hash of its body),
 * and `scenarioNotes`. Callers write all three together and nothing else
 * writes them. With no preset the text is the notes alone and there is no
 * source — a custom scene is wholly its text, with nothing to reload.
 *
 * Every legacy kind fails soft: an unresolvable pointer logs a warning and
 * falls through to the next. A `scenarioRef` that is malformed or names a
 * mount that is not a scenario owner is refused outright
 * (`ScenarioRefRefusedError`, a 400 at the route); one whose file has gone
 * missing fails soft like the rest.
 *
 * @module chat/scenario-selection
 */

import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { combineScenarioText } from '@/lib/chat/scenario-text';
import {
  lookupScenarioRef,
  normalizeScenarioPath,
  resolveScenarioLocation,
  type ScenarioLocation,
  type ScenarioRef,
  type ScenarioScope,
} from '@/lib/scenarios/location';
import type { ParsedScenario } from '@/lib/mount-index/scenarios-common';
import type { ScenarioSource } from '@/lib/schemas/chat.types';
import type { RepositoryContainer } from '@/lib/repositories/factory';

/**
 * The scenario fields as they arrive from a client — the New Chat dialog's
 * create payload and the in-chat picker's `?action=scenario` body use the same
 * names, so the same resolver serves both.
 */
export interface ScenarioSelectionFields {
  /** Free-text notes. Appended beneath a resolved preset, or used alone. */
  scenario?: string | null;
  /** A scenario anywhere — the browser's pick. Most specific, so first. */
  scenarioRef?: ScenarioRef | null;
  /** A character scenario's id (path-derived), looked up in the character's vault. */
  scenarioId?: string | null;
  /** `Scenarios/<file>.md` inside the project's official store. Needs `projectId`. */
  projectScenarioPath?: string | null;
  /** `Scenarios/<file>.md` inside a group's official store. Needs `groupScenarioGroupId`. */
  groupScenarioPath?: string | null;
  groupScenarioGroupId?: string | null;
  /** `Scenarios/<file>.md` inside the instance-wide "Quilltap General" mount. */
  generalScenarioPath?: string | null;
}

export interface ResolveScenarioSelectionOptions {
  repos: RepositoryContainer;
  userId: string;
  /** Required for `projectScenarioPath` to resolve. */
  projectId?: string | null;
  /** The character whose vault backs a `scenarioId` lookup. */
  characterId?: string | null;
  /** Log prefix, so warnings read as coming from the calling route. */
  logTag?: string;
}

export interface ResolvedScenario {
  scenarioText: string | null;
  scenarioSource: ScenarioSource | null;
  scenarioNotes: string | null;
}

/** A `scenarioRef` that can never resolve: a bad path, or a mount that holds no scenarios. */
export class ScenarioRefRefusedError extends Error {
  constructor(reason: string) {
    super(`Invalid scenarioRef: ${reason}`);
    this.name = 'ScenarioRefRefusedError';
  }
}

/** Hex SHA-256 of a scenario body as resolved — the `bodySha256` of a source. */
export function hashScenarioBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** True when two recipes would leave a chat byte-identical. */
export function sameResolvedScenario(a: ResolvedScenario, b: ResolvedScenario): boolean {
  const sa = a.scenarioSource;
  const sb = b.scenarioSource;
  const sameSource =
    sa === sb ||
    (!!sa && !!sb && sa.mountPointId === sb.mountPointId && sa.path === sb.path && sa.bodySha256 === sb.bodySha256);
  return a.scenarioText === b.scenarioText && a.scenarioNotes === b.scenarioNotes && sameSource;
}

interface Preset {
  location: ScenarioLocation;
  scenario: ParsedScenario;
}

/**
 * Read one owner's scenario by path. Every miss logs a warning and returns
 * null so the chain falls through to the next kind.
 */
async function readFromScope(
  scope: ScenarioScope,
  ownerId: string | null | undefined,
  rawPath: string,
  options: ResolveScenarioSelectionOptions,
  field: string,
): Promise<Preset | null> {
  const logTag = options.logTag ?? '[Scenario]';
  if (scope !== 'general' && !ownerId) {
    logger.warn(`${logTag} ${field} provided without its owner; ignoring`, { [field]: rawPath });
    return null;
  }
  const normalized = normalizeScenarioPath(rawPath);
  if (!normalized.ok) {
    logger.warn(`${logTag} ${field} is not a scenario path; ignoring`, { [field]: rawPath, reason: normalized.error });
    return null;
  }
  const location = await resolveScenarioLocation(scope, ownerId, options.repos, options.userId);
  if (!location) {
    logger.warn(`${logTag} ${field} provided but its ${scope} has no scenario store`, {
      ownerId: ownerId ?? null,
      [field]: rawPath,
    });
    return null;
  }
  const scenario = await location.read(normalized.path);
  if (!scenario) {
    logger.warn(`${logTag} ${field} did not resolve to a body`, { ownerId: ownerId ?? null, [field]: rawPath });
    return null;
  }
  return { location, scenario };
}

/** Find a character scenario by its path-derived id. */
async function readCharacterScenarioById(
  scenarioId: string,
  options: ResolveScenarioSelectionOptions,
): Promise<Preset | null> {
  const logTag = options.logTag ?? '[Scenario]';
  const location = options.characterId
    ? await resolveScenarioLocation('character', options.characterId, options.repos, options.userId)
    : null;
  if (location) {
    const { scenarios } = await location.list({ includeArchived: true });
    const scenario = scenarios.find((s) => location.idForPath(s.path) === scenarioId);
    if (scenario) return { location, scenario };
  }
  logger.warn(`${logTag} scenarioId not found on character`, {
    characterId: options.characterId ?? null,
    scenarioId,
  });
  return null;
}

/**
 * Resolve a scenario selection into the recipe that lands on the chat.
 * Throws `ScenarioRefRefusedError` for a `scenarioRef` that can never resolve.
 */
export async function resolveScenarioSelection(
  fields: ScenarioSelectionFields,
  options: ResolveScenarioSelectionOptions,
): Promise<ResolvedScenario> {
  const { repos, userId, projectId, logTag = '[Scenario]' } = options;

  let preset: Preset | null = null;

  if (fields.scenarioRef) {
    const lookup = await lookupScenarioRef(fields.scenarioRef, repos, userId);
    if (lookup.status === 'refused') throw new ScenarioRefRefusedError(lookup.reason);
    if (lookup.status === 'ok') {
      preset = { location: lookup.location, scenario: lookup.scenario };
    } else {
      logger.warn(`${logTag} scenarioRef points at a missing file`, { ...fields.scenarioRef });
    }
  }

  if (!preset && fields.scenarioId) {
    preset = await readCharacterScenarioById(fields.scenarioId, options);
  }

  if (!preset && fields.projectScenarioPath) {
    preset = await readFromScope('project', projectId, fields.projectScenarioPath, options, 'projectScenarioPath');
  }

  if (!preset && fields.groupScenarioPath) {
    preset = await readFromScope('group', fields.groupScenarioGroupId, fields.groupScenarioPath, options, 'groupScenarioPath');
  }

  if (!preset && fields.generalScenarioPath) {
    preset = await readFromScope('general', null, fields.generalScenarioPath, options, 'generalScenarioPath');
  }

  const notes = fields.scenario?.trim() ? fields.scenario.trim() : null;

  if (!preset) {
    // No preset: the notes ARE the scenario, and there is nothing to reload.
    return { scenarioText: notes, scenarioSource: null, scenarioNotes: null };
  }

  const body = preset.scenario.body;
  const result: ResolvedScenario = {
    scenarioText: combineScenarioText(body, notes) ?? null,
    scenarioSource: {
      mountPointId: preset.location.mountPointId,
      path: preset.scenario.path,
      bodySha256: hashScenarioBody(body),
    },
    scenarioNotes: notes,
  };
  logger.debug(`${logTag} Resolved scenario selection`, {
    scope: preset.location.scope,
    ownerId: preset.location.id,
    mountPointId: preset.location.mountPointId,
    path: preset.scenario.path,
    hasNotes: notes !== null,
  });
  return result;
}
