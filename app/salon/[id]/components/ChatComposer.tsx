'use client'

import { useRef, useState, useCallback } from 'react'
import ToolPalette from '@/components/chat/ToolPalette'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import ComposerGutterTools from '@/components/chat/ComposerGutterTools'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { LexicalComposerWrapper } from '@/components/chat/lexical'
import type { ComposerEditorHandle } from '@/components/chat/lexical'
import type { AttachedFile, PendingToolResult } from '../types'
import type { RenderingPattern, DialogueDetection, NarrationDelimiters } from '@/lib/schemas/template.types'
import type { OutfitNotifications } from '../hooks/useOutfitNotification'

// Platform detection for keyboard shortcuts
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

interface ChatComposerProps {
  id: string
  input: string
  setInput: (value: string) => void
  attachedFiles: AttachedFile[]
  onRemoveAttachedFile: (fileId: string) => void
  /** Pending tool results to display in composer */
  pendingToolResults: PendingToolResult[]
  /** Remove a pending tool result */
  onRemovePendingToolResult: (id: string) => void
  /** External ref for the editor, enabling parent components to focus it */
  inputRef?: React.MutableRefObject<ComposerEditorHandle | null>
  disabled: boolean
  sending: boolean
  hasActiveCharacters: boolean
  streaming: boolean
  waitingForResponse: boolean
  /** Current response generation status */
  responseStatus?: {
    stage: string
    message: string
    toolName?: string
    characterName?: string
  } | null
  toolPaletteOpen: boolean
  setToolPaletteOpen: (open: boolean) => void
  showSource: boolean
  setShowSource: (show: boolean) => void
  uploadingFile: boolean
  toolExecutionStatus: { tool: string; status: 'pending' | 'success' | 'error'; message: string } | null
  /** Patterns for styling roleplay text in preview */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling in preview */
  dialogueDetection?: DialogueDetection | null
  chatPhotoCount: number
  chatMemoryCount: number
  hasImageProfile: boolean
  isSingleCharacterChat: boolean
  roleplayTemplateId?: string | null
  /** Whether document editing mode is enabled */
  documentEditingMode: boolean
  /** Toggle document editing mode on/off */
  onToggleDocumentEditingMode: () => void
  /** Callback to open the document picker for Document Mode */
  onOpenDocumentClick?: () => void
  /** Whether Document Mode is currently active (split/focus) */
  isDocumentModeActive?: boolean
  /** Whether agent mode is enabled for this chat */
  agentModeEnabled?: boolean | null
  /** Callback to toggle agent mode */
  onAgentModeToggle?: () => void

  // Callbacks
  onSubmit: (e: React.FormEvent) => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onAttachFileClick?: () => void
  onImagePaste: (file: File) => Promise<void>
  onGalleryClick: () => void
  onGenerateImageClick: () => void
  onLibraryFileClick: () => void
  onStandaloneGenerateImageClick: () => void
  onAddCharacterClick: () => void
  onSettingsClick: () => void
  onRenameClick?: () => void
  onProjectClick?: () => void
  projectName?: string | null
  onDeleteChatMemoriesClick: () => void
  onReextractMemoriesClick: () => void
  onSearchReplaceClick?: () => void
  onBulkCharacterReplaceClick?: () => void
  onToolSettingsClick?: () => void
  onRunToolClick?: () => void
  onStateClick?: () => void
  onRegenerateBackgroundClick?: () => void
  onRoleplayTemplateChange?: () => void
  storyBackgroundsEnabled?: boolean
  onStopStreaming: () => void
  /** Hide the stop button (when sidebar has its own stop button) */
  hideStopButton?: boolean
  /** Callback when a pending tool result is added */
  onPendingToolResult?: (result: Omit<PendingToolResult, 'id' | 'createdAt'>) => void
  /** Current roleplay template narration delimiters (e.g. '*' or ['[', ']']) */
  narrationDelimiters?: NarrationDelimiters
  /** Whether there are pending outfit change notifications */
  outfitNotificationHasPending?: boolean
  /** Number of pending outfit notifications */
  outfitNotificationCount?: number
  /** Consume all pending outfit notifications, returns them and clears state */
  onConsumeOutfitNotifications?: () => OutfitNotifications
}

export function ChatComposer({
  id,
  input,
  setInput,
  attachedFiles,
  onRemoveAttachedFile,
  pendingToolResults,
  onRemovePendingToolResult,
  disabled,
  sending,
  hasActiveCharacters,
  streaming,
  waitingForResponse,
  responseStatus,
  toolPaletteOpen,
  setToolPaletteOpen,
  showSource,
  setShowSource,
  uploadingFile,
  toolExecutionStatus,
  renderingPatterns,
  dialogueDetection,
  chatPhotoCount,
  chatMemoryCount,
  hasImageProfile,
  isSingleCharacterChat,
  roleplayTemplateId,
  documentEditingMode,
  onToggleDocumentEditingMode,
  onOpenDocumentClick,
  isDocumentModeActive,
  inputRef: externalInputRef,
  agentModeEnabled = false,
  onAgentModeToggle,
  onSubmit,
  onFileSelect,
  onAttachFileClick,
  onImagePaste,
  onGalleryClick,
  onGenerateImageClick,
  onLibraryFileClick,
  onStandaloneGenerateImageClick,
  onAddCharacterClick,
  onSettingsClick,
  onRenameClick,
  onProjectClick,
  projectName,
  onDeleteChatMemoriesClick,
  onReextractMemoriesClick,
  onSearchReplaceClick,
  onBulkCharacterReplaceClick,
  onToolSettingsClick,
  onRunToolClick,
  onStateClick,
  onRegenerateBackgroundClick,
  onRoleplayTemplateChange,
  storyBackgroundsEnabled = false,
  onStopStreaming,
  hideStopButton = false,
  onPendingToolResult,
  narrationDelimiters,
  outfitNotificationHasPending = false,
  outfitNotificationCount = 0,
  onConsumeOutfitNotifications,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toolPaletteToggleRef = useRef<HTMLButtonElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<ComposerEditorHandle>(null)
  // Track the Lexical editor instance in state so it's available during render
  // (refs can't be read during render in React 19)
  const [lexicalEditor, setLexicalEditor] = useState<import('lexical').LexicalEditor | null>(null)

  // Sync external ref with internal editor ref
  const setEditorRef = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle
      if (externalInputRef) {
        externalInputRef.current = handle
      }
    },
    [externalInputRef],
  )

  // Handler that triggers the file input click
  const handleAttachFileClick = () => {
    fileInputRef.current?.click()
    onAttachFileClick?.()
  }

  // Submit handler: reads markdown from Lexical and dispatches form submit
  const handleEditorSubmit = useCallback(() => {
    const markdown = editorRef.current?.getMarkdown() ?? ''
    if (markdown.trim() || attachedFiles.length > 0 || pendingToolResults.length > 0) {
      setInput(markdown)
      // Use a microtask to ensure setInput has propagated
      setTimeout(() => {
        const form = document.querySelector<HTMLFormElement>(`#composer-form-${id}`)
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true }))
          setTimeout(() => {
            editorRef.current?.focus({ preventScroll: true })
          }, 10)
        }
      }, 0)
    }
  }, [id, attachedFiles.length, pendingToolResults.length, setInput])

  // Handle outfit notification insertion
  const handleInsertOutfitNotification = useCallback(() => {
    if (!onConsumeOutfitNotifications) return
    const notifications = onConsumeOutfitNotifications()
    if (Object.keys(notifications).length === 0) return

    // Build the text to insert
    const parts: string[] = []
    for (const [name, entry] of Object.entries(notifications)) {
      const label = entry.type === 'clothing' ? 'clothing change' : 'wardrobe change'
      parts.push(`${label}: ${name}:\n${entry.description}`)
    }
    const notificationText = parts.join('\n').trimEnd()

    // Wrap in a ```wardrobe code block so the model sees the change as
    // structured data rather than narration. Route through setMarkdown so the
    // fence is parsed into a real code-block node — prependText would wrap the
    // whole string in a text node and escape the backticks on serialization.
    const wrappedText = `\`\`\`wardrobe\n${notificationText}\n\`\`\``
    const existing = editorRef.current?.getMarkdown() ?? ''
    const combined = existing.trim() ? `${wrappedText}\n\n${existing}` : wrappedText
    editorRef.current?.setMarkdown(combined)
  }, [onConsumeOutfitNotifications])

  // Capture the Lexical editor instance when the wrapper mounts
  const composerRefCallback = useCallback(
    (handle: ComposerEditorHandle | null) => {
      setEditorRef(handle)
      setLexicalEditor(handle?.getEditor() ?? null)
    },
    [setEditorRef],
  )

  return (
    <div className="qt-chat-composer">
      {/* No active characters warning */}
      {!hasActiveCharacters && (
        <div className="qt-alert qt-alert-warning flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="font-medium text-sm">No characters in this chat</p>
            <p className="text-xs opacity-80 mt-0.5">
              Add a character to continue the conversation.
            </p>
          </div>
        </div>
      )}

      <div className="qt-chat-composer-content">
        {/* Tool execution status indicator */}
        {toolExecutionStatus && (
          <div
            className={`qt-alert flex items-center gap-2 ${
              toolExecutionStatus.status === 'pending'
                ? 'qt-alert-info'
                : toolExecutionStatus.status === 'success'
                  ? 'qt-alert-success'
                  : 'qt-alert-error'
            }`}
          >
            {toolExecutionStatus.status === 'pending' ? (
              <svg className="w-5 h-5 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            ) : toolExecutionStatus.status === 'success' ? (
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            )}
            <span className="text-sm font-medium">{toolExecutionStatus.message}</span>
          </div>
        )}

        {/* Response status indicator */}
        {responseStatus && (
          <div
            className="qt-chat-response-status"
            data-stage={responseStatus.stage}
            role="status"
            aria-live="polite"
          >
            <div className="qt-chat-response-status-icon">
              {responseStatus.stage === 'streaming' ? (
                <QuillAnimation size="sm" />
              ) : (
                <svg className="w-4 h-4 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" opacity="0.3" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              )}
            </div>
            <span className="qt-chat-response-status-text">
              {responseStatus.message}
            </span>
          </div>
        )}

        {/* Attached files and pending tool results preview */}
        {(attachedFiles.length > 0 || pendingToolResults.length > 0) && (
          <div className="qt-chat-attachment-list mb-2">
            {/* Attached files */}
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className="qt-chat-attachment-chip"
              >
                {file.mimeType.startsWith('image/') ? (
                  <svg className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ) : (
                  <svg className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                <span className="text-foreground max-w-[150px] truncate">
                  {file.filename}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachedFile(file.id)}
                  className="qt-chat-attachment-chip-remove"
                  title="Remove attachment"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Pending tool results */}
            {pendingToolResults.map((result) => (
              <div
                key={result.id}
                className="qt-chat-tool-result-chip group relative"
                title={`${result.requestPrompt}\n\n${result.formattedResult}`}
              >
                <span className="text-base leading-none">{result.icon}</span>
                <span className="text-foreground max-w-[200px] truncate">
                  {result.summary}
                </span>
                <button
                  type="button"
                  onClick={() => onRemovePendingToolResult(result.id)}
                  className="qt-chat-attachment-chip-remove"
                  title="Remove tool result"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Tool palette popover - shows above the composer when open */}
        <ToolPalette
          isOpen={toolPaletteOpen}
          onClose={() => setToolPaletteOpen(false)}
          toggleButtonRef={toolPaletteToggleRef}
          onGalleryClick={onGalleryClick}
          onSettingsClick={onSettingsClick}
          onRenameClick={onRenameClick}
          onProjectClick={onProjectClick}
          projectName={projectName}
          onAddCharacterClick={onAddCharacterClick}
          onDeleteChatMemoriesClick={onDeleteChatMemoriesClick}
          onReextractMemoriesClick={onReextractMemoriesClick}
          onSearchReplaceClick={onSearchReplaceClick}
          onBulkCharacterReplaceClick={onBulkCharacterReplaceClick}
          onToolSettingsClick={onToolSettingsClick}
          onRunToolClick={onRunToolClick}
          onStateClick={onStateClick}
          onRegenerateBackgroundClick={onRegenerateBackgroundClick}
          chatPhotoCount={chatPhotoCount}
          showAddCharacter={isSingleCharacterChat}
          chatId={id}
          chatMemoryCount={chatMemoryCount}
          storyBackgroundsEnabled={storyBackgroundsEnabled}
          disabled={sending || !hasActiveCharacters}
          agentModeEnabled={agentModeEnabled}
          onAgentModeToggle={onAgentModeToggle}
          roleplayTemplateId={roleplayTemplateId}
          onRoleplayTemplateChange={onRoleplayTemplateChange}
        />

        {/* Formatting toolbar - shown above the form when document editing mode is enabled */}
        {documentEditingMode && lexicalEditor && (
          <FormattingToolbar
            roleplayTemplateId={roleplayTemplateId}
            editor={lexicalEditor}
            disabled={sending || !hasActiveCharacters}
            showSource={showSource}
            sourceTextareaRef={sourceTextareaRef}
            setInput={setInput}
            onToggleSource={() => {
              if (showSource) {
                // Switching back to rich text — sync source edits into Lexical
                editorRef.current?.setMarkdown(input)
              }
              setShowSource(!showSource)
            }}
            narrationDelimiters={narrationDelimiters}
          />
        )}

        <form id={`composer-form-${id}`} onSubmit={onSubmit} className="qt-chat-composer-inner">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={onFileSelect}
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
            className="hidden"
          />

          {/* Left side toolbar - gutter tools, then main toolbar buttons */}
          <div className="qt-chat-toolbar-row">
            {/* Outfit notification button - shown above gutter tools when changes are pending */}
            <div className="qt-composer-gutter-column">
              {outfitNotificationHasPending && (
                <button
                  type="button"
                  onClick={handleInsertOutfitNotification}
                  className="qt-composer-outfit-notify-button"
                  title={`Insert ${outfitNotificationCount} outfit notification${outfitNotificationCount > 1 ? 's' : ''} into message`}
                >
                  <span className="qt-composer-outfit-notify-label">Notify</span>
                  <span className="qt-composer-outfit-notify-icon">👗</span>
                </button>
              )}

            {/* Gutter tools - Attach, Generate, RNG */}
            <ComposerGutterTools
              onAttachFileClick={handleAttachFileClick}
              uploadingFile={uploadingFile}
              onLibraryFileClick={onLibraryFileClick}
              onStandaloneGenerateImageClick={onStandaloneGenerateImageClick}
              chatId={id}
              onPendingToolResult={onPendingToolResult}
              disabled={sending || !hasActiveCharacters}
            />
            </div>

            {/* Main toolbar buttons - hamburger and composition mode */}
            <div className="qt-chat-toolbar">
              {/* Tool palette toggle button */}
              <button
                ref={toolPaletteToggleRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setToolPaletteOpen(!toolPaletteOpen)
                }}
                className="qt-chat-toolbar-button"
                title="Tools"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Composition mode toggle button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleDocumentEditingMode()
                }}
                className={`qt-chat-toolbar-button ${documentEditingMode ? 'qt-chat-toolbar-button-active' : ''}`}
                title={documentEditingMode
                  ? `Switch to chat mode (Enter to send)`
                  : `Switch to composition mode (${isMac ? 'Cmd' : 'Ctrl'}+Enter to send)`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </button>

              {/* Document Mode toggle button */}
              {onOpenDocumentClick && !isDocumentModeActive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDocumentClick()
                  }}
                  className="qt-chat-toolbar-button qt-doc-open-button"
                  title={`Open document (${isMac ? 'Cmd' : 'Ctrl'}+Shift+D)`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {showSource && (
            <textarea
              ref={sourceTextareaRef}
              className="qt-chat-composer-input qt-source-mode-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending || !hasActiveCharacters}
              style={{ lineHeight: '1.5' }}
            />
          )}
          {/* Keep Lexical mounted but hidden during source mode to preserve undo history */}
          <div className="flex-1 min-w-0 self-stretch" style={showSource ? { display: 'none' } : undefined}>
            <LexicalComposerWrapper
              ref={composerRefCallback}
              input={input}
              setInput={setInput}
              onSubmit={handleEditorSubmit}
              onImagePaste={onImagePaste}
              documentEditingMode={documentEditingMode}
              disabled={sending || !hasActiveCharacters}
              placeholder={!hasActiveCharacters ? "Add a character to start chatting..." : attachedFiles.length > 0 ? "Add a message (optional)..." : "Type a message..."}
            />
          </div>

          {/* Right side buttons */}
          {(streaming || waitingForResponse) && !hideStopButton ? (
            /* Stop button - shown during streaming/waiting (hidden when sidebar has its own) */
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onStopStreaming()
              }}
              className="qt-chat-composer-send qt-chat-stop-button"
              title="Stop generating"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            /* Send button - disabled while generating when stop is in sidebar */
            <button
              type="submit"
              disabled={sending || (streaming || waitingForResponse) || (!input.trim() && attachedFiles.length === 0 && pendingToolResults.length === 0) || !hasActiveCharacters}
              className="qt-chat-composer-send"
              title={!hasActiveCharacters ? "Add a character to start chatting" : (streaming || waitingForResponse) ? "Generating..." : "Send message"}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
