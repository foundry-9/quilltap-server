'use client'

import { useId } from 'react'
import type { MessageEditImpact } from '@/lib/schemas/message-edit-impact.types'
import type { EditImpactState } from '../../hooks/useMessageActions'

interface MessageEditorProps {
  messageId: string
  content: string
  onChange: (content: string) => void
  onSave: (messageId: string) => void
  onCancel: () => void
  /** What the edit disturbs; null when the check has not been asked. */
  impact: EditImpactState | null
  regenerateMemories: boolean
  onRegenerateMemoriesChange: (value: boolean) => void
}

/** "a model has read it since" — the sentence, with what we know of how often. */
function seenSentence(impact: MessageEditImpact): string {
  const calls = impact.laterLlmCalls
  const lines = impact.laterCharacterLines
  const evidence = calls > 0
    ? `${calls} later model ${calls === 1 ? 'call has' : 'calls have'} read it`
    : `${lines} character ${lines === 1 ? 'line has' : 'lines have'} been written after it`
  return `This line has already been put before a model since it landed — ${evidence}. ` +
    'Your edit changes what every future call sees, but what was said in answer to the old words stays said.'
}

function memorySubject(impact: MessageEditImpact): string {
  switch (impact.memorySource) {
    case 'turn': return 'the turn this line belongs to'
    case 'carina': return 'this answer'
    case 'established-fact': return 'this established fact'
    default: return 'this line'
  }
}

/**
 * The in-place editor for any line of the transcript. When it opens it asks
 * what the edit would disturb, and says so above the text: a model that has
 * already read the old words, and the memories they formed — with the offer
 * (on by default) to retire those memories and draw fresh ones from the edit.
 */
export function MessageEditor({
  messageId,
  content,
  onChange,
  onSave,
  onCancel,
  impact,
  regenerateMemories,
  onRegenerateMemoriesChange,
}: MessageEditorProps) {
  const checkboxId = useId()
  const ready = impact?.messageId === messageId && impact.status === 'ready' ? impact.impact : null
  const memoryCount = ready?.memoryCount ?? 0

  return (
    <div className="qt-chat-message-editor">
      {impact?.messageId === messageId && impact.status === 'loading' && (
        <p className="qt-text-xs qt-text-secondary" role="status">
          Consulting the ledgers to see who has read this line…
        </p>
      )}
      {ready?.seenByLlm && (
        <div className="qt-alert-warning" role="alert">
          {seenSentence(ready)}
        </div>
      )}
      {memoryCount > 0 && (
        <div className="qt-alert-info qt-chat-message-editor-notice">
          <p>
            The Commonplace Book holds {memoryCount} {memoryCount === 1 ? 'memory' : 'memories'} drawn
            from {memorySubject(ready!)}.
          </p>
          {ready!.canRegenerateMemories ? (
            <label htmlFor={checkboxId} className="qt-chat-message-editor-option">
              <input
                id={checkboxId}
                type="checkbox"
                checked={regenerateMemories}
                onChange={(e) => onRegenerateMemoriesChange(e.target.checked)}
              />
              <span>
                Regenerate {memoryCount === 1 ? 'it' : 'them'} on save — retire the old and draw fresh ones from the edited text
              </span>
            </label>
          ) : (
            <p className="qt-text-xs">
              No connection profile is at hand to draw fresh ones, so {memoryCount === 1 ? 'it stays' : 'they stay'} as written.
            </p>
          )}
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        className="qt-textarea"
        aria-label="Edit message"
        rows={Math.min(16, Math.max(3, content.split('\n').length + 1))}
      />
      <div className="qt-chat-message-editor-actions">
        <button
          type="button"
          onClick={() => onSave(messageId)}
          disabled={content.trim().length === 0}
          className="qt-button qt-button-primary qt-button-sm"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="qt-button qt-button-secondary qt-button-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
