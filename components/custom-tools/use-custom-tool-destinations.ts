'use client'

/**
 * The Workbench's one read of its save targets (`?action=destinations` on
 * `/api/v1/custom-tools`): the editor's vantage, the save dialog and the
 * proving bench's fact-sheet picker all narrow this one query.
 *
 * @module components/custom-tools/use-custom-tool-destinations
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { CustomToolDestinations } from '@/lib/pascal/workbench'

export const CUSTOM_TOOL_DESTINATIONS_URL = '/api/v1/custom-tools?action=destinations'

export function useCustomToolDestinations<T = CustomToolDestinations>(options?: {
  select?: (data: CustomToolDestinations) => T
  enabled?: boolean
}) {
  return useQuery({
    queryKey: queryKeys.customTools.destinations(),
    queryFn: ({ signal }) => apiFetch<CustomToolDestinations>(CUSTOM_TOOL_DESTINATIONS_URL, { signal }),
    select: options?.select,
    enabled: options?.enabled,
  })
}
