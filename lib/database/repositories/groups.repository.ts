/**
 * Groups Repository
 *
 * Backend-agnostic repository for Group entities.
 * Works with SQLite through the database abstraction layer.
 *
 * A "Group" is a cross-section of *characters* (parallel to how a Project is a
 * cross-section of files/chats). Like projects, a group's substantive content
 * lives in its official document store, not in `groups` columns. The shared
 * {@link AbstractStoreBackedRepository} is the chokepoint that hides that split
 * (overlay on read, route-and-strip on write, provision-on-create).
 *
 * Membership (characters ↔ groups) and *additional linked* stores live in the
 * mount-index DB via `GroupCharacterMembersRepository` and
 * `GroupDocMountLinksRepository`, not on the group row.
 */

import { Group, GroupSchema, GROUP_STORE_MANAGED_FIELDS } from '@/lib/schemas/types';
import {
  AbstractStoreBackedRepository,
  StoreOverlayBinding,
} from './store-backed.repository';
import {
  applyGroupStoreOverlay,
  applyGroupStoreOverlayOne,
} from '@/lib/groups/group-store/read-overlay';
import {
  applyGroupStoreWriteOverlay,
  writeGroupStoreManagedFields,
} from '@/lib/groups/group-store/write-overlay';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';

/**
 * Groups Repository
 * Implements CRUD operations for groups with document-store-backed content.
 */
export class GroupsRepository extends AbstractStoreBackedRepository<Group> {
  constructor() {
    super('groups', GroupSchema);
  }

  protected readonly store: StoreOverlayBinding<Group> = {
    managedFields: GROUP_STORE_MANAGED_FIELDS,
    entityLabel: 'Group',
    idLogKey: 'groupId',
    applyOverlay: applyGroupStoreOverlay,
    applyOverlayOne: applyGroupStoreOverlayOne,
    applyWriteOverlay: applyGroupStoreWriteOverlay,
    writeManagedFields: writeGroupStoreManagedFields,
    ensureOfficialStore: ensureGroupOfficialStore,
  };
}
