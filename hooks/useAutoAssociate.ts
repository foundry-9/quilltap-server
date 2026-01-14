'use client'

import { useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { fetchJson } from '@/lib/fetch-helpers'
import { showSuccessToast } from '@/lib/toast'

/**
 * Response type from the auto-associate API
 */
interface AutoAssociateResponse {
  success: boolean
  associations: Array<{ profileName: string; keyLabel: string }>
}

/**
 * Hook to trigger auto-association of profiles with API keys.
 *
 * This hook consolidates the common auto-associate pattern found in multiple settings tabs.
 * It calls the /api/v1/api-keys/auto-associate endpoint and shows toast notifications for
 * any successful associations.
 *
 * @param logContext - Context string for logging (e.g., 'embedding-profiles', 'connection-profiles')
 * @returns A callback function to trigger auto-association
 *
 * @example
 * const triggerAutoAssociate = useAutoAssociate('embedding-profiles')
 *
 * useEffect(() => {
 *   triggerAutoAssociate()
 * }, [triggerAutoAssociate])
 */
export function useAutoAssociate(logContext?: string): () => Promise<void> {
  const triggerAutoAssociate = useCallback(async () => {
    clientLogger.debug('Triggering auto-association', {
      context: logContext || 'useAutoAssociate',
    })
    try {
      const response = await fetchJson<AutoAssociateResponse>('/api/v1/api-keys/auto-associate', {
        method: 'POST',
      })
      if (response.ok && response.data?.associations?.length) {
        clientLogger.info('Auto-associated profiles with API keys', {
          context: logContext || 'useAutoAssociate',
          count: response.data.associations.length,
        })
        // Show toast for each association
        response.data.associations.forEach((assoc) => {
          showSuccessToast(`${assoc.profileName} linked to API key "${assoc.keyLabel}"`, 4000)
        })
      }
    } catch (error) {
      clientLogger.debug('Auto-association failed (non-critical)', {
        context: logContext || 'useAutoAssociate',
        error,
      })
    }
  }, [logContext])

  return triggerAutoAssociate
}
