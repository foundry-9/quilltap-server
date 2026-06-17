/**
 * Projects Repository
 *
 * Backend-agnostic repository for Project entities.
 * Works with SQLite through the database abstraction layer.
 *
 * As of the project-store cutover (`cutover-projects-to-store-v1`), a project's
 * substantive content lives in its official document store, not in `projects`
 * columns. The shared {@link AbstractStoreBackedRepository} is the chokepoint
 * that hides that split (overlay on read, route-and-strip on write,
 * provision-on-create). This subclass adds only the character-roster operations
 * and the create-time roster defaults.
 *
 * `userId` is gone — projects are global to the instance (single-user-per-instance).
 */

import { Project, ProjectSchema, PROJECT_STORE_MANAGED_FIELDS } from '@/lib/schemas/types';
import {
  AbstractStoreBackedRepository,
  StoreOverlayBinding,
} from './store-backed.repository';
import { logger } from '@/lib/logger';
import {
  applyProjectStoreOverlay,
  applyProjectStoreOverlayOne,
} from '@/lib/projects/project-store/read-overlay';
import {
  applyProjectStoreWriteOverlay,
  writeProjectStoreManagedFields,
} from '@/lib/projects/project-store/write-overlay';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';

/**
 * Projects Repository
 * Implements CRUD operations for projects with document-store-backed content
 * and character roster management.
 */
export class ProjectsRepository extends AbstractStoreBackedRepository<Project> {
  constructor() {
    super('projects', ProjectSchema);
  }

  protected readonly store: StoreOverlayBinding<Project> = {
    managedFields: PROJECT_STORE_MANAGED_FIELDS,
    entityLabel: 'Project',
    idLogKey: 'projectId',
    applyOverlay: applyProjectStoreOverlay,
    applyOverlayOne: applyProjectStoreOverlayOne,
    applyWriteOverlay: applyProjectStoreWriteOverlay,
    writeManagedFields: writeProjectStoreManagedFields,
    ensureOfficialStore: ensureProjectOfficialStore,
  };

  /** Seed the roster defaults a fresh project needs before its row is written. */
  protected prepareCreateData(
    data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
  ): Omit<Project, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      ...data,
      allowAnyCharacter: data.allowAnyCharacter ?? false,
      characterRoster: data.characterRoster ?? [],
    };
  }

  // ==========================================================================
  // CHARACTER ROSTER OPERATIONS
  //
  // `characterRoster` / `allowAnyCharacter` now live in `properties.json`. The
  // helpers below read the hydrated project (overlay) and write back through
  // `update()` (which routes the change to the store), so they need no special
  // handling beyond `findByCharacterId`, which can no longer filter in SQL.
  // ==========================================================================

  /**
   * Find projects containing a specific character in their roster.
   *
   * `characterRoster` lives in the store now, so this lists all hydrated
   * projects and filters in memory. Project counts are small.
   * @param characterId The character ID
   * @returns Promise<Project[]> Array of projects with this character
   */
  async findByCharacterId(characterId: string): Promise<Project[]> {
    return this.safeQuery(
      async () => {
        const all = await this.findAll();
        const matched = all.filter((p) => p.characterRoster.includes(characterId));
        logger.debug('findByCharacterId: in-memory roster filter', {
          characterId,
          scanned: all.length,
          matched: matched.length,
        });
        return matched;
      },
      'Error finding projects by character ID',
      { characterId },
      []
    );
  }

  /**
   * Add a character to the project roster
   * @param projectId The project ID
   * @param characterId The character ID
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async addToRoster(projectId: string, characterId: string): Promise<Project | null> {
    return this.safeQuery(
      async () => {
        const project = await this.findById(projectId);
        if (!project) {
          logger.warn('Project not found for roster addition', { projectId });
          return null;
        }

        if (!project.characterRoster.includes(characterId)) {
          project.characterRoster.push(characterId);
          return await this.update(projectId, { characterRoster: project.characterRoster });
        }
        return project;
      },
      'Error adding character to project roster',
      { projectId, characterId }
    );
  }

  /**
   * Add multiple characters to the project roster
   * @param projectId The project ID
   * @param characterIds Array of character IDs
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async addManyToRoster(projectId: string, characterIds: string[]): Promise<Project | null> {
    return this.safeQuery(
      async () => {
        const project = await this.findById(projectId);
        if (!project) {
          logger.warn('Project not found for roster addition', { projectId });
          return null;
        }

        const newIds = characterIds.filter((id) => !project.characterRoster.includes(id));
        if (newIds.length > 0) {
          project.characterRoster.push(...newIds);
          return await this.update(projectId, { characterRoster: project.characterRoster });
        }
        return project;
      },
      'Error adding characters to project roster',
      { projectId }
    );
  }

  /**
   * Remove a character from the project roster
   * @param projectId The project ID
   * @param characterId The character ID
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async removeFromRoster(projectId: string, characterId: string): Promise<Project | null> {
    return this.safeQuery(
      async () => {
        const project = await this.findById(projectId);
        if (!project) {
          logger.warn('Project not found for roster removal', { projectId });
          return null;
        }

        const beforeCount = project.characterRoster.length;
        project.characterRoster = project.characterRoster.filter((id) => id !== characterId);
        const afterCount = project.characterRoster.length;

        if (beforeCount !== afterCount) {
          return await this.update(projectId, { characterRoster: project.characterRoster });
        }
        return project;
      },
      'Error removing character from project roster',
      { projectId, characterId }
    );
  }

  /**
   * Check if a character can participate in a project
   * @param projectId The project ID
   * @param characterId The character ID
   * @returns Promise<boolean> True if character can participate
   */
  async canCharacterParticipate(projectId: string, characterId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const project = await this.findById(projectId);
        if (!project) {
          return false;
        }

        // If allowAnyCharacter is true, any character can participate
        if (project.allowAnyCharacter) {
          return true;
        }

        // Otherwise, check if character is in the roster
        return project.characterRoster.includes(characterId);
      },
      'Error checking character participation',
      { projectId, characterId },
      false
    );
  }

  /**
   * Set the allowAnyCharacter flag
   * @param projectId The project ID
   * @param allowAnyCharacter Whether any character can participate
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async setAllowAnyCharacter(
    projectId: string,
    allowAnyCharacter: boolean
  ): Promise<Project | null> {
    return this.safeQuery(
      () => this.update(projectId, { allowAnyCharacter }),
      'Error setting allowAnyCharacter',
      { projectId, allowAnyCharacter }
    );
  }

}
