'use client'

/**
 * Image Prompt Optimizer Modal — the wardrobe's portrait-cue wizard.
 *
 * 1. Intro — what will be reviewed (the character's own garments: no shared
 *    pieces, no archived ones, no outfits) and a "Begin" button.
 * 2. Reviewing — the cheap LLM checks each garment's `imagePrompt` against
 *    its description (`?action=optimize-image-prompts`; writes nothing).
 * 3. Decide — the recommendations, each editable, and the question: make
 *    them all, or choose? Choosing reveals a tick-box per recommendation.
 * 4. Apply — the chosen cues are written in one request
 *    (`?action=apply-image-prompts`), each held to the 200-character cap.
 *
 * @module components/wardrobe/image-prompt-optimizer-modal
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/toast'
import { WARDROBE_IMAGE_PROMPT_MAX_LENGTH } from '@/lib/wardrobe/image-prompt-limit'
import type { PromptRecommendation, PromptRecommendationKind } from '@/lib/wardrobe/prompt-optimizer'

interface ImagePromptOptimizerModalProps {
  characterId: string
  characterName?: string
  onClose: () => void
  /** Called after cues were written, so the wardrobe list re-reads. */
  onApplied: () => void
}

interface OptimizeResponse {
  examined: number
  recommendations: PromptRecommendation[]
  failedItemIds: string[]
  provider: string
  model: string
}

interface DraftRecommendation extends PromptRecommendation {
  /** The cue to write — the proposal, as the operator may have edited it. */
  draft: string
  chosen: boolean
}

type Stage = 'intro' | 'reviewing' | 'decide' | 'choose'

const KIND_LABEL: Record<PromptRecommendationKind, string> = {
  fill: 'Blank — filled in',
  revise: 'Revised to match',
  shorten: 'Trimmed to fit',
}

const optimizeUrl = (characterId: string, action: string) =>
  `/api/v1/characters/${encodeURIComponent(characterId)}/wardrobe?action=${action}`

export function ImagePromptOptimizerModal({
  characterId,
  characterName,
  onClose,
  onApplied,
}: ImagePromptOptimizerModalProps) {
  const id = useId()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const handleFocusKeyDown = useDialogFocus(dialogRef, true)
  const [stage, setStage] = useState<Stage>('intro')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recommendations, setRecommendations] = useState<DraftRecommendation[]>([])
  const [summary, setSummary] = useState<{ examined: number; failed: number; reader: string } | null>(null)

  const busy = stage === 'reviewing' || applying
  useEscapeKey(() => {
    if (!busy) onClose()
  }, true)

  const handleReview = useCallback(async () => {
    setStage('reviewing')
    setError(null)
    const result = await fetchJson<OptimizeResponse>(optimizeUrl(characterId, 'optimize-image-prompts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!result.ok || !result.data) {
      setError(result.error || 'The review could not be completed.')
      setStage('intro')
      return
    }
    const data = result.data
    setSummary({
      examined: data.examined,
      failed: data.failedItemIds.length,
      reader: `${data.provider} • ${data.model}`,
    })
    setRecommendations(
      data.recommendations.map((rec) => ({ ...rec, draft: rec.proposedPrompt, chosen: true })),
    )
    setStage('decide')
  }, [characterId])

  const updateRec = useCallback((itemId: string, patch: Partial<DraftRecommendation>) => {
    setRecommendations((prev) => prev.map((rec) => (rec.itemId === itemId ? { ...rec, ...patch } : rec)))
  }, [])

  const chosenCount = useMemo(() => recommendations.filter((rec) => rec.chosen).length, [recommendations])

  const apply = useCallback(
    async (which: 'all' | 'chosen') => {
      const changes = recommendations
        .filter((rec) => which === 'all' || rec.chosen)
        .map((rec) => ({ itemId: rec.itemId, imagePrompt: rec.draft.trim() }))
        .filter((change) => change.imagePrompt.length > 0)
      if (changes.length === 0) {
        showWarningToast('Nothing chosen to apply.')
        return
      }
      setApplying(true)
      const result = await fetchJson<{ updated: number }>(optimizeUrl(characterId, 'apply-image-prompts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      if (!result.ok || !result.data) {
        showErrorToast(result.error || 'The portrait cues could not be saved.')
        setApplying(false)
        return
      }
      const n = result.data.updated
      showSuccessToast(n === 1 ? 'One portrait cue freshly inked.' : `${n} portrait cues freshly inked.`)
      onApplied()
      onClose()
    },
    [recommendations, characterId, onApplied, onClose],
  )

  const whose = characterName ? `${characterName}'s` : "this character's"

  return (
    <>
      {/* Stacks above the wardrobe dialog, like the import-from-image modal. */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-[70]"
        onClick={() => {
          if (!busy) onClose()
        }}
        aria-label="Close dialog"
        type="button"
      />
      <div
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[80] pointer-events-auto"
        style={{ width: 'min(var(--qt-page-max-width), calc(100vw - 2rem))' }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={handleFocusKeyDown}
          className="qt-dialog qt-dialog-wide max-h-[90vh] overflow-hidden flex flex-col"
        >
          <div className="qt-dialog-header flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 id={titleId} className="qt-dialog-title">Polish the Portrait Cues</h2>
              <button
                aria-label="Close"
                type="button"
                onClick={onClose}
                disabled={busy}
                className="qt-text-secondary hover:text-foreground"
              >
                <Icon name="close" className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="qt-dialog-body space-y-4 flex-1 min-h-0 overflow-y-auto">
            {error && <div className="qt-alert-error rounded px-3 py-2 text-sm">{error}</div>}

            {(stage === 'intro' || stage === 'reviewing') && (
              <div className="space-y-3 text-sm text-foreground">
                <p>
                  A brisk clerk of modest wages will go through {whose} wardrobe, garment by garment, and
                  compare each portrait cue — the short phrase whispered to the portraitist and the Lantern —
                  with the piece&apos;s description. Blank cues are filled in, contradictory ones set right, and
                  every one kept to {WARDROBE_IMAGE_PROMPT_MAX_LENGTH} characters.
                </p>
                <p className="qt-text-secondary text-xs">
                  Only the character&apos;s own pieces are examined: nothing shared from a group, project or
                  Quilltap General, nothing archived, and no multi-part outfits (an outfit is drawn from its
                  pieces). Garments covering several slots are included. Nothing is changed until you say so.
                </p>
                {stage === 'reviewing' && (
                  <div className="flex items-center gap-3 px-3 py-2 rounded qt-bg-muted" role="status">
                    <svg className="w-5 h-5 animate-spin qt-text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                    </svg>
                    <span className="qt-text-secondary">Rummaging through the wardrobe, pencil behind one ear…</span>
                  </div>
                )}
              </div>
            )}

            {(stage === 'decide' || stage === 'choose') && summary && (
              <>
                <div className="text-sm text-foreground space-y-1">
                  <p>
                    {summary.examined === 0
                      ? 'There was nothing in the wardrobe to examine.'
                      : recommendations.length === 0
                        ? `All ${summary.examined} garments passed inspection; not a cue out of place.`
                        : `${summary.examined} garment${summary.examined === 1 ? '' : 's'} examined; ${recommendations.length} recommended for change.`}
                  </p>
                  <p className="text-xs qt-text-secondary">Reviewed by {summary.reader}</p>
                  {summary.failed > 0 && (
                    <p className="text-xs qt-text-warning">
                      {summary.failed} garment{summary.failed === 1 ? '' : 's'} could not be read this time; run it again to try those.
                    </p>
                  )}
                  {recommendations.length > 0 && stage !== 'choose' && (
                    <p className="font-medium pt-2">
                      Shall all {recommendations.length} be made, or would you rather choose?
                    </p>
                  )}
                </div>

                <ul className="space-y-3">
                  {recommendations.map((rec) => {
                    const fieldId = `${id}-cue-${rec.itemId}`
                    const muted = stage === 'choose' && !rec.chosen
                    return (
                      <li
                        key={rec.itemId}
                        className={`border qt-border-default rounded-lg p-3 space-y-2 transition-opacity ${muted ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          {stage === 'choose' && (
                            <input
                              type="checkbox"
                              checked={rec.chosen}
                              onChange={(e) => updateRec(rec.itemId, { chosen: e.target.checked })}
                              aria-label={`Apply the new cue for ${rec.title}`}
                              className="qt-checkbox mt-1"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-sm font-medium text-foreground">{rec.title}</span>
                              <span className="text-xs qt-text-secondary">{rec.types.join(', ')}</span>
                              <span className="qt-badge text-xs">{KIND_LABEL[rec.kind]}</span>
                            </div>
                            {rec.reason && <p className="text-xs qt-text-secondary mt-0.5">{rec.reason}</p>}
                          </div>
                        </div>
                        <div className={stage === 'choose' ? 'ml-7 space-y-2' : 'space-y-2'}>
                          <p className="text-xs qt-text-secondary">
                            <span className="font-medium">Was:</span>{' '}
                            {rec.currentPrompt ? rec.currentPrompt : <em>(blank)</em>}
                          </p>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label htmlFor={fieldId} className="qt-label text-xs">
                                New cue
                              </label>
                              <span className="text-xs qt-text-secondary">
                                {rec.draft.length}/{WARDROBE_IMAGE_PROMPT_MAX_LENGTH}
                              </span>
                            </div>
                            <input
                              id={fieldId}
                              type="text"
                              value={rec.draft}
                              maxLength={WARDROBE_IMAGE_PROMPT_MAX_LENGTH}
                              disabled={applying}
                              onChange={(e) => updateRec(rec.itemId, { draft: e.target.value })}
                              className="qt-input text-sm w-full"
                            />
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>

          <div className="qt-dialog-footer flex-shrink-0">
            <div className="flex flex-wrap justify-end gap-2">
              {(stage === 'intro' || stage === 'reviewing') && (
                <>
                  <button type="button" className="qt-button-secondary" onClick={onClose} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className="qt-button-primary" onClick={handleReview} disabled={busy}>
                    {stage === 'reviewing' ? 'Reviewing…' : 'Begin the review'}
                  </button>
                </>
              )}
              {stage === 'decide' && recommendations.length > 0 && (
                <>
                  <button type="button" className="qt-button-secondary" onClick={onClose} disabled={busy}>
                    Leave them as they are
                  </button>
                  <button type="button" className="qt-button-secondary" onClick={() => setStage('choose')} disabled={busy}>
                    Let me choose
                  </button>
                  <button type="button" className="qt-button-primary" onClick={() => void apply('all')} disabled={busy}>
                    {applying ? 'Inking…' : `Make all ${recommendations.length}`}
                  </button>
                </>
              )}
              {stage === 'choose' && (
                <>
                  <button
                    type="button"
                    className="qt-button-ghost qt-button-sm mr-auto"
                    onClick={() => {
                      const allOn = chosenCount === recommendations.length
                      setRecommendations((prev) => prev.map((rec) => ({ ...rec, chosen: !allOn })))
                    }}
                  >
                    {chosenCount === recommendations.length ? 'Untick all' : 'Tick all'}
                  </button>
                  <button type="button" className="qt-button-secondary" onClick={() => setStage('decide')} disabled={busy}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="qt-button-primary"
                    onClick={() => void apply('chosen')}
                    disabled={chosenCount === 0 || busy}
                  >
                    {applying ? 'Inking…' : `Apply ${chosenCount} chosen`}
                  </button>
                </>
              )}
              {stage === 'decide' && recommendations.length === 0 && (
                <button type="button" className="qt-button-primary" onClick={onClose}>
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
