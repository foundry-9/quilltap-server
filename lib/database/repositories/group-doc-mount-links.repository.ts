/**
 * Group Document Mount Links Repository
 *
 * GroupDocMountLink is a join table linking groups to their *additional
 * linked* mount points (the official store is recorded on the group row as
 * officialMountPointId, not here). The groupId references a group in the main
 * database; the link itself lives in the mount index DB. Linking, unlinking
 * and the finders are inherited from {@link OwnerDocMountLinksRepository}.
 */

import { GroupDocMountLink, GroupDocMountLinkSchema } from '@/lib/schemas/mount-index.types';
import { OwnerDocMountLinksRepository } from './owner-doc-mount-links.repository';
import { TypedQueryFilter } from '../interfaces';

export class GroupDocMountLinksRepository extends OwnerDocMountLinksRepository<GroupDocMountLink> {
  constructor() {
    super('group_doc_mount_links', GroupDocMountLinkSchema, { ownerKey: 'groupId', ownerNoun: 'group' });
  }

  /** Find all links for a group. */
  async findByGroupId(groupId: string): Promise<GroupDocMountLink[]> {
    return this.findByOwnerId(groupId);
  }

  /**
   * Delete every link for a group (used when a group is deleted).
   * @returns Number of link rows removed
   */
  async deleteByGroupId(groupId: string): Promise<number> {
    return this.safeQuery(
      () => this.deleteMany(this.ownerFilter(groupId)),
      'Error deleting links by group ID',
      { groupId },
      0
    );
  }

  /**
   * Delete every link that points at a mount point (used when a store is
   * deleted). The sibling of {@link deleteByGroupId} on the mount-point axis —
   * without it, deleting a store left its group's additional-store links
   * standing (Bug 9).
   * @returns Number of link rows removed
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      () => this.deleteMany({ mountPointId } as TypedQueryFilter<GroupDocMountLink>),
      'Error deleting group links by mount point ID',
      { mountPointId },
      0
    );
  }
}
