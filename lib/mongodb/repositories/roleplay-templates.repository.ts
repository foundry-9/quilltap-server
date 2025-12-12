/**
 * MongoDB Roleplay Templates Repository
 *
 * Handles CRUD operations for RoleplayTemplate entities in MongoDB.
 * Provides methods for managing roleplay templates including built-in templates.
 * Uses the 'roleplay_templates' collection.
 */

import { Collection } from 'mongodb';
import {
  RoleplayTemplate,
  RoleplayTemplateSchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { MongoBaseRepository } from './base.repository';

/**
 * Built-in roleplay templates that are seeded on first access
 */
const BUILT_IN_TEMPLATES: Omit<RoleplayTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
  // Standard is listed first as the default/recommended option
  {
    userId: null,
    name: 'Standard',
    description: 'Traditional roleplay formatting with *actions* in asterisks and "dialogue" in quotes.',
    systemPrompt: `[SYSTEM INSTRUCTION: STANDARD ROLEPLAY FORMATTING]
You must adhere to the following standard roleplay syntax for all outputs.

1. ACTION & NARRATION: Enclose all physical movements, sensory details, and narration in ASTERISKS *.
   - Example: *I sighed heavily, wiping the rain from my eyes.*
   - Example: *She drew her sword, the steel glinting in the firelight.*

2. SPOKEN DIALOGUE: Enclose all spoken words in DOUBLE QUOTES ".
   - Example: "I don't think that's a good idea, Captain."

3. OUT-OF-CHARACTER (OOC): Enclose meta-comments, questions, or clarifications in PARENTHESES ( ) or DOUBLE PARENTHESES (( )).
   - Example: ((Should we skip to the next morning?))

4. EMPHASIS: Use Markdown bold (**text**) for vocal stress within dialogue. Do NOT use italics for emphasis inside dialogue to avoid confusion with actions.
   - Example: "I said **stop** moving!"

5. STRICT COMPLIANCE: Ensure a clear visual separation between actions (* *) and speech (" ").`,
    isBuiltIn: true,
    tags: [],
  },
  {
    userId: null,
    name: 'Quilltap RP',
    description: 'Custom formatting protocol with dialogue as bare text, actions in [brackets], thoughts in {braces}, and OOC with >> prefix.',
    systemPrompt: `[SYSTEM INSTRUCTION: INTERACTION FORMATTING PROTOCOL]
You must adhere to the following custom syntax for all outputs. Do NOT use standard roleplay formatting.

1. SPOKEN DIALOGUE: Write as bare text. Do NOT use quotation marks.
   - Example: Put the gun down, John.
   - Markdown Italics (*text*) denote VOCAL EMPHASIS only, never action.

2. ACTION & NARRATION: Enclose all physical movements, facial expressions, and environmental descriptions in SQUARE BRACKETS [ ].
   - Example: [I lean back in the chair, crossing my arms.]

3. INTERNAL MONOLOGUE: Enclose private thoughts and feelings in CURLY BRACES { }.
   - Example: {He's lying to me. I can feel it.}

4. META/OOC: Any Out-of-Character comments or instructions must start with ">> ".
   - Example: >> The user is simulating a high-gravity environment now.

5. STRICT COMPLIANCE: You must mirror this formatting in your responses. Never use asterisks for actions.`,
    isBuiltIn: true,
    tags: [],
  },
];

/**
 * Roleplay Templates Repository
 * Manages RoleplayTemplate entities including built-in and user-created templates
 */
export class RoleplayTemplatesRepository extends MongoBaseRepository<RoleplayTemplate> {
  private seedingPromise: Promise<void> | null = null;

  constructor() {
    super('roleplay_templates', RoleplayTemplateSchema);
    logger.debug('RoleplayTemplatesRepository initialized', {
      collection: this.collectionName,
    });
  }

  // ============================================================================
  // SEEDING OPERATIONS
  // ============================================================================

  /**
   * Seed built-in templates if they don't exist
   * Called automatically on first access to ensure built-in templates are available
   */
  async seedBuiltInTemplates(): Promise<void> {
    // Use a promise to prevent concurrent seeding
    if (this.seedingPromise) {
      return this.seedingPromise;
    }

    this.seedingPromise = this._doSeedBuiltInTemplates();
    try {
      await this.seedingPromise;
    } finally {
      this.seedingPromise = null;
    }
  }

  private async _doSeedBuiltInTemplates(): Promise<void> {
    try {
      logger.debug('Checking for built-in roleplay templates to seed', {
        collection: this.collectionName,
      });

      const collection = await this.getCollection();

      for (const template of BUILT_IN_TEMPLATES) {
        // Check if template already exists by name and isBuiltIn
        const existing = await collection.findOne({
          name: template.name,
          isBuiltIn: true,
        });

        if (!existing) {
          const id = this.generateId();
          const now = this.getCurrentTimestamp();

          const newTemplate: RoleplayTemplate = {
            ...template,
            id,
            createdAt: now,
            updatedAt: now,
          };

          const validated = this.validate(newTemplate);
          await collection.insertOne(validated as any);

          logger.info('Built-in roleplay template seeded', {
            templateId: id,
            name: template.name,
          });
        } else {
          logger.debug('Built-in roleplay template already exists', {
            name: template.name,
          });
        }
      }
    } catch (error) {
      logger.error('Error seeding built-in roleplay templates', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - seeding failure shouldn't break the app
    }
  }

  // ============================================================================
  // ROLEPLAY TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * Find a roleplay template by ID
   */
  async findById(id: string): Promise<RoleplayTemplate | null> {
    try {
      logger.debug('Finding roleplay template by ID', {
        templateId: id,
        collection: this.collectionName,
      });

      // Ensure built-in templates are seeded
      await this.seedBuiltInTemplates();

      const collection = await this.getCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        logger.debug('Roleplay template not found', { templateId: id });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Roleplay template found and validated', { templateId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding roleplay template by ID', {
        templateId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all roleplay templates
   */
  async findAll(): Promise<RoleplayTemplate[]> {
    try {
      logger.debug('Finding all roleplay templates', { collection: this.collectionName });

      // Ensure built-in templates are seeded
      await this.seedBuiltInTemplates();

      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();

      logger.debug('Retrieved roleplay templates from database', { count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('All roleplay templates validated', {
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding all roleplay templates', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find roleplay templates by user ID (user-created templates only)
   */
  async findByUserId(userId: string): Promise<RoleplayTemplate[]> {
    try {
      logger.debug('Finding roleplay templates by user ID', {
        userId,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const docs = await collection.find({ userId }).toArray();

      logger.debug('Retrieved roleplay templates for user', {
        userId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('User roleplay templates validated', {
        userId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding roleplay templates by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all built-in roleplay templates
   */
  async findBuiltIn(): Promise<RoleplayTemplate[]> {
    try {
      logger.debug('Finding built-in roleplay templates', {
        collection: this.collectionName,
      });

      // Ensure built-in templates are seeded
      await this.seedBuiltInTemplates();

      const collection = await this.getCollection();
      const docs = await collection.find({ isBuiltIn: true }).toArray();

      logger.debug('Retrieved built-in roleplay templates', { count: docs.length });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('Built-in roleplay templates validated', {
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding built-in roleplay templates', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all templates available to a user (built-in + user's own templates)
   */
  async findAllForUser(userId: string): Promise<RoleplayTemplate[]> {
    try {
      logger.debug('Finding all roleplay templates for user', {
        userId,
        collection: this.collectionName,
      });

      // Ensure built-in templates are seeded
      await this.seedBuiltInTemplates();

      const collection = await this.getCollection();
      const docs = await collection.find({
        $or: [
          { isBuiltIn: true },
          { userId },
        ],
      }).toArray();

      logger.debug('Retrieved roleplay templates for user', {
        userId,
        count: docs.length,
      });

      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      logger.debug('User available roleplay templates validated', {
        userId,
        total: docs.length,
        validated: validated.length,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding all roleplay templates for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find roleplay template by name for a specific user
   */
  async findByName(userId: string, name: string): Promise<RoleplayTemplate | null> {
    try {
      logger.debug('Finding roleplay template by name for user', {
        userId,
        name,
        collection: this.collectionName,
      });

      const collection = await this.getCollection();
      const doc = await collection.findOne({ userId, name });

      if (!doc) {
        logger.debug('Roleplay template not found by name for user', {
          userId,
          name,
        });
        return null;
      }

      const validated = this.validate(doc);
      logger.debug('Roleplay template found by name for user', {
        userId,
        name,
      });
      return validated;
    } catch (error) {
      logger.error('Error finding roleplay template by name', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new roleplay template
   */
  async create(
    data: Omit<RoleplayTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<RoleplayTemplate> {
    try {
      logger.debug('Creating new roleplay template', {
        userId: data.userId,
        name: data.name,
        isBuiltIn: data.isBuiltIn,
        collection: this.collectionName,
      });

      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const template: RoleplayTemplate = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(template);

      const collection = await this.getCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('Roleplay template created successfully', {
        templateId: id,
        userId: data.userId,
        name: data.name,
        isBuiltIn: data.isBuiltIn,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating roleplay template', {
        userId: data.userId,
        name: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a roleplay template
   * Note: Built-in templates cannot be updated
   */
  async update(id: string, data: Partial<RoleplayTemplate>): Promise<RoleplayTemplate | null> {
    try {
      logger.debug('Updating roleplay template', {
        templateId: id,
        collection: this.collectionName,
      });

      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Roleplay template not found for update', { templateId: id });
        return null;
      }

      // Prevent updating built-in templates
      if (existing.isBuiltIn) {
        logger.warn('Cannot update built-in roleplay template', { templateId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: RoleplayTemplate = {
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

      logger.info('Roleplay template updated successfully', {
        templateId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
    } catch (error) {
      logger.error('Error updating roleplay template', {
        templateId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a roleplay template
   * Note: Built-in templates cannot be deleted
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting roleplay template', {
        templateId: id,
        collection: this.collectionName,
      });

      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Roleplay template not found for deletion', { templateId: id });
        return false;
      }

      // Prevent deleting built-in templates
      if (existing.isBuiltIn) {
        logger.warn('Cannot delete built-in roleplay template', { templateId: id });
        return false;
      }

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Roleplay template not found for deletion', { templateId: id });
        return false;
      }

      logger.info('Roleplay template deleted successfully', {
        templateId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting roleplay template', {
        templateId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a tag to a roleplay template
   */
  async addTag(templateId: string, tagId: string): Promise<RoleplayTemplate | null> {
    try {
      logger.debug('Adding tag to roleplay template', {
        templateId,
        tagId,
        collection: this.collectionName,
      });

      const template = await this.findById(templateId);
      if (!template) {
        logger.warn('Roleplay template not found for tag addition', { templateId });
        return null;
      }

      // Prevent modifying built-in templates
      if (template.isBuiltIn) {
        logger.warn('Cannot add tag to built-in roleplay template', { templateId });
        return null;
      }

      if (!template.tags.includes(tagId)) {
        template.tags.push(tagId);
        logger.debug('Tag added to roleplay template tags array', {
          templateId,
          tagId,
          totalTags: template.tags.length,
        });
        return await this.update(templateId, { tags: template.tags });
      }

      logger.debug('Tag already exists for roleplay template', { templateId, tagId });
      return template;
    } catch (error) {
      logger.error('Error adding tag to roleplay template', {
        templateId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a roleplay template
   */
  async removeTag(templateId: string, tagId: string): Promise<RoleplayTemplate | null> {
    try {
      logger.debug('Removing tag from roleplay template', {
        templateId,
        tagId,
        collection: this.collectionName,
      });

      const template = await this.findById(templateId);
      if (!template) {
        logger.warn('Roleplay template not found for tag removal', { templateId });
        return null;
      }

      // Prevent modifying built-in templates
      if (template.isBuiltIn) {
        logger.warn('Cannot remove tag from built-in roleplay template', { templateId });
        return null;
      }

      const initialLength = template.tags.length;
      template.tags = template.tags.filter((id) => id !== tagId);

      if (template.tags.length < initialLength) {
        logger.debug('Tag removed from roleplay template tags array', {
          templateId,
          tagId,
          totalTags: template.tags.length,
        });
        return await this.update(templateId, { tags: template.tags });
      }

      logger.debug('Tag not found in roleplay template tags', { templateId, tagId });
      return template;
    } catch (error) {
      logger.error('Error removing tag from roleplay template', {
        templateId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
