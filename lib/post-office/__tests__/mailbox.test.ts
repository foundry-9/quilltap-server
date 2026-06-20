/**
 * Tests for the Post Office mailbox storage layer.
 *
 * The pure helpers (slugify / compose / parse / reply preface) are tested
 * directly. The I/O helpers (deliver / collect / markAlerted) run against an
 * in-memory fake of the mount-index database-store, so we exercise the real
 * frontmatter round-trip without a database. `ensureFolderPath` is a no-op.
 *
 * `markAlerted` deliberately routes through `writeDatabaseDocument` (a content
 * update — buffered-safe in the forked child) and never a delete/GC, so the
 * "announce once, never re-announce" guarantee holds identically on the parent
 * and child write paths.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import {
  slugifySenderName,
  composeLetterContent,
  parseLetter,
  buildReplyPreface,
  deliverLetter,
  collectUnalertedMail,
  listMailbox,
  markAlerted,
  type MailFrontmatter,
} from '../mailbox';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import {
  writeDatabaseDocument,
  readDatabaseDocument,
  listDatabaseFiles,
} from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';

jest.mock('@/lib/mount-index/database-store', () => {
  const actual = jest.requireActual('@/lib/mount-index/database-store');
  return {
    ...actual,
    writeDatabaseDocument: jest.fn(),
    readDatabaseDocument: jest.fn(),
    listDatabaseFiles: jest.fn(),
  };
});
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(null),
}));

const { DatabaseStoreError } = jest.requireActual('@/lib/mount-index/database-store');

/** vaultId → (relativePath → content) */
let store: Map<string, Map<string, string>>;

function vault(id: string): Map<string, string> {
  let v = store.get(id);
  if (!v) {
    v = new Map();
    store.set(id, v);
  }
  return v;
}

beforeEach(() => {
  jest.clearAllMocks();
  store = new Map();

  jest.mocked(writeDatabaseDocument).mockImplementation(async (vaultId, relativePath, content) => {
    vault(vaultId).set(relativePath, content);
    return { mtime: 1 };
  });

  jest.mocked(readDatabaseDocument).mockImplementation(async (vaultId, relativePath) => {
    const content = vault(vaultId).get(relativePath);
    if (content === undefined) {
      throw new DatabaseStoreError(`not found: ${relativePath}`, 'NOT_FOUND');
    }
    return { content, mtime: 1, size: content.length };
  });

  jest.mocked(listDatabaseFiles).mockImplementation(async (vaultId, options) => {
    const folder = (options?.folder ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
    const prefix = folder ? `${folder}/` : '';
    const out: Array<{ relativePath: string; kind: 'file' }> = [];
    for (const relativePath of vault(vaultId).keys()) {
      if (!prefix || relativePath.startsWith(prefix)) {
        out.push({ relativePath, kind: 'file' });
      }
    }
    return out as never;
  });
});

describe('slugifySenderName', () => {
  it('lowercases and collapses non-alphanumerics to single hyphens', () => {
    expect(slugifySenderName('Aria Stark')).toBe('aria-stark');
    expect(slugifySenderName("  O'Brien!! ")).toBe('o-brien');
    expect(slugifySenderName('Madame   de  la Rue')).toBe('madame-de-la-rue');
  });
  it('falls back to "someone" when nothing survives', () => {
    expect(slugifySenderName('!!!')).toBe('someone');
    expect(slugifySenderName('')).toBe('someone');
  });
});

describe('composeLetterContent + parseLetter round-trip', () => {
  it('preserves frontmatter fields and extracts the body (no leading blank line)', () => {
    const fm: MailFrontmatter = {
      from: 'Ariadne',
      fromCharacterId: 'c-1',
      sentAt: '2026-06-14T18:22:05.123Z',
      alerted: false,
      inReplyTo: null,
    };
    const content = composeLetterContent(fm, 'Hello,\n\nHow do you do?');
    const parsed = parseLetter(content);
    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body).toBe('Hello,\n\nHow do you do?');
  });

  it('reads alerted:true and inReplyTo back', () => {
    const fm: MailFrontmatter = {
      from: 'Bertie',
      fromCharacterId: 'c-2',
      sentAt: '2026-06-13T10:00:00.000Z',
      alerted: true,
      inReplyTo: 'Mail/111-from-ariadne.md',
    };
    const parsed = parseLetter(composeLetterContent(fm, 'body'));
    expect(parsed.frontmatter.alerted).toBe(true);
    expect(parsed.frontmatter.inReplyTo).toBe('Mail/111-from-ariadne.md');
  });
});

describe('buildReplyPreface', () => {
  it('quotes the original body line-by-line and never includes frontmatter', () => {
    const preface = buildReplyPreface('First line\n\nSecond line', '2026-06-01T12:00:00.000Z');
    expect(preface).toContain('In reply to your letter of');
    expect(preface).toContain('> First line');
    expect(preface).toContain('> Second line');
    expect(preface).not.toContain('---');
    expect(preface).not.toContain('from:');
  });
});

describe('deliverLetter', () => {
  it('writes a stamped letter into the recipient Mail/ folder with alerted:false', async () => {
    const { path } = await deliverLetter({
      recipientVaultId: 'rv',
      fromName: 'Ariadne',
      fromCharacterId: 'c-1',
      sentAt: '2026-06-14T18:22:05.123Z',
      body: 'A letter.',
      inReplyTo: null,
    });

    expect(path).toMatch(/^Mail\/\d+-from-ariadne\.md$/);
    expect(ensureFolderPath).toHaveBeenCalledWith('rv', 'Mail');

    const written = vault('rv').get(path)!;
    const parsed = parseLetter(written);
    expect(parsed.frontmatter.from).toBe('Ariadne');
    expect(parsed.frontmatter.fromCharacterId).toBe('c-1');
    expect(parsed.frontmatter.alerted).toBe(false);
    expect(parsed.body).toBe('A letter.');
  });

  it('avoids clobbering on a same-millisecond collision by suffixing', async () => {
    const common = {
      recipientVaultId: 'rv',
      fromName: 'Ariadne',
      fromCharacterId: 'c-1',
      sentAt: '2026-06-14T18:22:05.123Z',
      inReplyTo: null,
    };
    const first = await deliverLetter({ ...common, body: 'one' });
    const second = await deliverLetter({ ...common, body: 'two' });
    expect(second.path).not.toBe(first.path);
    expect(vault('rv').size).toBe(2);
  });
});

describe('collectUnalertedMail + markAlerted', () => {
  async function deliver(sentAt: string, from = 'Ariadne') {
    return deliverLetter({
      recipientVaultId: 'rv',
      fromName: from,
      fromCharacterId: 'c-1',
      sentAt,
      body: `body ${sentAt}`,
      inReplyTo: null,
    });
  }

  it('returns [] for an empty/absent mailbox', async () => {
    expect(await collectUnalertedMail('rv')).toEqual([]);
  });

  it('returns unalerted letters newest-first', async () => {
    await deliver('2026-06-10T00:00:00.000Z');
    await deliver('2026-06-12T00:00:00.000Z');
    await deliver('2026-06-11T00:00:00.000Z');
    const got = await collectUnalertedMail('rv');
    expect(got.map((l) => l.sentAt)).toEqual([
      '2026-06-12T00:00:00.000Z',
      '2026-06-11T00:00:00.000Z',
      '2026-06-10T00:00:00.000Z',
    ]);
  });

  it('announces once: after markAlerted the letter is no longer unalerted', async () => {
    const { path } = await deliver('2026-06-14T00:00:00.000Z');

    // Turn 1: the letter is unalerted.
    const turn1 = await collectUnalertedMail('rv');
    expect(turn1).toHaveLength(1);

    await markAlerted('rv', path);

    // The flip is a content write, never a delete — the file is still present.
    expect(writeDatabaseDocument).toHaveBeenCalledWith('rv', path, expect.stringContaining('alerted: true'));
    expect(vault('rv').has(path)).toBe(true);

    // Turn 2: no double-announce.
    const turn2 = await collectUnalertedMail('rv');
    expect(turn2).toHaveLength(0);

    // But the letter is still in the mailbox listing.
    expect(await listMailbox('rv')).toHaveLength(1);
  });

  it('markAlerted is a no-op (no throw) when the letter was already deleted', async () => {
    await expect(markAlerted('rv', 'Mail/gone.md')).resolves.toBeUndefined();
  });
});
