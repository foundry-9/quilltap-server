'use client'

/**
 * The Atlas lore wizard — "Draft from lore": Brahma writes an entry up from
 * what the operator's stores and records already hold.
 *
 * Three panes switched by state: Inputs (the subject, whether Brahma may
 * search the stores, further details, the model), Running (Brahma's searches,
 * live) and Review (the draft — name, aliases, graphic prompt, knowledge —
 * with a Revise box). **Nothing is filed here:** "Open in the editor" hands
 * the draft to the Atlas entry editor in create mode, where the operator
 * amends it and saves it through the ordinary create. Pictures are the
 * editor's business once the entry exists.
 *
 * Model: Brahma's own profile for the tier (project override → global inline
 * setting → default, `?action=lore-defaults`) is preselected; any profile may
 * be chosen instead.
 *
 * @module components/atlas/AtlasLoreWizard
 */

import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import BaseModal from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { atlasTierKey } from '@/lib/hooks/use-atlas'
import { GENERAL_ATLAS_CONTAINER, atlasActionUrl, type AtlasContainer } from '@/lib/atlas/container'
import type { AgentStreamEvent, AgentStreamToolCall } from '@/components/agent-stream/parse-agent-stream'
import { useAgentStreamRun } from '@/components/agent-stream/useAgentStreamRun'
import {
  ATLAS_LORE_DETAILS_MAX,
  ATLAS_LORE_REVISION_MAX,
  ATLAS_LORE_SUBJECT_MAX,
  type AtlasLoreDraft,
  type AtlasLoreDraftRequestInput,
} from '@/lib/atlas/lore-draft/request-schema'

const BRAHMA_AVATAR = '/images/avatars/brahma-avatar.webp'

export interface AtlasLoreWizardProps {
  /** The tier the entry will be filed in. */
  container: AtlasContainer
  containerLabel: string
  onClose: () => void
  /** "Open in the editor": the draft goes to the entry editor, which files it. */
  onDraft: (draft: AtlasLoreDraft) => void
}

interface DoneResult {
  draft: AtlasLoreDraft
  structured: boolean
}

const readDone = (event: AgentStreamEvent): DoneResult | null => {
  const draft = event.draft as AtlasLoreDraft | undefined
  if (!draft || typeof draft !== 'object' || typeof draft.name !== 'string') return null
  return {
    draft: {
      name: draft.name,
      aliases: Array.isArray(draft.aliases) ? draft.aliases.filter((a): a is string => typeof a === 'string') : [],
      graphicPrompt: typeof draft.graphicPrompt === 'string' ? draft.graphicPrompt : null,
      knowledge: typeof draft.knowledge === 'string' ? draft.knowledge : null,
    },
    structured: event.structured !== false,
  }
}

const MESSAGES = {
  cannotBegin: (status: number) => `Brahma could not begin (HTTP ${status}).`,
  noBody: 'Brahma could not begin: no response arrived.',
  wentQuiet: 'Brahma went quiet before the draft was finished. Do try again.',
  failed: 'Brahma could not finish the draft.',
}

/**
 * A query as it sits inside our own double quotes: a wrapping pair is dropped,
 * and a phrase quoted within it (`"Zbinden Trust" Osage Duchy`) takes single
 * quotes, so the outer pair is never broken or doubled.
 */
function quoteInner(text: string): string {
  const wrapped = /^["“']([^"“”']*)["”']$/.exec(text)
  const body = wrapped ? wrapped[1] : text
  return body
    .replace(/["“]([^"“”]*)["”]/g, '‘$1’')
    .replace(/["“”]/g, '')
    .trim()
}

/** One line of Brahma's activity, by tool — the argument shown is the most telling one. */
export function describeBrahmaActivity(call: Pick<AgentStreamToolCall, 'name' | 'arguments'>): string {
  const args = call.arguments ?? {}
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string).trim() : '')
  const quoted = (key: string) => `“${quoteInner(str(key))}”`
  switch (call.name) {
    case 'search':
      return `Searching the stores for ${quoted('query')}`
    case 'doc_read_file':
      return `Reading ${str('path') || str('uri') || 'a document'}`
    case 'doc_grep':
      return `Combing the papers for ${quoted('query')}`
    case 'doc_list_files':
      return `Surveying the shelves${str('folder') ? ` of ${str('folder')}` : ''}`
    case 'doc_read_frontmatter':
    case 'doc_read_heading':
      return `Consulting ${str('path') || str('uri') || 'a document'}`
    case 'lookup_character':
      return `Looking up ${str('character') || 'a character'}`
    case 'lookup_memories':
      return `Turning over the memories${str('query') ? ` for ${quoted('query')}` : ''}`
    case 'lookup_messages':
      return `Searching the conversations for ${quoted('query')}`
    case 'read_messages':
      return 'Reading a conversation'
    case 'run_sql':
      return 'Consulting the ledgers'
    case 'submit_final_response':
      return 'Inking the entry'
    default:
      return `Working with ${call.name}`
  }
}

export function AtlasLoreWizard({ container, containerLabel, onClose, onDraft }: AtlasLoreWizardProps) {
  const fieldId = useId()
  const { profiles, loading: profilesLoading } = useConnectionProfiles()
  const runner = useAgentStreamRun<AtlasLoreDraftRequestInput, DoneResult>({
    url: atlasActionUrl(GENERAL_ATLAS_CONTAINER, 'draft-from-lore'),
    readDone,
    messages: MESSAGES,
  })

  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [searchStores, setSearchStores] = useState(true)
  const [chosenProfileId, setProfileId] = useState<string | null>(null)
  const [result, setResult] = useState<DoneResult | null>(null)
  const [revision, setRevision] = useState('')

  const tierKey = atlasTierKey(container)
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- container is left out: tierKey encodes it, and the URL is a pure function of it
  const { data: defaults } = useQuery({
    queryKey: queryKeys.atlas.loreDefaults(tierKey),
    queryFn: ({ signal }) =>
      apiFetch<{ brahmaProfileId: string | null }>(
        atlasActionUrl(GENERAL_ATLAS_CONTAINER, 'lore-defaults', {
          scope: container.scope,
          id: container.id ?? null,
        }),
        { signal },
      ),
  })

  // Null until the operator picks: Brahma's own profile stands in, else the
  // default, else the first one with tools.
  const brahmaProfileId = defaults?.brahmaProfileId ?? null
  const profileId =
    chosenProfileId ??
    ((brahmaProfileId ? profiles.find((p) => p.id === brahmaProfileId) : undefined) ??
      profiles.find((p) => p.isDefault && p.allowToolUse) ??
      profiles.find((p) => p.allowToolUse) ??
      profiles[0])?.id ??
    ''
  const selectedProfile = profiles.find((p) => p.id === profileId) ?? null

  const running = runner.phase === 'running'
  const view: 'inputs' | 'running' | 'review' = running ? 'running' : result !== null ? 'review' : 'inputs'
  const runError = runner.phase === 'error' ? runner.error : null

  const profileUsable = !!selectedProfile && (!searchStores || selectedProfile.allowToolUse)
  const canDraft = subject.trim().length > 0 && profileUsable

  const startRun = async (revise?: { priorDraft: AtlasLoreDraft; revision: string }) => {
    if (!profileId) return
    const done = await runner.run({
      subject: subject.trim(),
      details,
      searchStores,
      connectionProfileId: profileId,
      target: { scope: container.scope, id: container.scope === 'general' ? null : container.id },
      ...(revise ?? {}),
    })
    if (done !== null) {
      setResult(done)
      setRevision('')
    }
  }

  const handleClose = () => {
    if (running) return
    onClose()
  }

  const footer =
    view === 'inputs' ? (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={handleClose} className="qt-button-secondary qt-button-sm">
          Cancel
        </button>
        <button type="button" onClick={() => void startRun()} disabled={!canDraft} className="qt-button-primary qt-button-sm">
          Draft the entry
        </button>
      </div>
    ) : view === 'running' ? (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={runner.stop} className="qt-button-secondary qt-button-sm">
          <Icon name="stop" className="w-4 h-4 mr-1 inline" />
          Stop
        </button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setResult(null)
            runner.reset()
          }}
          className="qt-button-secondary qt-button-sm"
        >
          Start over
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={handleClose} className="qt-button-secondary qt-button-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => result && onDraft(result.draft)}
            disabled={!result?.draft.name.trim()}
            className="qt-button-primary qt-button-sm"
          >
            Open in the editor
          </button>
        </div>
      </div>
    )

  const draft = result?.draft ?? null

  return (
    <BaseModal
      isOpen
      onClose={handleClose}
      title="Draft an entry from the lore"
      maxWidth="2xl"
      overlayClassName="z-[70]"
      closeOnClickOutside={false}
      closeOnEscape={!running}
      footer={footer}
    >
      <div className="flex items-start gap-3 mb-4">
        <img src={BRAHMA_AVATAR} alt="Brahma" className="qt-avatar w-10 h-10 object-cover" />
        <p className="text-sm qt-text-secondary">
          {view === 'inputs' &&
            'Name the thing, and Brahma will go through your papers and records and write it up for the Atlas — name, aliases, appearance and all that is known of it. The picture is left to you.'}
          {view === 'running' && 'Brahma is going through the papers…'}
          {view === 'review' &&
            'Here is the draft. Ask for changes below, or open it in the editor to amend it yourself and file it.'}
        </p>
      </div>

      {view === 'inputs' && (
        <div className="space-y-4">
          <p className="qt-text-xs qt-text-secondary">Will be kept in {containerLabel}</p>

          <div className="space-y-1">
            <label htmlFor={`${fieldId}-subject`} className="qt-label block">
              What shall Brahma write up?
            </label>
            <input
              id={`${fieldId}-subject`}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={ATLAS_LORE_SUBJECT_MAX}
              placeholder="the Convertible · Blackmoor Hall · the brass contraption in the cellar"
              className="qt-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canDraft) {
                  e.preventDefault()
                  void startRun()
                }
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm qt-text">
              <input
                type="checkbox"
                checked={searchStores}
                onChange={(e) => setSearchStores(e.target.checked)}
                className="mt-0.5"
              />
              <span>Search the document stores and records</span>
            </label>
            <p className="qt-text-xs qt-text-muted">
              {searchStores
                ? 'Brahma may read every document store and look through characters, memories and conversations. Reading only — nothing is changed.'
                : 'Brahma will work from what you write below and nothing else.'}
            </p>
          </div>

          <div>
            <span className="qt-label mb-1 block">Further details (optional)</span>
            <MarkdownLexicalEditor
              value={details}
              onChange={(value) => setDetails(value.slice(0, ATLAS_LORE_DETAILS_MAX))}
              namespace="AtlasLoreWizard.details"
              ariaLabel="Further details"
              minHeight="4rem"
            />
            <p className="mt-1 qt-text-xs qt-text-muted">
              Facts Brahma ought to take as given, where to look, what to leave out, how long you would like it.
            </p>
          </div>

          <div>
            <label htmlFor={`${fieldId}-profile`} className="qt-label mb-1 block">
              Model
            </label>
            <select
              id={`${fieldId}-profile`}
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              disabled={profilesLoading || profiles.length === 0}
              className="qt-select"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id} disabled={searchStores && !p.allowToolUse}>
                  {p.name}
                  {p.id === defaults?.brahmaProfileId ? " (Brahma's)" : p.isDefault ? ' (Default)' : ''}
                  {!p.allowToolUse ? ' (no tools)' : ''}
                </option>
              ))}
            </select>
            {searchStores && profiles.some((p) => !p.allowToolUse) && (
              <p className="mt-1 qt-text-xs qt-text-muted">
                Profiles with tool use switched off cannot search the stores, and are not offered while searching is on.
              </p>
            )}
          </div>

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
            <QuillAnimation size="lg" label="Brahma is drafting…" />
            <span className="text-sm qt-text-secondary">Brahma is drafting…</span>
          </div>
          {runner.toolCalls.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Brahma's searches">
              {runner.toolCalls.map((call, i) => (
                <li key={i} className="flex items-start gap-2">
                  {call.pending ? (
                    <QuillAnimation size="sm" label={null} className="mt-0.5" />
                  ) : call.success === false ? (
                    <Icon name="close" className="w-4 h-4 mt-0.5 qt-text-danger" title="Came to nothing" />
                  ) : (
                    <Icon name="check" className="w-4 h-4 mt-0.5 qt-text-success" title="Done" />
                  )}
                  <span className="qt-text-secondary break-words">{describeBrahmaActivity(call)}</span>
                </li>
              ))}
            </ul>
          )}
          <ThinkingBlock content={runner.reasoning} streaming />
        </div>
      )}

      {view === 'review' && draft && (
        <div className="space-y-4" data-testid="atlas-lore-draft">
          {result && !result.structured && (
            <p role="status" className="qt-alert-warning text-sm">
              Brahma&rsquo;s answer did not come back in proper order, so all of it has been kept as what is known, under
              the name you gave. Set the rest to rights in the editor.
            </p>
          )}
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="qt-label">Name</dt>
              <dd className="qt-text">{draft.name || <em className="qt-text-muted">none</em>}</dd>
            </div>
            <div>
              <dt className="qt-label">Also called</dt>
              <dd className="qt-text">
                {draft.aliases.length > 0 ? draft.aliases.join(', ') : <em className="qt-text-muted">nothing else</em>}
              </dd>
            </div>
            <div>
              <dt className="qt-label">Graphic prompt</dt>
              <dd className="qt-text">
                {draft.graphicPrompt || <em className="qt-text-muted">nothing found of its looks</em>}
              </dd>
            </div>
            <div>
              <dt className="qt-label">What is known</dt>
              <dd className="qt-text whitespace-pre-wrap max-h-72 overflow-y-auto qt-bg-muted rounded p-2">
                {draft.knowledge || <em className="qt-text-muted">nothing</em>}
              </dd>
            </div>
          </dl>

          <div>
            <label htmlFor={`${fieldId}-revision`} className="qt-label mb-1 block">
              Revise
            </label>
            <div className="flex gap-2">
              <input
                id={`${fieldId}-revision`}
                type="text"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                maxLength={ATLAS_LORE_REVISION_MAX}
                placeholder="shorter, and look for what happened to it after the war"
                className="qt-input flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && revision.trim() && profileUsable) {
                    e.preventDefault()
                    void startRun({ priorDraft: draft, revision: revision.trim() })
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void startRun({ priorDraft: draft, revision: revision.trim() })}
                disabled={!revision.trim() || !profileUsable}
                className="qt-button-secondary qt-button-sm"
              >
                Revise
              </button>
            </div>
          </div>
          {runError && (
            <p role="alert" className="text-sm qt-text-danger">
              {runError} The draft is untouched.
            </p>
          )}
        </div>
      )}
    </BaseModal>
  )
}
