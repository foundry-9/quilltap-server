'use client'

import { useCallback } from 'react'
import { fetchJson } from '@/lib/fetch-helpers'
import { useInvalidateProfileLists } from '@/lib/hooks/use-profiles'
import { showSuccessToast } from '@/lib/toast'

/** A profile the server just linked to an API key. */
export interface AnnouncedAssociation {
  profileName: string
  keyLabel: string
}

/**
 * Response type from the auto-associate API
 */
interface AutoAssociateResponse {
  success: boolean
  associations: AnnouncedAssociation[]
}

/**
 * The one way an auto-association reaches the operator: a toast per profile
 * linked, and a refresh of the three profile lists — the server rewrote those
 * rows' `apiKeyId`, so a card that read them before the link still shows the
 * key as missing. Used after key creation, key import and the tabs' mount-time
 * sweep.
 */
export function useAnnounceAssociations(): (associations: AnnouncedAssociation[] | undefined) => void {
  const invalidateProfileLists = useInvalidateProfileLists()
  return useCallback(
    (associations) => {
      if (!associations || associations.length === 0) return
      associations.forEach((assoc) => {
        showSuccessToast(`${assoc.profileName} linked to API key "${assoc.keyLabel}"`, 4000)
      })
      void invalidateProfileLists('connectionProfiles', 'imageProfiles', 'embeddingProfiles')
    },
    [invalidateProfileLists],
  )
}

/**
 * Hook to trigger auto-association of profiles with API keys.
 *
 * Calls `POST /api/v1/api-keys?action=auto-associate` and announces any
 * associations it made (`useAnnounceAssociations`).
 *
 * @returns A callback function to trigger auto-association
 *
 * @example
 * const triggerAutoAssociate = useAutoAssociate()
 *
 * useEffect(() => {
 *   triggerAutoAssociate()
 * }, [triggerAutoAssociate])
 */
export function useAutoAssociate(): () => Promise<void> {
  const announceAssociations = useAnnounceAssociations()
  const triggerAutoAssociate = useCallback(async () => {
    try {
      const response = await fetchJson<AutoAssociateResponse>('/api/v1/api-keys?action=auto-associate', {
        method: 'POST',
      })
      if (response.ok) {
        announceAssociations(response.data?.associations)
      }
    } catch {
      // Auto-association failed non-critically
    }
  }, [announceAssociations])

  return triggerAutoAssociate
}
