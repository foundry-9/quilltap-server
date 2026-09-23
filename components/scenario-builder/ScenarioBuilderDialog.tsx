'use client'

/**
 * The Scenario Builder dialog — "Ask the Host to set the scene."
 *
 * Three panes switched by state: Inputs (mode, location, time, details, model),
 * Running (the Host's enquiries, live), and Review (an editable draft with a
 * Revise box, Save as scenario…, and Use this scene). Surface-agnostic: the New
 * Chat form and the Salon sidebar each decide what "use" and "saved" mean for
 * their own picker via `onUse` / `onSaved`.
 *
 * A failed run never traps a draft: Revise failures leave the draft editable,
 * and Use / Save stay enabled whatever the provider did.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import BaseModal from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { STAFF_AVATARS } from '@/lib/chat/staff-display-names'
import type { AgentStreamToolCall } from '@/components/agent-stream/parse-agent-stream'
import { useScenarioBuilderRun } from './hooks/useScenarioBuilderRun'
import {
  SaveScenarioDialog,
  type SavedScenarioTarget,
  type ScenarioBuilderCastMember,
} from './SaveScenarioDialog'

export type { SavedScenarioTarget, ScenarioBuilderCastMember } from './SaveScenarioDialog'

type Mode = 'real' | 'in-world'

export interface ScenarioBuilderDialogProps {
  isOpen: boolean
  onClose: () => void
  /** The cast — scopes which stores the Host may read, and the save targets. */
  cast: ScenarioBuilderCastMember[]
  projectId?: string | null
  projectName?: string | null
  /** Set when launched from inside a chat: the Host also sees its current scene. */
  chatId?: string | null
  /** "Use this scene": the surface puts the text in its custom box. */
  onUse: (scene: string) => void
  /** After a save: the surface may select the new preset in its picker. */
  onSaved?: (target: SavedScenarioTarget) => void
}

const HOST_AVATAR = STAFF_AVATARS.host ?? '/images/avatars/host-avatar.webp'

/** One line of the Host's activity, by tool — the argument shown is the most telling one. */
export function describeHostActivity(call: Pick<AgentStreamToolCall, 'name' | 'arguments'>): string {
  const args = call.arguments ?? {}
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')
  // Queries go inside the Host's own quotation marks; strip any the model added.
  const quoted = (key: string) => `“${str(key).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')}”`
  switch (call.name) {
    case 'search_web':
      return `Consulting the wider world about ${quoted('query')}`
    case 'curl':
      return `Reading ${str('url') || 'a page from the wider world'}`
    case 'search':
      return `Leafing through the stores for ${quoted('query')}`
    case 'doc_read_file':
      return `Opening ${str('path') || str('uri') || 'a document'}`
    case 'doc_grep':
      return `Hunting through the papers for ${quoted('query')}`
    case 'doc_list_files':
      return `Surveying the shelves${str('folder') ? ` of ${str('folder')}` : ''}`
    case 'doc_read_frontmatter':
    case 'doc_read_heading':
      return `Consulting ${str('path') || str('uri') || 'a document'}`
    case 'submit_final_response':
      return 'Setting the scene down on paper'
    default:
      return `Busying himself with ${call.name}`
  }
}

export function ScenarioBuilderDialog({
  isOpen,
  onClose,
  cast,
  projectId,
  projectName,
  chatId,
  onUse,
  onSaved,
}: ScenarioBuilderDialogProps) {
  const { profiles, loading: profilesLoading } = useConnectionProfiles()
  const builder = useScenarioBuilderRun()

  const [mode, setMode] = useState<Mode>(cast.length > 0 ? 'in-world' : 'real')
  const [location, setLocation] = useState('')
  const [time, setTime] = useState('')
  const [details, setDetails] = useState('')
  // Null until the user picks; until then the default profile (else the first
  // usable one) stands in, so it is preselected the moment profiles arrive.
  const [chosenProfileId, setProfileId] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [draftKey, setDraftKey] = useState(0)
  const [revision, setRevision] = useState('')
  const [saveOpen, setSaveOpen] = useState(false)

  const profileId = useMemo(() => {
    if (chosenProfileId) return chosenProfileId
    const preferred =
      profiles.find((p) => p.isDefault && p.allowToolUse) ??
      profiles.find((p) => p.allowToolUse) ??
      profiles[0]
    return preferred?.id ?? ''
  }, [chosenProfileId, profiles])

  const { data: capabilities } = useQuery({
    queryKey: queryKeys.scenarioBuilder.capabilities,
    queryFn: ({ signal }) =>
      apiFetch<{ webSearchConfigured: boolean; curlConfigured: boolean }>(
        '/api/v1/scenario-builder?action=capabilities',
        { signal },
      ),
    enabled: isOpen,
  })

  const selectedProfile = profiles.find((p) => p.id === profileId) ?? null
  const webUnreachable =
    mode === 'real' &&
    !!selectedProfile &&
    (!selectedProfile.allowWebSearch || capabilities?.webSearchConfigured === false)

  const running = builder.phase === 'running'
  const view: 'inputs' | 'running' | 'review' = running ? 'running' : draft !== null ? 'review' : 'inputs'

  const characterIds = useMemo(() => cast.map((c) => c.id), [cast])

  const startRun = async (revise?: { priorDraft: string; revision: string }) => {
    if (!profileId) return
    const scene = await builder.run({
      mode,
      location: location.trim(),
      time: time.trim(),
      details,
      connectionProfileId: profileId,
      projectId: projectId ?? null,
      characterIds,
      chatId: chatId ?? null,
      ...(revise ?? {}),
    })
    if (scene !== null) {
      setDraft(scene)
      setDraftKey((k) => k + 1)
      setRevision('')
    }
  }

  // A failed run surfaces on whichever pane we land back on.
  const runError = builder.phase === 'error' ? builder.error : null

  const canSetScene =
    location.trim().length > 0 && time.trim().length > 0 && !!selectedProfile && selectedProfile.allowToolUse

  const handleClose = () => {
    if (running) return
    onClose()
  }

  const handleUse = () => {
    if (draft === null) return
    onUse(draft)
    onClose()
  }

  const defaultSaveName = [location.trim(), time.trim()].filter(Boolean).join(' — ').slice(0, 100)

  const footer =
    view === 'inputs' ? (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={handleClose} className="qt-button-secondary">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => startRun()}
          disabled={!canSetScene}
          className="qt-button-primary"
        >
          Set the scene
        </button>
      </div>
    ) : view === 'running' ? (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={builder.stop} className="qt-button-secondary">
          <Icon name="stop" className="w-4 h-4 mr-1 inline" />
          Stop
        </button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setSaveOpen(true)}
          disabled={!draft?.trim()}
          className="qt-button-secondary"
        >
          Save as scenario…
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={handleClose} className="qt-button-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleUse} disabled={!draft?.trim()} className="qt-button-primary">
            Use this scene
          </button>
        </div>
      </div>
    )

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title="The Host sets the scene"
        maxWidth="2xl"
        closeOnClickOutside={false}
        closeOnEscape={!running && !saveOpen}
        footer={footer}
      >
        <div className="flex items-start gap-3 mb-4">
          <img src={HOST_AVATAR} alt="The Host" className="w-10 h-10 rounded-full shrink-0" />
          <p className="text-sm qt-text-secondary">
            {view === 'inputs' &&
              'Tell me where and when, and I shall go and see what the place is like. The scene I bring back will leave the company out of it entirely — you may seat whomever you please.'}
            {view === 'running' && 'Pray bear with me; I am out making enquiries.'}
            {view === 'review' &&
              'Here is the scene as I found it. Amend it as you like, or tell me what to change and I shall go round again.'}
          </p>
        </div>

        {view === 'inputs' && (
          <div className="space-y-4">
            <fieldset>
              <legend className="qt-label mb-1">Is the place real, or of your own world?</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scenario-builder-mode"
                    value="in-world"
                    checked={mode === 'in-world'}
                    onChange={() => setMode('in-world')}
                  />
                  In-world
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scenario-builder-mode"
                    value="real"
                    checked={mode === 'real'}
                    onChange={() => setMode('real')}
                  />
                  Real
                </label>
              </div>
              <p className="mt-1 text-xs qt-text-muted">
                {mode === 'in-world'
                  ? 'I shall read only the document stores this company could see — never the wider world.'
                  : 'I shall consult the wider world, and your document stores besides.'}
              </p>
            </fieldset>

            <div>
              <label htmlFor="scenario-builder-location" className="qt-label mb-1 block">
                Location
              </label>
              <input
                id="scenario-builder-location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={500}
                placeholder="the Gare du Nord · the Lantern Inn at Vey's Crossing"
                className="qt-input"
              />
            </div>

            <div>
              <label htmlFor="scenario-builder-time" className="qt-label mb-1 block">
                Time
              </label>
              <input
                id="scenario-builder-time"
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                maxLength={200}
                placeholder="an autumn evening, 1927 · now · the third day of the siege"
                className="qt-input"
              />
            </div>

            <div>
              <span className="qt-label mb-1 block">Further details (optional)</span>
              <MarkdownLexicalEditor
                value={details}
                onChange={setDetails}
                namespace="ScenarioBuilder.details"
                ariaLabel="Further details"
                minHeight="4rem"
              />
              <p className="mt-1 text-xs qt-text-muted">
                Anything else I ought to know — the mood, the weather, what has just happened, how long you would like it.
              </p>
            </div>

            <div>
              <label htmlFor="scenario-builder-profile" className="qt-label mb-1 block">
                Model
              </label>
              <select
                id="scenario-builder-profile"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                disabled={profilesLoading || profiles.length === 0}
                className="qt-select"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.allowToolUse}>
                    {p.name}
                    {p.isDefault ? ' (Default)' : ''}
                    {!p.allowToolUse ? ' (no tools)' : ''}
                  </option>
                ))}
              </select>
              {profiles.some((p) => !p.allowToolUse) && (
                <p className="mt-1 text-xs qt-text-muted">
                  Profiles with tool use switched off are listed but cannot be chosen: I cannot make enquiries without tools.
                </p>
              )}
            </div>

            {webUnreachable && (
              <p role="status" className="qt-alert-warning text-sm">
                I regret that the wider world is out of reach on this occasion
                {selectedProfile && !selectedProfile.allowWebSearch
                  ? ' — this profile does not permit web search'
                  : ' — no search provider has been engaged'}
                . I shall make do with what I know and your stores, and keep the particulars general where I am unsure.
              </p>
            )}

            {runError && (
              <p role="alert" className="text-sm qt-text-danger">
                {runError}
              </p>
            )}
          </div>
        )}

        {view === 'running' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <QuillAnimation size="lg" label="The Host is out making enquiries…" />
              <span className="text-sm qt-text-secondary">The Host is out making enquiries…</span>
            </div>
            {builder.toolCalls.length > 0 && (
              <ul className="space-y-1 text-sm" aria-label="The Host's enquiries">
                {builder.toolCalls.map((call, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {call.pending ? (
                      <QuillAnimation size="sm" label={null} className="mt-0.5" />
                    ) : call.success === false ? (
                      <Icon name="close" className="w-4 h-4 mt-0.5 qt-text-danger" title="Came to nothing" />
                    ) : (
                      <Icon name="check" className="w-4 h-4 mt-0.5 qt-text-success" title="Done" />
                    )}
                    <span className="qt-text-secondary break-words">{describeHostActivity(call)}</span>
                  </li>
                ))}
              </ul>
            )}
            <ThinkingBlock content={builder.reasoning} streaming />
          </div>
        )}

        {view === 'review' && draft !== null && (
          <div className="space-y-4">
            <MarkdownLexicalEditor
              value={draft}
              onChange={setDraft}
              remountKey={draftKey}
              namespace="ScenarioBuilder.draft"
              ariaLabel="The scene"
              minHeight="12rem"
            />
            <div>
              <label htmlFor="scenario-builder-revision" className="qt-label mb-1 block">
                Revise
              </label>
              <div className="flex gap-2">
                <input
                  id="scenario-builder-revision"
                  type="text"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  maxLength={2000}
                  placeholder="make it raining, and two hours later"
                  className="qt-input flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && revision.trim() && profileId) {
                      e.preventDefault()
                      startRun({ priorDraft: draft, revision: revision.trim() })
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => startRun({ priorDraft: draft, revision: revision.trim() })}
                  disabled={!revision.trim() || !profileId}
                  className="qt-button-secondary"
                >
                  Revise
                </button>
              </div>
            </div>
            {runError && (
              <p role="alert" className="text-sm qt-text-danger">
                {runError} Your draft is untouched.
              </p>
            )}
          </div>
        )}
      </BaseModal>

      {saveOpen && draft !== null && (
        <SaveScenarioDialog
          isOpen={saveOpen}
          onClose={() => setSaveOpen(false)}
          body={draft}
          defaultName={defaultSaveName || 'A scene set by the Host'}
          projectId={projectId}
          projectName={projectName}
          cast={cast}
          onSaved={(target) => onSaved?.(target)}
        />
      )}
    </>
  )
}
