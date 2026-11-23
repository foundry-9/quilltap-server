'use client'

/**
 * Calliope's settings card (Calliope Live, Spec J decision 10): the engine
 * her theme-editor conversations fall back to when none is pinned, and her
 * agent-turn budget (`instance_settings['calliope']`). The PUT merges over the
 * stored value, so each control sends only its own field.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { InlineBrahmaProfileSelect as ProfileSelect } from '@/components/brahma-console/InlineBrahmaProfileSelect'
import { BoundedNumberInstanceSetting } from '@/components/settings/chat-settings/components/BoundedNumberInstanceSetting'
import { DEFAULT_CALLIOPE_MAX_AGENT_TURNS } from '@/lib/schemas/settings.types'

const SETTINGS_URL = '/api/v1/settings/calliope'

interface CalliopeSettingsResponse {
  connectionProfileId?: string | null
  maxAgentTurns?: number
}

function CalliopeEngineSetting() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.settings.calliope,
    queryFn: ({ signal }) => apiFetch<CalliopeSettingsResponse>(SETTINGS_URL, { signal }),
  })

  const save = useMutation({
    mutationFn: (profileId: string | null) =>
      apiFetch<CalliopeSettingsResponse>(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionProfileId: profileId }),
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings.calliope, settings)
      showSuccessToast('Calliope’s engine saved')
    },
    onError: (err) => {
      console.warn('[CalliopeSettings] Engine save failed', { error: getErrorMessage(err) })
      showErrorToast(getErrorMessage(err, 'Failed to save Calliope’s settings'))
    },
  })

  if (isLoading) return null

  return (
    <div className="space-y-2">
      <label htmlFor="calliope-engine" className="qt-text-label block">
        Calliope&rsquo;s engine
      </label>
      <p className="qt-text-small qt-text-muted">
        The muse attends the theme editor on whichever engine is named here, unless a conversation
        has been switched to another in her panel. She reads and proposes through her own tools, so
        choose a profile that permits tool use; should it be dismissed from service, she falls back
        on your default.
      </p>
      <ProfileSelect
        id="calliope-engine"
        value={data?.connectionProfileId ?? null}
        onChange={(profileId) => save.mutate(profileId)}
        inheritLabel="Use my default profile"
        disabled={save.isPending}
      />
    </div>
  )
}

export function CalliopeSettings() {
  return (
    <div className="space-y-6">
      <CalliopeEngineSetting />
      <BoundedNumberInstanceSetting
        queryKey={queryKeys.settings.calliope}
        url={SETTINGS_URL}
        field="maxAgentTurns"
        defaultValue={DEFAULT_CALLIOPE_MAX_AGENT_TURNS}
        min={1}
        loadFailureMessage="Failed to load Calliope's settings"
        saveFailureMessage="Failed to save Calliope's settings"
        successToast="Calliope's turn budget saved"
        inputId="calliope-max-turns"
        loadingText={<>Consulting the muse&hellip;</>}
        intro={
          <>
            Ask Calliope for a new look and she works it out a step at a time &mdash; reading the draft,
            looking up a token, measuring a contrast, setting down a proposal &mdash; each a <em>turn</em>.
            This dial sets how many she may take on one request before she must stop and say where she
            got to.
          </>
        }
        label="Let Calliope take up to"
        unit="turns"
        footnote={
          <>
            Should she fall to asking the same question twice over, Quilltap calls a halt regardless of
            this figure, so a higher ceiling never lets a muse run in circles.
          </>
        }
      />
    </div>
  )
}
