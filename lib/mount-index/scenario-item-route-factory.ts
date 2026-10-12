/**
 * Scenario single-item route factory.
 *
 * The General, group and project single-scenario endpoints
 * (`/api/v1/scenarios/[scenarioPath]`,
 * `/api/v1/groups/[id]/scenarios/[scenarioPath]` and
 * `/api/v1/projects/[id]/scenarios/[scenarioPath]`) are identical modulo the
 * owning scope and its labels. This factory owns the shared GET / PUT /
 * POST(?action=rename) / DELETE bodies once; every read and write goes through
 * the scope's `ScenarioLocation` (`lib/scenarios/location.ts`), so the routes
 * hold no file IO of their own.
 *
 * `[scenarioPath]` is the URL-encoded filename relative to `Scenarios/`.
 * The routes accept the bare filename (with or without `.md`) and prefix
 * `Scenarios/` server-side; `..` segments are rejected before any store is
 * looked up. PUT, POST and DELETE all honour `?includeArchived=true` on the
 * freshly-listed scenarios they return. A read never provisions: an owner
 * without a store yet is a 404 naming the remedy.
 *
 * @module mount-index/scenario-item-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, dispatchAction } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, created, notFound, serverError, successResponse } from '@/lib/api/responses';
import {
  SCENARIOS_FOLDER,
  createScenarioSchema,
  resolveScenarioPath,
  updateScenarioSchema,
  renameScenarioSchema,
} from '@/lib/mount-index/scenarios-common';
import { readIncludeArchived } from '@/lib/api/query-params';
import {
  ScenarioConflictError,
  ScenarioFilenameError,
  ScenarioNotFoundError,
  resolveScenarioLocation,
  type ScenarioLocation,
} from '@/lib/scenarios/location';

export interface ScenarioItemRouteConfig {
  /** The store scope this endpoint serves. */
  scope: 'project' | 'group' | 'general';
  /** Capitalised owner label — `'Group'` / `'Project'` / `'General'`. Feeds
   *  `notFound(...)` bodies and, lower-cased, the error strings and log messages. */
  ownerLabel: 'Group' | 'Project' | 'General';
  /** Log-message prefix — `'[Groups v1]'` / `'[Projects v1]'` / `'[General v1]'`. */
  logTag: string;
  /** Metadata key naming the owner id in log lines — `'groupId'` / `'projectId'` / `'ownerId'`. */
  logIdKey: string;
  /** Extra idempotent folder heals once the store is known for a write (the group tier's `Knowledge/`). */
  afterEnsure?: (mountPointId: string) => Promise<void>;
}

/** `{ scenarioPath }`, plus `{ id }` for the project and group endpoints. */
type ItemParams = Record<string, string> & { scenarioPath: string };

/**
 * Map a location error onto its response, or null when it isn't one of ours.
 */
export function scenarioErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof ScenarioNotFoundError) return notFound('Scenario');
  if (error instanceof ScenarioConflictError || error instanceof ScenarioFilenameError) {
    return badRequest(error.message);
  }
  if (error instanceof z.ZodError) {
    return badRequest(`Invalid request body: ${error.issues.map(i => i.message).join('; ')}`);
  }
  return null;
}

/**
 * Build the four route handlers for one scope's single-scenario endpoint.
 */
export function createScenarioItemHandlers<P extends ItemParams>(config: ScenarioItemRouteConfig) {
  const { scope, ownerLabel, logTag, logIdKey, afterEnsure } = config;
  const owner = ownerLabel.toLowerCase();

  /**
   * GET is a read probe and never provisions. PUT, rename and DELETE are
   * writes, so they heal what they write into — the store's `Scenarios/`
   * folder (and the group's `Knowledge/`) — rather than leave a deleted
   * folder missing until the next collection call or restart. An owner with
   * no store at all still answers 404 with the remedy; a write to a scenario
   * that cannot exist is no reason to mint a store.
   */
  async function loadLocation(
    ownerId: string | undefined,
    { user, repos }: RequestContext,
    forWrite = false,
  ): Promise<{ ok: true; location: ScenarioLocation } | { ok: false; response: NextResponse }> {
    let location = await resolveScenarioLocation(scope, ownerId, repos, user.id);
    if (location && forWrite) {
      location = await resolveScenarioLocation(scope, ownerId, repos, user.id, { ensure: true });
      if (location && afterEnsure) await afterEnsure(location.mountPointId);
    }
    if (location) return { ok: true, location };

    if (scope === 'general') {
      return { ok: false, response: notFound('Quilltap General mount has not been provisioned yet') };
    }
    const row = ownerId
      ? scope === 'project'
        ? await repos.projects.findByIdRaw(ownerId)
        : await repos.groups.findByIdRaw(ownerId)
      : null;
    if (!row) return { ok: false, response: notFound(ownerLabel) };
    return {
      ok: false,
      response: notFound(`${ownerLabel} has no official document store yet — restart the server or call GET /scenarios first`),
    };
  }

  // ==========================================================================
  // GET — read one scenario
  // ==========================================================================

  const GET = createContextParamsHandler<P>(
    async (_req: NextRequest, ctx: RequestContext, params) => {
      const { scenarioPath } = params;
      const id: string | undefined = params.id;
      try {
        const resolved = resolveScenarioPath(scenarioPath, SCENARIOS_FOLDER);
        if (!resolved.ok) return badRequest(resolved.error);

        const lookup = await loadLocation(id, ctx);
        if (!lookup.ok) return lookup.response;

        const scenario = await lookup.location.read(resolved.path);
        if (!scenario) return notFound('Scenario');

        return successResponse({ scenario });
      } catch (error) {
        logger.error(
          `${logTag} Failed to read ${owner} scenario`,
          { [logIdKey]: id ?? null, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to read ${owner} scenario`);
      }
    },
  );

  // ==========================================================================
  // PUT — update scenario content + frontmatter
  // ==========================================================================

  const PUT = createContextParamsHandler<P>(
    async (req: NextRequest, ctx: RequestContext, params) => {
      const { scenarioPath } = params;
      const id: string | undefined = params.id;
      try {
        const resolved = resolveScenarioPath(scenarioPath, SCENARIOS_FOLDER);
        if (!resolved.ok) return badRequest(resolved.error);

        const lookup = await loadLocation(id, ctx, true);
        if (!lookup.ok) return lookup.response;
        const { location } = lookup;

        const includeArchived = readIncludeArchived(req);
        const validated = updateScenarioSchema.parse(await req.json());

        // 404 if the file doesn't exist (use POST on the collection to create).
        await location.update(resolved.path, validated);

        const { scenarios, warnings } = await location.list({ includeArchived });

        logger.info(`${logTag} Updated ${owner} scenario`, {
          [logIdKey]: id ?? null,
          userId: ctx.user.id,
          mountPointId: location.mountPointId,
          relativePath: resolved.path,
          isDefault: validated.isDefault === true,
        });

        return successResponse({ scenarios, warnings });
      } catch (error) {
        const mapped = scenarioErrorResponse(error);
        if (mapped) return mapped;
        logger.error(
          `${logTag} Failed to update ${owner} scenario`,
          { [logIdKey]: id ?? null, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to update ${owner} scenario`);
      }
    },
  );

  // ==========================================================================
  // POST ?action=rename — rename a scenario file
  // ==========================================================================

  const POST = createContextParamsHandler<P>(
    async (req: NextRequest, ctx: RequestContext, params) => {
      const { scenarioPath } = params;
      const id: string | undefined = params.id;
      try {
        const includeArchived = readIncludeArchived(req);
        return await dispatchAction(req, {
          rename: async () => {
            const resolved = resolveScenarioPath(scenarioPath, SCENARIOS_FOLDER);
            if (!resolved.ok) return badRequest(resolved.error);

            const lookup = await loadLocation(id, ctx, true);
            if (!lookup.ok) return lookup.response;
            const { location } = lookup;

            const validated = renameScenarioSchema.parse(await req.json());
            const renamed = await location.rename(resolved.path, validated.newFilename);

            const { scenarios, warnings } = await location.list({ includeArchived });

            logger.info(`${logTag} Renamed ${owner} scenario`, {
              [logIdKey]: id ?? null,
              userId: ctx.user.id,
              mountPointId: location.mountPointId,
              from: resolved.path,
              to: renamed.path,
            });

            return successResponse({ path: renamed.path, scenarios, warnings });
          },
        });
      } catch (error) {
        const mapped = scenarioErrorResponse(error);
        if (mapped) return mapped;
        logger.error(
          `${logTag} Failed to rename ${owner} scenario`,
          { [logIdKey]: id ?? null, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to rename ${owner} scenario`);
      }
    },
  );

  // ==========================================================================
  // DELETE — delete a scenario file
  // ==========================================================================

  const DELETE = createContextParamsHandler<P>(
    async (req: NextRequest, ctx: RequestContext, params) => {
      const { scenarioPath } = params;
      const id: string | undefined = params.id;
      try {
        const includeArchived = readIncludeArchived(req);
        const resolved = resolveScenarioPath(scenarioPath, SCENARIOS_FOLDER);
        if (!resolved.ok) return badRequest(resolved.error);

        const lookup = await loadLocation(id, ctx, true);
        if (!lookup.ok) return lookup.response;
        const { location } = lookup;

        await location.delete(resolved.path);

        const { scenarios, warnings } = await location.list({ includeArchived });

        logger.info(`${logTag} Deleted ${owner} scenario`, {
          [logIdKey]: id ?? null,
          userId: ctx.user.id,
          mountPointId: location.mountPointId,
          relativePath: resolved.path,
        });

        return successResponse({ scenarios, warnings });
      } catch (error) {
        const mapped = scenarioErrorResponse(error);
        if (mapped) return mapped;
        logger.error(
          `${logTag} Failed to delete ${owner} scenario`,
          { [logIdKey]: id ?? null, scenarioPath },
          error instanceof Error ? error : undefined,
        );
        return serverError(`Failed to delete ${owner} scenario`);
      }
    },
  );

  return { GET, PUT, POST, DELETE };
}

// ============================================================================
// Collection endpoints — list + create
// ============================================================================

export type ScenarioCollectionRouteConfig = ScenarioItemRouteConfig;

/**
 * Build the list (GET) and create (POST) bodies for one scope's collection
 * endpoint. Both provision the store and its `Scenarios/` folder first
 * (`ensure: true`), so a user hitting the endpoint needn't wait for the next
 * startup heal. General tolerates the pre-migration race on GET (an empty
 * list with `mountPointId: null`) and refuses writes in that window.
 *
 * The bodies are returned bare (`(req, ctx, params)`) so a route can wrap
 * them in action dispatch, as the General collection route does.
 */
export function createScenarioCollectionBodies<P extends Record<string, string>>(
  config: ScenarioCollectionRouteConfig,
) {
  const { scope, ownerLabel, logTag, logIdKey, afterEnsure } = config;
  const owner = ownerLabel.toLowerCase();

  async function ensureLocation(
    ownerId: string | undefined,
    { user, repos }: RequestContext,
    forWrite: boolean,
  ): Promise<{ ok: true; location: ScenarioLocation } | { ok: false; response: NextResponse }> {
    if (scope !== 'general' && ownerId) {
      const row = scope === 'project'
        ? await repos.projects.findByIdRaw(ownerId)
        : await repos.groups.findByIdRaw(ownerId);
      if (!row) return { ok: false, response: notFound(ownerLabel) };
    }
    const location = await resolveScenarioLocation(scope, ownerId, repos, user.id, { ensure: true });
    if (!location) {
      if (scope === 'general') {
        return {
          ok: false,
          response: forWrite
            ? badRequest('Quilltap General mount has not been provisioned yet — restart the server')
            : NextResponse.json({ mountPointId: null, scenarios: [], warnings: [] }),
        };
      }
      return { ok: false, response: serverError(`Failed to ensure ${owner} document store`) };
    }
    if (afterEnsure) await afterEnsure(location.mountPointId);
    return { ok: true, location };
  }

  const list = async (req: NextRequest, ctx: RequestContext, params: P): Promise<NextResponse> => {
    const id: string | undefined = params.id;
    try {
      const includeArchived = readIncludeArchived(req);
      const lookup = await ensureLocation(id, ctx, false);
      if (!lookup.ok) return lookup.response;
      const { scenarios, warnings } = await lookup.location.list({ includeArchived });
      return NextResponse.json({ mountPointId: lookup.location.mountPointId, scenarios, warnings });
    } catch (error) {
      logger.error(
        `${logTag} Failed to list ${owner} scenarios`,
        { [logIdKey]: id ?? null },
        error instanceof Error ? error : undefined,
      );
      return serverError(`Failed to list ${owner} scenarios`);
    }
  };

  const create = async (req: NextRequest, ctx: RequestContext, params: P): Promise<NextResponse> => {
    const id: string | undefined = params.id;
    try {
      const validated = createScenarioSchema.parse(await req.json());
      const lookup = await ensureLocation(id, ctx, true);
      if (!lookup.ok) return lookup.response;
      const { location } = lookup;

      const scenario = await location.create(validated);

      logger.info(`${logTag} Created ${owner} scenario`, {
        [logIdKey]: id ?? null,
        userId: ctx.user.id,
        mountPointId: location.mountPointId,
        relativePath: scenario.path,
        isDefault: validated.isDefault === true,
      });

      // Return the freshly listed scenarios so the client doesn't need a follow-up GET.
      const { scenarios, warnings } = await location.list({ includeArchived: validated.archived === true });
      return created({ mountPointId: location.mountPointId, path: scenario.path, scenarios, warnings });
    } catch (error) {
      const mapped = scenarioErrorResponse(error);
      if (mapped) return mapped;
      logger.error(
        `${logTag} Failed to create ${owner} scenario`,
        { [logIdKey]: id ?? null },
        error instanceof Error ? error : undefined,
      );
      return serverError(`Failed to create ${owner} scenario`);
    }
  };

  return { list, create };
}
