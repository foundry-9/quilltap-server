/**
 * Projects Repository
 *
 * Backend-agnostic repository for Project entities.
 * Works with SQLite through the database abstraction layer.
 *
 * As of the project-store cutover (`cutover-projects-to-store-v1`), a project's
 * substantive content lives in its official document store, not in `projects`
 * columns. This repository is the chokepoint that hides that split:
 *
 *   - Every read overlays the store (`applyProjectStoreOverlay[One]`) so callers
 *     see the fully-hydrated `Project` they always did.
 *   - Every write routes store-resident fields to the store
 *     (`applyProjectStoreWriteOverlay`) and strips them (`PROJECT_STORE_MANAGED_FIELDS`)
 *     from the slim DB row.
 *   - `create()` provisions and populates the official store before returning,
 *     so a freshly-created project is never storeless.
 *
 * `userId` is gone — projects are global to the instance (single-user-per-instance).
 */

import { Project, ProjectSchema, PROJECT_STORE_MANAGED_FIELDS } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter, UpdateSpec } from '../interfaces';
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
export class ProjectsRepository extends AbstractBaseRepository<Project> {
  constructor() {
    super('projects', ProjectSchema);
  }

  // ==========================================================================
  // READS (document-store overlay applied)
  // ==========================================================================

  /**
   * Find a project by ID, hydrated from its document store. Throws
   * `ProjectStoreUnavailableError` if the store is missing/unreadable — the
   * caller asked for this specific project, so fail loudly.
   */
  async findById(id: string): Promise<Project | null> {
    const raw = await this._findById(id);
    return applyProjectStoreOverlayOne(raw);
  }

  /**
   * Find a project by ID **without applying the document-store overlay**. The
   * returned Project has empty/default values for every store-resident field
   * (description, instructions, state, and the properties bag) once the cutover
   * migration has dropped the DB columns — those fields live exclusively in the
   * project's official document store.
   *
   * **Almost no caller wants this.** Use {@link findById} for any normal read.
   * The legitimate exceptions are the overlay's own bootstrap (it must read the
   * row before it can apply itself) and startup migrations/backfills that
   * operate on the row directly (e.g. `backfill-project-stores`).
   */
  async findByIdRaw(id: string): Promise<Project | null> {
    return this._findById(id);
  }

  /**
   * Find all projects, each hydrated from its document store. A project whose
   * store is unavailable is logged at `error` and dropped from the result so
   * one bad row can't take down the whole list.
   */
  async findAll(): Promise<Project[]> {
    const raw = await this._findAll();
    return applyProjectStoreOverlay(raw);
  }

  /**
   * Find all projects **without applying the document-store overlay**. See the
   * warnings on {@link findByIdRaw}. Reserved for startup migrations/backfills
   * and the overlay's own bootstrap.
   */
  async findAllRaw(): Promise<Project[]> {
    return this._findAll();
  }

  /**
   * Find projects by IDs, hydrated from their document stores.
   */
  async findByIds(ids: string[]): Promise<Project[]> {
    if (ids.length === 0) return [];
    const raw = await this.findByFilter({ id: { $in: ids } } as TypedQueryFilter<Project>);
    return applyProjectStoreOverlay(raw);
  }

  // ==========================================================================
  // CREATE / UPDATE / DELETE
  // ==========================================================================

  /**
   * Create a new project, provision its official document store, and populate
   * the store files from the create payload before returning. Fails hard if the
   * store cannot be provisioned — a storeless project would throw on every read.
   *
   * @param data The project data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Project> The created, fully-hydrated project
   */
  async create(
    data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Project> {
    return this.safeQuery(
      async () => {
        // Drop any incoming officialMountPointId — create always provisions a
        // fresh store. Importers carrying a source pointer shouldn't reuse it.
        const projectData = {
          ...data,
          allowAnyCharacter: data.allowAnyCharacter ?? false,
          characterRoster: data.characterRoster ?? [],
          officialMountPointId: null,
        } as Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;

        // _create validates the full project (store fields in memory) and writes
        // only the slim row.
        const created = await this._create(projectData, options);

        // Provision the official store, then write the four overlay files from
        // the in-memory create payload (which carries description/instructions/
        // state/properties). ensureProjectOfficialStore sets officialMountPointId
        // on the row.
        const ensured = await ensureProjectOfficialStore(created.id, created.name);
        if (!ensured) {
          throw new Error(
            `Failed to provision official document store for project ${created.id}; ` +
              `refusing to return a storeless project.`,
          );
        }
        await writeProjectStoreManagedFields(ensured.mountPointId, {
          ...created,
          officialMountPointId: ensured.mountPointId,
        });

        logger.info('Project created', {
          projectId: created.id,
          name: created.name,
          officialMountPointId: ensured.mountPointId,
        });

        // Reload through the overlay so the returned project reflects the
        // store-backed state, including the freshly-set mount pointer.
        const finalProject = await this.findById(created.id);
        if (!finalProject) {
          throw new Error(`Project ${created.id} disappeared immediately after creation`);
        }
        return finalProject;
      },
      'Error creating project',
      { name: data.name }
    );
  }

  /**
   * Update a project.
   *
   * Store-resident fields (description, instructions, state, and the properties
   * bag) in `data` are routed to the project's official store via
   * {@link applyProjectStoreWriteOverlay}; the remaining DB-only fields
   * (`name`, `officialMountPointId`) are written through `_update`. The returned
   * project is overlaid so callers see the store-backed view, exactly as
   * {@link findById} would.
   *
   * @param id The project ID
   * @param data Partial project data to update
   * @returns Promise<Project | null> The updated project if found, null otherwise
   */
  async update(id: string, data: Partial<Project>): Promise<Project | null> {
    return this.safeQuery(
      async () => {
        const dbPatch = await applyProjectStoreWriteOverlay(id, data);
        const hasDbWork = Object.keys(dbPatch).length > 0;
        const result = hasDbWork ? await this._update(id, dbPatch) : await this._findById(id);
        if (result) {
          logger.info('Project updated', { projectId: id });
        }
        return applyProjectStoreOverlayOne(result);
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
   * Store-aware override of the base `_create`. Strips store-resident keys
   * before INSERT so callers that pass e.g. `description` or `state` to
   * `create()` don't blow up with "no such column" — those fields belong in the
   * project's document store, not the DB row.
   */
  protected async _create(
    data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Project> {
    return this.safeQuery(async () => {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;
      const updatedAt = options?.updatedAt || now;

      const entityInput = {
        ...data,
        id,
        createdAt,
        updatedAt,
      };

      const validated = this.validate(entityInput) as Project;

      const dbRow = { ...validated } as Record<string, unknown>;
      for (const f of PROJECT_STORE_MANAGED_FIELDS) {
        delete dbRow[f as string];
      }

      const collection = await this.getCollection();
      await collection.insertOne(dbRow as Project);

      logger.info('Entity created', { collection: 'projects', id });

      return validated;
    }, 'Error creating project entity');
  }

  /**
   * Store-aware override of the base `_update`. The cutover dropped DB columns
   * for store-resident fields — they live in the project's document store now.
   * Read raw, merge, validate, then strip store-resident keys before writing as
   * a defensive backstop so `$set` never references a dropped column.
   */
  protected async _update(id: string, data: Partial<Project>): Promise<Project | null> {
    return this.safeQuery(async () => {
      const existing = await this.findByIdRaw(id);
      if (!existing) {
        logger.warn('Entity not found for update', { collection: 'projects', id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const merged = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: ('updatedAt' in data)
          ? (data as Record<string, unknown>).updatedAt as string
          : now,
      } as Project;

      const validated = this.validate(merged) as Project;

      const dbRow = { ...validated } as Record<string, unknown>;
      for (const f of PROJECT_STORE_MANAGED_FIELDS) {
        delete dbRow[f as string];
      }

      const collection = await this.getCollection();
      await collection.updateOne(
        { id } as TypedQueryFilter<Project>,
        { $set: dbRow } as UpdateSpec<Project>
      );

      return validated;
    }, 'Error updating project entity', { id });
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
