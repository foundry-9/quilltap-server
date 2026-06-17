/**
 * The group document-store overlay instance.
 *
 * Specializes the generic {@link createDocumentStoreOverlay} engine with the
 * group schema, paths, and typed unavailability error. `read-overlay.ts` and
 * `write-overlay.ts` re-export the bound operations under their historical
 * names so existing import paths keep working.
 *
 * @module groups/group-store/overlay
 */

import { getRepositories } from '@/lib/repositories/factory';
import { createDocumentStoreOverlay } from '@/lib/database/document-store-overlay';
import type { Group, GroupProperties } from '@/lib/schemas/group.types';
import {
  GroupPropertiesSchema,
  GROUP_STORE_MANAGED_FIELDS,
} from '@/lib/schemas/group.types';
import {
  GROUP_SINGLE_FILE_OVERLAY_PATHS,
  GROUP_PROPERTIES_JSON_PATH,
  GROUP_DESCRIPTION_MD_PATH,
  GROUP_INSTRUCTIONS_MD_PATH,
  GROUP_STATE_JSON_PATH,
  GroupStoreUnavailableError,
} from './schema';

const overlay = createDocumentStoreOverlay<Group, GroupProperties>({
  entityLabel: 'group',
  entityLabelCapitalized: 'Group',
  idLogKey: 'groupId',
  propertyKeys: Object.keys(GroupPropertiesSchema.shape),
  parseProperties: (value) => GroupPropertiesSchema.parse(value),
  managedFields: GROUP_STORE_MANAGED_FIELDS,
  paths: {
    properties: GROUP_PROPERTIES_JSON_PATH,
    description: GROUP_DESCRIPTION_MD_PATH,
    instructions: GROUP_INSTRUCTIONS_MD_PATH,
    state: GROUP_STATE_JSON_PATH,
    all: GROUP_SINGLE_FILE_OVERLAY_PATHS,
  },
  createUnavailableError: (id, mountPointId, detail) =>
    new GroupStoreUnavailableError(id, mountPointId, detail),
  isUnavailableError: (err) => err instanceof GroupStoreUnavailableError,
  findRawById: (id) => getRepositories().groups.findByIdRaw(id),
});

export const applyGroupStoreOverlay = overlay.applyOverlay;
export const applyGroupStoreOverlayOne = overlay.applyOverlayOne;
export const readGroupStoreProperties = overlay.readProperties;
export const writeGroupStoreManagedFields = overlay.writeManagedFields;
export const applyGroupStoreWriteOverlay = overlay.applyWriteOverlay;
