/**
 * Text Replacement Rules Repository
 *
 * Backend-agnostic repository for the global list of user-defined word-boundary
 * text replacements (Layer 1.5 of the composer spellcheck/autocorrect plan).
 *
 * Single-user model — no userId scoping. Conflict detection on
 * `(fromText, caseSensitive)` happens here; the route translates the typed
 * error to a 409.
 */

import { logger } from '@/lib/logger';
import {
  TextReplacementRule,
  TextReplacementRuleSchema,
  TextReplacementRuleInput,
} from '@/lib/schemas/text-replacement.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';

/**
 * Thrown when a create or update would produce a duplicate `(fromText,
 * caseSensitive)` pair. The route maps this to HTTP 409.
 */
export class TextReplacementRuleConflictError extends Error {
  constructor(public readonly fromText: string, public readonly caseSensitive: boolean) {
    super(
      `A ${caseSensitive ? 'case-sensitive' : 'case-insensitive'} rule for ` +
        `"${fromText}" already exists`,
    );
    this.name = 'TextReplacementRuleConflictError';
  }
}

export interface ListOptions {
  /** When true, omit rules with `enabled = false`. */
  enabledOnly?: boolean;
}

export class TextReplacementRulesRepository extends AbstractBaseRepository<TextReplacementRule> {
  constructor() {
    super('text_replacement_rules', TextReplacementRuleSchema);
  }

  // ============================================================================
  // List
  // ============================================================================

  async list(options: ListOptions = {}): Promise<TextReplacementRule[]> {
    return this.safeQuery(
      async () => {
        const all = await this._findAll();
        const filtered = options.enabledOnly ? all.filter((r) => r.enabled) : all;
        return filtered.sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.createdAt.localeCompare(b.createdAt);
        });
      },
      'Error listing text replacement rules',
      {},
      [],
    );
  }

  // ============================================================================
  // Create / Update / Delete with conflict detection
  // ============================================================================

  async create(
    data: Omit<TextReplacementRule, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions,
  ): Promise<TextReplacementRule> {
    return this.safeQuery(
      async () => {
        await this.assertNoConflict(data.fromText, data.caseSensitive, null);
        const result = await this._create(data, options);
        logger.debug('Text replacement rule created', {
          ruleId: result.id,
          fromText: result.fromText,
          caseSensitive: result.caseSensitive,
        });
        return result;
      },
      'Error creating text replacement rule',
      { fromText: data.fromText, caseSensitive: data.caseSensitive },
    );
  }

  async update(
    id: string,
    data: Partial<TextReplacementRule>,
  ): Promise<TextReplacementRule | null> {
    return this.safeQuery(
      async () => {
        const updateData = { ...data };
        delete updateData.id;

        const existing = await this._findById(id);
        if (!existing) return null;

        const nextFromText = updateData.fromText ?? existing.fromText;
        const nextCaseSensitive = updateData.caseSensitive ?? existing.caseSensitive;
        if (
          nextFromText !== existing.fromText ||
          nextCaseSensitive !== existing.caseSensitive
        ) {
          await this.assertNoConflict(nextFromText, nextCaseSensitive, id);
        }

        const result = await this._update(id, updateData);
        if (result) {
          logger.debug('Text replacement rule updated', {
            ruleId: id,
            fromText: result.fromText,
          });
        }
        return result;
      },
      'Error updating text replacement rule',
      { ruleId: id },
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const deleted = await this._delete(id);
        if (deleted) {
          logger.debug('Text replacement rule deleted', { ruleId: id });
        }
        return deleted;
      },
      'Error deleting text replacement rule',
      { ruleId: id },
      false,
    );
  }

  /**
   * Replace the entire rule list in one shot (used by the import path). Drops
   * everything currently stored and inserts the supplied rules. Conflicts
   * within the input are detected before any writes happen.
   */
  async bulkReplace(rules: TextReplacementRuleInput[]): Promise<TextReplacementRule[]> {
    return this.safeQuery(
      async () => {
        const seen = new Map<string, true>();
        for (const r of rules) {
          const key = `${r.caseSensitive ? '|cs|' : '|ci|'}${
            r.caseSensitive ? r.fromText : r.fromText.toLowerCase()
          }`;
          if (seen.has(key)) {
            throw new TextReplacementRuleConflictError(r.fromText, r.caseSensitive);
          }
          seen.set(key, true);
        }

        const existing = await this._findAll();
        for (const row of existing) {
          await this._delete(row.id);
        }

        const created: TextReplacementRule[] = [];
        for (const r of rules) {
          const row = await this._create(r);
          created.push(row);
        }

        logger.info('Text replacement rules bulk-replaced', {
          before: existing.length,
          after: created.length,
        });

        return created;
      },
      'Error bulk-replacing text replacement rules',
    );
  }

  // ============================================================================
  // Internals
  // ============================================================================

  private async assertNoConflict(
    fromText: string,
    caseSensitive: boolean,
    excludeId: string | null,
  ): Promise<void> {
    const all = await this._findAll();
    const conflict = all.find((row) => {
      if (excludeId && row.id === excludeId) return false;
      if (row.caseSensitive !== caseSensitive) return false;
      if (caseSensitive) {
        return row.fromText === fromText;
      }
      return row.fromText.toLowerCase() === fromText.toLowerCase();
    });
    if (conflict) {
      throw new TextReplacementRuleConflictError(fromText, caseSensitive);
    }
  }
}
