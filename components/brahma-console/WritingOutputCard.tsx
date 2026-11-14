'use client'

/**
 * WritingOutputCard
 *
 * One Writing Assistant output (`systemKind: 'writing-output'`): the piece as
 * rendered Markdown inside its own frame, with a toolbar — Copy (the stored
 * Markdown verbatim), Download (`.md`), Save to store (store, folder and name;
 * the server reads the text from the stored message), and a Rendered / Source
 * toggle so the operator sees exactly what will be copied. Each output in a
 * conversation is its own card.
 *
 * @module components/brahma-console/WritingOutputCard
 */

import { useCallback, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import MessageContent from '@/components/chat/MessageContent'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { DocumentDestinationDialog, type DocumentDestination } from '@/components/document-browser/DocumentDestinationDialog'
import { ApiFetchError, apiFetch } from '@/lib/query/fetcher'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface WritingOutputCardProps {
  chatId: string | null
  messageId: string | null
  content: string
  /** Default filename (`<slug>.md`, `<slug>-2.md`, …). */
  filename: string
  reasoningContent?: string | null
  /** A provisional card while the reply streams: no toolbar. */
  draft?: boolean
}

interface SaveResponse {
  saved: boolean
  storeName: string
  path: string
  address: string
}

export function WritingOutputCard({ chatId, messageId, content, filename, reasoningContent, draft }: WritingOutputCardProps) {
  const [view, setView] = useState<'rendered' | 'source'>('rendered')
  const [copied, setCopied] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState(filename)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<DocumentDestination | null>(null)
  const [savedAddress, setSavedAddress] = useState<string | null>(null)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy output', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [content])

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [content, filename])

  const save = useCallback(async (destination: DocumentDestination, onConflict: 'fail' | 'overwrite') => {
    if (!chatId || !messageId) return
    setSaving(true)
    try {
      const result = await apiFetch<SaveResponse>(`/api/v1/brahma-console/${chatId}?action=save-output`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          mountPointId: destination.mountPointId,
          folderPath: destination.folder,
          filename: saveName.trim() || filename,
          onConflict,
        }),
      })
      setSaveOpen(false)
      setConflict(null)
      setSavedAddress(result.address || null)
      showSuccessToast(`Filed in ${result.storeName}: ${result.path}`)
    } catch (error) {
      if (error instanceof ApiFetchError && error.status === 409) {
        setConflict(destination)
      } else {
        showErrorToast(error instanceof Error ? error.message : 'The piece could not be saved')
      }
    } finally {
      setSaving(false)
    }
  }, [chatId, messageId, saveName, filename])

  return (
    <div className={`qt-console-output${draft ? ' qt-console-output-draft' : ''}`}>
      {reasoningContent && <ThinkingBlock content={reasoningContent} collapsedByDefault align="start" />}
      {draft ? (
        <div className="qt-console-output-toolbar">
          <span className="text-xs qt-text-secondary italic">Draft — still being set in type…</span>
        </div>
      ) : (
        <div className="qt-console-output-toolbar" role="toolbar" aria-label="Output controls">
          <button
            type="button"
            className="qt-chat-message-action-icon"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy the Markdown'}
            title={copied ? 'Copied!' : 'Copy the Markdown'}
          >
            <Icon name={copied ? 'check' : 'copy'} />
          </button>
          <button
            type="button"
            className="qt-chat-message-action-icon"
            onClick={handleDownload}
            aria-label={`Download ${filename}`}
            title={`Download ${filename}`}
          >
            <Icon name="download" />
          </button>
          <button
            type="button"
            className="qt-chat-message-action-icon"
            onClick={() => { setSaveName(filename); setConflict(null); setSaveOpen(true) }}
            disabled={!chatId || !messageId}
            aria-label="Save to a document store"
            title="Save to a document store"
          >
            <Icon name="folder-plus" />
          </button>
          <span className="flex-1" />
          <div className="qt-console-output-view" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === 'rendered'}
              className={view === 'rendered' ? 'qt-console-output-view-on' : ''}
              onClick={() => setView('rendered')}
            >
              Rendered
            </button>
            <button
              type="button"
              aria-pressed={view === 'source'}
              className={view === 'source' ? 'qt-console-output-view-on' : ''}
              onClick={() => setView('source')}
            >
              Source
            </button>
          </div>
        </div>
      )}
      <div className="qt-console-output-body">
        {view === 'source' && !draft ? (
          <pre className="qt-console-output-source">{content}</pre>
        ) : (
          <MessageContent content={content} />
        )}
      </div>
      {savedAddress && (
        <div className="qt-console-output-saved text-xs qt-text-secondary">
          <MessageContent content={`Saved to ${savedAddress}`} />
        </div>
      )}

      {saveOpen && (
        <DocumentDestinationDialog
          isOpen={saveOpen}
          mode="save"
          subject={saveName.trim() || filename}
          currentFolder={null}
          working={saving}
          onClose={() => { if (!saving) { setSaveOpen(false); setConflict(null) } }}
          onSubmit={(destination) => save(destination, 'fail')}
          submitBlocked={!saveName.trim() || conflict !== null}
          note="Choose a store, a folder and a name. The piece is filed exactly as the Source view shows it."
          overlayClassName="qt-console-modal-layer"
        >
          <div className="mt-3">
            <label htmlFor="console-output-filename" className="qt-label block mb-1">File name</label>
            <input
              id="console-output-filename"
              type="text"
              className="qt-input w-full"
              value={saveName}
              onChange={e => { setSaveName(e.target.value); setConflict(null) }}
              disabled={saving}
            />
          </div>
          {conflict && (
            <div className="mt-3 flex flex-wrap items-center gap-2" role="alert">
              <span className="text-sm qt-text-destructive">A file of that name already sits there.</span>
              <button
                type="button"
                className="qt-button-secondary qt-button-sm"
                onClick={() => void save(conflict, 'overwrite')}
                disabled={saving}
              >
                Overwrite it
              </button>
              <span className="text-xs qt-text-secondary">or choose another name above.</span>
            </div>
          )}
        </DocumentDestinationDialog>
      )}
    </div>
  )
}
