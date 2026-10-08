/**
 * @jest-environment node
 *
 * walkDisk over a real temp directory: dot-entries, sidecars, symlinks,
 * invalid UTF-8, exclusion patterns, and the missing-target case.
 */

import { walkDisk } from '@/lib/mount-index/sync/walk-disk';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describe('walkDisk', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qt-walk-disk-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('treats a missing target as an empty side', async () => {
    const result = await walkDisk(path.join(dir, 'nope'), []);
    expect(result.entries.size).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.unreadable).toEqual([]);
  });

  it('reports a non-directory target as unreadable', async () => {
    const file = path.join(dir, 'plain.txt');
    await fs.writeFile(file, 'x');
    const result = await walkDisk(file, []);
    expect(result.entries.size).toBe(0);
    expect(result.unreadable).toEqual(['.']);
    expect(result.warnings[0]).toMatch(/Could not read the target directory/);
  });

  it('walks files and folders with lower-cased keys, sha and size', async () => {
    await fs.mkdir(path.join(dir, 'Lore'));
    await fs.writeFile(path.join(dir, 'Lore', 'Harbour.md'), '# Harbour\n');
    await fs.writeFile(path.join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0xff, 0xfe]));

    const { entries } = await walkDisk(dir, []);
    expect([...entries.keys()].sort()).toEqual(['lore', 'lore/harbour.md', 'pic.png']);

    const folder = entries.get('lore')!;
    expect(folder.kind).toBe('folder');
    expect(folder.relativePath).toBe('Lore');
    expect(folder.sha256).toBeUndefined();

    const md = entries.get('lore/harbour.md')!;
    expect(md.kind).toBe('file');
    expect(md.relativePath).toBe('Lore/Harbour.md');
    expect(md.sha256).toBe(sha('# Harbour\n'));
    expect(md.sizeBytes).toBe(10);
    expect(new Date(md.lastModified).toISOString()).toBe(md.lastModified);

    expect(entries.get('pic.png')!.sizeBytes).toBe(4);
  });

  it('ignores dot-entries (and their subtrees) and leftover temp files', async () => {
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref');
    await fs.writeFile(path.join(dir, '.DS_Store'), 'x');
    await fs.writeFile(path.join(dir, '.quilltap-sync.json'), '{}');
    await fs.writeFile(path.join(dir, 'a.md.quilltap-tmp'), 'half');
    await fs.writeFile(path.join(dir, 'keep.md'), 'ok');

    const { entries, warnings } = await walkDisk(dir, []);
    expect([...entries.keys()]).toEqual(['keep.md']);
    expect(warnings).toEqual([]);
  });

  it('applies exclude patterns by extension and by segment name', async () => {
    await fs.mkdir(path.join(dir, 'node_modules'));
    await fs.writeFile(path.join(dir, 'node_modules', 'x.md'), 'x');
    await fs.mkdir(path.join(dir, 'docs'));
    await fs.writeFile(path.join(dir, 'docs', 'a.md'), 'a');
    await fs.writeFile(path.join(dir, 'docs', 'b.log'), 'b');

    const { entries } = await walkDisk(dir, ['node_modules', '*.log']);
    expect([...entries.keys()].sort()).toEqual(['docs', 'docs/a.md']);
  });

  it('skips symbolic links with a warning', async () => {
    await fs.writeFile(path.join(dir, 'real.md'), 'real');
    await fs.symlink(path.join(dir, 'real.md'), path.join(dir, 'link.md'));

    const { entries, warnings } = await walkDisk(dir, []);
    expect([...entries.keys()]).toEqual(['real.md']);
    expect(warnings).toEqual(['link.md is a symbolic link and is skipped']);
  });

  it('attaches a sidecar to its partner and does not list it as an entry', async () => {
    await fs.writeFile(path.join(dir, 'harbour.png'), Buffer.from([1, 2, 3]));
    await fs.writeFile(path.join(dir, 'harbour.png.description.md'), 'A foggy harbour.\n\n');

    const { entries, orphanSidecars, warnings } = await walkDisk(dir, []);
    expect([...entries.keys()]).toEqual(['harbour.png']);
    const entry = entries.get('harbour.png')!;
    expect(entry.description).toBe('A foggy harbour.');
    expect(entry.descriptionUpdatedAt).toEqual(expect.any(String));
    expect(orphanSidecars).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('matches a sidecar to its partner case-insensitively', async () => {
    await fs.writeFile(path.join(dir, 'Harbour.PNG'), Buffer.from([1]));
    await fs.writeFile(path.join(dir, 'harbour.png.description.md'), 'caption');
    const { entries, orphanSidecars } = await walkDisk(dir, []);
    expect(entries.get('harbour.png')!.description).toBe('caption');
    expect(orphanSidecars).toEqual([]);
  });

  it('reports an orphan sidecar without deleting or listing it', async () => {
    await fs.writeFile(path.join(dir, 'ghost.png.description.md'), 'who?');
    const { entries, orphanSidecars, warnings } = await walkDisk(dir, []);
    expect(entries.size).toBe(0);
    expect(orphanSidecars).toEqual(['ghost.png.description.md']);
    expect(warnings).toEqual(['ghost.png.description.md describes a file that is not here']);
    // still on disk
    await expect(fs.stat(path.join(dir, 'ghost.png.description.md'))).resolves.toBeDefined();
  });

  it('refuses a text-extension file that is not valid UTF-8, but not a binary one', async () => {
    const bad = Buffer.from([0x68, 0x69, 0xff, 0xfe]);
    await fs.writeFile(path.join(dir, 'bad.md'), bad);
    await fs.writeFile(path.join(dir, 'ok.bin'), bad);

    const { entries, unreadable, warnings } = await walkDisk(dir, []);
    expect([...entries.keys()]).toEqual(['ok.bin']);
    expect(unreadable).toEqual(['bad.md']);
    expect(warnings[0]).toMatch(/bad\.md has a text extension but is not valid UTF-8/);
  });

  it('accepts multi-byte UTF-8 text', async () => {
    await fs.writeFile(path.join(dir, 'ünï.md'), 'café — 日本語');
    const { entries, unreadable } = await walkDisk(dir, []);
    expect(entries.size).toBe(1);
    expect(unreadable).toEqual([]);
  });

  it('refuses both members of a case-colliding pair (case-sensitive filesystems only)', async () => {
    await fs.writeFile(path.join(dir, 'Notes.md'), 'one');
    let sensitive = true;
    try {
      await fs.writeFile(path.join(dir, 'notes.md'), 'two');
      const names = await fs.readdir(dir);
      sensitive = names.length === 2;
    } catch {
      sensitive = false;
    }
    if (!sensitive) return; // case-insensitive volume (default macOS): collision cannot arise

    const { entries, warnings } = await walkDisk(dir, []);
    expect(entries.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/differ only by case/);
  });
});
