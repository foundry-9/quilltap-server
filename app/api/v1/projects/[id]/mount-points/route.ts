/**
 * Projects API v1 - Project Mount Points Endpoint
 *
 * GET /api/v1/projects/[id]/mount-points - List mount points linked to a project
 * POST /api/v1/projects/[id]/mount-points - Link a mount point to a project
 * DELETE /api/v1/projects/[id]/mount-points?mountPointId= - Unlink a mount point from a project
 *
 * One route shared with groups: `createOwnerMountLinkRoutes`
 * (`lib/mount-index/owner-mount-links-routes.ts`).
 */

import { createOwnerMountLinkRoutes } from '@/lib/mount-index/owner-mount-links-routes';

export const { GET, POST, DELETE } = createOwnerMountLinkRoutes({
  label: 'Project',
  findOwner: (repos, id) => repos.projects.findById(id),
  links: (repos) => ({
    findMountPointIds: async (projectId) =>
      (await repos.projectDocMountLinks.findByProjectId(projectId)).map((link) => link.mountPointId),
    link: (projectId, mountPointId) => repos.projectDocMountLinks.link(projectId, mountPointId),
    unlink: (projectId, mountPointId) => repos.projectDocMountLinks.unlink(projectId, mountPointId),
  }),
});
