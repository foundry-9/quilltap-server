/**
 * Roleplay Templates Repository
 *
 * Backend-agnostic repository for RoleplayTemplate entities.
 * Works with SQLite through the database abstraction layer.
 * Manages roleplay templates including built-in and user-created templates.
 */

import {
  RoleplayTemplate,
  RoleplayTemplateSchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { NOVEL_TEMPLATE } from '@/lib/chat/novel-template';
import {
  encodeNarrationDelimiters,
  decodeNarrationDelimiters,
} from './roleplay-template-narration-codec';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter, QueryOptions } from '../interfaces';

/**
 * Built-in roleplay templates that are seeded on first access.
 * These templates are read-only and always available.
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
    delimiters: [
      { kind: 'wrap', name: 'Narration', buttonName: 'Nar', delimiters: '*', style: 'qt-chat-narration' },
      { kind: 'wrap', name: 'Out of Character', buttonName: 'OOC', delimiters: ['((', '))'], style: 'qt-chat-ooc' },
    ],
    // Rendering patterns for message content styling
    renderingPatterns: [
      // OOC: ((comments)) - double parentheses
      { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' },
      // Dialogue: "speech" - straight and curly quotes (inline detection as fallback)
      { pattern: '[""\u201c][^""\u201d]+[""\u201d]', className: 'qt-chat-dialogue' },
      // Narration: *actions* - single asterisks (not bold **)
      { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
    ],
    // Paragraph-level dialogue detection (handles dialogue with formatting inside)
    dialogueDetection: {
      openingChars: ['"', '\u201c'],
      closingChars: ['"', '\u201d'],
      className: 'qt-chat-dialogue',
    },
    // Narration uses single asterisks
    narrationDelimiters: '*',
    unmarkedStyle: null,
    markdownAsterisks: true,
  },
  // Quilltap RP - bracket-based formatting (migrated from plugin)
  {
    userId: null,
    name: 'Quilltap RP',
    description: 'Custom formatting protocol with dialogue as bare text, actions in [brackets], thoughts in {braces}, and OOC with // prefix.',
    systemPrompt: `[SYSTEM INSTRUCTION: INTERACTION FORMATTING PROTOCOL]
You must adhere to the following custom syntax for all outputs. Do NOT use standard roleplay formatting.

1. SPOKEN DIALOGUE: Write as bare text. Do NOT use quotation marks.
   - Example: Put the gun down, John.
   - Markdown Italics (*text*) denote VOCAL EMPHASIS only, never action.

2. ACTION & NARRATION: Enclose all physical movements, facial expressions, and environmental descriptions in SQUARE BRACKETS [ ].
   - Example: [I lean back in the chair, crossing my arms.]

3. INTERNAL MONOLOGUE: Enclose private thoughts and feelings in CURLY BRACES { }.
   - Example: {He's lying to me. I can feel it.}

4. META/OOC: Any Out-of-Character comments or instructions must start with "// ".
   - Example: // The user is simulating a high-gravity environment now.

5. STRICT COMPLIANCE: You must mirror this formatting in your responses. Never use asterisks for actions.`,
    isBuiltIn: true,
    tags: [],
    delimiters: [
      { kind: 'wrap', name: 'Narration', buttonName: 'Nar', delimiters: ['[', ']'], style: 'qt-chat-narration' },
      { kind: 'wrap', name: 'Internal Monologue', buttonName: 'Int', delimiters: ['{', '}'], style: 'qt-chat-inner-monologue' },
      { kind: 'linePrefix', name: 'Out of Character', buttonName: 'OOC', marker: '// ', style: 'qt-chat-ooc' },
    ],
    renderingPatterns: [
      { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm', scope: 'line' },
      { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
      { pattern: '\\{[^}]+\\}', className: 'qt-chat-inner-monologue' },
    ],
    dialogueDetection: null,
    narrationDelimiters: ['[', ']'],
    unmarkedStyle: null,
    markdownAsterisks: true,
  },
  // Novel - prose as a published novel prints it (see lib/chat/novel-template.ts)
  NOVEL_TEMPLATE,
];

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
  // NARRATION STORAGE CODEC
  // ============================================================================
  // narrationDelimiters is written as JSON text and decoded on every read (see
  // roleplay-template-narration-codec.ts) so a pair and a null both survive.

  /** A template as read: narrationDelimiters decoded from its stored text. */
  private decoded(template: RoleplayTemplate): RoleplayTemplate {
    return { ...template, narrationDelimiters: decodeNarrationDelimiters(template.narrationDelimiters) };
  }

  /** A template as written: narrationDelimiters encoded as JSON text. */
  private encoded<P extends Partial<RoleplayTemplate>>(template: P): P {
    if (!('narrationDelimiters' in template)) return template;
    return {
      ...template,
      narrationDelimiters: encodeNarrationDelimiters(template.narrationDelimiters ?? null),
    };
  }

  protected toPersistedRow(validated: RoleplayTemplate): RoleplayTemplate {
    return this.encoded(validated);
  }

  protected async _findById(id: string): Promise<RoleplayTemplate | null> {
    const found = await super._findById(id);
    return found ? this.decoded(found) : null;
  }

  protected async _findAll(): Promise<RoleplayTemplate[]> {
    return (await super._findAll()).map((t) => this.decoded(t));
  }

  protected async findByFilter(
    filter: TypedQueryFilter<RoleplayTemplate>,
    options?: QueryOptions,
  ): Promise<RoleplayTemplate[]> {
    return (await super.findByFilter(filter, options)).map((t) => this.decoded(t));
  }

  protected async findOneByFilter(filter: TypedQueryFilter<RoleplayTemplate>): Promise<RoleplayTemplate | null> {
    const found = await super.findOneByFilter(filter);
    return found ? this.decoded(found) : null;
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
            await collection.insertOne(this.encoded(validated));

            logger.info('Built-in roleplay template seeded', {
              templateId: id,
              templateName: template.name,
            });
          } else {
            // Update existing built-in template with new fields
            // This ensures built-in templates stay in sync with code changes
            const now = this.getCurrentTimestamp();
            const updateData: Partial<RoleplayTemplate> = {
              systemPrompt: template.systemPrompt,
              description: template.description,
              delimiters: template.delimiters,
              renderingPatterns: template.renderingPatterns,
              dialogueDetection: template.dialogueDetection,
              narrationDelimiters: template.narrationDelimiters,
              unmarkedStyle: template.unmarkedStyle,
              markdownAsterisks: template.markdownAsterisks,
              updatedAt: now,
            };

            await collection.updateOne(
              { id: existing.id },
              { $set: this.encoded(updateData) }
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
   */
  async findById(id: string): Promise<RoleplayTemplate | null> {
    return this.safeQuery(
      async () => {
        return await this._findById(id);
      },
      'Error finding roleplay template by ID',
      { templateId: id },
      null
    );
  }

  /**
   * Find all roleplay templates
   */
  async findAll(): Promise<RoleplayTemplate[]> {
    return this.safeQuery(
      async () => {
        return await this._findAll();
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
      () => this.findByFilter({ userId }),
      'Error finding roleplay templates by user ID',
      { userId },
      []
    );
  }

  /**
   * Find all templates available to a user (built-in + user's own templates)
   */
  async findAllForUser(userId: string): Promise<RoleplayTemplate[]> {
    return this.safeQuery(
      async () => {
        return await this.findByFilter({
          $or: [
            { isBuiltIn: true },
            { userId },
          ],
        } as TypedQueryFilter<RoleplayTemplate>);
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
        const template = await this.findOneByFilter({ userId, name });

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

        // _update writes the whole merged row, so the narration value always
        // travels encoded — the patch's if it names one, else the stored one.
        const narrationDelimiters = 'narrationDelimiters' in data
          ? data.narrationDelimiters ?? null
          : existing.narrationDelimiters;
        const updated = await this._update(id, this.encoded({ ...data, narrationDelimiters }));

        if (updated) {
          logger.info('Roleplay template updated successfully', { templateId: id });
        }

        return updated ? this.decoded(updated) : null;
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
