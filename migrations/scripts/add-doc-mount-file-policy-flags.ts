/**
 * Migration: per-document policy flags on doc_mount_file_links
 *
 * Adds three positive-sense policy columns to the link row and backfills them
 * from each markdown document's frontmatter:
 *
 *   allowEmbed          (frontmatter `embed`)          — embed for retrieval
 *   allowCharacterRead  (frontmatter `character_read`) — visible to characters
 *   allowCharacterWrite (frontmatter `character_write`)— mutable by characters
 *
 * Each defaults to `1` (permissive, matching the frontmatter default). Only a
 * markdown document whose frontmatter explicitly says `false` (quoted or bare)
 * flips a column to `0`. Non-markdown links keep the permissive defaults — they
 * carry no frontmatter.
 *
 * Backfill is required (committed decision): existing protected documents — the
 * reference being `Roleplay/ad-Daiat/ad-Daiat Recurring Scenarios.md` — must be
 * shielded the instant the release lands, not on their next reindex. For every
 * markdown link we read the current bytes (the file on disk for filesystem
 * mounts; `doc_mount_documents.content` for database-backed mounts), parse the
 * policy, and write the columns. When a document resolves to `embed:false` we
 * also NULL its chunks' embeddings so an already-indexed document is stripped
 * of its vectors on upgrade.
 *
 * Migration ID: add-doc-mount-file-policy-flags-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { getMountIndexDatabasePath } from '../../lib/paths';
import { policyFromContent } from '../../lib/doc-edit/document-policy';

const MIGRATION_ID = 'add-doc-mount-file-policy-flags-v1';

const POLICY_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: 'allowEmbed',          definition: `"allowEmbed" INTEGER NOT NULL DEFAULT 1` },
  { name: 'allowCharacterRead',  definition: `"allowCharacterRead" INTEGER NOT NULL DEFAULT 1` },
  { name: 'allowCharacterWrite', definition: `"allowCharacterWrite" INTEGER NOT NULL DEFAULT 1` },
];

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  if (!fs.existsSync(path.dirname(dbPath))) return null;
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

function tableExists(db: DatabaseType, name: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(name) as { name: string } | undefined;
  return row !== undefined;
}

function hasColumn(db: DatabaseType, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

interface MarkdownLinkRow {
  id: string;
  fileId: string;
  mountPointId: string;
  relativePath: string;
  source: string;
}

export const addDocMountFilePolicyFlagsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Add allowEmbed / allowCharacterRead / allowCharacterWrite to doc_mount_file_links and backfill them from markdown frontmatter; NULL embeddings for embed:false documents',
  introducedInVersion: '4.7.0',
  dependsOn: ['add-doc-mount-file-links-v1'],

  async shouldRun(): Promise<boolean> {
    const dbPath = getMountIndexDatabasePath();
    if (!fs.existsSync(dbPath)) return false;
    const db = openMountIndexDb();
    if (!db) return false;
    try {
      if (!tableExists(db, 'doc_mount_file_links')) return false;
      // Run only while any of the three columns is still missing.
      return POLICY_COLUMNS.some(col => !hasColumn(db, 'doc_mount_file_links', col.name));
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = openMountIndexDb();
    if (!db) {
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'No mount-index database present; nothing to migrate',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    let columnsAdded = 0;
    let documentsScanned = 0;
    let documentsProtected = 0;
    let documentsDeEmbedded = 0;

    try {
      // ----------------------------------------------------------------------
      // Step 1: add the three policy columns (idempotent).
      // ----------------------------------------------------------------------
      for (const col of POLICY_COLUMNS) {
        if (!hasColumn(db, 'doc_mount_file_links', col.name)) {
          db.exec(`ALTER TABLE "doc_mount_file_links" ADD COLUMN ${col.definition}`);
          columnsAdded += 1;
        }
      }

      // ----------------------------------------------------------------------
      // Step 2: backfill from markdown frontmatter.
      // ----------------------------------------------------------------------
      const markdownLinks = db.prepare(
        `SELECT l.id AS id, l.fileId AS fileId, l.mountPointId AS mountPointId,
                l.relativePath AS relativePath, f.source AS source
         FROM doc_mount_file_links l
         JOIN doc_mount_files f ON f.id = l.fileId
         WHERE f.fileType = 'markdown'`
      ).all() as MarkdownLinkRow[];

      const total = markdownLinks.length;

      const basePathByMount = new Map<string, string | null>();
      const basePathStmt = db.prepare(`SELECT basePath FROM doc_mount_points WHERE id = ?`);
      const docContentStmt = db.prepare(`SELECT content FROM doc_mount_documents WHERE fileId = ?`);
      const updatePolicyStmt = db.prepare(
        `UPDATE doc_mount_file_links
           SET allowEmbed = ?, allowCharacterRead = ?, allowCharacterWrite = ?, updatedAt = ?
         WHERE id = ?`
      );
      const nullEmbeddingsStmt = db.prepare(
        `UPDATE doc_mount_chunks SET embedding = NULL WHERE linkId = ? AND embedding IS NOT NULL`
      );

      const resolveBasePath = (mountPointId: string): string | null => {
        if (basePathByMount.has(mountPointId)) return basePathByMount.get(mountPointId) ?? null;
        const row = basePathStmt.get(mountPointId) as { basePath: string | null } | undefined;
        const basePath = row?.basePath ?? null;
        basePathByMount.set(mountPointId, basePath);
        return basePath;
      };

      const readContent = (link: MarkdownLinkRow): string | null => {
        if (link.source === 'database') {
          const row = docContentStmt.get(link.fileId) as { content: string } | undefined;
          return row?.content ?? null;
        }
        // filesystem / obsidian: bytes live on disk under the mount's basePath.
        const basePath = resolveBasePath(link.mountPointId);
        if (!basePath) return null;
        try {
          return fs.readFileSync(path.join(basePath, link.relativePath), 'utf-8');
        } catch {
          return null; // missing/unreadable file → leave permissive defaults
        }
      };

      for (let i = 0; i < markdownLinks.length; i++) {
        const link = markdownLinks[i];
        documentsScanned += 1;

        const content = readContent(link);
        if (content !== null) {
          const policy = policyFromContent(content);
          const now = new Date().toISOString();
          updatePolicyStmt.run(
            policy.embed ? 1 : 0,
            policy.characterRead ? 1 : 0,
            policy.characterWrite ? 1 : 0,
            now,
            link.id
          );
          if (!policy.embed || !policy.characterRead || !policy.characterWrite) {
            documentsProtected += 1;
          }
          if (!policy.embed) {
            const res = nullEmbeddingsStmt.run(link.id);
            if (res.changes > 0) documentsDeEmbedded += 1;
          }
        }

        // Throttled progress; safe to call every iteration.
        reportProgress(i + 1, total, 'documents');
      }

      const message =
        `Added ${columnsAdded} policy column(s); ` +
        `scanned ${documentsScanned} markdown document(s), ` +
        `protected ${documentsProtected}, de-embedded ${documentsDeEmbedded}`;
      logger.info(message, {
        context: `migration.${MIGRATION_ID}`,
        columnsAdded,
        documentsScanned,
        documentsProtected,
        documentsDeEmbedded,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: documentsProtected,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('add-doc-mount-file-policy-flags migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: documentsProtected,
        message: 'add-doc-mount-file-policy-flags migration aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },
};
