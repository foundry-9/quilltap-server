/**
 * Projects Repository
 *
 * Backend-agnostic repository for Project entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations and queries for Project entities with support for
 * character roster management and mount point operations.
 */

import { Project, ProjectSchema } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';

/**
 * Projects Repository
 * Implements CRUD operations for projects with user-scoping, character roster management,
 * and mount point operations.
 */
export class ProjectsRepository extends UserOwnedBaseRepository<Project> {
  constructor() {
    super('projects', ProjectSchema);
  }

  /**
   * Find a project by ID
   * @param id The project ID
   * @returns Promise<Project | null> The project if found, null otherwise
   */
  async findById(id: string): Promise<Project | null> {
    return this._findById(id);
  }

  /**
   * Find all projects
   * @returns Promise<Project[]> Array of all projects
   */
  async findAll(): Promise<Project[]> {
    return this._findAll();
  }

  /**
   * Create a new project
   * @param data The project data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Project> The created project with generated id and timestamps
   */
  async create(
    data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Project> {
    return this.safeQuery(
      async () => {
        // Set defaults for optional fields
        const projectData = {
          ...data,
          allowAnyCharacter: data.allowAnyCharacter ?? false,
          characterRoster: data.characterRoster ?? [],
        };

        const project = await this._create(projectData, options);

        logger.info('Project created', {
          projectId: project.id,
          userId: project.userId,
          name: project.name,
        });

        return project;
      },
      'Error creating project',
      { userId: data.userId, name: data.name }
    );
  }

  /**
   * Update a project
   * @param id The project ID
   * @param data Partial project data to update
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async update(id: string, data: Partial<Project>): Promise<Project | null> {
    return this.safeQuery(
      async () => {
        const project = await this._update(id, data);

        if (project) {
          logger.info('Project updated', { projectId: id });
        }

        return project;
      },
      'Error updating project',
      { projectId: id }
    );
  }

  /**
   * Delete a project
   * @param id The project ID
   * @returns Promise<boolean> True if project was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Project deleted', { projectId: id });
        }

        return result;
      },
      'Error deleting project',
      { projectId: id }
    );
  }

  /**
   * Find projects containing a specific character in their roster
   * @param characterId The character ID
   * @returns Promise<Project[]> Array of projects with this character
   */
  async findByCharacterId(characterId: string): Promise<Project[]> {
    return this.safeQuery(
      () => this.findByFilter({
        characterRoster: { $in: [characterId] },
      } as TypedQueryFilter<Project>),
      'Error finding projects by character ID',
      { characterId },
      []
    );
  }

  // ============================================================================
  // CHARACTER ROSTER OPERATIONS
  // ============================================================================

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

  // ============================================================================
  // MOUNT POINT OPERATIONS
  // ============================================================================

  /**
   * Set the mount point for a project
   * @param projectId The project ID
   * @param mountPointId The mount point ID (null to clear)
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async setMountPoint(projectId: string, mountPointId: string | null): Promise<Project | null> {
    return this.safeQuery(
      () => this.update(projectId, { mountPointId }),
      'Error setting mount point for project',
      { projectId, mountPointId }
    );
  }

  /**
   * Find projects using a specific mount point
   * @param mountPointId The mount point ID
   * @returns Promise<Project[]> Array of projects using this mount point
   */
  async findByMountPointId(mountPointId: string): Promise<Project[]> {
    return this.safeQuery(
      () => this.findByFilter({ mountPointId }),
      'Error finding projects by mount point',
      { mountPointId },
      []
    );
  }
}
