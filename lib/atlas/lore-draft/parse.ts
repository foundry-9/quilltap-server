/**
 * Atlas lore draft — reading Brahma's answer into a draft.
 *
 * The answer should be one document: YAML frontmatter (`name`, `aliases`,
 * `graphicPrompt`) over a Markdown body (the knowledge). Models drift, so the
 * reader is forgiving: a whole-answer code fence is unwrapped, a stray line of
 * preamble before the frontmatter is dropped, aliases may be a list or a
 * comma-separated string, and an answer with no readable frontmatter at all
 * becomes a draft named after the subject with the whole answer as its
 * knowledge. A draft is never thrown away for its shape; the operator reviews
 * every field before saving.
 *
 * Aliases go through `normalizeAtlasAliases` (the server would too).
 *
 * @module atlas/lore-draft/parse
 */

import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser'
import { ATLAS_MAX_ALIASES, normalizeAtlasAliases } from '@/lib/schemas/atlas.types'
import { atlasKnowledgeOfBody } from '@/lib/atlas/vault-readers'
import type { AtlasLoreDraft } from './request-schema'

const NAME_MAX = 200

export interface ParsedAtlasLoreDraft {
  draft: AtlasLoreDraft
  /** False when no frontmatter could be read and the fallback was used. */
  structured: boolean
}

/** Unwrap a whole-answer ```markdown fence and drop anything before the frontmatter. */
function normalizeAnswer(answer: string): string {
  let text = answer.replace(/\r\n/g, '\n').trim()
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text)
  if (fence) text = fence[1].trim()
  if (!text.startsWith('---\n')) {
    const at = text.search(/^---\n/m)
    if (at > 0) text = text.slice(at)
  }
  return text
}

const asText = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  return null
}

function readAliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asText).filter((v): v is string => !!v)
  const text = asText(value)
  return text ? text.split(',').map((s) => s.trim()).filter(Boolean) : []
}

const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max).trim() : text)

export function parseAtlasLoreDraft(answer: string, subject: string): ParsedAtlasLoreDraft {
  const text = normalizeAnswer(answer)
  const parsed = parseFrontmatter(text)
  const fallbackName = clip(subject.trim(), NAME_MAX)

  if (!parsed.data) {
    return {
      draft: { name: fallbackName, aliases: [], graphicPrompt: null, knowledge: atlasKnowledgeOfBody(text) },
      structured: false,
    }
  }

  const data = parsed.data
  const name = clip(asText(data.name) ?? fallbackName, NAME_MAX)
  const aliases = normalizeAtlasAliases(
    name,
    readAliases(data.aliases).map((a) => clip(a, NAME_MAX)),
  ).slice(0, ATLAS_MAX_ALIASES)
  const graphicPrompt = asText(data.graphicPrompt ?? data.graphic_prompt)
  const knowledge = atlasKnowledgeOfBody(text.slice(parsed.bodyStartOffset))

  return { draft: { name, aliases, graphicPrompt, knowledge }, structured: true }
}
