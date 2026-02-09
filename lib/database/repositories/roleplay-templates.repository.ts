/**
 * Roleplay Templates Repository
 *
 * Backend-agnostic repository for RoleplayTemplate entities.
 * Works with SQLite through the database abstraction layer.
 * Manages roleplay templates including built-in and plugin-provided templates.
 */

import {
  RoleplayTemplate,
  RoleplayTemplateSchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { roleplayTemplateRegistry, type LoadedRoleplayTemplate } from '@/lib/plugins/roleplay-template-registry';
import { QueryFilter } from '../interfaces';

/**
 * Built-in roleplay templates that are seeded on first access
 * Note: Additional templates may be provided by plugins with the ROLEPLAY_TEMPLATE capability
 * Note: RoleplayTemplate has optional userId (null for built-in), so we use AbstractBaseRepository
 * instead of UserOwnedBaseRepository. Tag operations are implemented manually.
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
      openingChars: ['"', '\u201c'],
      closingChars: ['"', '\u201d'],
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
 * Note: Uses AbstractBaseRepository because userId can be null for built-in templates
 */
export class RoleplayTemplatesRepository extends AbstractBaseRepository<RoleplayTemplate> {
  private seedingPromise: Promise<void> | null = null;

  constructor() {
    super('roleplay_templates', RoleplayTemplateSchema);
  }

  // ============================================================================
  // PLUGIN TEMPLATE HELPERS
  // ============================================================================

  /**
   * Get all plugin-provided templates as RoleplayTemplate objects
   */
  private getPluginTemplates(): RoleplayTemplate[] {
    if (!roleplayTemplateRegistry.isInitialized()) {
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
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();

        for (const template of BUILT_IN_TEMPLATES) {
          // Check if template already exists by name and isBuiltIn
          const existing = await collection.findOne({
            name: template.name,
            isBuiltIn: true,
          } as QueryFilter);

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
            await collection.insertOne(validated);

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
              { id: existing.id },
              { $set: updateData }
            );
          }
        }
      },
      'Error seeding built-in roleplay templates',
      {},
      undefined
    );
  }

  // ============================================================================
  // ROLEPLAY TEMPLATE OPERATIONS
  // ============================================================================

  /**
   * Find a roleplay template by ID
   * Checks plugin templates first, then database templates
   */
  async findById(id: string): Promise<RoleplayTemplate | null> {
    return this.safeQuery(
      async () => {
        // Check if this is a plugin template
        const pluginTemplate = this.getPluginTemplateById(id);
        if (pluginTemplate) {
          return pluginTemplate;
        }

        // Ensure built-in templates are seeded
        await this.seedBuiltInTemplates();

        // Use base implementation for database lookup
        const result = await this._findById(id);
        return result;
      },
      'Error finding roleplay template by ID',
      { templateId: id },
      null
    );
  }

  /**
   * Find all roleplay templates (database + plugin templates)
   */
  async findAll(): Promise<RoleplayTemplate[]> {
    return this.safeQuery(
      async () => {
        // Ensure built-in templates are seeded
        await this.seedBuiltInTemplates();

        // Use base implementation for database lookup
        const dbTemplates = await this._findAll();
        // Also include plugin templates
        const pluginTemplates = this.getPluginTemplates();

        const allTemplates = [...dbTemplates, ...pluginTemplates];
        return allTemplates;
      },
      'Error finding all roleplay templates',
      {},
      []
    );
  }

  /**
   * Find roleplay templates by user ID (user-created templates only)
   */
  async findByUserId(userId: string): Promise<RoleplayTemplate[]> {
    return this.safeQuery(
      () => this.findByFilter({ userId } as QueryFilter),
      'Error finding roleplay templates by user ID',
      { userId },
      []
    );
  }

  /**
   * Find all built-in roleplay templates (database + plugin templates)
   */
  async findBuiltIn(): Promise<RoleplayTemplate[]> {
    return this.safeQuery(
      async () => {
        // Ensure built-in templates are seeded
        await this.seedBuiltInTemplates();

        const dbTemplates = await this.findByFilter({ isBuiltIn: true } as QueryFilter);
        // Also include plugin templates (they are all built-in)
        const pluginTemplates = this.getPluginTemplates();

        const allBuiltIn = [...dbTemplates, ...pluginTemplates];
        return allBuiltIn;
      },
      'Error finding built-in roleplay templates',
      {},
      []
    );
  }

  /**
   * Find all templates available to a user (built-in + plugin + user's own templates)
   */
  async findAllForUser(userId: string): Promise<RoleplayTemplate[]> {
    return this.safeQuery(
      async () => {
        // Ensure built-in templates are seeded
        await this.seedBuiltInTemplates();

        const dbTemplates = await this.findByFilter({
          $or: [
            { isBuiltIn: true },
            { userId },
          ],
        } as QueryFilter);
        // Also include plugin templates
        const pluginTemplates = this.getPluginTemplates();

        const allTemplates = [...dbTemplates, ...pluginTemplates];
        return allTemplates;
      },
      'Error finding all roleplay templates for user',
      { userId },
      []
    );
  }

  /**
   * Find roleplay template by name for a specific user
   */
  async findByName(userId: string, name: string): Promise<RoleplayTemplate | null> {
    return this.safeQuery(
      async () => {
        const template = await this.findOneByFilter({ userId, name } as QueryFilter);

        if (!template) {
          return null;
        }
        return template;
      },
      'Error finding roleplay template by name',
      { userId, name },
      null
    );
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
    return this.safeQuery(
      async () => {
        const template = await this._create(data, options);

        logger.info('Roleplay template created successfully', {
          templateId: template.id,
          userId: data.userId,
          name: data.name,
          isBuiltIn: data.isBuiltIn,
        });

        return template;
      },
      'Error creating roleplay template',
      { userId: data.userId, name: data.name }
    );
  }

  /**
   * Update a roleplay template
   * Note: Built-in templates cannot be updated
   */
  async update(id: string, data: Partial<RoleplayTemplate>): Promise<RoleplayTemplate | null> {
    return this.safeQuery(
      async () => {
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

        const updated = await this._update(id, data);

        if (updated) {
          logger.info('Roleplay template updated successfully', { templateId: id });
        }

        return updated;
      },
      'Error updating roleplay template',
      { templateId: id }
    );
  }

  /**
   * Delete a roleplay template
   * Note: Built-in templates cannot be deleted
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
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

        const result = await this._delete(id);

        if (result) {
          logger.info('Roleplay template deleted successfully', { templateId: id });
        }

        return result;
      },
      'Error deleting roleplay template',
      { templateId: id }
    );
  }

  /**
   * Add a tag to a roleplay template
   * Note: Built-in templates cannot be modified
   */
  async addTag(templateId: string, tagId: string): Promise<RoleplayTemplate | null> {
    return this.safeQuery(
      async () => {
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
          return await this.update(templateId, { tags: template.tags });
        }
        return template;
      },
      'Error adding tag to roleplay template',
      { templateId, tagId }
    );
  }

  /**
   * Remove a tag from a roleplay template
   * Note: Built-in templates cannot be modified
   */
  async removeTag(templateId: string, tagId: string): Promise<RoleplayTemplate | null> {
    return this.safeQuery(
      async () => {
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
          return await this.update(templateId, { tags: template.tags });
        }
        return template;
      },
      'Error removing tag from roleplay template',
      { templateId, tagId }
    );
  }
}
