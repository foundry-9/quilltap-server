'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { AutonomousRoomCard } from './AutonomousRoomCard'
import { toAutonomousSettingsHint } from './autonomous-settings-hint'
import type { NewChatAutonomousState } from './types'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

interface EditEnclaveModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Current room title, shown pre-filled and editable. */
  currentTitle: string
  /** Fired after a successful save with the (trimmed) new title. */
  onSaved?: (newTitle: string) => void
}

/** The room settings as they arrive from the autonomous-room status endpoint (milliseconds). */
interface RoomStatus {
  scheduleCron: string | null
  scheduleFreshnessWindowMs: number | null
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMs: number | null
  budgetEstimatedSpendCapUSD: number | null
  budgetExcludeCacheHits: number | null
  runVisibility: 'owner_only' | 'household' | 'open' | null
  runDestructiveToolsAllowed: number | null
}

const EMPTY_STATE: NewChatAutonomousState = {
  enabled: true,
  scheduleCron: '',
  scheduleFreshnessHours: null,
  budgetMaxTurns: null,
  budgetMaxTokens: null,
  budgetMaxWallClockMinutes: null,
  budgetEstimatedSpendCapUSD: null,
  runVisibility: null,
  runDestructiveToolsAllowed: false,
  budgetExcludeCacheHits: true,
}

/** Convert the status payload (ms) into the human-units form state the card edits. */
function statusToFormState(s: RoomStatus): NewChatAutonomousState {
  return {
    enabled: true,
    scheduleCron: s.scheduleCron ?? '',
    scheduleFreshnessHours:
      s.scheduleFreshnessWindowMs == null
        ? null
        : Math.round(s.scheduleFreshnessWindowMs / MS_PER_HOUR),
    budgetMaxTurns: s.budgetMaxTurns ?? null,
    budgetMaxTokens: s.budgetMaxTokens ?? null,
    budgetMaxWallClockMinutes:
      s.budgetMaxWallClockMs == null ? null : Math.round(s.budgetMaxWallClockMs / MS_PER_MINUTE),
    budgetEstimatedSpendCapUSD: s.budgetEstimatedSpendCapUSD ?? null,
    runVisibility: s.runVisibility ?? null,
    runDestructiveToolsAllowed: s.runDestructiveToolsAllowed === 1,
    // Default to excluding cache hits when the column is null/absent.
    budgetExcludeCacheHits: (s.budgetExcludeCacheHits ?? 1) === 1,
  }
}

/**
 * Edit Enclave modal — reuses the New Room form's AutonomousRoomCard to edit an
 * existing autonomous room ("enclave") in place. Reached from the Scheduled
 * Autonomous Rooms settings card and from the Salon sidebar's Organize card.
 *
 * Edits land on the live chat row and take effect on the running run's next turn
 * (the turn handler re-reads budget caps / cache mode / destructive flag every
 * turn) as well as becoming the settings for future runs. The card speaks human
 * units (hours, minutes); we convert ⇄ milliseconds at this API boundary only.
 */
export function EditEnclaveModal({
  isOpen,
  onClose,
  chatId,
  currentTitle,
  onSaved,
}: EditEnclaveModalProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(currentTitle)
  const [auto, setAuto] = useState<NewChatAutonomousState>(EMPTY_STATE)

  // The room's current settings, re-read each time the modal opens; the user's
  // autonomous-room defaults ride the shared chat-settings query.
  const statusQuery = useQuery({
    queryKey: queryKeys.chats.autonomousRoom(chatId),
    queryFn: ({ signal }) => apiFetch<RoomStatus>(`/api/v1/chats/${chatId}/autonomous-room`, { signal }),
    enabled: isOpen && Boolean(chatId),
    refetchOnMount: 'always',
  })
  const { data: settingsHint } = useChatSettingsQuery(toAutonomousSettingsHint, { enabled: isOpen })
  const loading = statusQuery.isFetching && !statusQuery.data
  const loadError = statusQuery.error ? 'Could not load this enclave’s settings.' : null

  // Seed the editable form from each fresh read, and the title on each open
  // (state adjusted during render, React's pattern for state that follows data).
  const [seededFrom, setSeededFrom] = useState<RoomStatus | undefined>(undefined)
  if (statusQuery.data && statusQuery.data !== seededFrom) {
    setSeededFrom(statusQuery.data)
    setAuto(statusToFormState(statusQuery.data))
  }
  const [seenOpen, setSeenOpen] = useState(false)
  if (isOpen !== seenOpen) {
    setSeenOpen(isOpen)
    if (isOpen) setTitle(currentTitle)
  }

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/api/v1/chats/${chatId}/autonomous-room?action=update-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.autonomousRoom(chatId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.autonomousRooms })
    },
  })
  const saving = saveMutation.isPending

  const updateAuto = useCallback((patch: Partial<NewChatAutonomousState>) => {
    setAuto((prev) => ({ ...prev, ...patch }))
  }, [])

  const handleSave = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      showErrorToast('Title cannot be empty')
      return
    }

    // Convert the card's human units back to the milliseconds the API/DB speak.
    // null clears a previously-set value; a number sets it.
    const body = {
      title: trimmedTitle,
      scheduleCron: auto.scheduleCron.trim(),
      scheduleFreshnessWindowMs:
        auto.scheduleFreshnessHours != null && auto.scheduleFreshnessHours > 0
          ? auto.scheduleFreshnessHours * MS_PER_HOUR
          : null,
      budgetMaxTurns: auto.budgetMaxTurns ?? null,
      budgetMaxTokens: auto.budgetMaxTokens ?? null,
      budgetMaxWallClockMs:
        auto.budgetMaxWallClockMinutes != null && auto.budgetMaxWallClockMinutes > 0
          ? auto.budgetMaxWallClockMinutes * MS_PER_MINUTE
          : null,
      budgetEstimatedSpendCapUSD: auto.budgetEstimatedSpendCapUSD ?? null,
      runVisibility: auto.runVisibility,
      runDestructiveToolsAllowed: auto.runDestructiveToolsAllowed,
      budgetExcludeCacheHits: auto.budgetExcludeCacheHits,
    }

    try {
      await saveMutation.mutateAsync(body)
      showSuccessToast('Enclave updated')
      onSaved?.(trimmedTitle)
      onClose()
    } catch (err) {
      const msg = apiErrorMessage(err, 'Failed to update enclave')
      showErrorToast(msg)
      console.error('[EditEnclaveModal] Failed to save', { chatId, error: msg })
    }
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={saving}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || loading || !!loadError || !title.trim()}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Enclave"
      maxWidth="2xl"
      showCloseButton
      footer={footer}
    >
      {loadError ? (
        <div className="qt-alert-error">{loadError}</div>
      ) : loading ? (
        <div className="qt-text-secondary py-8 text-center">Loading enclave settings…</div>
      ) : (
        <div className="space-y-5">
          <div>
            <label htmlFor="edit-enclave-title" className="qt-label mb-1">
              Room Title
            </label>
            <input
              id="edit-enclave-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              placeholder="Name this enclave…"
              className="qt-input"
            />
            <p className="mt-1 qt-text-xs qt-text-muted">
              Setting a title here pins it — the automatic titler will leave it be.
            </p>
          </div>

          <AutonomousRoomCard
            value={auto}
            onChange={updateAuto}
            settingsHint={settingsHint}
            disabled={saving}
          />
        </div>
      )}
    </BaseModal>
  )
}

export default EditEnclaveModal
