/**
 * Migration: Migrate Plugin Templates to Native
 *
 * 1. Renames the `annotationButtons` column to `delimiters` on roleplay_templates,
 *    converting the data from the old {label, abbrev, prefix, suffix} format to
 *    the new {name, buttonName, delimiters, style} format.
 * 2. Drops the `pluginName` column (no longer needed).
 * 3. Seeds the "Quilltap RP" built-in template if it doesn't exist.
 * 4. Rewrites all `plugin:quilltap-rp` references in chats, chat_participants,
 *    projects, and chat_settings to point to the new built-in template UUID.
 *
 * Migration ID: migrate-plugin-templates-to-native-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/** Convert old annotationButton format to new delimiter format */
function convertAnnotationButtonsToDelimiters(buttonsJson: string): string {
  try {
    const buttons = JSON.parse(buttonsJson);
    if (!Array.isArray(buttons)) return '[]';

    // Known style mappings based on common delimiter patterns
    const styleMap: Record<string, string> = {
      'Narration': 'qt-chat-narration',
      'Nar': 'qt-chat-narration',
      'Internal Monologue': 'qt-chat-inner-monologue',
      'Int': 'qt-chat-inner-monologue',
      'Out of Character': 'qt-chat-ooc',
      'OOC': 'qt-chat-ooc',
    };

    const delimiters = buttons.map((btn: { label?: string; abbrev?: string; prefix?: string; suffix?: string }) => {
      const name = btn.label || btn.abbrev || 'Unknown';
      const buttonName = btn.abbrev || btn.label || '?';
      const prefix = btn.prefix || '';
      const suffix = btn.suffix || '';

      // Build delimiters value: string if same, [string, string] if different
      const delimValue = (prefix === suffix)
        ? prefix
        : [prefix, suffix];

      // Look up style from known mappings
      const style = styleMap[name] || styleMap[buttonName] || 'qt-chat-narration';

      return { name, buttonName, delimiters: delimValue, style };
    });

    return JSON.stringify(delimiters);
  } catch {
    return '[]';
  }
}

export const migratePluginTemplatesToNativeMigration: Migration = {
  id: 'migrate-plugin-templates-to-native-v1',
  description: 'Migrate plugin roleplay templates to native built-in templates, rename annotationButtons to delimiters',
  introducedInVersion: '4.2.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-narration-delimiters-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('roleplay_templates')) {
      return false;
    }

    const columns = getSQLiteTableColumns('roleplay_templates');
    const columnNames = columns.map((col) => col.name);

    // Run if annotationButtons column still exists (hasn't been renamed yet)
    return columnNames.includes('annotationButtons');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();

      // Step 1: Add `delimiters` column
      db.exec(`ALTER TABLE "roleplay_templates" ADD COLUMN "delimiters" TEXT DEFAULT '[]'`);

      // Step 2: Convert annotationButtons data to delimiters format
      const rows = db.prepare('SELECT id, "annotationButtons" FROM "roleplay_templates" WHERE "annotationButtons" IS NOT NULL').all() as Array<{ id: string; annotationButtons: string }>;

      const updateStmt = db.prepare('UPDATE "roleplay_templates" SET "delimiters" = ? WHERE id = ?');
      for (const row of rows) {
        const converted = convertAnnotationButtonsToDelimiters(row.annotationButtons);
        updateStmt.run(converted, row.id);
        itemsAffected++;
      }

      logger.info('Converted annotationButtons to delimiters format', {
        context: 'migration.migrate-plugin-templates-to-native',
        templatesConverted: itemsAffected,
      });

      // Step 3: Seed "Quilltap RP" built-in template if it doesn't exist
      const existingQuilltapRP = db.prepare(
        'SELECT id FROM "roleplay_templates" WHERE "name" = ? AND "isBuiltIn" = 1'
      ).get('Quilltap RP') as { id: string } | undefined;

      let quilltapRPId: string;

      if (!existingQuilltapRP) {
        // Generate a UUID for the new built-in template
        quilltapRPId = crypto.randomUUID();
        const now = new Date().toISOString();

        const systemPrompt = `[SYSTEM INSTRUCTION: INTERACTION FORMATTING PROTOCOL]
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

5. STRICT COMPLIANCE: You must mirror this formatting in your responses. Never use asterisks for actions.`;

        const delimiters = JSON.stringify([
          { name: 'Narration', buttonName: 'Nar', delimiters: ['[', ']'], style: 'qt-chat-narration' },
          { name: 'Internal Monologue', buttonName: 'Int', delimiters: ['{', '}'], style: 'qt-chat-inner-monologue' },
          { name: 'Out of Character', buttonName: 'OOC', delimiters: ['// ', ''], style: 'qt-chat-ooc' },
        ]);

        const renderingPatterns = JSON.stringify([
          { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' },
          { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
          { pattern: '\\{[^}]+\\}', className: 'qt-chat-inner-monologue' },
        ]);

        const narrationDelimiters = JSON.stringify(['[', ']']);

        db.prepare(`INSERT INTO "roleplay_templates" ("id", "userId", "name", "description", "systemPrompt", "isBuiltIn", "tags", "delimiters", "renderingPatterns", "dialogueDetection", "narrationDelimiters", "createdAt", "updatedAt") VALUES (?, NULL, ?, ?, ?, 1, '[]', ?, ?, NULL, ?, ?, ?)`).run(
          quilltapRPId,
          'Quilltap RP',
          'Custom formatting protocol with dialogue as bare text, actions in [brackets], thoughts in {braces}, and OOC with // prefix.',
          systemPrompt,
          delimiters,
          renderingPatterns,
          narrationDelimiters,
          now,
          now,
        );

        logger.info('Seeded Quilltap RP built-in template', {
          context: 'migration.migrate-plugin-templates-to-native',
          templateId: quilltapRPId,
        });
        itemsAffected++;
      } else {
        quilltapRPId = existingQuilltapRP.id;
      }

      // Step 4: Rewrite all `plugin:quilltap-rp` references
      const pluginId = 'plugin:quilltap-rp';

      // Chats
      const chatsResult = db.prepare(
        'UPDATE "chats" SET "roleplayTemplateId" = ? WHERE "roleplayTemplateId" = ?'
      ).run(quilltapRPId, pluginId);
      if (chatsResult.changes > 0) {
        logger.info('Rewrote plugin template references in chats', {
          context: 'migration.migrate-plugin-templates-to-native',
          count: chatsResult.changes,
        });
        itemsAffected += chatsResult.changes;
      }

      // Chat participants
      if (sqliteTableExists('chat_participants')) {
        const columns = getSQLiteTableColumns('chat_participants');
        if (columns.some(c => c.name === 'roleplayTemplateId')) {
          const participantsResult = db.prepare(
            'UPDATE "chat_participants" SET "roleplayTemplateId" = ? WHERE "roleplayTemplateId" = ?'
          ).run(quilltapRPId, pluginId);
          if (participantsResult.changes > 0) {
            logger.info('Rewrote plugin template references in chat_participants', {
              context: 'migration.migrate-plugin-templates-to-native',
              count: participantsResult.changes,
            });
            itemsAffected += participantsResult.changes;
          }
        }
      }

      // Projects (defaultRoleplayTemplateId)
      if (sqliteTableExists('projects')) {
        const projColumns = getSQLiteTableColumns('projects');
        if (projColumns.some(c => c.name === 'defaultRoleplayTemplateId')) {
          const projectsResult = db.prepare(
            'UPDATE "projects" SET "defaultRoleplayTemplateId" = ? WHERE "defaultRoleplayTemplateId" = ?'
          ).run(quilltapRPId, pluginId);
          if (projectsResult.changes > 0) {
            logger.info('Rewrote plugin template references in projects', {
              context: 'migration.migrate-plugin-templates-to-native',
              count: projectsResult.changes,
            });
            itemsAffected += projectsResult.changes;
          }
        }
      }

      // Chat settings (defaultRoleplayTemplateId)
      if (sqliteTableExists('chat_settings')) {
        const settingsColumns = getSQLiteTableColumns('chat_settings');
        if (settingsColumns.some(c => c.name === 'defaultRoleplayTemplateId')) {
          const settingsResult = db.prepare(
            'UPDATE "chat_settings" SET "defaultRoleplayTemplateId" = ? WHERE "defaultRoleplayTemplateId" = ?'
          ).run(quilltapRPId, pluginId);
          if (settingsResult.changes > 0) {
            logger.info('Rewrote plugin template references in chat_settings', {
              context: 'migration.migrate-plugin-templates-to-native',
              count: settingsResult.changes,
            });
            itemsAffected += settingsResult.changes;
          }
        }
      }

      // Step 5: Drop the old annotationButtons column and pluginName column
      // SQLite doesn't support DROP COLUMN directly in older versions,
      // but better-sqlite3 with SQLite 3.35+ does support it
      try {
        db.exec('ALTER TABLE "roleplay_templates" DROP COLUMN "annotationButtons"');
        logger.info('Dropped annotationButtons column', {
          context: 'migration.migrate-plugin-templates-to-native',
        });
      } catch (dropError) {
        // If DROP COLUMN isn't supported, leave the old column in place
        // The application code no longer reads it
        logger.warn('Could not drop annotationButtons column (old SQLite version)', {
          context: 'migration.migrate-plugin-templates-to-native',
          error: dropError instanceof Error ? dropError.message : String(dropError),
        });
      }

      try {
        db.exec('ALTER TABLE "roleplay_templates" DROP COLUMN "pluginName"');
        logger.info('Dropped pluginName column', {
          context: 'migration.migrate-plugin-templates-to-native',
        });
      } catch (dropError) {
        logger.warn('Could not drop pluginName column (old SQLite version)', {
          context: 'migration.migrate-plugin-templates-to-native',
          error: dropError instanceof Error ? dropError.message : String(dropError),
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'migrate-plugin-templates-to-native-v1',
        success: true,
        itemsAffected,
        message: `Migrated plugin templates to native: ${itemsAffected} items affected`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to migrate plugin templates to native', {
        context: 'migration.migrate-plugin-templates-to-native',
        error: errorMessage,
      });

      return {
        id: 'migrate-plugin-templates-to-native-v1',
        success: false,
        itemsAffected,
        message: 'Failed to migrate plugin templates to native',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
