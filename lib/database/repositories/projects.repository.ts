/**
 * Projects Repository
 *
 * Backend-agnostic repository for Project entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 *
 * Handles CRUD operations and queries for Project entities with support for
 * character roster management and mount point operations.
 */

import { Project, ProjectSchema } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';
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
    try {
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
    } catch (error) {
      logger.error('Error creating project', {
        userId: data.userId,
        name: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a project
   * @param id The project ID
   * @param data Partial project data to update
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async update(id: string, data: Partial<Project>): Promise<Project | null> {
    try {
      const project = await this._update(id, data);

      if (project) {
        logger.info('Project updated', { projectId: id });
      }

      return project;
    } catch (error) {
      logger.error('Error updating project', {
        projectId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a project
   * @param id The project ID
   * @returns Promise<boolean> True if project was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Project deleted', { projectId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting project', {
        projectId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find projects containing a specific character in their roster
   * @param characterId The character ID
   * @returns Promise<Project[]> Array of projects with this character
   */
  async findByCharacterId(characterId: string): Promise<Project[]> {
    try {
      const projects = await this.findByFilter({
        characterRoster: { $in: [characterId] },
      } as QueryFilter);

      logger.debug('Found projects by character ID', {
        characterId,
        count: projects.length,
      });

      return projects;
    } catch (error) {
      logger.error('Error finding projects by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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
    logger.debug('Adding character to project roster', { projectId, characterId });
    try {
      const project = await this.findById(projectId);
      if (!project) {
        logger.warn('Project not found for roster addition', { projectId });
        return null;
      }

      if (!project.characterRoster.includes(characterId)) {
        project.characterRoster.push(characterId);
        logger.debug('Character added to project roster', { projectId, characterId });
        return await this.update(projectId, { characterRoster: project.characterRoster });
      }

      logger.debug('Character already in project roster', { projectId, characterId });
      return project;
    } catch (error) {
      logger.error('Error adding character to project roster', {
        projectId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add multiple characters to the project roster
   * @param projectId The project ID
   * @param characterIds Array of character IDs
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async addManyToRoster(projectId: string, characterIds: string[]): Promise<Project | null> {
    logger.debug('Adding characters to project roster', { projectId, count: characterIds.length });
    try {
      const project = await this.findById(projectId);
      if (!project) {
        logger.warn('Project not found for roster addition', { projectId });
        return null;
      }

      const newIds = characterIds.filter((id) => !project.characterRoster.includes(id));
      if (newIds.length > 0) {
        project.characterRoster.push(...newIds);
        logger.debug('Characters added to project roster', { projectId, addedCount: newIds.length });
        return await this.update(projectId, { characterRoster: project.characterRoster });
      }

      logger.debug('All characters already in project roster', { projectId });
      return project;
    } catch (error) {
      logger.error('Error adding characters to project roster', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a character from the project roster
   * @param projectId The project ID
   * @param characterId The character ID
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async removeFromRoster(projectId: string, characterId: string): Promise<Project | null> {
    logger.debug('Removing character from project roster', { projectId, characterId });
    try {
      const project = await this.findById(projectId);
      if (!project) {
        logger.warn('Project not found for roster removal', { projectId });
        return null;
      }

      const beforeCount = project.characterRoster.length;
      project.characterRoster = project.characterRoster.filter((id) => id !== characterId);
      const afterCount = project.characterRoster.length;

      if (beforeCount !== afterCount) {
        logger.debug('Character removed from project roster', { projectId, characterId });
        return await this.update(projectId, { characterRoster: project.characterRoster });
      }

      logger.debug('Character not found in project roster', { projectId, characterId });
      return project;
    } catch (error) {
      logger.error('Error removing character from project roster', {
        projectId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if a character can participate in a project
   * @param projectId The project ID
   * @param characterId The character ID
   * @returns Promise<boolean> True if character can participate
   */
  async canCharacterParticipate(projectId: string, characterId: string): Promise<boolean> {
    try {
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
    } catch (error) {
      logger.error('Error checking character participation', {
        projectId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
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
    logger.debug('Setting allowAnyCharacter for project', { projectId, allowAnyCharacter });
    try {
      return await this.update(projectId, { allowAnyCharacter });
    } catch (error) {
      logger.error('Error setting allowAnyCharacter', {
        projectId,
        allowAnyCharacter,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    logger.debug('Setting mount point for project', { projectId, mountPointId });
    try {
      return await this.update(projectId, { mountPointId });
    } catch (error) {
      logger.error('Error setting mount point for project', {
        projectId,
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find projects using a specific mount point
   * @param mountPointId The mount point ID
   * @returns Promise<Project[]> Array of projects using this mount point
   */
  async findByMountPointId(mountPointId: string): Promise<Project[]> {
    try {
      const projects = await this.findByFilter({ mountPointId } as QueryFilter);

      logger.debug('Found projects by mount point', { mountPointId, count: projects.length });

      return projects;
    } catch (error) {
      logger.error('Error finding projects by mount point', {
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
