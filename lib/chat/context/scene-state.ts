/**
 * The `## Current State` block of the Commonplace Book whisper. Pure
 * formatting; the turn's reads around it (the stored scene, the live
 * wardrobe, the per-recipient emission cache) are `turn-scene-state.ts`.
 */

import { createHash } from 'node:crypto'
import type { Provider } from '@/lib/schemas/types'
import type { SceneState } from '@/lib/schemas/chat.types'
import { estimateTokens } from '@/lib/tokens/token-counter'

/**
 * Per-target emission record for a single character's slice of the
 * Commonplace Book scene-state whisper. Persisted on
 * `chats.commonplaceSceneCache` so the next emission to the same target
 * can collapse the character's section to "_unchanged_" when both hashes
 * match.
 */
export interface SceneStateEmissionEntry {
  /** Short hash of the character's `action` text, after trim. */
  actionHash: string
  /** Short hash of the character's clothing text (live override or cached). */
  clothingHash: string
  /** ISO timestamp of the most recent FULL emission of this character's
   *  section to this target. Carried forward unchanged across compact
   *  emissions so the timestamp tracks the last time the content actually
   *  changed — useful for diagnostics and for the LLM to know how stale
   *  the cached scene is. */
  emittedAt: string
}

const SCENE_HASH_LENGTH = 16

function sceneHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, SCENE_HASH_LENGTH)
}

/**
 * Render the latest scene-state snapshot as the `## Current State` section
 * for the Commonplace Book whisper. Returns `''` when no scene state is
 * available so callers can treat the section as absent.
 *
 * `time` is the chat's announced timestamp (the same string the Host
 * announces); pass `null`/`undefined` when the chat is not announcing time
 * and the Time line is dropped entirely.
 *
 * `liveClothingByCharacterId` lets the caller override each character's
 * clothing line with a freshly-rendered description of their currently
 * equipped wardrobe slots. The cached `c.clothing` from scene state is only
 * refreshed at turn boundaries, so passing live values here keeps the
 * responding character's prompt in sync with mid-turn wardrobe edits and
 * `wardrobe_*` tool calls.
 *
 * `priorEmissionByCharacter` is the per-target emission cache from the most
 * recent Commonplace Book whisper for the same recipient. When a
 * character's current (action, clothing) hashes match the cached pair,
 * their section collapses to a single `### Name — _unchanged_` line; the
 * cached `emittedAt` is preserved on the returned `emittedByCharacter` so
 * subsequent compact emissions don't reset the timestamp. The caller
 * persists the returned map back to `chat.commonplaceSceneCache[target]`.
 */
export function formatCurrentSceneState(
  sceneState: SceneState | null | undefined,
  time: string | null | undefined,
  provider?: Provider,
  liveClothingByCharacterId?: ReadonlyMap<string, string>,
  priorEmissionByCharacter?: ReadonlyMap<string, SceneStateEmissionEntry>,
): {
  content: string
  tokenCount: number
  emittedByCharacter: Map<string, SceneStateEmissionEntry>
} {
  if (!sceneState) {
    return { content: '', tokenCount: 0, emittedByCharacter: new Map() }
  }

  const characters = Array.isArray(sceneState.characters) ? sceneState.characters : []
  const names = characters.map(c => c.characterName).filter(n => typeof n === 'string' && n.length > 0)

  const lines: string[] = ['## Current State', '']
  lines.push(`- **Location**: ${sceneState.location || 'Unknown'}`)
  lines.push(`- **Characters Present**: ${names.join(', ')}`)
  if (time && time.trim().length > 0) {
    lines.push(`- **Time**: ${time.trim()}`)
  }
  lines.push('- **Active Now**: true')

  const nowIso = new Date().toISOString()
  const emittedByCharacter = new Map<string, SceneStateEmissionEntry>()

  for (const c of characters) {
    if (!c.characterName) continue

    const actionText = (c.action ?? '').trim() || '_unspecified_'
    const liveClothing = liveClothingByCharacterId?.get(c.characterId)?.trim()
    const clothingText = liveClothing || (c.clothing ?? '').trim() || '_unspecified_'
    const actionHash = sceneHash(actionText)
    const clothingHash = sceneHash(clothingText)

    const prior = c.characterId ? priorEmissionByCharacter?.get(c.characterId) : undefined
    const unchanged = !!prior && prior.actionHash === actionHash && prior.clothingHash === clothingHash

    lines.push('')
    if (unchanged) {
      // Compact: skip the full Action + Clothing prose. The prior whisper
      // already conveyed it; the recipient's LLM client (or the Courier
      // delta consumer) still remembers.
      lines.push(`### ${c.characterName} — _unchanged_`)
    } else {
      lines.push(`### ${c.characterName}`)
      lines.push('')
      lines.push('#### Action')
      lines.push('')
      lines.push(actionText)
      lines.push('')
      lines.push('#### Clothing')
      lines.push('')
      lines.push(clothingText)
    }

    if (c.characterId) {
      emittedByCharacter.set(c.characterId, {
        actionHash,
        clothingHash,
        // Preserve the prior timestamp when nothing changed — it tracks
        // the last time the section was *actually* re-emitted in full.
        emittedAt: unchanged && prior ? prior.emittedAt : nowIso,
      })
    }
  }

  const content = lines.join('\n')
  const tokenCount = estimateTokens(content + '\n', provider)
  return { content, tokenCount, emittedByCharacter }
}
