'use client'

import { useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import ToolPalette from '@/components/chat/ToolPalette'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import ComposerGutterTools from '@/components/chat/ComposerGutterTools'
import MessageContent from '@/components/chat/MessageContent'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import type { AttachedFile, PendingToolResult } from '../types'
import type { RenderingPattern, DialogueDetection, NarrationDelimiters } from '@/lib/schemas/template.types'
import type { OutfitNotifications } from '../hooks/useOutfitNotification'

// Platform detection for keyboard shortcuts
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

// Use useLayoutEffect on client, useEffect on server (for SSR compatibility)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

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
  /** External ref for the textarea, enabling parent components to focus it */
  inputRef?: React.MutableRefObject<HTMLTextAreaElement | null>
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
  showPreview: boolean
  setShowPreview: (show: boolean) => void
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

const resizeTextarea = (textarea: HTMLTextAreaElement, maxHeight: number) => {
  // Set to 0 first to force browser to recalculate scrollHeight for shrinking
  textarea.style.height = '0'
  const newHeight = Math.min(textarea.scrollHeight, maxHeight)
  textarea.style.height = newHeight + 'px'
}

const getTextareaMaxHeight = (): number => {
  if (typeof globalThis === 'undefined' || !globalThis.window) return 200
  const windowHeight = globalThis.window.innerHeight
  return windowHeight / 3
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
  showPreview,
  setShowPreview,
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
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Callback ref that assigns the textarea element to both our internal ref
  // and the parent's external ref, so parent can focus the textarea directly
  const textareaRefCallback = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node
    if (externalInputRef) {
      externalInputRef.current = node
    }
  }, [externalInputRef])
  // Track the last external input value to detect when parent clears it
  const lastExternalInputRef = useRef(input)
  // Debounce timer for parent state updates
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Calculate maxHeight once on mount and update on resize
  const maxHeightRef = useRef(getTextareaMaxHeight())

  useEffect(() => {
    const handleResize = () => {
      maxHeightRef.current = getTextareaMaxHeight()
      if (inputRef.current) {
        resizeTextarea(inputRef.current, maxHeightRef.current)
      }
    }

    globalThis.window?.addEventListener('resize', handleResize)
    return () => {
      globalThis.window?.removeEventListener('resize', handleResize)
    }
  }, [])

  // Handler that triggers the file input click - the file input lives in this component
  const handleAttachFileClick = () => {
    fileInputRef.current?.click()
    // Also call the parent's callback in case it needs to do something
    onAttachFileClick?.()
  }

  // Only sync when parent clears the input (e.g., after submission)
  // This avoids race conditions with concurrent rendering during typing
  useIsomorphicLayoutEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return

    // Only sync if parent cleared the input (input is now empty but textarea isn't)
    // This is the main case we need: after submission, parent sets input to ''
    if (input === '' && textarea.value !== '' && lastExternalInputRef.current !== '') {
      textarea.value = ''
      resizeTextarea(textarea, maxHeightRef.current)
    }
    lastExternalInputRef.current = input
  }, [input])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // onChange handler - debounces parent state updates to avoid excessive re-renders
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value

    // Resize immediately for responsive UI
    if (inputRef.current) {
      resizeTextarea(inputRef.current, maxHeightRef.current)
    }

    // Debounce the parent state update to avoid render storms in React 19
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setInput(newValue)
    }, 16) // ~1 frame, enough to batch rapid keystrokes
  }, [setInput])

  // Helper to insert a newline at cursor position
  const insertNewline = (textarea: HTMLTextAreaElement) => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const currentValue = textarea.value
    const newValue = currentValue.substring(0, start) + '\n' + currentValue.substring(end)
    textarea.value = newValue
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setInput(newValue)
    }, 16)
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + 1
      resizeTextarea(textarea, maxHeightRef.current)
    }, 0)
  }

  // Helper to submit the form
  const submitForm = (textarea: HTMLTextAreaElement) => {
    const currentValue = textarea.value
    if (currentValue.trim() || attachedFiles.length > 0 || pendingToolResults.length > 0) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      setInput(currentValue)
      const form = textarea.form
      if (form) {
        setTimeout(() => {
          form.dispatchEvent(new Event('submit', { bubbles: true }))
          setTimeout(() => {
            textarea.focus({ preventScroll: true })
          }, 10)
        }, 0)
      }
    }
  }

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

    // Wrap in narration delimiters
    let wrappedText: string
    if (narrationDelimiters) {
      if (Array.isArray(narrationDelimiters)) {
        wrappedText = `${narrationDelimiters[0]}${notificationText}${narrationDelimiters[1]}`
      } else {
        wrappedText = `${narrationDelimiters}${notificationText}${narrationDelimiters}`
      }
    } else {
      wrappedText = notificationText
    }

    // Insert at the top of the textarea
    const textarea = inputRef.current
    if (textarea) {
      const currentValue = textarea.value
      const newValue = currentValue ? `${wrappedText}\n\n${currentValue}` : `${wrappedText}\n`
      textarea.value = newValue
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      setInput(newValue)
      setTimeout(() => {
        if (inputRef.current) {
          resizeTextarea(inputRef.current, maxHeightRef.current)
          inputRef.current.focus()
          inputRef.current.selectionStart = inputRef.current.selectionEnd = wrappedText.length + 1
        }
      }, 0)
    }
  }, [onConsumeOutfitNotifications, narrationDelimiters, setInput])

  // Handle paste events to detect and upload images
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    // Check for image items in clipboard
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault() // Prevent default paste behavior for images
        const file = item.getAsFile()
        if (file) {
          // Generate a unique filename with timestamp
          const timestamp = Date.now()
          const extension = file.type.split('/')[1] || 'png'
          const filename = `pasted-image-${timestamp}.${extension}`
          const renamedFile = new File([file], filename, { type: file.type })

          // Upload the pasted image
          await onImagePaste(renamedFile)
        }
        return // Only handle the first image
      }
    }
    // Allow normal text paste to proceed if no images found
  }, [onImagePaste])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget

    if (documentEditingMode) {
      // Document mode: Enter = newline, Ctrl/Cmd+Enter = submit
      const isSubmitShortcut = isMac
        ? (e.metaKey && !e.ctrlKey && e.key === 'Enter')
        : (e.ctrlKey && !e.metaKey && e.key === 'Enter')

      if (isSubmitShortcut) {
        e.preventDefault()
        submitForm(textarea)
      } else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Plain Enter in document mode = newline
        e.preventDefault()
        insertNewline(textarea)
      }
    } else {
      // Chat mode: Enter = submit, Shift+Enter = newline
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        insertNewline(textarea)
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submitForm(textarea)
      }
    }
  }

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
        {documentEditingMode && (
          <FormattingToolbar
            roleplayTemplateId={roleplayTemplateId}
            inputRef={inputRef}
            input={input}
            setInput={setInput}
            disabled={sending || !hasActiveCharacters}
            showPreview={showPreview}
            onTogglePreview={() => setShowPreview(!showPreview)}
          />
        )}

        <form onSubmit={onSubmit} className="qt-chat-composer-inner">
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

            {/* Main toolbar buttons - hamburger and document mode */}
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

              {/* Document editing mode toggle button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleDocumentEditingMode()
                }}
                className={`qt-chat-toolbar-button ${documentEditingMode ? 'qt-chat-toolbar-button-active' : ''}`}
                title={documentEditingMode
                  ? `Document mode (${isMac ? 'Cmd' : 'Ctrl'}+Enter to send)`
                  : `Chat mode (Enter to send)`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </button>
            </div>
          </div>

          {showPreview ? (
            <div className="qt-chat-composer-input overflow-y-auto"
              style={{
                lineHeight: '1.5'
              }}
            >
              <MessageContent content={input} renderingPatterns={renderingPatterns} dialogueDetection={dialogueDetection} />
            </div>
          ) : (
            <textarea
              ref={textareaRefCallback}
              defaultValue={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={sending || !hasActiveCharacters}
              rows={1}
              placeholder={!hasActiveCharacters ? "Add a character to start chatting..." : attachedFiles.length > 0 ? "Add a message (optional)..." : "Type a message..."}
              className="qt-chat-composer-input resize-none overflow-y-auto"
              style={{
                lineHeight: '1.5'
              }}
            />
          )}

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
