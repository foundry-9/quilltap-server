/**
 * Groups API v1 - Group Mount Points Endpoint
 *
 * GET /api/v1/groups/[id]/mount-points - List mount points linked to a group
 * POST /api/v1/groups/[id]/mount-points - Link a mount point to a group
 * DELETE /api/v1/groups/[id]/mount-points?mountPointId= - Unlink a mount point from a group
 *
 * One route shared with projects: `createOwnerMountLinkRoutes`
 * (`lib/mount-index/owner-mount-links-routes.ts`).
 */

import { createOwnerMountLinkRoutes } from '@/lib/mount-index/owner-mount-links-routes';

export const { GET, POST, DELETE } = createOwnerMountLinkRoutes({
  label: 'Group',
  findOwner: (repos, id) => repos.groups.findById(id),
  links: (repos) => ({
    findMountPointIds: async (groupId) =>
      (await repos.groupDocMountLinks.findByGroupId(groupId)).map((link) => link.mountPointId),
    link: (groupId, mountPointId) => repos.groupDocMountLinks.link(groupId, mountPointId),
    unlink: (groupId, mountPointId) => repos.groupDocMountLinks.unlink(groupId, mountPointId),
  }),
});
