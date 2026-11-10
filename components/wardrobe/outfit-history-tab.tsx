'use client'

/**
 * OutfitHistoryTab — the Wardrobe dialog's History tab: one character's
 * numbered outfit timeline in this chat, newest first, with **Wear again** on
 * every entry but the current one.
 *
 * Reads `?action=wardrobe-history` (refetched on the `chats` realtime topic,
 * so a tool call under an open dialog shows up without a poll). Wear again
 * stages, like every other wardrobe gesture: the recorded outfit appears on the
 * Live tab and nothing is sent until Done, when the dialog commits it through
 * `?action=wardrobe-rollback` (`useStagedLiveOutfits`). Picking an outfit
 * replaces any other staging for the character, so when there is some the
 * operator confirms first. A staged pick can be taken back with Unstage.
 *
 * Design of record: docs/developer/features/complete/wardrobe-outfit-history.md §8.4
 *
 * @module components/wardrobe/outfit-history-tab
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { formatRelativeDate } from '@/lib/format-time'
import { useNow } from '@/hooks/useNow'
import { WARDROBE_SLOT_TYPES, WARDROBE_SLOT_META } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

export interface OutfitHistorySlotItem {
  itemId: string
  title: string | null
  archived: boolean
  missing: boolean
}

export interface OutfitHistoryEntry {
  index: number
  at: string
  source: string
  actorCharacterId: string | null
  actorName: string | null
  /** Pascal entries: the custom tool that made the change. */
  actorToolName: string | null
  changedBy: string
  isCurrent: boolean
  summary: string
  slots: Record<WardrobeItemType, OutfitHistorySlotItem[]>
}

export interface OutfitHistoryResponse {
  currentIndex: number | null
  entries: OutfitHistoryEntry[]
}

export interface OutfitHistoryTabProps {
  chatId: string
  characterId: string
  characterName: string
  /** True when the Live tab holds unsaved staged edits for this character. */
  hasStagedEdits: boolean
  /** The history index the staging returns this character to, if any. */
  stagedIndex: number | null
  /** Stage a return to `entry` on the Live tab; it applies on Done. */
  stageEntry: (entry: OutfitHistoryEntry) => void
  /** Throw away this character's staged edits (a staged pick included). */
  discardStagedEdits: () => void
  requestConfirmation: (message: string) => Promise<boolean>
}

/** The ids in an entry that Wear again will leave off. */
function staleCount(entry: OutfitHistoryEntry): number {
  const ids = new Set<string>()
  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const item of entry.slots[slot] ?? []) {
      if (item.archived || item.missing) ids.add(item.itemId)
    }
  }
  return ids.size
}

function EntrySlots({ entry }: { entry: OutfitHistoryEntry }) {
  const filled = WARDROBE_SLOT_TYPES.filter((slot) => (entry.slots[slot] ?? []).length > 0)
  if (filled.length === 0) {
    return <p className="qt-text-xs qt-text-muted italic">Nothing at all.</p>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {filled.map((slot) =>
        entry.slots[slot].map((item) => {
          const stale = item.archived || item.missing
          return (
            <span
              key={`${slot}:${item.itemId}`}
              className={`qt-badge ${stale ? 'qt-badge-secondary' : WARDROBE_SLOT_META[slot].badgeClass} text-xs`}
              title={`${WARDROBE_SLOT_META[slot].label}${stale ? (item.missing ? ' — no longer exists' : ' — archived') : ''}`}
            >
              {item.title ?? item.itemId}
              {item.missing ? ' · gone' : item.archived ? ' · archived' : ''}
            </span>
          )
        }),
      )}
    </div>
  )
}

export function OutfitHistoryTab({
  chatId,
  characterId,
  characterName,
  hasStagedEdits,
  stagedIndex,
  stageEntry,
  discardStagedEdits,
  requestConfirmation,
}: OutfitHistoryTabProps) {
  const nowMs = useNow(60_000)
  const history = useQuery({
    queryKey: queryKeys.wardrobe.history(chatId, characterId),
    queryFn: ({ signal }) =>
      apiFetch<OutfitHistoryResponse>(
        `/api/v1/chats/${chatId}?action=wardrobe-history&characterId=${encodeURIComponent(characterId)}`,
        { signal },
      ),
  })

  const wearAgain = async (entry: OutfitHistoryEntry) => {
    // A staged pick that still stands is simply replaced; other edits are
    // the operator's to give up.
    if (hasStagedEdits && stagedIndex === null) {
      const ok = await requestConfirmation(
        `Discard the staged changes to ${characterName}'s outfit and stage outfit ${entry.index} instead?`,
      )
      if (!ok) return
    }
    stageEntry(entry)
  }

  const entries = [...(history.data?.entries ?? [])].sort((a, b) => b.index - a.index)

  return (
    <div className="space-y-2 mb-3">
      <p className="qt-text-xs qt-text-secondary px-1">
        Every change of clothes in this chat, numbered from the outfit they arrived in. Wear
        again stages one on the Live outfit tab; it goes on when you click Done, and Aurora
        will say so.
      </p>

      {history.isLoading && <p className="qt-text-xs qt-text-muted px-1">Consulting the record…</p>}
      {history.isError && (
        <p className="qt-text-xs qt-text-danger px-1">
          {apiErrorMessage(history.error, 'The outfit record could not be read.')}
        </p>
      )}
      {history.isSuccess && entries.length === 0 && (
        <p className="qt-text-xs qt-text-muted px-1">
          No outfits recorded yet. The first change of clothes starts the record.
        </p>
      )}

      <ul className="space-y-2">
        {entries.map((entry) => {
          const stale = staleCount(entry)
          return (
            <li key={entry.index} className="qt-card p-2" data-testid={`outfit-history-entry-${entry.index}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="qt-badge text-xs">#{entry.index}</span>
                <span className="qt-text-xs qt-text-secondary" title={new Date(entry.at).toLocaleString()}>
                  {formatRelativeDate(entry.at, nowMs)}
                </span>
                <span className="qt-text-xs qt-text-secondary">· {entry.changedBy}</span>
                <span className="flex-1" />
                {entry.index === stagedIndex ? (
                  <>
                    <span className="qt-badge text-xs">Staged — on at Done</span>
                    <button
                      type="button"
                      className="qt-button-secondary qt-button-sm"
                      onClick={discardStagedEdits}
                      title={`Leave ${characterName} in what they are wearing now`}
                    >
                      Unstage
                    </button>
                  </>
                ) : entry.isCurrent ? (
                  <span className="qt-badge text-xs">Wearing now</span>
                ) : (
                  <button
                    type="button"
                    className="qt-button-secondary qt-button-sm"
                    onClick={() => void wearAgain(entry)}
                    title={
                      stale > 0
                        ? `${stale} item${stale === 1 ? ' in this outfit is' : 's in this outfit are'} no longer available and will be left off.`
                        : `Return ${characterName} to outfit ${entry.index}`
                    }
                  >
                    Wear again
                  </button>
                )}
              </div>
              <p className="qt-text-xs mb-1">{entry.summary}</p>
              <EntrySlots entry={entry} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
