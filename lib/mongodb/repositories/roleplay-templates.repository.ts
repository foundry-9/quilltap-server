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
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { roleplayTemplateRegistry, type LoadedRoleplayTemplate } from '@/lib/plugins/roleplay-template-registry';

/**
 * Built-in roleplay templates that are seeded on first access
 * Note: Additional templates may be provided by plugins with the ROLEPLAY_TEMPLATE capability
 */
const BUILT_IN_TEMPLATES: Omit<RoleplayTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
  // Standard is the default/recommended option
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
    annotationButtons: [
      { label: 'Narration', abbrev: 'Nar', prefix: '*', suffix: '*' },
      { label: 'Out of Character', abbrev: 'OOC', prefix: '((', suffix: '))' },
    ],
    // Rendering patterns for message content styling
    renderingPatterns: [
      // OOC: ((comments)) - double parentheses
      { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' },
      // Dialogue: "speech" - straight and curly quotes (inline detection as fallback)
      { pattern: '[""][^""]+[""]', className: 'qt-chat-dialogue' },
      // Narration: *actions* - single asterisks (not bold **)
      { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
    ],
    // Paragraph-level dialogue detection (handles dialogue with formatting inside)
    dialogueDetection: {
      openingChars: ['"', '"'],
      closingChars: ['"', '"'],
      className: 'qt-chat-dialogue',
    },
  },
  // Additional templates are provided by plugins
];

/**
 * Convert a plugin-provided template to a RoleplayTemplate format
 * Plugin templates use the plugin ID as their template ID
 */
function pluginTemplateToRoleplayTemplate(pluginTemplate: LoadedRoleplayTemplate): RoleplayTemplate {
  // Generate a stable timestamp based on the plugin - using a fixed date for plugin templates
  const pluginTimestamp = new Date('2025-01-01T00:00:00Z').toISOString();

  return {
    id: `plugin:${pluginTemplate.id}`, // Prefix with 'plugin:' to distinguish from DB templates
    userId: null,
    name: pluginTemplate.name,
    description: pluginTemplate.description || null,
    systemPrompt: pluginTemplate.systemPrompt,
    isBuiltIn: true, // Plugin templates are treated as built-in (read-only)
    pluginName: pluginTemplate.pluginName, // Include the plugin name for display
    tags: pluginTemplate.tags,
    annotationButtons: pluginTemplate.annotationButtons || [],
    renderingPatterns: pluginTemplate.renderingPatterns || [],
    dialogueDetection: pluginTemplate.dialogueDetection || null,
    createdAt: pluginTimestamp,
    updatedAt: pluginTimestamp,
  };
}

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
  // PLUGIN TEMPLATE HELPERS
  // ============================================================================

  /**
   * Get all plugin-provided templates as RoleplayTemplate objects
   */
  private getPluginTemplates(): RoleplayTemplate[] {
    if (!roleplayTemplateRegistry.isInitialized()) {
      logger.debug('Roleplay template registry not yet initialized, skipping plugin templates');
      return [];
    }

    const pluginTemplates = roleplayTemplateRegistry.getAll();
    return pluginTemplates.map(pluginTemplateToRoleplayTemplate);
  }

  /**
   * Get a plugin template by ID
   */
  private getPluginTemplateById(id: string): RoleplayTemplate | null {
    // Check if this is a plugin template ID (prefixed with 'plugin:')
    if (!id.startsWith('plugin:')) {
      return null;
    }

    const pluginId = id.slice(7); // Remove 'plugin:' prefix
    const pluginTemplate = roleplayTemplateRegistry.get(pluginId);

    if (!pluginTemplate) {
      return null;
    }

    return pluginTemplateToRoleplayTemplate(pluginTemplate);
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
            templateName: template.name,
          });
        } else {
          // Update existing built-in template with new fields (e.g., annotationButtons, renderingPatterns)
          // This ensures built-in templates stay in sync with code changes
          const now = this.getCurrentTimestamp();
          const updateData: Partial<RoleplayTemplate> = {
            systemPrompt: template.systemPrompt,
            description: template.description,
            annotationButtons: template.annotationButtons,
            renderingPatterns: template.renderingPatterns,
            dialogueDetection: template.dialogueDetection,
            updatedAt: now,
          };

          await collection.updateOne(
            { _id: existing._id },
            { $set: updateData }
          );

          logger.debug('Built-in roleplay template updated', {
            templateId: existing.id,
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
   * Checks plugin templates first, then database templates
   */
  async findById(id: string): Promise<RoleplayTemplate | null> {
    try {
      logger.debug('Finding roleplay template by ID', {
        templateId: id,
        collection: this.collectionName,
      });

      // Check if this is a plugin template
      const pluginTemplate = this.getPluginTemplateById(id);
      if (pluginTemplate) {
        logger.debug('Roleplay template found in plugin registry', {
          templateId: id,
          name: pluginTemplate.name,
        });
        return pluginTemplate;
      }

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
   * Find all roleplay templates (database + plugin templates)
   */
  async findAll(): Promise<RoleplayTemplate[]> {
    try {
      logger.debug('Finding all roleplay templates', { collection: this.collectionName });

      // Ensure built-in templates are seeded
      await this.seedBuiltInTemplates();

      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();

      logger.debug('Retrieved roleplay templates from database', { count: docs.length });

      const dbTemplates = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      // Also include plugin templates
      const pluginTemplates = this.getPluginTemplates();

      const allTemplates = [...dbTemplates, ...pluginTemplates];

      logger.debug('All roleplay templates combined', {
        database: dbTemplates.length,
        plugin: pluginTemplates.length,
        total: allTemplates.length,
      });
      return allTemplates;
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
   * Find all built-in roleplay templates (database + plugin templates)
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

      logger.debug('Retrieved built-in roleplay templates from database', { count: docs.length });

      const dbTemplates = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      // Also include plugin templates (they are all built-in)
      const pluginTemplates = this.getPluginTemplates();

      const allBuiltIn = [...dbTemplates, ...pluginTemplates];

      logger.debug('Built-in roleplay templates combined', {
        database: dbTemplates.length,
        plugin: pluginTemplates.length,
        total: allBuiltIn.length,
      });

      return allBuiltIn;
    } catch (error) {
      logger.error('Error finding built-in roleplay templates', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all templates available to a user (built-in + plugin + user's own templates)
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

      logger.debug('Retrieved roleplay templates for user from database', {
        userId,
        count: docs.length,
      });

      const dbTemplates = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);

      // Also include plugin templates
      const pluginTemplates = this.getPluginTemplates();

      const allTemplates = [...dbTemplates, ...pluginTemplates];

      logger.debug('User available roleplay templates combined', {
        userId,
        database: dbTemplates.length,
        plugin: pluginTemplates.length,
        total: allTemplates.length,
      });

      return allTemplates;
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
   * @param data The template data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<RoleplayTemplate, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<RoleplayTemplate> {
    try {
      logger.debug('Creating new roleplay template', {
        userId: data.userId,
        name: data.name,
        isBuiltIn: data.isBuiltIn,
        collection: this.collectionName,
      });

      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const template: RoleplayTemplate = {
        ...data,
        id,
        createdAt,
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
