/**
 * The Commonplace vault files — paths, rendering, and reading back.
 *
 * After a consolidation run, each subject bucket's hot digests are mirrored
 * into the holder's vault (memory-consolidation-and-tiers.md §C6):
 *
 *   - `Commonplace/<Subject Name>.md` — what the holder knows about another
 *     character, digested.
 *   - `Commonplace/Self.md` — what the holder knows about themselves.
 *
 * The folder is deliberately separate from the hand-written `Others/` folder
 * so no user prose is ever overwritten; the files are rewritten whole on every
 * run. The extractor's canon loaders (`cheap-llm-tasks/canon.ts`) read them
 * back as ALREADY ESTABLISHED, which is the loop that stops a digested fact
 * from being re-mined turn after turn.
 *
 * No I/O. The writer is `lib/file-storage/commonplace-digest-vault-bridge.ts`.
 *
 * @module memory/commonplace-file
 */

import { estimateTokens } from '@/lib/tokens/token-counter'
import { sanitizeFileName } from '@/lib/mount-index/character-vault'

/** Vault folder holding the digest mirrors. */
export const COMMONPLACE_FOLDER = 'Commonplace'

/** Frontmatter `type` stamped on every digest mirror. */
export const COMMONPLACE_FRONTMATTER_TYPE = 'commonplace-digest'

/** Basename of the self-bucket mirror. */
export const COMMONPLACE_SELF_STEM = 'Self'

/** Token ceiling on a mirror file's body (spec: "≤ ~1,500 tokens"). */
export const COMMONPLACE_FILE_TOKEN_BUDGET = 1500

/**
 * Vault-relative path of the mirror for one subject. `subject: 'self'` →
 * `Commonplace/Self.md`. A character actually named "Self" gets its id prefix
 * appended so it can never collide with the self file.
 */
export function commonplacePathFor(
  subject: 'self' | { id: string; name: string },
): string {
  if (subject === 'self') return `${COMMONPLACE_FOLDER}/${COMMONPLACE_SELF_STEM}.md`
  // Same sanitizer the `Others/<name>.md` canon lookup uses.
  let stem = sanitizeFileName(subject.name)
  if (stem.toLowerCase() === COMMONPLACE_SELF_STEM.toLowerCase()) {
    stem = `${stem} (${subject.id.slice(0, 8)})`
  }
  return `${COMMONPLACE_FOLDER}/${stem}.md`
}

/** One digest as the mirror renders it. */
export interface CommonplaceDigestEntry {
  content: string
  kind: 'semantic' | 'episodic'
  occurredAt: string | null
  /** Ranking key — highest first. */
  reinforcedImportance: number
}

export interface CommonplaceFileInput {
  /** The subject's character id (the holder's own id for the self file). */
  subjectCharacterId: string
  /** Display name for the heading; ignored for the self file. */
  subjectName: string
  isSelf: boolean
  digests: CommonplaceDigestEntry[]
  /** ISO timestamp stamped as frontmatter `updatedAt`. */
  updatedAt: string
}

function renderEntry(d: CommonplaceDigestEntry): string {
  const text = d.content.replace(/\s*\n\s*/g, ' ').trim()
  if (d.kind === 'episodic' && d.occurredAt) {
    return `- [${d.occurredAt.slice(0, 10)}] ${text}`
  }
  return `- ${text}`
}

/**
 * Render a mirror file: frontmatter, a heading, then one bullet per digest,
 * highest `reinforcedImportance` first, stopping before the body would pass
 * {@link COMMONPLACE_FILE_TOKEN_BUDGET}. Frontmatter values are plain scalars
 * (ids and an ISO stamp), so they are written without a YAML library.
 */
export function renderCommonplaceFile(input: CommonplaceFileInput): {
  content: string
  entriesWritten: number
  entriesDropped: number
} {
  const heading = input.isSelf ? `# ${COMMONPLACE_SELF_STEM}` : `# ${input.subjectName.trim() || 'Unnamed'}`
  const ordered = [...input.digests].sort((a, b) => b.reinforcedImportance - a.reinforcedImportance)

  const lines: string[] = [heading, '']
  let tokens = estimateTokens(heading)
  let written = 0
  for (const digest of ordered) {
    const line = renderEntry(digest)
    const cost = estimateTokens(line)
    if (written > 0 && tokens + cost > COMMONPLACE_FILE_TOKEN_BUDGET) break
    lines.push(line)
    tokens += cost
    written++
  }

  const frontmatter = [
    '---',
    `type: ${COMMONPLACE_FRONTMATTER_TYPE}`,
    `subjectCharacterId: ${JSON.stringify(input.subjectCharacterId)}`,
    `updatedAt: ${JSON.stringify(input.updatedAt)}`,
    '---',
  ].join('\n')

  return {
    content: `${frontmatter}\n${lines.join('\n')}\n`,
    entriesWritten: written,
    entriesDropped: ordered.length - written,
  }
}

/**
 * Turn a mirror file back into canon text: drop the frontmatter block and the
 * `#` heading, keep the digest lines. Returns null when nothing is left.
 */
export function commonplaceFileToCanonText(raw: string | null | undefined): string | null {
  if (!raw) return null
  let body = raw
  if (body.startsWith('---\n')) {
    const close = body.indexOf('\n---', 4)
    if (close >= 0) {
      const after = body.indexOf('\n', close + 4)
      body = after >= 0 ? body.slice(after + 1) : ''
    }
  }
  const kept = body
    .split('\n')
    .filter((line) => !/^#\s/.test(line))
    .join('\n')
    .trim()
  return kept.length > 0 ? kept : null
}

/**
 * Trim `text` so it fits in `budgetTokens`, cutting at a line boundary where
 * possible. Returns null when the budget leaves no room at all.
 */
export function truncateToTokenBudget(text: string, budgetTokens: number): string | null {
  if (budgetTokens <= 0) return null
  if (estimateTokens(text) <= budgetTokens) return text
  const lines = text.split('\n')
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = estimateTokens(`${line}\n`)
    if (used + cost > budgetTokens) break
    kept.push(line)
    used += cost
  }
  if (kept.length > 0) return kept.join('\n')
  // A single over-long first line: cut it by proportion.
  const ratio = budgetTokens / Math.max(1, estimateTokens(text))
  const cut = text.slice(0, Math.max(0, Math.floor(text.length * ratio) - 1)).trimEnd()
  return cut.length > 0 ? `${cut}…` : null
}
