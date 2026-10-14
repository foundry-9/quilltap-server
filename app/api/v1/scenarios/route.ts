/**
 * General Scenarios — collection endpoint.
 *
 * GET  /api/v1/scenarios          — list every scenario in the instance-wide
 *                                   "Quilltap General" mount's `Scenarios/`
 *                                   folder, with frontmatter parsed and
 *                                   default-conflict resolution applied.
 *                                   `?includeArchived=true` also returns
 *                                   archived scenarios (hidden by default).
 * GET  /api/v1/scenarios?action=everywhere[&includeArchived=true]
 *                                 — every scenario in the instance, grouped by
 *                                   owner (General, projects, groups,
 *                                   characters), with an excerpt instead of the
 *                                   body. The scenario browser's catalogue.
 * GET  /api/v1/scenarios?action=read&mountPointId=&path=
 *                                 — one scenario, body included, by ref. 400
 *                                   when the ref names no scenario owner, 404
 *                                   when the file is gone.
 * POST /api/v1/scenarios          — create a new scenario file.
 *                                   Body: { filename, name?, description?,
 *                                   isDefault?, body }.
 *
 * Both heal General's `Scenarios/` folder first (the scenario location's
 * `ensure`), so callers don't have to wait for the next startup heal pass.
 * GET tolerates the pre-migration race (returns an empty list with
 * `mountPointId: null`); POST rejects writes in that window. The bodies live
 * in `lib/mount-index/scenario-item-route-factory.ts`.
 */

import type { NextRequest } from 'next/server';
import { createContextHandler, withCollectionActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { logger } from '@/lib/logger';
import { createScenarioCollectionBodies } from '@/lib/mount-index/scenario-item-route-factory';
import { lookupScenarioRef } from '@/lib/scenarios/location';
import { listScenariosEverywhere } from '@/lib/scenarios/everywhere';

const { list, create } = createScenarioCollectionBodies<Record<string, never>>({
  scope: 'general',
  ownerLabel: 'General',
  logTag: '[General v1]',
  logIdKey: 'ownerId',
});

async function handleEverywhere(req: NextRequest, { user, repos }: RequestContext) {
  try {
    const sources = await listScenariosEverywhere(repos, user.id, { includeArchived: readIncludeArchived(req) });
    return successResponse({ sources });
  } catch (error) {
    logger.error('[General v1] Failed to list scenarios everywhere', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list scenarios');
  }
}

async function handleRead(req: NextRequest, { user, repos }: RequestContext) {
  const mountPointId = req.nextUrl.searchParams.get('mountPointId');
  const path = req.nextUrl.searchParams.get('path');
  if (!mountPointId || !path) return badRequest('mountPointId and path are required');
  const lookup = await lookupScenarioRef({ mountPointId, path }, repos, user.id);
  if (lookup.status === 'refused') return badRequest(`Invalid scenario ref: ${lookup.reason}`);
  if (lookup.status === 'missing') return notFound('Scenario');
  const { location, scenario } = lookup;
  return successResponse({
    scenario,
    owner: { scope: location.scope, id: location.id, name: location.ownerName, mountPointId: location.mountPointId },
  });
}

export const GET = createContextHandler(
  withCollectionActionDispatch({ everywhere: handleEverywhere, read: handleRead }, list),
);
export const POST = createContextHandler((req, ctx) => create(req, ctx, {}));
