import {
  buildKeptImageMarkdown,
  parseKeptImageFrontmatter,
  buildSlugAndFilename,
  renderSceneStateAsMarkdown,
  sha256OfString,
} from '@/lib/photos/keep-image-markdown';
import { isPhotosRelativePath, buildPhotosRelativePath, PHOTOS_FOLDER } from '@/lib/photos/photos-paths';
import type { SceneState } from '@/lib/schemas/chat.types';

const baseInput = {
  generationPrompt: 'A glass-roofed sunroom at dusk, brass details, copper kettle',
  generationRevisedPrompt: null,
  generationModel: 'grok-image-v2',
  characterName: 'Friday',
  characterId: 'char-friday-1',
  tags: ['covenant', 'sunroom'],
  caption: 'the night we built the sunroom',
  keptAt: '2026-05-14T07:22:33.000Z',
};

const sceneState: SceneState = {
  location: 'east garden, near the sunroom frame',
  characters: [
    { characterId: 'char-friday-1', characterName: 'Friday', action: 'measuring rafters', appearance: null, clothing: 'work coat' },
    { characterId: 'char-amy-1', characterName: 'Amy', action: 'holding the level', appearance: 'sawdust in her hair', clothing: 'jeans and a flannel' },
  ],
  updatedAt: '2026-05-14T07:21:00.000Z',
  updatedAtMessageCount: 42,
};

describe('buildKeptImageMarkdown', () => {
  it('emits frontmatter, prompt, scene, and caption attribution', () => {
    const md = buildKeptImageMarkdown({ ...baseInput, sceneState });
    expect(md).toMatch(/^---\n/);
    expect(md).toMatch(/tags:\s*\n\s*- covenant\n\s*- sunroom/);
    expect(md).toMatch(/linkedBy: Friday/);
    expect(md).toMatch(/linkedById: char-friday-1/);
    expect(md).toMatch(/generationModel: grok-image-v2/);
    expect(md).toContain('## Original prompt');
    expect(md).toContain('A glass-roofed sunroom at dusk');
    expect(md).toContain('### Scene at 2026-05-14T07:21:00.000Z');
    expect(md).toContain('- **Location**: east garden, near the sunroom frame');
    expect(md).toContain('- **Friday** — measuring rafters; wearing work coat');
    expect(md).toContain('Friday saved this image at 2026-05-14T07:22:33.000Z with this caption: the night we built the sunroom');
  });

  it('omits scene block when sceneState is null', () => {
    const md = buildKeptImageMarkdown({ ...baseInput, sceneState: null });
    expect(md).not.toContain('### Scene at');
    expect(md).toContain('## Original prompt');
  });

  it('emits placeholder when sceneState is malformed', () => {
    const md = buildKeptImageMarkdown({ ...baseInput, sceneState: null, sceneStateMalformed: true });
    expect(md).toContain('### Scene at the time');
    expect(md).toContain('_scene state unavailable_');
  });

  it('omits revised prompt when it matches the original', () => {
    const md = buildKeptImageMarkdown({
      ...baseInput,
      sceneState: null,
      generationRevisedPrompt: baseInput.generationPrompt,
    });
    expect(md).not.toContain('## Revised prompt');
  });

  it('includes revised prompt when it differs', () => {
    const md = buildKeptImageMarkdown({
      ...baseInput,
      sceneState: null,
      generationRevisedPrompt: 'A glass-roofed sunroom at dusk, brass details, copper kettle, soft candlelight',
    });
    expect(md).toContain('## Revised prompt');
    expect(md).toContain('soft candlelight');
  });

  it('ends with a plain sentence when there is no caption', () => {
    const md = buildKeptImageMarkdown({ ...baseInput, sceneState: null, caption: null });
    expect(md.trim().endsWith('Friday saved this image at 2026-05-14T07:22:33.000Z.')).toBe(true);
    expect(md).not.toContain('with this caption');
  });

  it('handles empty tags array gracefully', () => {
    const md = buildKeptImageMarkdown({ ...baseInput, sceneState: null, tags: [] });
    expect(md).toMatch(/tags: \[\]/);
  });
});

describe('parseKeptImageFrontmatter', () => {
  it('round-trips the structured fields and the caption from buildKeptImageMarkdown', () => {
    const md = buildKeptImageMarkdown({ ...baseInput, sceneState });
    const parsed = parseKeptImageFrontmatter(md);
    expect(parsed.tags).toEqual(['covenant', 'sunroom']);
    expect(parsed.linkedBy).toBe('Friday');
    expect(parsed.linkedById).toBe('char-friday-1');
    expect(parsed.generationModel).toBe('grok-image-v2');
    expect(parsed.caption).toBe('the night we built the sunroom');
  });

  it('returns a null caption when the footer omits one', () => {
    const md = buildKeptImageMarkdown({ ...baseInput, sceneState: null, caption: null });
    const parsed = parseKeptImageFrontmatter(md);
    expect(parsed.caption).toBeNull();
  });

  it('returns empties for null / blank input', () => {
    const parsed = parseKeptImageFrontmatter(null);
    expect(parsed.tags).toEqual([]);
    expect(parsed.linkedBy).toBeNull();
    expect(parsed.caption).toBeNull();
  });
});

describe('buildSlugAndFilename', () => {
  it('prefers the caption when present', () => {
    const result = buildSlugAndFilename({
      caption: 'The Night We Built the Sunroom',
      generationPrompt: 'glass roof brass detail',
      mimeType: 'image/webp',
      keptAt: '2026-05-14T07:22:33.000Z',
    });
    expect(result.slug).toBe('the-night-we-built-the-sunroom');
    expect(result.filename).toBe('2026-05-14T07-22-33.000Z-the-night-we-built-the-sunroom.webp');
    expect(result.extension).toBe('webp');
  });

  it('falls back to first words of the prompt when no caption', () => {
    const result = buildSlugAndFilename({
      caption: null,
      generationPrompt: 'A glass-roofed sunroom at dusk, brass details, copper kettle',
      mimeType: 'image/png',
      keptAt: '2026-05-14T07:22:33.000Z',
    });
    expect(result.slug).toBe('a-glass-roofed-sunroom-at-dusk-brass');
    expect(result.extension).toBe('png');
  });

  it('falls back to "kept" when neither caption nor prompt produces a slug', () => {
    const result = buildSlugAndFilename({
      caption: null,
      generationPrompt: null,
      mimeType: 'image/jpeg',
      keptAt: '2026-05-14T07:22:33.000Z',
    });
    expect(result.slug).toBe('kept');
    expect(result.extension).toBe('jpg');
  });

  it('caps long slugs', () => {
    const long = 'a'.repeat(200);
    const result = buildSlugAndFilename({
      caption: long,
      generationPrompt: null,
      mimeType: 'image/webp',
      keptAt: '2026-05-14T07:22:33.000Z',
    });
    expect(result.slug.length).toBeLessThanOrEqual(60);
  });
});

describe('renderSceneStateAsMarkdown', () => {
  it('returns empty string when sceneState is null', () => {
    expect(renderSceneStateAsMarkdown(null)).toBe('');
  });

  it('returns the malformed placeholder when flagged', () => {
    expect(renderSceneStateAsMarkdown(null, true)).toContain('_scene state unavailable_');
  });

  it('renders a single character without clothing/appearance cleanly', () => {
    const result = renderSceneStateAsMarkdown({
      location: 'library',
      characters: [{ characterId: 'a', characterName: 'Friday', action: 'reading', appearance: null, clothing: null }],
      updatedAt: '2026-05-14T00:00:00.000Z',
      updatedAtMessageCount: 1,
    });
    expect(result).toContain('### Scene at 2026-05-14T00:00:00.000Z');
    expect(result).toContain('- **Friday** — reading');
    expect(result).not.toContain('wearing');
  });
});

describe('sha256OfString', () => {
  it('produces a stable 64-char hex digest', () => {
    const hash = sha256OfString('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
});

describe('photos-paths helpers', () => {
  it('buildPhotosRelativePath nests under the canonical folder', () => {
    expect(buildPhotosRelativePath('a.webp')).toBe(`${PHOTOS_FOLDER}/a.webp`);
  });

  it('isPhotosRelativePath recognises photos-folder paths', () => {
    expect(isPhotosRelativePath('photos/a.webp')).toBe(true);
    expect(isPhotosRelativePath('photos/2026/a.webp')).toBe(true);
    expect(isPhotosRelativePath('Photos/a.webp')).toBe(true);
    expect(isPhotosRelativePath('images/avatar.webp')).toBe(false);
    expect(isPhotosRelativePath('')).toBe(false);
    expect(isPhotosRelativePath(null)).toBe(false);
  });
});
