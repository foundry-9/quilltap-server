/**
 * Every scenario in the instance — the scenario browser's catalogue.
 *
 * Lists every owner of the four kinds that has a store (General, every
 * project's and group's official store, every live character's vault) with
 * the scenarios in its `Scenarios/` folder: name, description, flags and a
 * short excerpt, never the body (the browser fetches one body at a time by
 * ref). Owners with an empty folder are included, so the browser can show the
 * shelf as bare rather than leaving the user to wonder; owners without a store
 * are skipped and never provisioned.
 *
 * Four row reads and one document read, however many owners there are: every
 * owner's mount id is collected first, then the `Scenarios/` documents of all
 * of them are fetched in a single query and bucketed by mount. Each bucket is
 * parsed with its scope's parser (`parseScenarioForScope`) and run through the
 * same default-conflict resolution a single owner's list gets.
 *
 * Server-only.
 *
 * @module lib/scenarios/everywhere
 */

import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { SCENARIOS_FOLDER, buildScenarioList } from '@/lib/mount-index/scenarios-common';
import {
  GENERAL_OWNER_NAME,
  characterScenarioIdForPath,
  parseScenarioForScope,
  type ScenarioScope,
} from '@/lib/scenarios/location';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';
import type { RepositoryContainer } from '@/lib/repositories/factory';

/** Characters of a body an "everywhere" row carries in lieu of the body itself. */
export const SCENARIO_EXCERPT_LENGTH = 240;

export interface EverywhereScenario {
  path: string;
  /** A character scenario's path-derived id (what `scenarioId` carries); character rows only. */
  scenarioId?: string;
  filename: string;
  name: string;
  description?: string;
  isDefault: boolean;
  archived: boolean;
  /** The first 240 characters of the body, whitespace collapsed. */
  excerpt: string;
  updatedAt: string;
}

export interface EverywhereSource {
  scope: ScenarioScope;
  id: string | null;
  name: string;
  mountPointId: string;
  scenarios: EverywhereScenario[];
  warnings: string[];
}

interface Owner {
  scope: ScenarioScope;
  id: string | null;
  name: string;
  mountPointId: string;
  defaultScenarioId?: string | null;
}

/** Collapse whitespace and cut to the excerpt length. */
export function scenarioExcerpt(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > SCENARIO_EXCERPT_LENGTH
    ? `${collapsed.slice(0, SCENARIO_EXCERPT_LENGTH).trimEnd()}…`
    : collapsed;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Every owner that has a scenario store, in browser order. */
async function collectOwners(repos: RepositoryContainer, userId: string): Promise<Owner[]> {
  const owners: Owner[] = [];

  const generalMountPointId = await getGeneralMountPointId();
  if (generalMountPointId) {
    owners.push({ scope: 'general', id: null, name: GENERAL_OWNER_NAME, mountPointId: generalMountPointId });
  }

  // Raw reads throughout: only names and mount pointers are needed, and
  // hydrating every owner's store to list its scenarios would be the
  // four-hundred-queries version of this.
  const [projects, groups, characters] = await Promise.all([
    repos.projects.findAllRaw(),
    repos.groups.findAllRaw(),
    repos.characters.findAllRaw(),
  ]);

  const storeOwners = (scope: 'project' | 'group', rows: Array<{ id: string; name: string; officialMountPointId?: string | null }>) =>
    rows
      .filter((row) => !!row.officialMountPointId)
      .map((row) => ({
        scope,
        id: row.id,
        name: row.name || (scope === 'project' ? 'Project' : 'Group'),
        mountPointId: row.officialMountPointId as string,
      }))
      .sort(byName);

  owners.push(...storeOwners('project', projects));
  owners.push(...storeOwners('group', groups));

  owners.push(
    ...characters
      // Archived characters are tombstones; a vaultless one has no shelf.
      .filter((c) => c.userId === userId && !c.archivedAt && !!c.characterDocumentMountPointId)
      .map((c) => ({
        scope: 'character' as const,
        id: c.id,
        name: c.name,
        mountPointId: c.characterDocumentMountPointId as string,
        defaultScenarioId: c.defaultScenarioId ?? null,
      }))
      .sort(byName),
  );

  return owners;
}

/**
 * List every scenario in the instance, grouped by owner. Archived scenarios
 * are omitted unless asked for.
 */
export async function listScenariosEverywhere(
  repos: RepositoryContainer,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<EverywhereSource[]> {
  const owners = await collectOwners(repos, userId);
  const mountIds = [...new Set(owners.map((o) => o.mountPointId))];

  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(mountIds, SCENARIOS_FOLDER, '.md');
  const byMount = new Map<string, DocMountDocument[]>();
  for (const doc of docs) {
    const bucket = byMount.get(doc.mountPointId);
    if (bucket) bucket.push(doc);
    else byMount.set(doc.mountPointId, [doc]);
  }

  logger.debug('[ScenariosEverywhere] Listed scenario shelves', {
    owners: owners.length,
    mounts: mountIds.length,
    documents: docs.length,
    includeArchived: options.includeArchived === true,
  });

  return owners.map((owner) => {
    const { scenarios, warnings } = buildScenarioList(
      byMount.get(owner.mountPointId) ?? [],
      (doc) =>
        parseScenarioForScope(owner.scope, doc, {
          characterId: owner.id ?? undefined,
          defaultScenarioId: owner.defaultScenarioId,
        }),
      options,
      { scope: owner.scope, id: owner.id, mountPointId: owner.mountPointId },
    );
    return {
      scope: owner.scope,
      id: owner.id,
      name: owner.name,
      mountPointId: owner.mountPointId,
      scenarios: scenarios.map((s) => ({
        path: s.path,
        ...(owner.scope === 'character' && {
          scenarioId: characterScenarioIdForPath(owner.mountPointId, s.path),
        }),
        filename: s.filename,
        name: s.name,
        ...(s.description !== undefined && { description: s.description }),
        isDefault: s.isDefault,
        archived: s.archived,
        excerpt: scenarioExcerpt(s.body),
        updatedAt: s.updatedAt,
      })),
      warnings,
    };
  });
}
