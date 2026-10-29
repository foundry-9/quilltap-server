/**
 * @jest-environment node
 *
 * `DocMountDocumentsRepository.findManyInFolderContaining` — the Inventory's
 * parent fallback asks the index only for the `Inventory/` files that mention
 * a wanted id, across every mount, instead of reading the whole instance.
 *
 * Runs the real repository against an in-memory SQLite DB (mirrors
 * doc-mount-preserve-ids.integration.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import { createHash } from 'crypto';

function loadDriver(): any {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();

import { logger } from '@/lib/logger';
import { DocMountFileLinksRepository } from '@/lib/database/repositories/doc-mount-file-links.repository';
import { DocMountFilesRepository } from '@/lib/database/repositories/doc-mount-files.repository';
import { DocMountFoldersRepository } from '@/lib/database/repositories/doc-mount-folders.repository';
import { DocMountDocumentsRepository } from '@/lib/database/repositories/doc-mount-documents.repository';
import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let db: any;
let links: DocMountFileLinksRepository;
let documents: DocMountDocumentsRepository;

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});

  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  documents = new DocMountDocumentsRepository();
  await new DocMountFilesRepository().findBySha256('seed');
  await new DocMountFoldersRepository().findByMountPointId('seed');
  await documents.findByFileId('seed');
  await new DocMountBlobsRepository().findByFileId('seed');
});

afterEach(() => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

async function writeDoc(mountPointId: string, relativePath: string, content: string) {
  await links.linkDocumentContent({
    mountPointId,
    relativePath,
    fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    folderId: null,
    fileType: relativePath.endsWith('.json') ? 'json' : 'markdown',
    content,
    contentSha256: sha(content),
    plainTextLength: content.length,
    fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
  } as never);
}

const BOW = 'a1111111-1111-4111-8111-111111111111';
const SWORD = 'b2222222-2222-4222-8222-222222222222';

describe('findManyInFolderContaining', () => {
  it('returns only the folder files that mention a wanted id, across mounts', async () => {
    await writeDoc('project-1', 'Inventory/Weapons/Magic bow.json', JSON.stringify({ id: BOW, name: 'magic bow' }));
    await writeDoc('vault-1', 'Inventory/Sword.json', JSON.stringify({ id: SWORD, name: 'sword' }));
    await writeDoc('vault-1', 'Inventory/notes.md', `mentions ${BOW} but is not json`);
    await writeDoc('vault-2', 'Wardrobe/Coat.json', JSON.stringify({ id: BOW }));

    const found = await documents.findManyInFolderContaining('Inventory', '.json', [BOW]);
    expect(found.map((d) => `${d.mountPointId}:${d.relativePath}`)).toEqual(['project-1:Inventory/Weapons/Magic bow.json']);
  });

  it('matches any of several needles, and nothing for none', async () => {
    await writeDoc('project-1', 'Inventory/Magic bow.json', JSON.stringify({ id: BOW }));
    await writeDoc('vault-1', 'Inventory/Sword.json', JSON.stringify({ id: SWORD }));

    const both = await documents.findManyInFolderContaining('Inventory', '.json', [BOW, SWORD]);
    expect(both.map((d) => d.relativePath).sort()).toEqual(['Inventory/Magic bow.json', 'Inventory/Sword.json']);
    expect(await documents.findManyInFolderContaining('Inventory', '.json', [])).toEqual([]);
  });
});
