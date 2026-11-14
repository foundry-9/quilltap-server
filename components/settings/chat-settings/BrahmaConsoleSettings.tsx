'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { InlineBrahmaProfileSelect } from '@/components/brahma-console/InlineBrahmaProfileSelect'
import { BoundedNumberInstanceSetting } from './components/BoundedNumberInstanceSetting'
import { DEFAULT_BRAHMA_MAX_AGENT_TURNS } from '@/lib/schemas/settings.types'

const SETTINGS_URL = '/api/v1/settings/brahma-console'

interface BrahmaConsoleSettingsResponse {
  maxAgentTurns?: number
  inlineConnectionProfileId?: string | null
}

/**
 * The model the inline `@Brahma:` / `@Brahma?` answerer uses in Salon chats
 * (`brahmaConsole.inlineConnectionProfileId`). The PUT merges over the stored
 * settings, so sending only this field leaves the turn budget alone — and the
 * turn-budget dial likewise sends only its own field.
 */
function InlineBrahmaProfileSetting() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.settings.brahmaConsole,
    queryFn: ({ signal }) => apiFetch<BrahmaConsoleSettingsResponse>(SETTINGS_URL, { signal }),
  })

  const save = useMutation({
    mutationFn: (profileId: string | null) =>
      apiFetch<BrahmaConsoleSettingsResponse>(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inlineConnectionProfileId: profileId }),
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings.brahmaConsole, settings)
      showSuccessToast('Inline Brahma engine saved')
    },
    onError: (err) => {
      console.warn('[BrahmaConsoleSettings] Inline profile save failed', { error: getErrorMessage(err) })
      showErrorToast(getErrorMessage(err, 'Failed to save Brahma Console settings'))
    },
  })

  if (isLoading) return null

  return (
    <div className="space-y-2">
      <label htmlFor="brahma-inline-profile" className="qt-text-label block">
        Engine for <code>@Brahma</code> in the Salon
      </label>
      <p className="qt-text-small qt-text-muted">
        Summon Brahma mid-conversation with <code>@Brahma:</code> or <code>@Brahma?</code> and he
        consults the ledgers on whichever engine is named here. A project may name an engine of its
        own on its Prospero page, which takes precedence within that project&rsquo;s chats; should
        the chosen profile be dismissed from service, Brahma quietly falls back on your default.
      </p>
      <InlineBrahmaProfileSelect
        id="brahma-inline-profile"
        value={data?.inlineConnectionProfileId ?? null}
        onChange={(profileId) => save.mutate(profileId)}
        inheritLabel="Use my default profile"
        disabled={save.isPending}
      />
    </div>
  )
}

// No upper bound: the operator's figure is the only ceiling.
const MIN_TURNS = 1

/**
 * The instance-wide Brahma Console agent-turn budget
 * (`instance_settings['brahmaConsole']`). Read at the start of every Console
 * query — and every one-shot `@Brahma` consultation — to cap how many tool-use
 * rounds the engine may take before it must answer. Global only; there is no
 * per-conversation dial. Below it, the inline `@Brahma` engine picker
 * (global; a project may override it on its Prospero page).
 */
export function BrahmaConsoleSettings() {
  return (
    <div className="space-y-6">
      <BoundedNumberInstanceSetting
        queryKey={queryKeys.settings.brahmaConsole}
        url="/api/v1/settings/brahma-console"
        field="maxAgentTurns"
        defaultValue={DEFAULT_BRAHMA_MAX_AGENT_TURNS}
        min={MIN_TURNS}
        loadFailureMessage="Failed to load Brahma Console settings"
        saveFailureMessage="Failed to save Brahma Console settings"
        successToast="Console turn budget saved"
        inputId="brahma-max-turns"
        loadingText={<>Loading Console settings&hellip;</>}
        intro={
          <>
            Put a knotty question to the Brahma Console &mdash; &ldquo;where in the ledgers is such-and-such
            buried?&rdquo; &mdash; and it sets about the search one step at a time: a query here, a document
            read there, each a <em>turn</em> at the telegraph key. This dial sets how many turns it may
            take on a single question before it must down tools and tell you what it has found so far.
            Raise it when the Console keeps running out of rope mid-investigation; the higher ceiling
            costs nothing on questions it answers quickly.
          </>
        }
        label="Let the Console take up to"
        unit="turns"
        footnote={
          <>
            A generous budget only helps a Console that is making headway. Should it fall to asking the
            same question twice over, Quilltap notices the engine chasing its own tail and calls a halt
            regardless of this figure &mdash; so raising the ceiling never lets a truly stuck search run
            on and on.
          </>
        }
      />
      <InlineBrahmaProfileSetting />
    </div>
  )
}
