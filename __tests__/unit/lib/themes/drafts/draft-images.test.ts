/**
 * @jest-environment node
 *
 * A theme draft's images are kept as written (Spec D, decision 11): a PNG
 * under `Themes/` in Quilltap General is stored byte for byte by both blob
 * chokepoints, while the same PNG anywhere else — elsewhere in General, or
 * under `Themes/` in another store — is re-encoded to WebP.
 */

jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: async () => 'general' }));

import sharp from 'sharp';
import { randomBytes } from 'crypto';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { normalizeLinkBlobImage, transcodeBlobForStore } from '@/lib/mount-index/normalize-blob-image';
import { isThemeDraftStorePath, isUnderThemeDraftsFolder, isValidDraftId, themeDraftPathTester } from '@/lib/themes/drafts/location';

let png: Buffer;
beforeAll(async () => {
  png = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
});

const linkInput = (mountPointId: string, relativePath: string) => ({
  mountPointId,
  relativePath,
  fileName: relativePath.split('/').pop()!,
  originalMimeType: 'image/png',
  storedMimeType: 'image/png',
  sha256: sha256OfBuffer(png),
  data: png,
});

describe('where a draft is', () => {
  it('checks ids against the manifest id rule', () => {
    expect(isValidDraftId('my-theme-2')).toBe(true);
    for (const bad of ['', '2-theme', 'My-Theme', '../x', 'a/b', 'a.b', 'x'.repeat(65)]) {
      expect(isValidDraftId(bad)).toBe(false);
    }
  });

  it('a draft path is under Themes/ in General, compared as the store compares', async () => {
    expect(isUnderThemeDraftsFolder('Themes/a/tokens.json')).toBe(true);
    expect(isUnderThemeDraftsFolder('/themes/a/x.png')).toBe(true);
    expect(isUnderThemeDraftsFolder('Themes')).toBe(false);
    expect(isUnderThemeDraftsFolder('Other/Themes/a.png')).toBe(false);
    expect(await isThemeDraftStorePath('general', 'Themes/a/x.png')).toBe(true);
    expect(await isThemeDraftStorePath('other-store', 'Themes/a/x.png')).toBe(false);
  });

  it('a per-store tester answers by the folder rule in General and false elsewhere', async () => {
    const inGeneral = await themeDraftPathTester('general');
    expect(inGeneral('Themes/a/tokens.json')).toBe(true);
    expect(inGeneral('Notes/a.md')).toBe(false);
    const elsewhere = await themeDraftPathTester('other-store');
    expect(elsewhere('Themes/a/tokens.json')).toBe(false);
    expect((await themeDraftPathTester(null))('Themes/a/x')).toBe(false);
  });
});

describe('draft images are kept byte for byte', () => {
  it('transcodeBlobForStore keeps a draft PNG and re-encodes one elsewhere in General', async () => {
    const kept = await transcodeBlobForStore({ mountPointId: 'general', relativePath: 'Themes/a/textures/grain.png', data: png, mimeType: 'image/png' });
    expect(kept.data.equals(png)).toBe(true);
    expect(kept.storedMimeType).toBe('image/png');
    expect(kept.sha256).toBe(sha256OfBuffer(png));

    const elsewhere = await transcodeBlobForStore({ mountPointId: 'general', relativePath: 'Pictures/grain.png', data: png, mimeType: 'image/png' });
    expect(elsewhere.storedMimeType).toBe('image/webp');
  }, 30000);

  it('normalizeLinkBlobImage keeps a draft PNG and re-encodes one in another store', async () => {
    const draft = linkInput('general', 'Themes/a/textures/grain.png');
    expect(await normalizeLinkBlobImage(draft)).toBe(draft);

    const other = await normalizeLinkBlobImage(linkInput('other-store', 'Themes/a/textures/grain.png'));
    expect(other.storedMimeType).toBe('image/webp');
    expect(other.relativePath).toBe('Themes/a/textures/grain.webp');
  }, 30000);
});
