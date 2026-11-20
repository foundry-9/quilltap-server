/**
 * Project Document Mount Links Repository
 *
 * ProjectDocMountLink is a join table linking projects to mount points. The
 * projectId references a project in the main database; the link itself lives
 * in the mount index DB. Everything but the owner-axis finder's name is
 * inherited from {@link OwnerDocMountLinksRepository}.
 */

import { ProjectDocMountLink, ProjectDocMountLinkSchema } from '@/lib/schemas/mount-index.types';
import { OwnerDocMountLinksRepository } from './owner-doc-mount-links.repository';

export class ProjectDocMountLinksRepository extends OwnerDocMountLinksRepository<ProjectDocMountLink> {
  constructor() {
    super('project_doc_mount_links', ProjectDocMountLinkSchema, { ownerKey: 'projectId', ownerNoun: 'project' });
  }

  /** Find all links for a project. */
  async findByProjectId(projectId: string): Promise<ProjectDocMountLink[]> {
    return this.findByOwnerId(projectId);
  }
}
