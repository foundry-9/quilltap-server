'use client'

/**
 * InformDialog — a quiet word out of character.
 *
 * The operator picks one, several or every LLM-controlled seat and writes a
 * short second-person passage. Each target receives it verbatim as a system
 * block on their next generation, and then it is consumed. Nothing here is
 * ever spoken aloud; the transcript keeps a Host record for the operator alone.
 *
 * Structure, props style and `qt-*` vocabulary mirror
 * {@link ../chat/InsertAnnouncementDialog} deliberately — the two dialogs sit
 * side by side in the gutter and should feel like siblings.
 *
 * ── Width ────────────────────────────────────────────────────────────────
 * The operator asked for a dialog wide enough to hold the whole
 * `MarkdownLexicalEditor` formatting toolbar without wrapping. The number
 * below is DERIVED FROM THE CSS, not measured in a live browser — confirm it
 * during live verification.
 *
 * `FormattingToolbar` here renders with no roleplay template, so its top-level
 * children are: [markdown section] [divider] [☺] [Ω] [divider] [source section].
 *
 *   Markdown section (`.qt-formatting-toolbar-section`, gap-1 = 4px) — 14
 *   buttons: B, I, H1–H6, "• …", "1. …", ", ⇤, ⇥, CODE. `.qt-formatting-button`
 *   is min-width 1.75rem (28px) with 0.375rem padding each side (12px), so each
 *   is max(28, 12 + label width) at text-xs (12px):
 *       B, I, H1–H6, "   — 9 × 28 (all label-narrower than 28) = 252px
 *       "• …"             ≈ 12 + 20                            =  32px
 *       "1. …"            ≈ 12 + 25                            =  37px
 *       ⇤, ⇥              (1.05rem glyph ≈ 17) 2 × (12 + 17)   =  58px
 *       CODE              (monospace 12px, 4 × 7.2 ≈ 29)       =  41px
 *       13 inner gaps × 4px                                    =  52px
 *                                                 section total = 472px
 *   2 dividers (`.qt-formatting-toolbar-divider`: 1px + mx-1)   =  18px
 *   ☺ and Ω (`.qt-formatting-button-emoji`, 12 + 17 each)      =  58px
 *   Source toggle button (icon w-4 + 12 padding → min-width 28) =  28px
 *   5 top-level gaps × 8px (`.qt-formatting-toolbar` gap-2)     =  40px
 *   `.qt-formatting-toolbar` padding 0.5rem each side           =  16px
 *   `.qt-doc-toolbar` padding px-4                              =  32px
 *   Editor frame border (1px each side)                         =   2px
 *   Dialog body `p-4`                                           =  32px
 *   Scrollbar gutter on the scrolling body (macOS classic)      =  16px
 *   `.qt-floating-dialog` border (1px each side, border-box)    =   2px
 *                                                         TOTAL ≈ 716px
 *
 * Rounded up to 720 for `minWidth` — glyph advances above are nominal, and a
 * theme may swap in a wider heading or monospace face — and opened at 780 so
 * the toolbar still has slack at the default size. The spec's guess of "around
 * 820" was an estimate; this is the arithmetic.
 */

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { queryKeys } from '@/lib/query/keys'
import { useImagesHidden } from '@/components/quick-hide/images-hidden-context'

/** Derived from the formatting toolbar's own CSS — see the header comment. */
const TOOLBAR_MIN_WIDTH = 720
const DIALOG_OPEN_WIDTH = 780

/** A current participant of the chat, offered as an inform target. */
export interface InformAudienceCandidate {
  /** CHAT PARTICIPANT id — never a character id. */
  participantId: string
  name: string
  controlledBy: 'llm' | 'user'
  avatarUrl?: string | null
  status?: 'active' | 'silent' | 'absent' | 'removed'
}

interface InformDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Current participants. User-controlled seats are filtered out here. */
  audienceCandidates?: InformAudienceCandidate[]
  onPosted?: () => void
}

export default function InformDialog({
  isOpen,
  onClose,
  chatId,
  audienceCandidates = [],
  onPosted,
}: InformDialogProps) {
  const imagesHidden = useImagesHidden()
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  // Chosen seats. EMPTY MEANS EVERYONE — the default, and what a full
  // selection collapses back to when it is posted.
  const [selected, setSelected] = useState<string[]>([])
  const [isPosting, setIsPosting] = useState(false)

  // Note: state resets naturally on each open because the parent conditionally
  // renders this component (`{informOpen && <... />}`), so each open is a fresh
  // mount and useState() initializers fire again.

  // Only LLM-controlled seats can be informed: a seat the human plays has no
  // generation to slip the passage into, so it is not offered at all.
  const eligible = useMemo(
    () => audienceCandidates.filter((p) => p.controlledBy !== 'user'),
    [audienceCandidates],
  )

  const everyone = selected.length === 0 || selected.length === eligible.length

  const toggleSeat = (participantId: string) => {
    setSelected((prev) =>
      prev.includes(participantId)
        ? prev.filter((id) => id !== participantId)
        : [...prev, participantId],
    )
  }

  const selectedNames = useMemo(
    () =>
      selected
        .map((id) => eligible.find((p) => p.participantId === id)?.name)
        .filter((name): name is string => Boolean(name)),
    [selected, eligible],
  )

  const canSubmit =
    !isPosting && content.trim().length > 0 && eligible.length > 0

  const handlePost = async () => {
    if (!canSubmit) return
    // Actual coverage decides the record's public/whisper shape, not how the
    // operator clicked: ticking every seat is the same thing as Everyone.
    const targetParticipantIds = everyone ? null : selected

    setIsPosting(true)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=inform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentMarkdown: content.trim(),
          targetParticipantIds,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const message = err.message || err.error || `Failed (HTTP ${res.status})`
        showErrorToast(message)
        return
      }

      showSuccessToast(
        everyone ? 'The company has been informed' : `Informed ${selectedNames.join(', ')}`,
      )
      onPosted?.()
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.informs(chatId) })
      onClose()
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to post the inform'
      showErrorToast(msg)
    } finally {
      setIsPosting(false)
    }
  }

  const dialogClose = isPosting ? () => {} : onClose

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={dialogClose}
      title="Inform the cast"
      storageKey="quilltap:inform-geometry"
      initialGeometry={{ width: DIALOG_OPEN_WIDTH, height: 620 }}
      minWidth={TOOLBAR_MIN_WIDTH}
      minHeight={460}
    >
      <div className="flex flex-col h-full">
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col">
          {/* Audience — Everyone by default; ticking a seat narrows it. */}
          <div className="mb-4">
            <label className="block text-sm qt-text-primary mb-2" id="inform-audience-label">
              Who is told
            </label>
            {eligible.length === 0 ? (
              <div className="qt-text-secondary text-sm">
                No seat in this chat is played by a model, so there is nobody to take
                the note aside.
              </div>
            ) : (
              <div
                role="group"
                aria-labelledby="inform-audience-label"
                className="flex flex-wrap gap-2"
              >
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  aria-pressed={everyone}
                  disabled={isPosting}
                  className={`px-3 py-1.5 text-sm rounded-full border qt-border-primary flex items-center gap-2 ${
                    everyone ? 'qt-bg-primary/20' : 'hover:qt-bg-primary/10'
                  }`}
                >
                  Everyone
                </button>
                {eligible.map((p) => {
                  const picked = selected.includes(p.participantId)
                  return (
                    <button
                      key={p.participantId}
                      type="button"
                      onClick={() => toggleSeat(p.participantId)}
                      aria-pressed={picked}
                      disabled={isPosting}
                      className={`px-3 py-1.5 text-sm rounded-full border qt-border-primary flex items-center gap-2 ${
                        picked ? 'qt-bg-primary/20' : 'hover:qt-bg-primary/10'
                      }`}
                    >
                      {p.avatarUrl && !imagesHidden ? (
                        <img
                          src={p.avatarUrl}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full qt-bg-secondary flex-shrink-0" />
                      )}
                      <span className="min-w-0 truncate">{p.name}</span>
                      {(p.status === 'silent' || p.status === 'absent') && (
                        <span className="qt-text-xs flex-shrink-0">({p.status})</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Guidance — the second-person rule, in the house voice. */}
          <div className="mb-4 qt-text-xs">
            Write it <em>to</em> them, in the second person, as something they now know or
            notice — <em>You see that Alice slipped the letter into her sleeve.</em>{' '}
            <em>You remember that Bob and Carol were at school together.</em> Everyone you
            tick receives the identical words before their next turn, so set down a passage
            that is true from each of their chairs. It is never spoken aloud, and once they
            have had their turn it is gone, like a note fed to the fire.
          </div>

          {/* The passage itself */}
          <div className="flex-1 flex flex-col min-h-0">
            <label className="block text-sm qt-text-primary mb-2" id="inform-body-label">
              What they are told
            </label>
            <MarkdownLexicalEditor
              value={content}
              onChange={setContent}
              disabled={isPosting}
              namespace="InformDialog"
              ariaLabel="What they are told"
              className="flex-1"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t qt-border-default px-4 py-3 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="qt-button qt-button-secondary"
            disabled={isPosting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePost}
            disabled={!canSubmit}
            className="qt-button qt-button-primary"
          >
            {isPosting ? 'Informing…' : 'Inform'}
          </button>
        </div>
      </div>
    </FloatingDialog>
  )
}
