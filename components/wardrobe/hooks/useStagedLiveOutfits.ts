'use client'

/**
 * Staged Live-outfit edits for the wardrobe dialog.
 *
 * Per-slot tweaks on the Live tab used to call the equip API one at a time,
 * and the server fired a fresh avatar regen + Aurora announcement on every
 * call. Now every Live-tab gesture stages here, keyed by character, and on
 * Done each character whose staged slots differ from their baseline gets one
 * `set_all` — at most one announcement and one regen per character per dialog
 * session.
 *
 * The pure core (rebasing, classification, the `set_all` body) lives in
 * `lib/wardrobe/staged-live-outfits.ts`; this hook owns the React state and
 * the two moments that need it: seeding from the worn snapshot (replaying any
 * gesture made before it arrived — Bug 61) and the Done flush.
 *
 * The History tab's "Wear again" stages here too (`stageRollback`). On Done a
 * staged rollback that still matches what the Live tab shows is committed
 * through `?action=wardrobe-rollback`, so the history cursor moves rather than
 * a new entry being appended; one edited further is an ordinary `set_all`.
 *
 * @module components/wardrobe/hooks/useStagedLiveOutfits
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  EMPTY_EQUIPPED_SLOTS,
  cloneEquippedSlots,
  equippedSlotsEqual,
  makeEmptyEquippedSlots,
  type EquippedSlots,
} from '@/lib/schemas/wardrobe.types'
import {
  appendWornBundleIds,
  buildSetAllEquipBody,
  classifyStagedOutfits,
  rebaseStagedGestures,
  rollbackGesture,
  rollbackTargetSlots,
  standingRollbacks,
  type HistoryEntrySlots,
  type StagedGesture,
  type StagedRollback,
} from '@/lib/wardrobe/staged-live-outfits'

interface RollbackResponse {
  restoredIndex: number
  skipped?: Array<{ itemId: string; title: string | null; reason: 'archived' | 'missing' }>
}

export interface UseStagedLiveOutfitsOptions {
  chatId: string | null
  /** The character the Live tab is showing. */
  characterId: string | null
  /** That character's worn slots, or undefined until the snapshot arrives. */
  wornSlots: EquippedSlots | undefined
  /** Display name for a character id (the unresolved-snapshot prompt names them). */
  characterName: (characterId: string) => string | undefined
  requestConfirmation: (message: string) => Promise<boolean>
}

export interface UseStagedLiveOutfitsResult {
  /** What the Live tab paints: the staged slots, else the worn snapshot, else empty. */
  displaySlots: EquippedSlots
  /** Stage one gesture for the current character. No server call. */
  apply: (gesture: StagedGesture) => void
  /**
   * Commit every dirty character with one `set_all` each. Resolves true when
   * the dialog may close (all commits succeeded, or nothing to commit).
   */
  flush: () => Promise<boolean>
  /** True when a character has staged edits Done would commit. */
  isDirty: (characterId: string) => boolean
  /**
   * Stage a return to a recorded outfit for the current character, replacing
   * any other staging. Nothing is sent until Done.
   */
  stageRollback: (entry: { index: number; slots: HistoryEntrySlots }) => void
  /**
   * The history index a character's staging returns them to, or null when no
   * rollback is staged or the Live tab has been edited away from it since.
   */
  stagedRollbackIndex: (characterId: string) => number | null
  /**
   * Throw away a character's staged edits (a staged rollback included). The
   * Live tab re-seeds from the current worn snapshot.
   */
  discard: (characterId: string) => void
}

export function useStagedLiveOutfits({
  chatId,
  characterId,
  wornSlots,
  characterName,
  requestConfirmation,
}: UseStagedLiveOutfitsOptions): UseStagedLiveOutfitsResult {
  const queryClient = useQueryClient()
  const isInChat = chatId !== null
  const [stagedByChar, setStagedByChar] = useState<Record<string, EquippedSlots>>({})
  // Outfits (bundles) the staged gestures put on, per character. The staged
  // slots hold only the dissolved leaves, so these ids ride beside them on the
  // `set_all` flush for the wear ledger. Recomputed on rebase, cleared on commit.
  const [wornBundlesByChar, setWornBundlesByChar] = useState<Record<string, string[]>>({})
  // History-tab picks, per character, until Done or discard.
  const [rollbackByChar, setRollbackByChar] = useState<Record<string, StagedRollback>>({})
  const baselineByCharRef = useRef<Record<string, EquippedSlots>>({})
  const seededRef = useRef<Set<string>>(new Set())
  // Gestures made before the worn snapshot arrived, keyed by character. The
  // seeding effect replays them onto the real slots. Without this the fast
  // click is either overwritten by the first seed (Bug 61's silent loss) or
  // committed against an empty base, undressing everything never touched.
  const pendingRef = useRef<Record<string, StagedGesture[]>>({})
  // Bumped by `discard` so the seeding effect runs again for a character
  // whose staging was thrown away, even if the snapshot has not changed yet.
  const [reseedTick, setReseedTick] = useState(0)

  const seedKeyFor = useCallback(
    (cid: string): string => `${cid}|${chatId ?? 'no-chat'}`,
    [chatId],
  )

  // Seed once we have a worn snapshot for this character. The baseline is
  // captured separately so the Done flush can skip no-op commits; re-seeding
  // is ref-gated so refetches don't blow away in-progress edits.
  useEffect(() => {
    if (!isInChat || !characterId || !wornSlots) return
    const seedKey = seedKeyFor(characterId)
    if (seededRef.current.has(seedKey)) return
    seededRef.current.add(seedKey)
    baselineByCharRef.current[characterId] = cloneEquippedSlots(wornSlots)
    const pending = pendingRef.current[characterId] ?? []
    delete pendingRef.current[characterId]
    // The staged slots and their bundle claims rebase together.
    const seed = rebaseStagedGestures(wornSlots, pending)
    setStagedByChar((prev) => ({ ...prev, [characterId]: seed.slots }))
    setWornBundlesByChar((prev) => ({ ...prev, [characterId]: seed.wornBundleIds }))
  }, [isInChat, characterId, wornSlots, seedKeyFor, reseedTick])

  const apply = useCallback(
    (gesture: StagedGesture) => {
      if (!isInChat || !characterId) return
      const cid = characterId
      // Until the worn snapshot has seeded there is no honest base to stage
      // onto: the gesture paints against an empty fallback, and is recorded so
      // the seed can replay it onto the real slots.
      if (!seededRef.current.has(seedKeyFor(cid))) {
        pendingRef.current[cid] = [...(pendingRef.current[cid] ?? []), gesture]
      }
      if (gesture.wornBundleIds.length > 0) {
        setWornBundlesByChar((prev) => ({
          ...prev,
          [cid]: appendWornBundleIds(prev[cid], gesture.wornBundleIds),
        }))
      }
      setStagedByChar((prev) => {
        const current =
          prev[cid] ?? (wornSlots ? cloneEquippedSlots(wornSlots) : makeEmptyEquippedSlots())
        return { ...prev, [cid]: gesture.mutate(current) }
      })
    },
    [isInChat, characterId, wornSlots, seedKeyFor],
  )

  /**
   * A character staged against no baseline at all is *not* clean — their worn
   * snapshot never arrived, so the staging was built on an empty fallback and
   * committing it would undress them. That case is put to the operator rather
   * than passed off as a successful save.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (!chatId) return true
    const { dirty, unresolved } = classifyStagedOutfits(
      stagedByChar,
      baselineByCharRef.current,
      wornBundlesByChar,
    )

    if (unresolved.length > 0) {
      const names = unresolved.map((id) => characterName(id) ?? 'this character').join(', ')
      const discard = await requestConfirmation(
        `Word of what ${names} is presently wearing never reached us, so your alterations cannot be saved. Close the wardrobe and let them go?`,
      )
      if (!discard) return false
    }

    const rollbacks = standingRollbacks(
      rollbackByChar,
      stagedByChar,
      baselineByCharRef.current,
      wornBundlesByChar,
    )
    const rollbackIds = new Set(rollbacks.map((r) => r.characterId))
    const setAll = dirty.filter((d) => !rollbackIds.has(d.characterId))

    if (setAll.length === 0 && rollbacks.length === 0) return true

    let allOk = true
    for (const { characterId: cid, index, slots } of rollbacks) {
      const result = await fetchJson<RollbackResponse>(
        `/api/v1/chats/${chatId}?action=wardrobe-rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId: cid, index }),
        },
      )
      if (!result.ok || !result.data) {
        showErrorToast(result.error || 'Could not return to that outfit')
        allOk = false
        continue
      }
      baselineByCharRef.current[cid] = cloneEquippedSlots(slots)
      setRollbackByChar((prev) => {
        const next = { ...prev }
        delete next[cid]
        return next
      })
      const skipped = result.data.skipped ?? []
      if (skipped.length > 0) {
        const names = skipped.map((s) => s.title ?? s.itemId).join(', ')
        showSuccessToast(
          `Back in outfit ${result.data.restoredIndex}. ${skipped.length} item${skipped.length === 1 ? '' : 's'} could not be put back on: ${names}`,
        )
      }
    }

    for (const { characterId: cid, slots, wornBundleIds } of setAll) {
      const result = await fetchJson<{ equippedSlots: EquippedSlots }>(
        `/api/v1/chats/${chatId}?action=equip`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSetAllEquipBody(cid, slots, wornBundleIds)),
        },
      )
      if (!result.ok) {
        showErrorToast(result.error || 'Failed to update outfit')
        allOk = false
      } else {
        baselineByCharRef.current[cid] = cloneEquippedSlots(slots)
        // Committed: the claims went with the slots, so start the next round clean.
        setWornBundlesByChar((prev) => {
          const next = { ...prev }
          delete next[cid]
          return next
        })
        setRollbackByChar((prev) => {
          const next = { ...prev }
          delete next[cid]
          return next
        })
      }
    }
    // A committed outfit may have put garments on — every wear tally, and the
    // worn snapshot itself, is stale.
    await queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.all })
    return allOk
  }, [chatId, stagedByChar, wornBundlesByChar, rollbackByChar, characterName, requestConfirmation, queryClient])

  const isDirty = useCallback(
    (cid: string): boolean => {
      const staged = stagedByChar[cid]
      if (!staged) return (pendingRef.current[cid]?.length ?? 0) > 0
      const baseline = baselineByCharRef.current[cid]
      if (!baseline) return true
      return (
        !equippedSlotsEqual(staged, baseline) ||
        (wornBundlesByChar[cid]?.length ?? 0) > 0 ||
        rollbackByChar[cid] !== undefined
      )
    },
    [stagedByChar, wornBundlesByChar, rollbackByChar],
  )

  const discard = useCallback(
    (cid: string) => {
      seededRef.current.delete(seedKeyFor(cid))
      delete pendingRef.current[cid]
      delete baselineByCharRef.current[cid]
      const drop = <T,>(prev: Record<string, T>): Record<string, T> => {
        const next = { ...prev }
        delete next[cid]
        return next
      }
      setStagedByChar(drop)
      setWornBundlesByChar(drop)
      setRollbackByChar(drop)
      // Re-seed from the snapshot already in hand.
      setReseedTick((t) => t + 1)
    },
    [seedKeyFor],
  )

  const stageRollback = useCallback(
    (entry: { index: number; slots: HistoryEntrySlots }) => {
      if (!isInChat || !characterId) return
      const cid = characterId
      const gesture = rollbackGesture(entry.slots)
      // The pick replaces the outfit outright, so it is applied to the worn
      // snapshot — any earlier staging (and its outfit claims) goes.
      delete pendingRef.current[cid]
      if (!seededRef.current.has(seedKeyFor(cid))) pendingRef.current[cid] = [gesture]
      setWornBundlesByChar((prev) => {
        const next = { ...prev }
        delete next[cid]
        return next
      })
      const base = baselineByCharRef.current[cid] ?? wornSlots
      setStagedByChar((prev) => ({
        ...prev,
        [cid]: gesture.mutate(base ? cloneEquippedSlots(base) : makeEmptyEquippedSlots()),
      }))
      setRollbackByChar((prev) => ({ ...prev, [cid]: { index: entry.index, slots: entry.slots } }))
    },
    [isInChat, characterId, wornSlots, seedKeyFor],
  )

  const stagedRollbackIndex = useCallback(
    (cid: string): number | null => {
      const rollback = rollbackByChar[cid]
      const staged = stagedByChar[cid]
      if (!rollback || !staged) return null
      const base = baselineByCharRef.current[cid] ?? wornSlots
      if (!base) return rollback.index
      return equippedSlotsEqual(staged, rollbackTargetSlots(rollback.slots, base)) ? rollback.index : null
    },
    [rollbackByChar, stagedByChar, wornSlots],
  )

  const displaySlots: EquippedSlots = characterId
    ? stagedByChar[characterId] ?? wornSlots ?? EMPTY_EQUIPPED_SLOTS
    : EMPTY_EQUIPPED_SLOTS

  return { displaySlots, apply, flush, isDirty, stageRollback, stagedRollbackIndex, discard }
}
