/**
 * MongoDB Projects Repository
 *
 * Handles CRUD operations and queries for Project entities.
 * Each project is stored as a document in the 'projects' MongoDB collection.
 */

import { Project, ProjectInput, ProjectSchema } from '@/lib/schemas/types';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';

export class ProjectsRepository extends MongoBaseRepository<Project> {
  constructor() {
    super('projects', ProjectSchema);
  }

  /**
   * Find a project by ID
   * @param id The project ID
   * @returns Promise<Project | null> The project if found, null otherwise
   */
  async findById(id: string): Promise<Project | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        logger.debug('Project not found', { projectId: id });
        return null;
      }

      return this.validate(result);
    } catch (error) {
      logger.error('Error finding project by ID', {
        projectId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all projects
   * @returns Promise<Project[]> Array of all projects
   */
  async findAll(): Promise<Project[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((project): project is Project => project !== null);
    } catch (error) {
      logger.error('Error finding all projects', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find projects by user ID
   * @param userId The user ID
   * @returns Promise<Project[]> Array of projects belonging to the user
   */
  async findByUserId(userId: string): Promise<Project[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({ userId }).sort({ createdAt: -1 }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((project): project is Project => project !== null);
    } catch (error) {
      logger.error('Error finding projects by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find projects containing a specific character in their roster
   * @param characterId The character ID
   * @returns Promise<Project[]> Array of projects with this character
   */
  async findByCharacterId(characterId: string): Promise<Project[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({
        characterRoster: { $in: [characterId] },
      }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((project): project is Project => project !== null);
    } catch (error) {
      logger.error('Error finding projects by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find multiple projects by their IDs in a single query
   * @param ids Array of project IDs
   * @returns Promise<Project[]> Array of found projects
   */
  async findByIds(ids: string[]): Promise<Project[]> {
    if (ids.length === 0) {
      return [];
    }

    try {
      const collection = await this.getCollection();
      const results = await collection.find({ id: { $in: ids } }).toArray();

      const projects = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((project): project is Project => project !== null);

      logger.debug('Found projects by IDs', { requestedCount: ids.length, foundCount: projects.length });
      return projects;
    } catch (error) {
      logger.error('Error finding projects by IDs', {
        idCount: ids.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new project
   * @param data The project data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Project> The created project with generated id and timestamps
   */
  async create(
    data: Omit<ProjectInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Project> {
    try {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const projectInput = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(projectInput);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.info('Project created', { projectId: id, userId: data.userId, name: data.name });
      return validated;
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
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Project not found for update', { projectId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: Project = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne({ id }, { $set: validated as any });

      return validated;
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
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Project not found for deletion', { projectId: id });
        return false;
      }

      logger.info('Project deleted', { projectId: id });
      return true;
    } catch (error) {
      logger.error('Error deleting project', {
        projectId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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

      const newIds = characterIds.filter(id => !project.characterRoster.includes(id));
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
      project.characterRoster = project.characterRoster.filter(id => id !== characterId);
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
  async setAllowAnyCharacter(projectId: string, allowAnyCharacter: boolean): Promise<Project | null> {
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
      const collection = await this.getCollection();
      const results = await collection.find({ mountPointId }).toArray();

      const projects = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((project): project is Project => project !== null);

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
