/**
 * @fileoverview Tool definition for `list_images` — searches and lists
 * images previously kept to a character's photo album (and, when Shared
 * Vaults is on, the visible albums of other characters in the chat).
 */

export const listImagesTool = {
  type: 'function',
  function: {
    name: 'list_images',
    description:
      "List images previously saved to your photo album (and other characters' albums if cross-character vault reads are enabled for this chat). When `query` is set, results are ranked by semantic similarity over the saved image's prompt, scene snapshot, caption, and tags. The returned metadata includes the prompt excerpt so even a non-image-capable model can reason about each entry without rendering it. Use the returned uuid with `attach_image` to show one of these images again in the chat.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional semantic search query. Searches the saved prompt, scene, caption, and tags.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tag filter. An image matches if any of its tags appears in the list.',
        },
        saved_by: {
          type: 'string',
          description: 'Optional filter: character name or id of the character who saved the image. Defaults to all visible albums.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return. Defaults to 20.',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset. Defaults to 0.',
        },
      },
      required: [],
    },
  },
};

export function validateListImagesInput(input: unknown): input is ListImagesInput {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  if (o.query !== undefined && typeof o.query !== 'string') return false;
  if (o.saved_by !== undefined && typeof o.saved_by !== 'string') return false;
  if (o.limit !== undefined && typeof o.limit !== 'number') return false;
  if (o.offset !== undefined && typeof o.offset !== 'number') return false;
  if (o.tags !== undefined) {
    if (!Array.isArray(o.tags) || !o.tags.every(t => typeof t === 'string')) return false;
  }
  return true;
}

export interface ListImagesInput {
  query?: string;
  tags?: string[];
  saved_by?: string;
  limit?: number;
  offset?: number;
}

export interface ListedImage {
  /** doc_mount_file_links.id — the album link uuid; pass this to attach_image. */
  uuid: string;
  /** Path inside the vault mount point. */
  relative_path: string;
  /** Mount point display name. */
  mount_point: string;
  /** Saver. */
  linked_by: string | null;
  linked_by_id: string | null;
  /** ISO timestamp the photo was kept. */
  kept_at: string;
  caption: string | null;
  tags: string[];
  /** First ~200 chars of the generation prompt for at-a-glance scanning. */
  generation_prompt_excerpt: string;
  /** Set when `query` was supplied: cosine score (with literal boosts) of the top hit. */
  relevance_score?: number;
}

export interface ListImagesOutput {
  images: ListedImage[];
  total: number;
  has_more: boolean;
}
