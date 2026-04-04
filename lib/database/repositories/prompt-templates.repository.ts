/**
 * Prompt Templates Repository
 *
 * Backend-agnostic repository for PromptTemplate entities.
 * Works with SQLite through the database abstraction layer.
 * Manages PromptTemplate entities including built-in sample prompts and user-created templates.
 */

import { logger } from '@/lib/logger';
import { PromptTemplate, PromptTemplateSchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';
import { systemPromptRegistry } from '@/lib/plugins/system-prompt-registry';
import { loadSamplePrompts } from '@/lib/prompts/sample-prompts-loader';

/**
 * Prompt Templates Repository
 * Implements CRUD operations for prompt templates including built-in sample prompts.
 * Uses AbstractBaseRepository since PromptTemplate has optional userId (null for built-in).
 */
export class PromptTemplatesRepository extends AbstractBaseRepository<PromptTemplate> {
  private seedingPromise: Promise<void> | null = null;

  constructor() {
    super('prompt_templates', PromptTemplateSchema);
  }

  // ============================================================================
  // SEEDING OPERATIONS
  // ============================================================================

  /**
   * Seed built-in sample prompts from prompts/ directory if they don't exist
   * Called automatically on first access
   */
  async seedSamplePrompts(): Promise<void> {
    if (this.seedingPromise) {
      return this.seedingPromise;
    }

    this.seedingPromise = this._doSeedSamplePrompts();
    try {
      await this.seedingPromise;
    } finally {
      this.seedingPromise = null;
    }
  }

  private async _doSeedSamplePrompts(): Promise<void> {
    return this.safeQuery(
      async () => {
        // Primary source: system prompt plugin registry
        const registryPrompts = systemPromptRegistry.isInitialized()
          ? systemPromptRegistry.getAll()
          : [];

        if (registryPrompts.length > 0) {
          const collection = await this.getCollection();

          for (const prompt of registryPrompts) {
            // Check if prompt already exists by name and isBuiltIn
            const existing = await collection.findOne({
              name: prompt.name,
              isBuiltIn: true,
            });

            if (!existing) {
              const id = this.generateId();
              const now = this.getCurrentTimestamp();

              const newTemplate: PromptTemplate = {
                id,
                userId: null,
                name: prompt.name,
                content: prompt.content,
                description: `${prompt.category} prompt optimized for ${prompt.modelHint} models`,
                isBuiltIn: true,
                category: prompt.category,
                modelHint: prompt.modelHint,
                tags: [],
                createdAt: now,
                updatedAt: now,
              };

              const validated = this.validate(newTemplate);
              await collection.insertOne(validated);

              logger.info('Sample prompt template seeded from plugin', {
                templateId: id,
                name: prompt.name,
                promptId: prompt.id,
                modelHint: prompt.modelHint,
                category: prompt.category,
              });
            }
          }
          return;
        }

        // Fallback: load from filesystem (legacy prompts/ directory)
        const samplePrompts = await loadSamplePrompts();
        if (samplePrompts.length === 0) {
          return;
        }

        const collection = await this.getCollection();

        for (const sample of samplePrompts) {
          // Check if prompt already exists by name and isBuiltIn
          const existing = await collection.findOne({
            name: sample.name,
            isBuiltIn: true,
          });

          if (!existing) {
            const id = this.generateId();
            const now = this.getCurrentTimestamp();

            const newTemplate: PromptTemplate = {
              id,
              userId: null,
              name: sample.name,
              content: sample.content,
              description: `${sample.category} prompt optimized for ${sample.modelHint} models`,
              isBuiltIn: true,
              category: sample.category,
              modelHint: sample.modelHint,
              tags: [],
              createdAt: now,
              updatedAt: now,
            };

            const validated = this.validate(newTemplate);
            await collection.insertOne(validated);

            logger.info('Sample prompt template seeded from filesystem', {
              templateId: id,
              name: sample.name,
              modelHint: sample.modelHint,
              category: sample.category,
            });
          }
        }
      },
      'Error seeding sample prompts',
      {},
      undefined
    );
  }

  // ============================================================================
  // PROMPT TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * Find a prompt template by ID
   */
  async findById(id: string): Promise<PromptTemplate | null> {
    return this.safeQuery(
      async () => {
        // Ensure built-in templates are seeded
        await this.seedSamplePrompts();

        return this._findById(id);
      },
      'Error finding prompt template by ID',
      { templateId: id },
      null
    );
  }

  /**
   * Find all prompt templates
   */
  async findAll(): Promise<PromptTemplate[]> {
    return this.safeQuery(
      async () => {
        // Ensure built-in templates are seeded
        await this.seedSamplePrompts();

        const templates = await this._findAll();
        return templates;
      },
      'Error finding all prompt templates',
      {},
      []
    );
  }

  /**
   * Find prompt templates by user ID (user-created templates only)
   */
  async findByUserId(userId: string): Promise<PromptTemplate[]> {
    return this.safeQuery(
      () => this.findByFilter({ userId }),
      'Error finding prompt templates by user ID',
      { userId },
      []
    );
  }

  /**
   * Find all built-in prompt templates
   */
  async findBuiltIn(): Promise<PromptTemplate[]> {
    return this.safeQuery(
      async () => {
        // Ensure built-in templates are seeded
        await this.seedSamplePrompts();

        const templates = await this.findByFilter({ isBuiltIn: true });
        return templates;
      },
      'Error finding built-in prompt templates',
      {},
      []
    );
  }

  /**
   * Find all templates available to a user (built-in + user's own templates)
   */
  async findAllForUser(userId: string): Promise<PromptTemplate[]> {
    return this.safeQuery(
      async () => {
        // Ensure built-in templates are seeded
        await this.seedSamplePrompts();

        const templates = await this.findByFilter({
          $or: [
            { isBuiltIn: true },
            { userId },
          ],
        } as TypedQueryFilter<PromptTemplate>);
        return templates;
      },
      'Error finding all prompt templates for user',
      { userId },
      []
    );
  }

  /**
   * Find prompt template by name for a specific user
   */
  async findByName(userId: string, name: string): Promise<PromptTemplate | null> {
    return this.safeQuery(
      () => this.findOneByFilter({ userId, name }),
      'Error finding prompt template by name',
      { userId, name },
      null
    );
  }

  /**
   * Create a new prompt template
   * @param data The template data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<PromptTemplate> {
    return this.safeQuery(
      async () => {
        const template = await this._create(data, options);

        logger.info('Prompt template created successfully', {
          templateId: template.id,
          userId: data.userId,
          name: data.name,
          isBuiltIn: data.isBuiltIn,
        });

        return template;
      },
      'Error creating prompt template',
      { userId: data.userId, name: data.name }
    );
  }

  /**
   * Update a prompt template
   * Note: Built-in templates cannot be updated
   */
  async update(id: string, data: Partial<PromptTemplate>): Promise<PromptTemplate | null> {
    return this.safeQuery(
      async () => {
        const existing = await this.findById(id);
        if (!existing) {
          logger.warn('Prompt template not found for update', { templateId: id });
          return null;
        }

        // Prevent updating built-in templates
        if (existing.isBuiltIn) {
          logger.warn('Cannot update built-in prompt template', { templateId: id });
          return null;
        }

        const updated = await this._update(id, data);

        if (updated) {
          logger.info('Prompt template updated successfully', {
            templateId: id,
          });
        }

        return updated;
      },
      'Error updating prompt template',
      { templateId: id }
    );
  }

  /**
   * Delete a prompt template
   * Note: Built-in templates cannot be deleted
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const existing = await this.findById(id);
        if (!existing) {
          logger.warn('Prompt template not found for deletion', { templateId: id });
          return false;
        }

        // Prevent deleting built-in templates
        if (existing.isBuiltIn) {
          logger.warn('Cannot delete built-in prompt template', { templateId: id });
          return false;
        }

        const result = await this._delete(id);

        if (result) {
          logger.info('Prompt template deleted successfully', {
            templateId: id,
          });
        }

        return result;
      },
      'Error deleting prompt template',
      { templateId: id }
    );
  }

  /**
   * Add a tag to a prompt template
   * Note: Built-in templates cannot be tagged
   */
  async addTag(templateId: string, tagId: string): Promise<PromptTemplate | null> {
    return this.safeQuery(
      async () => {
        const template = await this.findById(templateId);
        if (!template) {
          logger.warn('Prompt template not found for tag addition', { templateId });
          return null;
        }

        // Prevent modifying built-in templates
        if (template.isBuiltIn) {
          logger.warn('Cannot add tag to built-in prompt template', { templateId });
          return null;
        }

        // Add tag if not already present
        if (!template.tags.includes(tagId)) {
          const updatedTags = [...template.tags, tagId];
          return this.update(templateId, { tags: updatedTags } as Partial<PromptTemplate>);
        }
        return template;
      },
      'Error adding tag to prompt template',
      { templateId, tagId }
    );
  }

  /**
   * Remove a tag from a prompt template
   * Note: Built-in templates cannot be modified
   */
  async removeTag(templateId: string, tagId: string): Promise<PromptTemplate | null> {
    return this.safeQuery(
      async () => {
        const template = await this.findById(templateId);
        if (!template) {
          logger.warn('Prompt template not found for tag removal', { templateId });
          return null;
        }

        // Prevent modifying built-in templates
        if (template.isBuiltIn) {
          logger.warn('Cannot remove tag from built-in prompt template', { templateId });
          return null;
        }

        // Remove tag if present
        const updatedTags = template.tags.filter((id) => id !== tagId);
        if (updatedTags.length !== template.tags.length) {
          return this.update(templateId, { tags: updatedTags } as Partial<PromptTemplate>);
        }
        return template;
      },
      'Error removing tag from prompt template',
      { templateId, tagId }
    );
  }
}
