/**
 * One route for "the document stores linked to an owner", shared by
 * `/api/v1/projects/[id]/mount-points` and `/api/v1/groups/[id]/mount-points`.
 *
 * The two used to be separate copies that disagreed: the project one caught
 * its own Zod errors into 500s (#166) and alone reported the owner's
 * `officialMountPointId`; their logging differed. Both owners now answer the
 * same shapes:
 *
 * - `GET`    → `{ mountPoints, officialMountPointId }` (links whose store has
 *   since been deleted are skipped)
 * - `POST`   `{ mountPointId }` → `201 { link, mountPoint }`
 * - `DELETE` `?mountPointId=` → `{ message }`; 400 when no such link exists.
 *   The JSON body `{ mountPointId }` that DELETE used to take is still read
 *   for one release, with a warning.
 *
 * A malformed body or query is a ZodError, which the middleware answers
 * with a 400.
 *
 * @module mount-index/owner-mount-links-routes
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { badRequest, created, notFound, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

const linkMountPointSchema = z.object({
  mountPointId: z.string().min(1, 'Mount point ID is required'),
});

type Repos = RequestContext['repos'];

/** The two things a link owner needs to provide. */
export interface MountLinkOwnerConfig {
  /** Display name, for 404s and messages: `'Project'`, `'Group'`. */
  label: string;
  /** Loads the owner, or null. Only `officialMountPointId` is read. */
  findOwner: (repos: Repos, id: string) => Promise<{ officialMountPointId?: string | null } | null>;
  /** The owner's link table. */
  links: (repos: Repos) => {
    findMountPointIds: (ownerId: string) => Promise<string[]>;
    link: (ownerId: string, mountPointId: string) => Promise<{ id: string }>;
    unlink: (ownerId: string, mountPointId: string) => Promise<boolean>;
  };
}

/**
 * The store to unlink: `?mountPointId=`, or — for one release — the JSON body
 * the route used to take.
 */
async function readUnlinkTarget(req: NextRequest, label: string, ownerId: string): Promise<string> {
  const fromQuery = req.nextUrl.searchParams.get('mountPointId');
  if (fromQuery !== null) {
    return linkMountPointSchema.parse({ mountPointId: fromQuery }).mountPointId;
  }
  const body = await req.json().catch(() => ({}));
  logger.warn(`[${label} mount points] DELETE with a JSON body is deprecated; use ?mountPointId=`, { ownerId });
  return linkMountPointSchema.parse(body).mountPointId;
}

/** The GET / POST / DELETE handlers for one owner kind. */
export function createOwnerMountLinkRoutes(config: MountLinkOwnerConfig) {
  const { label } = config;
  const log = logger.child({ module: `${label.toLowerCase()}-mount-points` });

  const GET = createContextParamsHandler<{ id: string }>(
    async (_req: NextRequest, { repos }: RequestContext, { id }) => {
      const owner = await config.findOwner(repos, id);
      if (!owner) return notFound(label);

      const mountPointIds = await config.links(repos).findMountPointIds(id);
      const mountPoints = (
        await Promise.all(mountPointIds.map((mountPointId) => repos.docMountPoints.findById(mountPointId)))
      ).filter((mp): mp is NonNullable<typeof mp> => mp !== null);

      // The owner's own store, so a browser opens the store the owner reads
      // and writes rather than guessing among its linked ones.
      const officialMountPointId = owner.officialMountPointId ?? null;
      log.debug('Listed linked mount points', { ownerId: id, count: mountPoints.length, officialMountPointId });

      return successResponse({ mountPoints, officialMountPointId });
    }
  );

  const POST = createContextParamsHandler<{ id: string }>(
    async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
      const owner = await config.findOwner(repos, id);
      if (!owner) return notFound(label);

      const { mountPointId } = linkMountPointSchema.parse(await req.json());

      const mountPoint = await repos.docMountPoints.findById(mountPointId);
      if (!mountPoint) return notFound('Mount point');

      const link = await config.links(repos).link(id, mountPointId);
      log.info('Mount point linked', { ownerId: id, mountPointId, linkId: link.id, userId: user.id });

      return created({ link, mountPoint });
    }
  );

  const DELETE = createContextParamsHandler<{ id: string }>(
    async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
      const owner = await config.findOwner(repos, id);
      if (!owner) return notFound(label);

      const mountPointId = await readUnlinkTarget(req, label, id);

      const unlinked = await config.links(repos).unlink(id, mountPointId);
      if (!unlinked) {
        return badRequest(`No link exists between this ${label.toLowerCase()} and mount point`);
      }

      log.info('Mount point unlinked', { ownerId: id, mountPointId, userId: user.id });
      return successResponse({ message: `Mount point unlinked from ${label.toLowerCase()}` });
    }
  );

  return { GET, POST, DELETE };
}
