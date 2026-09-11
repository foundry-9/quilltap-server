'use client'

import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { QuillAnimation } from '@/components/chat/QuillAnimation'

export interface VoiceRewriteReviewPanelProps {
  /** Name to put in the "What {name} will say" heading. */
  characterName: string
  /** True while the rewrite is in flight — shows the quill in place of the editor. */
  generating: boolean
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Lexical namespace; must be unique per mounted editor. */
  namespace: string
  ariaLabel: string
}

/**
 * The review half of a "say it in the character's own voice" rehearsal: the
 * heading, the generating state, and the editable proposal.
 *
 * Shared by the off-scene rehearsal (`InsertAnnouncementDialog`) and the
 * in-scene one (`ImpersonationVoiceDialog`) so the two cannot drift apart in
 * look or behaviour. Presentation only — every decision about when it appears
 * and what becomes of the text stays with the dialog.
 */
export function VoiceRewriteReviewPanel({
  characterName,
  generating,
  value,
  onChange,
  disabled = false,
  namespace,
  ariaLabel,
}: VoiceRewriteReviewPanelProps) {
  return (
    <div>
      <label className="block text-sm qt-text-primary mb-2">
        What {characterName} will say
      </label>
      {generating ? (
        <div className="qt-border-primary border rounded p-6 flex flex-col items-center justify-center gap-3 min-h-32">
          <QuillAnimation size="lg" />
          <div className="qt-text-secondary text-sm">Generating in character…</div>
        </div>
      ) : (
        <MarkdownLexicalEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
          namespace={namespace}
          ariaLabel={ariaLabel}
        />
      )}
    </div>
  )
}

export default VoiceRewriteReviewPanel
