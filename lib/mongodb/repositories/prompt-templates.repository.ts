/**
 * MongoDB Prompt Templates Repository
 *
 * Handles CRUD operations for PromptTemplate entities in MongoDB.
 * Provides methods for managing prompt templates including built-in sample prompts.
 * Uses the 'prompt_templates' collection.
 */

import {
  PromptTemplate,
  PromptTemplateSchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { MongoBaseRepository } from './base.repository';
import { loadSamplePrompts } from '@/lib/prompts/sample-prompts-loader';

/**
 * Prompt Templates Repository
 * Manages PromptTemplate entities including built-in sample prompts and user-created templates
 */
export class PromptTemplatesRepository extends MongoBaseRepository<PromptTemplate> {
  private seedingPromise: Promise<void> | null = null;

  constructor() {
    super('prompt_templates', PromptTemplateSchema);
    logger.debug('PromptTemplatesRepository initialized', {
      collection: this.collectionName,
    });
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
    try {
      logger.debug('Checking for sample prompts to seed', {
        collection: this.collectionName,
      });

      const samplePrompts = await loadSamplePrompts();
      if (samplePrompts.length === 0) {
        logger.debug('No sample prompts found to seed');
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
          await collection.insertOne(validated as any);

          logger.info('Sample prompt template seeded', {
            templateId: id,
            name: sample.name,
            modelHint: sample.modelHint,
            category: sample.category,
          });
        } else {
          logger.debug('Sample prompt template already exists', {
            name: sample.name,
          });
        }
      }
    } catch (error) {
      logger.error('Error seeding sample prompts', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - seeding failure shouldn't break the app
    }
  }

  // ============================================================================
  // PROMPT TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * Find a prompt template by ID
   */
  async findById(id: string): Promise<PromptTemplate | null> {
    try {
      logger.debug('Finding prompt template by ID', {
        templateId: id,
        collection: this.collectionName,
      });

      // Ensure built-in templates are seeded
      await this.seedSamplePrompts();

      const collection = await this.getCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        logger.debug('Prompt template not found', { templateId: id });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Prompt template found and validated', { templateId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding prompt template by ID', {
        templateId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all prompt templates
   */
  async findAll(): Promise<PromptTemplate[]> {
    try {
      logger.debug('Finding all prompt templates', { collection: this.collectionName });

      // Ensure built-in templates are seeded
      await this.seedSamplePrompts();

      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();

      logger.debug('Retrieved prompt templates from database', { count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('All prompt templates validated', {
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding all prompt templates', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find prompt templates by user ID (user-created templates only)
   */
  async findByUserId(userId: string): Promise<PromptTemplate[]> {
    try {
      logger.debug('Finding prompt templates by user ID', {
        userId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const docs = await collection.find({ userId }).toArray();

      logger.debug('Retrieved prompt templates for user', {
        userId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('User prompt templates validated', {
        userId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding prompt templates by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all built-in prompt templates
   */
  async findBuiltIn(): Promise<PromptTemplate[]> {
    try {
      logger.debug('Finding built-in prompt templates', {
        collection: this.collectionName,
      });

      // Ensure built-in templates are seeded
      await this.seedSamplePrompts();

      const collection = await this.getCollection();
      const docs = await collection.find({ isBuiltIn: true }).toArray();

      logger.debug('Retrieved built-in prompt templates', { count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('Built-in prompt templates validated', {
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding built-in prompt templates', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all templates available to a user (built-in + user's own templates)
   */
  async findAllForUser(userId: string): Promise<PromptTemplate[]> {
    try {
      logger.debug('Finding all prompt templates for user', {
        userId,
        collection: this.collectionName,
      });

      // Ensure built-in templates are seeded
      await this.seedSamplePrompts();

      const collection = await this.getCollection();
      const docs = await collection.find({
        $or: [
          { isBuiltIn: true },
          { userId },
        ],
      }).toArray();

      logger.debug('Retrieved prompt templates for user', {
        userId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('User available prompt templates validated', {
        userId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding all prompt templates for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find prompt template by name for a specific user
   */
  async findByName(userId: string, name: string): Promise<PromptTemplate | null> {
    try {
      logger.debug('Finding prompt template by name for user', {
        userId,
        name,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ userId, name });

      if (!doc) {
        logger.debug('Prompt template not found by name for user', {
          userId,
          name,
        });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Prompt template found by name for user', {
        userId,
        name,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding prompt template by name', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new prompt template
   */
  async create(
    data: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PromptTemplate> {
    try {
      logger.debug('Creating new prompt template', {
        userId: data.userId,
        name: data.name,
        isBuiltIn: data.isBuiltIn,
        collection: this.collectionName,
      });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const template: PromptTemplate = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(template);

      const collection = await this.getCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('Prompt template created successfully', {
        templateId: id,
        userId: data.userId,
        name: data.name,
        isBuiltIn: data.isBuiltIn,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating prompt template', {
        userId: data.userId,
        name: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a prompt template
   * Note: Built-in templates cannot be updated
   */
  async update(id: string, data: Partial<PromptTemplate>): Promise<PromptTemplate | null> {
    try {
      logger.debug('Updating prompt template', {
        templateId: id,
        collection: this.collectionName,
      });

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

      const now = this.getCurrentTimestamp();
      const updated: PromptTemplate = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        userId: existing.userId, // Preserve userId
        isBuiltIn: existing.isBuiltIn, // Preserve isBuiltIn
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);

      const collection = await this.getCollection();
      const result = await collection.updateOne(
        { id },
        { $set: validated as any }
      );

      logger.info('Prompt template updated successfully', {
        templateId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
    } catch (error) {
      logger.error('Error updating prompt template', {
        templateId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a prompt template
   * Note: Built-in templates cannot be deleted
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting prompt template', {
        templateId: id,
        collection: this.collectionName,
      });

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

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Prompt template not found for deletion', { templateId: id });
        return false;
      }

      logger.info('Prompt template deleted successfully', {
        templateId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting prompt template', {
        templateId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a tag to a prompt template
   */
  async addTag(templateId: string, tagId: string): Promise<PromptTemplate | null> {
    try {
      logger.debug('Adding tag to prompt template', {
        templateId,
        tagId,
        collection: this.collectionName,
      });

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

      if (!template.tags.includes(tagId)) {
        template.tags.push(tagId);
        logger.debug('Tag added to prompt template tags array', {
          templateId,
          tagId,
          totalTags: template.tags.length,
        });
        return await this.update(templateId, { tags: template.tags });
      }

      logger.debug('Tag already exists for prompt template', { templateId, tagId });
      return template;
    } catch (error) {
      logger.error('Error adding tag to prompt template', {
        templateId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a prompt template
   */
  async removeTag(templateId: string, tagId: string): Promise<PromptTemplate | null> {
    try {
      logger.debug('Removing tag from prompt template', {
        templateId,
        tagId,
        collection: this.collectionName,
      });

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

      const initialLength = template.tags.length;
      template.tags = template.tags.filter((id) => id !== tagId);

      if (template.tags.length < initialLength) {
        logger.debug('Tag removed from prompt template tags array', {
          templateId,
          tagId,
          totalTags: template.tags.length,
        });
        return await this.update(templateId, { tags: template.tags });
      }

      logger.debug('Tag not found in prompt template tags', { templateId, tagId });
      return template;
    } catch (error) {
      logger.error('Error removing tag from prompt template', {
        templateId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
