/**
 * The project document-store overlay instance.
 *
 * Specializes the generic {@link createDocumentStoreOverlay} engine with the
 * project schema, paths, and typed unavailability error. `read-overlay.ts` and
 * `write-overlay.ts` re-export the bound operations under their historical
 * names so existing import paths keep working.
 *
 * @module projects/project-store/overlay
 */

import { getRepositories } from '@/lib/repositories/factory';
import { createDocumentStoreOverlay } from '@/lib/database/document-store-overlay';
import type { Project, ProjectProperties } from '@/lib/schemas/project.types';
import {
  ProjectPropertiesSchema,
  PROJECT_STORE_MANAGED_FIELDS,
} from '@/lib/schemas/project.types';
import {
  PROJECT_SINGLE_FILE_OVERLAY_PATHS,
  PROJECT_PROPERTIES_JSON_PATH,
  PROJECT_DESCRIPTION_MD_PATH,
  PROJECT_INSTRUCTIONS_MD_PATH,
  PROJECT_STATE_JSON_PATH,
  ProjectStoreUnavailableError,
} from './schema';

const overlay = createDocumentStoreOverlay<Project, ProjectProperties>({
  entityLabel: 'project',
  entityLabelCapitalized: 'Project',
  idLogKey: 'projectId',
  propertyKeys: Object.keys(ProjectPropertiesSchema.shape),
  parseProperties: (value) => ProjectPropertiesSchema.parse(value),
  managedFields: PROJECT_STORE_MANAGED_FIELDS,
  paths: {
    properties: PROJECT_PROPERTIES_JSON_PATH,
    description: PROJECT_DESCRIPTION_MD_PATH,
    instructions: PROJECT_INSTRUCTIONS_MD_PATH,
    state: PROJECT_STATE_JSON_PATH,
    all: PROJECT_SINGLE_FILE_OVERLAY_PATHS,
  },
  createUnavailableError: (id, mountPointId, detail) =>
    new ProjectStoreUnavailableError(id, mountPointId, detail),
  isUnavailableError: (err) => err instanceof ProjectStoreUnavailableError,
  findRawById: (id) => getRepositories().projects.findByIdRaw(id),
});

export const applyProjectStoreOverlay = overlay.applyOverlay;
export const applyProjectStoreOverlayOne = overlay.applyOverlayOne;
export const readProjectStoreProperties = overlay.readProperties;
export const writeProjectStoreManagedFields = overlay.writeManagedFields;
export const applyProjectStoreWriteOverlay = overlay.applyWriteOverlay;
