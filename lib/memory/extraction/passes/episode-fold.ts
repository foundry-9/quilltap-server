/**
 * The `episode-fold` pass: 0–2 consolidated, dated episode records over a
 * folded stretch (episodic spine — creation-side keystone), written as
 * `kind: 'episodic'` memories for every present character, and linked to each
 * character's per-turn fragment memories from the same stretch so one-hop
 * expansion can pull the fragments when the episode surfaces.
 *
 * A `when` phrase resolves against the stretch's newest message (the clock the
 * model was shown), falling back to its oldest; the row's `createdAt` is the
 * stretch's newest message, never the event date.
 *
 * @module memory/extraction/passes/episode-fold
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { admissionInserted, linkBothWays } from '../../admission'
import { parseEpisodeDrafts } from '../parse'
import { buildEpisodeFoldMessages, FOLD_EPISODE_CAP } from '../prompts/episode'
import { clockAt, type ExtractionContext } from '../context'
import type { AdmittedCandidate, ExtractionPass, PassCall } from '../run'
import type { TranscriptWindow } from '../window'

/** Cap on fragment links attached to one episode (per character). */
export const MAX_FRAGMENT_LINKS = 8

/**
 * A fresh episode pass. It remembers the episodes it has written, so an
 * episode is never linked as a fragment of a later one in the same run.
 */
export function episodeFoldPass(): ExtractionPass {
  const writtenEpisodeIds = new Set<string>()
  return {
    name: 'episode-fold',
    candidatePass: 'episode-fold',
    taskType: 'fold-episode-extraction',
    async calls(ctx: ExtractionContext, window: TranscriptWindow): Promise<PassCall[]> {
      if (window.kind !== 'stretch' || window.messages.length === 0) return []
      const holders = [...ctx.cast.values()].filter(m => m.participantId && m.present)
      if (holders.length === 0) return []
      const lastStamped = [...window.messages].reverse().find(m => m.createdAt)
      const sourceMessageId = lastStamped?.id ?? window.messages[window.messages.length - 1]?.id ?? null
      return [{
        label: 'episode memory',
        holders,
        messages: buildEpisodeFoldMessages({ stretch: window.rendered, clock: clockAt(ctx, window.nowIso) }),
        parse: raw => {
          const drafts = parseEpisodeDrafts(raw, FOLD_EPISODE_CAP)
          return drafts.map(draft => ({
            holders,
            about: null,
            drafts: [draft],
            source: { messageId: sourceMessageId, createdAt: window.nowIso },
            anchors: { referenceIso: window.nowIso, fallbackIso: window.startIso },
          }))
        },
      }]
    },
    async afterBatch(ctx: ExtractionContext, window: TranscriptWindow, admitted: AdmittedCandidate[]): Promise<void> {
      if (window.kind !== 'stretch') return
      // Only an inserted row is this run's episode. A reinforce or absorb names
      // a row that already existed — perhaps one of the very fragments — and
      // must neither be counted a sibling episode nor have fragments linked to
      // it (review of PR 94).
      const episodes = admitted.filter(a => a.outcome.memory && admissionInserted(a.outcome))
      for (const a of episodes) writtenEpisodeIds.add(a.outcome.memory!.id)
      if (ctx.dryRun) return
      const windowMessageIds = window.messages.map(m => m.id)
      for (const a of episodes) {
        const memory = a.outcome.memory
        if (!memory) continue
        const characterId = a.candidate.subject.holderId
        try {
          await linkFragments(characterId, memory.id, memory.relatedMemoryIds ?? [], windowMessageIds, writtenEpisodeIds)
        } catch (error) {
          logger.warn('[Memory] Failed to link episode fragments', {
            chatId: ctx.chat.id,
            characterId,
            episodeId: memory.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
  }
}

/**
 * Link a character's per-turn fragments from the stretch to its episode. Links
 * are deltas against the rows at commit (bug 231); only pairs not already
 * linked on both sides are written. The admitted row's `relatedMemoryIds` is
 * the post-link row, so links admission made are kept (bug 26). Episodes this
 * run wrote are siblings, not fragments (finding 10).
 */
async function linkFragments(
  characterId: string,
  episodeId: string,
  episodeLinks: readonly string[],
  windowMessageIds: string[],
  writtenEpisodeIds: ReadonlySet<string>,
): Promise<number> {
  const found = await getRepositories().memories.findByCharacterAndSourceMessageIds(characterId, windowMessageIds)
  const fragments = found.filter(f => !writtenEpisodeIds.has(f.id) && f.id !== episodeId).slice(0, MAX_FRAGMENT_LINKS)
  if (fragments.length === 0) return 0
  const existing = new Set(episodeLinks)
  const newlyLinked = fragments.filter(f => !(f.relatedMemoryIds ?? []).includes(episodeId))
  const linkTo = fragments
    .map(f => f.id)
    .filter(id => !existing.has(id) || newlyLinked.some(f => f.id === id))
  if (linkTo.length > 0) await linkBothWays(characterId, episodeId, linkTo)
  logger.debug('[Memory] Episode fragments linked', {
    characterId,
    episodeId,
    fragments: fragments.length,
    newlyLinked: newlyLinked.length,
  })
  return newlyLinked.length
}
