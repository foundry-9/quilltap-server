'use client'

/**
 * SummonFromLoreModal
 *
 * A thin Salon-side wrapper around the Aurora AI-import ("Summon From Lore")
 * wizard. It conjures a character from uploaded lore / pasted text via the
 * existing wizard, then hands the freshly-summoned character's id back to the
 * "Add Character" picker so the operator can finish adding it as a participant
 * (connection profile, outfit, etc.) through the ordinary controls.
 *
 * It deliberately reuses `AIImportWizard` and the import-execute path rather
 * than forking either — the only Salon-specific concern lives here: resolving
 * the single summoned character and refreshing the picker's roster.
 */

import dynamic from 'next/dynamic'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast } from '@/lib/toast'

// Lazily load the wizard so its weight stays out of the Salon bundle until a
// soul is actually being summoned (mirrors Aurora's dynamic import).
const AIImportWizard = dynamic(() => import('@/components/settings/ai-import/AIImportWizard'), {
  loading: () => <p className="qt-text-muted p-8 text-center">Rousing the summoning apparatus…</p>,
})

interface SummonFromLoreModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the summoned character's id once exactly one soul is conjured. */
  onSummoned: (characterId: string) => void
}

export default function SummonFromLoreModal({
  isOpen,
  onClose,
  onSummoned,
}: SummonFromLoreModalProps) {
  const queryClient = useQueryClient()

  const handleImportSuccess = useCallback(
    (characterIds?: string[]) => {
      const ids = characterIds ?? []

      if (ids.length === 0) {
        showErrorToast('The summoning came back empty-handed — do try again.')
        return
      }

      if (ids.length > 1) {
        showErrorToast('That conjuration produced more than one soul — repair to Aurora to sort them out.')
        return
      }

      // Refresh the picker's roster so the newly summoned character is selectable.
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })

      onSummoned(ids[0])
      onClose()
    },
    [queryClient, onSummoned, onClose]
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="qt-dialog-title text-foreground">Summon From Lore</h3>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg border qt-border-default qt-bg-card px-3 py-1.5 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted"
          >
            Close
          </button>
        </div>
        <AIImportWizard onClose={onClose} onImportSuccess={handleImportSuccess} />
      </div>
    </div>
  )
}
