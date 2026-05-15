/**
 * Kept-image Markdown builder + parser.
 *
 * `keep_image` writes a Markdown document into `doc_mount_file_links.extractedText`
 * for the new vault link. That Markdown carries:
 *
 *   - YAML frontmatter with the tags, the keeping character, and the model
 *     used to generate the image.
 *   - The original generation prompt (and revised prompt if different) so a
 *     non-image-reading LLM can still reason about what the image depicts.
 *   - A scene snapshot taken from the chat's `sceneState` at keep-time —
 *     provenance for "what was happening when this image was taken."
 *   - A footer attributing the save to the character with the optional
 *     caption.
 *
 * The extractedText is what the mount-index chunk pipeline embeds, so all
 * of this content is automatically searchable through the character's vault.
 *
 * @module photos/keep-image-markdown
 */

import path from 'path';
import { createHash } from 'crypto';
import YAML from 'yaml';
import type { SceneState } from '@/lib/schemas/chat.types';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';

const SLUG_MAX_LENGTH = 60;
const SLUG_FALLBACK = 'kept';
const PROMPT_SLUG_WORD_COUNT = 6;

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export interface BuildKeptImageMarkdownInput {
  generationPrompt: string | null;
  generationRevisedPrompt: string | null;
  generationModel: string | null;
  sceneState: SceneState | null;
  /** True when chat.sceneState was non-null but failed schema validation. */
  sceneStateMalformed?: boolean;
  characterName: string;
  characterId: string;
  tags: string[];
  caption: string | null;
  keptAt: string;
}

/**
 * Build the full Markdown document that gets stored as the link's extractedText.
 */
export function buildKeptImageMarkdown(input: BuildKeptImageMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    tags: input.tags ?? [],
    linkedBy: input.characterName,
    linkedById: input.characterId,
    generationModel: input.generationModel ?? null,
  };
  const yamlBlock = `---\n${YAML.stringify(frontmatter)}---\n`;

  const sections: string[] = [];

  const prompt = (input.generationPrompt ?? '').trim();
  if (prompt) {
    sections.push(`## Original prompt\n\n${prompt}`);
  }

  const revised = (input.generationRevisedPrompt ?? '').trim();
  if (revised && revised !== prompt) {
    sections.push(`## Revised prompt\n\n${revised}`);
  }

  const sceneBlock = renderSceneStateAsMarkdown(input.sceneState, input.sceneStateMalformed === true);
  if (sceneBlock) {
    sections.push(sceneBlock);
  }

  sections.push(buildAttributionLine(input.characterName, input.keptAt, input.caption));

  return `${yamlBlock}\n${sections.join('\n\n')}\n`;
}

function buildAttributionLine(characterName: string, keptAt: string, caption: string | null): string {
  const trimmedCaption = caption?.trim() ?? '';
  if (trimmedCaption) {
    return `${characterName} saved this image at ${keptAt} with this caption: ${trimmedCaption}`;
  }
  return `${characterName} saved this image at ${keptAt}.`;
}

/**
 * Render a SceneState snapshot as a small Markdown subsection. Returns the
 * empty string when no scene state is available (so the caller can drop the
 * section entirely instead of emitting an empty heading).
 *
 * If `malformed` is true the chat carried a sceneState column that didn't
 * parse against the schema; emit a single placeholder line so the operator
 * can spot the issue without losing the whole Markdown body.
 */
export function renderSceneStateAsMarkdown(
  sceneState: SceneState | null,
  malformed = false
): string {
  if (malformed) {
    return '### Scene at the time\n\n_scene state unavailable_';
  }
  if (!sceneState) return '';

  const lines: string[] = [`### Scene at ${sceneState.updatedAt}`, ''];
  lines.push(`- **Location**: ${sceneState.location || '_unspecified_'}`);

  const characters = sceneState.characters ?? [];
  if (characters.length > 0) {
    const names = characters.map(c => c.characterName).filter(Boolean).join(', ');
    if (names) {
      lines.push(`- **Characters present**: ${names}`);
    }
    lines.push('');
    for (const c of characters) {
      const segments: string[] = [];
      if (c.action) segments.push(c.action);
      else segments.push('no action recorded');
      if (c.clothing) segments.push(`wearing ${c.clothing}`);
      if (c.appearance) segments.push(c.appearance);
      lines.push(`- **${c.characterName}** — ${segments.join('; ')}`);
    }
  }

  return lines.join('\n').trimEnd();
}

export interface KeptImageFrontmatter {
  tags: string[];
  linkedBy: string | null;
  linkedById: string | null;
  generationModel: string | null;
  /** The trailing "X saved this image at TS with this caption: …" caption, if any. */
  caption: string | null;
}

/**
 * Reverse of `buildKeptImageMarkdown` — pulls the structured metadata back
 * out of a link's `extractedText`. Used by `list_images` and the chat GET
 * resolver to surface the caption / tags without re-walking the chat.
 */
export function parseKeptImageFrontmatter(extractedText: string | null | undefined): KeptImageFrontmatter {
  const empty: KeptImageFrontmatter = {
    tags: [],
    linkedBy: null,
    linkedById: null,
    generationModel: null,
    caption: null,
  };
  if (!extractedText) return empty;

  const parsed = parseFrontmatter(extractedText);
  const data = parsed.data ?? {};

  const tagsRaw = data.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === 'string')
    : [];

  const linkedBy = typeof data.linkedBy === 'string' ? data.linkedBy : null;
  const linkedById = typeof data.linkedById === 'string' ? data.linkedById : null;
  const generationModel = typeof data.generationModel === 'string' ? data.generationModel : null;

  const caption = extractCaptionFromBody(extractedText.slice(parsed.bodyStartOffset));

  return { tags, linkedBy, linkedById, generationModel, caption };
}

const CAPTION_REGEX = / saved this image at [^\s]+ with this caption: (.+)$/m;

function extractCaptionFromBody(body: string): string | null {
  const match = body.match(CAPTION_REGEX);
  if (!match) return null;
  return match[1].trim();
}

export interface BuildSlugAndFilenameInput {
  caption: string | null;
  generationPrompt: string | null;
  mimeType: string;
  /** ISO timestamp; colons replaced with hyphens for path safety. */
  keptAt: string;
}

export interface BuildSlugAndFilenameOutput {
  slug: string;
  filename: string;
  extension: string;
}

export function buildSlugAndFilename(input: BuildSlugAndFilenameInput): BuildSlugAndFilenameOutput {
  const slugSource = (input.caption?.trim()
    ? input.caption
    : firstWordsOf(input.generationPrompt ?? '', PROMPT_SLUG_WORD_COUNT)) ?? '';
  const slug = slugify(slugSource) || SLUG_FALLBACK;
  const extension = extensionForMime(input.mimeType);
  const safeTimestamp = input.keptAt.replace(/:/g, '-');
  const filename = `${safeTimestamp}-${slug}.${extension}`;
  return { slug, filename, extension };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

function firstWordsOf(text: string, wordCount: number): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/).slice(0, wordCount).join(' ');
}

function extensionForMime(mime: string): string {
  const key = (mime || '').toLowerCase();
  if (MIME_TO_EXTENSION[key]) return MIME_TO_EXTENSION[key];
  if (key.startsWith('image/')) {
    const sub = key.slice('image/'.length).split(/[+;]/)[0];
    if (sub) return sub;
  }
  return 'bin';
}

/**
 * Convenience: compute the SHA-256 of a UTF-8 string. Useful for the
 * `extractedTextSha256` field on the link row, so future writers can detect
 * "the extracted text content hasn't changed" without rehashing.
 */
export function sha256OfString(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Posix-basename a relative path. Re-exported here purely for handler
 * brevity — saves an `import path from 'path'` in every consumer.
 */
export function basenameOfRelativePath(relativePath: string): string {
  return path.posix.basename(relativePath);
}
