'use client'

/**
 * Import From Instructions — Aurora designs wardrobe pieces from a written
 * brief.
 *
 * Three panes switched by state: Inputs (the instructions, whether Aurora may
 * read the stores and records, whether she may consult the web, the model),
 * Running (her searches, live) and Review (her note, the shared review pane
 * with the pieces and the outfit, and a Revise box). **The run creates
 * nothing:** Import Selected creates the pieces and the outfit through the
 * ordinary wardrobe creates (`useProposalImport`), in the browsed wardrobe
 * and folder. No picture is drafted.
 *
 * It works in every tier; the target is whichever wardrobe is being browsed.
 *
 * @module components/wardrobe/ImportFromInstructionsModal
 */

import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import BaseModal from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/toast'
import type { AgentStreamEvent, AgentStreamToolCall } from '@/components/agent-stream/parse-agent-stream'
import { useAgentStreamRun } from '@/components/agent-stream/useAgentStreamRun'
import {
  WARDROBE_DESIGN_INSTRUCTIONS_MAX,
  WARDROBE_DESIGN_REVISION_MAX,
  type WardrobeDesignDefaults,
  type WardrobeDesignRequestInput,
  type WardrobeDesignResult,
} from '@/lib/wardrobe/instruction-design/request-schema'
import type { WardrobeProposalInput } from '@/lib/wardrobe/proposal/types'
import {
  GENERAL_CONTAINER,
  wardrobeCollectionActionUrl,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import {
  ProposalReview,
  summarizeReview,
  toOutfitDraft,
  toReviewItems,
  type OutfitDraft,
  type ReusedPiece,
  type ReviewItem,
} from './proposal-review/ProposalReview'
import { useProposalImport } from './proposal-review/useProposalImport'

const AURORA_AVATAR = '/images/avatars/aurora-avatar.webp'

const DESIGN_URL = wardrobeCollectionActionUrl(GENERAL_CONTAINER, 'design-from-instructions')
const DEFAULTS_URL = wardrobeCollectionActionUrl(GENERAL_CONTAINER, 'design-defaults')

export interface ImportFromInstructionsModalProps {
  /** The wardrobe the pieces will be created in. */
  container: WardrobeContainer
  containerLabel?: string
  /** Folder under `Wardrobe/` to file them in; `''` = the root. */
  folder?: string
  onClose: () => void
  onImported: () => void
}

interface DoneResult {
  proposal: WardrobeDesignResult
  /** "provider • model", as the stream reported it. */
  designedBy: string
}

const readDone = (event: AgentStreamEvent): DoneResult | null => {
  const proposal = event.proposal as WardrobeDesignResult | undefined
  if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.items)) return null
  return {
    proposal: {
      items: proposal.items,
      outfit: proposal.outfit ?? null,
      reuse: Array.isArray(proposal.reuse) ? proposal.reuse : [],
      notes: typeof proposal.notes === 'string' ? proposal.notes : '',
    },
    designedBy: [event.provider, event.modelName].filter((part) => typeof part === 'string' && part).join(' • '),
  }
}

const MESSAGES = {
  cannotBegin: (status: number) => `Aurora could not begin (HTTP ${status}).`,
  noBody: 'Aurora could not begin: no response arrived.',
  wentQuiet: 'Aurora went quiet before the design was finished. Do try again.',
  failed: 'Aurora could not finish the design.',
}

/** The host of a URL, or the text itself when it is not one — a fetch row never shows a whole address. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** One line of Aurora's activity, by tool — the argument shown is the most telling one. */
export function describeAuroraActivity(call: Pick<AgentStreamToolCall, 'name' | 'arguments'>): string {
  const args = call.arguments ?? {}
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string).trim() : '')
  const quoted = (key: string) => `“${str(key).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')}”`
  switch (call.name) {
    case 'search_web':
      return `Enquiring abroad about ${quoted('query')}`
    case 'curl':
      return `Reading ${str('url') ? hostOf(str('url')) : 'a page'}`
    case 'search':
      return `Leafing through the stores for ${quoted('query')}`
    case 'doc_read_file':
      return `Opening ${str('path') || str('uri') || 'a document'}`
    case 'doc_grep':
      return `Combing the papers for ${quoted('query')}`
    case 'doc_list_files':
      return `Surveying the shelves${str('folder') ? ` of ${str('folder')}` : ''}`
    case 'doc_read_frontmatter':
    case 'doc_read_heading':
      return `Consulting ${str('path') || str('uri') || 'a document'}`
    case 'lookup_character':
      return `Taking ${str('character') ? `${str('character')}’s` : 'someone’s'} measure`
    case 'lookup_memories':
      return 'Turning over the memories'
    case 'lookup_messages':
    case 'read_messages':
      return 'Recalling a conversation'
    case 'run_sql':
      return 'Consulting the ledgers'
    case 'submit_final_response':
      return 'Pinning the design'
    default:
      return `Working with ${call.name}`
  }
}

/** Why the web is wholly or partly out of reach, in the house voice; null when all of it is to hand. */
export function describeWebReach(reach: {
  searchConfigured: boolean
  profileAllowsSearch: boolean
  curlConfigured: boolean
}): string | null {
  const canSearch = reach.searchConfigured && reach.profileAllowsSearch
  if (canSearch && reach.curlConfigured) return null
  if (!canSearch && !reach.curlConfigured) {
    return reach.searchConfigured
      ? 'This model’s profile does not permit web search and no page-fetching is permitted, so the wider world is out of reach.'
      : 'No search provider is configured and no page-fetching is permitted, so the wider world is out of reach.'
  }
  if (canSearch) {
    return 'Aurora may search the web but not open the pages she finds: the curl plugin has no permitted addresses.'
  }
  return reach.searchConfigured
    ? 'Aurora may open pages but not search for them: this model’s profile does not permit web search.'
    : 'Aurora may open pages but not search for them: no search provider is configured.'
}

interface ReviewState {
  items: ReviewItem[]
  outfit: OutfitDraft
  reused: ReusedPiece[]
  notes: string
  designedBy: string
}

function toReviewState(done: DoneResult): ReviewState {
  const { proposal } = done
  return {
    items: toReviewItems(proposal.items),
    outfit: toOutfitDraft(proposal.outfit, proposal.items.length + proposal.reuse.length),
    reused: proposal.reuse.map((piece) => ({ ...piece, selected: true })),
    notes: proposal.notes,
    designedBy: done.designedBy,
  }
}

export function ImportFromInstructionsModal({
  container,
  containerLabel,
  folder = '',
  onClose,
  onImported,
}: ImportFromInstructionsModalProps) {
  const fieldId = useId()
  const { profiles, loading: profilesLoading } = useConnectionProfiles()
  const runner = useAgentStreamRun<WardrobeDesignRequestInput, DoneResult>({
    url: DESIGN_URL,
    readDone,
    messages: MESSAGES,
  })
  const { importing, run: runImport } = useProposalImport({
    container,
    folder: folder || undefined,
    logLabel: 'ImportFromInstructionsModal',
  })

  const [instructions, setInstructions] = useState('')
  const [searchStores, setSearchStores] = useState(true)
  const [wantsWeb, setWantsWeb] = useState(true)
  const [chosenProfileId, setProfileId] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [revision, setRevision] = useState('')

  const { data: defaults } = useQuery({
    queryKey: queryKeys.wardrobe.designDefaults,
    queryFn: ({ signal }) => apiFetch<WardrobeDesignDefaults>(DEFAULTS_URL, { signal }),
  })

  // Null until the operator picks: the default profile stands in, else the
  // first one with tools, else the first.
  const defaultProfileId = defaults?.defaultProfileId ?? null
  const profileId =
    chosenProfileId ??
    ((defaultProfileId ? profiles.find((p) => p.id === defaultProfileId) : undefined) ??
      profiles.find((p) => p.isDefault && p.allowToolUse) ??
      profiles.find((p) => p.allowToolUse) ??
      profiles[0])?.id ??
    ''
  const selectedProfile = profiles.find((p) => p.id === profileId) ?? null

  const searchConfigured = defaults?.webSearchConfigured ?? false
  const curlConfigured = defaults?.curlConfigured ?? false
  const canSearchWeb = searchConfigured && !!selectedProfile?.allowWebSearch
  const webReachable = canSearchWeb || curlConfigured
  const searchWeb = wantsWeb && webReachable
  const webNote =
    defaults && selectedProfile
      ? describeWebReach({
          searchConfigured,
          profileAllowsSearch: selectedProfile.allowWebSearch,
          curlConfigured,
        })
      : null

  const needsTools = searchStores || searchWeb
  const profileUsable = !!selectedProfile && (!needsTools || selectedProfile.allowToolUse)

  const running = runner.phase === 'running'
  const view: 'inputs' | 'running' | 'review' = running ? 'running' : review !== null ? 'review' : 'inputs'
  const runError = runner.phase === 'error' ? runner.error : null
  const canDesign = instructions.trim().length > 0 && profileUsable

  const summary = review ? summarizeReview(review.items, review.outfit, review.reused) : null

  /** The proposal as it now stands on the review pane, for a revision. */
  const currentProposal = (state: ReviewState): WardrobeProposalInput => {
    const { willCreateOutfit } = summarizeReview(state.items, state.outfit, state.reused)
    return {
      items: state.items
        .filter((item) => item.selected)
        .map(({ title, description, imagePrompt, types, appropriateness }) => ({
          title,
          description,
          imagePrompt,
          types,
          appropriateness,
        })),
      outfit: willCreateOutfit
        ? {
            title: state.outfit.title,
            description: state.outfit.description,
            appropriateness: state.outfit.appropriateness,
          }
        : null,
      reuseItemIds: state.reused.filter((piece) => piece.selected).map((piece) => piece.id),
    }
  }

  const startRun = async (revise?: { priorProposal: WardrobeProposalInput; revision: string }) => {
    if (!profileId) return
    const done = await runner.run({
      instructions: instructions.trim(),
      searchStores,
      searchWeb,
      connectionProfileId: profileId,
      target: { scope: container.scope, id: container.scope === 'general' ? null : container.id },
      ...(revise ?? {}),
    })
    if (done !== null) {
      setReview(toReviewState(done))
      setRevision('')
    }
  }

  const revise = () => {
    if (!review || !revision.trim() || !profileUsable) return
    void startRun({ priorProposal: currentProposal(review), revision: revision.trim() })
  }

  const handleClose = () => {
    if (running || importing) return
    onClose()
  }

  const handleImport = async () => {
    if (!review || !summary || summary.selectedCount === 0) return
    try {
      const result = await runImport({
        pieces: review.items.filter((item) => item.selected),
        outfit: summary.willCreateOutfit ? review.outfit : null,
        reusedItems: review.reused.filter((piece) => piece.selected),
      })

      const count = result.created.length
      if (count === 0) {
        showErrorToast('Not one piece could be stitched. The design is still here; do try again.')
        return
      }
      showSuccessToast(
        count === 1 ? 'One piece stitched to Aurora’s design' : `${count} pieces stitched to Aurora’s design`,
      )
      if (result.failedTitles.length > 0) {
        showWarningToast(
          result.failedTitles.length === 1
            ? `“${result.failedTitles[0]}” could not be stitched and was left out.`
            : `${result.failedTitles.length} pieces could not be stitched and were left out.`,
        )
      }
      switch (result.outfitOutcome) {
        case 'created':
          showSuccessToast(
            `Outfit “${review.outfit.title.trim()}” assembled from ${result.outfitPieceCount} pieces`,
          )
          break
        case 'failed':
          showErrorToast('The pieces were stitched, but the outfit could not be assembled')
          break
        case 'too-few':
          showErrorToast('Too few pieces were stitched to assemble an outfit')
          break
        case 'none':
          break
      }

      onImported()
      onClose()
    } catch {
      showErrorToast('The pieces could not be stitched. The design is still here; do try again.')
    }
  }

  const importLabel = summary
    ? `Import ${summary.selectedCount} Item${summary.selectedCount !== 1 ? 's' : ''}${summary.willCreateOutfit ? ' + Outfit' : ''}`
    : 'Import'

  const footer =
    view === 'inputs' ? (
      <div className="flex justify-end gap-2">
        <button type="button" onClick={handleClose} className="qt-button-secondary qt-button-sm">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void startRun()}
          disabled={!canDesign}
          className="qt-button-primary qt-button-sm"
        >
          Set Aurora to work
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
            setReview(null)
            runner.reset()
          }}
          disabled={importing}
          className="qt-button-secondary qt-button-sm"
        >
          Start over
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={handleClose} disabled={importing} className="qt-button-secondary qt-button-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing || !summary || summary.selectedCount === 0 || summary.outfitTitleMissing}
            className="qt-button-primary qt-button-sm"
          >
            {importing ? 'Stitching…' : importLabel}
          </button>
        </div>
      </div>
    )

  return (
    <BaseModal
      isOpen
      onClose={handleClose}
      title="Import from Instructions"
      maxWidth="wide"
      closeOnClickOutside={false}
      closeOnEscape={!running && !importing}
      busy={importing}
      bodyClassName="qt-dialog-body-default space-y-4 flex-1 overflow-y-auto"
      footerClassName="qt-dialog-footer-default flex-shrink-0"
      footer={footer}
    >
      <div className="flex items-start gap-3">
        <img src={AURORA_AVATAR} alt="Aurora" className="qt-avatar w-10 h-10 object-cover" />
        <p className="text-sm qt-text-secondary">
          {view === 'inputs' &&
            'Tell Aurora what is wanted, and she will consult what the house knows, make her enquiries abroad where the matter calls for it, and lay out a design for your approval. Nothing is stitched until you say so.'}
          {view === 'running' && 'Aurora is at her pattern books…'}
          {view === 'review' &&
            'Here is the design. Amend any of it, ask for changes below, or have the pieces stitched as they stand.'}
        </p>
      </div>

      {view === 'inputs' && (
        <div className="space-y-4">
          {containerLabel && <p className="qt-text-xs qt-text-secondary">Will be hung in {containerLabel}</p>}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor={`${fieldId}-instructions`} className="qt-label block">
                What shall Aurora design?
              </label>
              <span className="text-xs qt-text-secondary">
                {instructions.length}/{WARDROBE_DESIGN_INSTRUCTIONS_MAX}
              </span>
            </div>
            <textarea
              id={`${fieldId}-instructions`}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              maxLength={WARDROBE_DESIGN_INSTRUCTIONS_MAX}
              placeholder="A Pan Am stewardess’s uniform, 1968 · what she would wear to her brother’s funeral · three plain working outfits for a dockhand"
              className="qt-textarea text-sm w-full"
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm qt-text">
              <input
                type="checkbox"
                checked={searchStores}
                onChange={(e) => setSearchStores(e.target.checked)}
                className="qt-checkbox mt-0.5"
              />
              <span>Search the stores and records</span>
            </label>
            <p className="qt-text-xs qt-text-muted">
              {searchStores
                ? 'Aurora may read your documents, characters and conversations. She alters nothing.'
                : 'Aurora will leave your papers alone, and work from the wardrobe and what you write above.'}
            </p>
          </div>

          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm qt-text">
              <input
                type="checkbox"
                checked={searchWeb}
                disabled={!webReachable}
                onChange={(e) => setWantsWeb(e.target.checked)}
                className="qt-checkbox mt-0.5"
              />
              <span>Consult the wider web</span>
            </label>
            <p className="qt-text-xs qt-text-muted">
              {searchWeb
                ? 'Aurora may look up real uniforms, periods and makers. Her enquiries go to your search provider; nothing of your story goes with them.'
                : webReachable
                  ? 'Aurora will rely on what she already knows of the world.'
                  : 'Aurora will rely on what she already knows of the world, and say where she is unsure.'}
            </p>
            {webNote && (
              <p role="status" className="qt-text-xs qt-text-secondary">
                {webNote}
              </p>
            )}
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
                <option key={p.id} value={p.id} disabled={needsTools && !p.allowToolUse}>
                  {p.name}
                  {p.isDefault ? ' (Default)' : ''}
                  {!p.allowToolUse ? ' (no tools)' : ''}
                </option>
              ))}
            </select>
            {needsTools && profiles.some((p) => !p.allowToolUse) && (
              <p className="mt-1 qt-text-xs qt-text-muted">
                Profiles with tool use switched off can neither search nor look anything up, and are not offered while
                either is asked for.
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
            <QuillAnimation size="lg" label="Aurora is designing…" />
            <span className="text-sm qt-text-secondary">Aurora is designing…</span>
          </div>
          {runner.toolCalls.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Aurora's enquiries">
              {runner.toolCalls.map((call, i) => (
                <li key={i} className="flex items-start gap-2">
                  {call.pending ? (
                    <QuillAnimation size="sm" label={null} className="mt-0.5" />
                  ) : call.success === false ? (
                    <Icon name="close" className="w-4 h-4 mt-0.5 qt-text-danger" title="Came to nothing" />
                  ) : (
                    <Icon name="check" className="w-4 h-4 mt-0.5 qt-text-success" title="Done" />
                  )}
                  <span className="qt-text-secondary break-words">{describeAuroraActivity(call)}</span>
                </li>
              ))}
            </ul>
          )}
          <ThinkingBlock content={runner.reasoning} streaming />
        </div>
      )}

      {view === 'review' && review && (
        <div className="space-y-4" data-testid="wardrobe-design-review">
          <div className="px-3 py-2 rounded qt-bg-muted space-y-1">
            {review.notes && <p className="text-sm qt-text whitespace-pre-wrap">{review.notes}</p>}
            <p className="text-xs qt-text-secondary">
              {review.items.length} piece{review.items.length !== 1 ? 's' : ''} designed
              {review.designedBy ? ` by ${review.designedBy}` : ''}. Edit any field before importing; untick what you
              do not want.
            </p>
          </div>

          <ProposalReview
            items={review.items}
            onItemsChange={(next) =>
              setReview((prev) =>
                prev ? { ...prev, items: typeof next === 'function' ? next(prev.items) : next } : prev,
              )
            }
            outfit={review.outfit}
            onOutfitChange={(next) =>
              setReview((prev) =>
                prev ? { ...prev, outfit: typeof next === 'function' ? next(prev.outfit) : next } : prev,
              )
            }
            reused={review.reused}
            onReusedChange={(next) =>
              setReview((prev) =>
                prev ? { ...prev, reused: typeof next === 'function' ? next(prev.reused) : next } : prev,
              )
            }
          />

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
                maxLength={WARDROBE_DESIGN_REVISION_MAX}
                placeholder="make the skirt longer, and drop the gloves"
                className="qt-input flex-1"
                disabled={importing}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    revise()
                  }
                }}
              />
              <button
                type="button"
                onClick={revise}
                disabled={!revision.trim() || !profileUsable || importing}
                className="qt-button-secondary qt-button-sm"
              >
                Revise
              </button>
            </div>
            <p className="mt-1 qt-text-xs qt-text-muted">
              Aurora begins from the design as you have amended it, with only the ticked pieces.
            </p>
          </div>
          {runError && (
            <p role="alert" className="text-sm qt-text-danger">
              {runError} The design is untouched.
            </p>
          )}
        </div>
      )}
    </BaseModal>
  )
}
