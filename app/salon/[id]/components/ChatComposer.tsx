'use client'

import { useRef, useState, useCallback, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import ComposerGutterTools from '@/components/chat/ComposerGutterTools'
import PendingInformChips from '@/components/chat/PendingInformChips'
import { SpeakingAsAvatar, voiceRehearsalTitle, type VoiceRehearsalCue } from './SpeakingAsAvatar'
import type { AvatarImageSource } from '@/components/ui/Avatar'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { LexicalComposerWrapper } from '@/components/chat/lexical'
import type { ComposerEditorHandle } from '@/components/chat/lexical'
import {
  buildQuickRollActions,
  type SlashCommandContext,
  type SlashCustomToolRef,
} from '@/components/chat/lexical/slash-commands/context'
import { useSlashCommandRunner } from '@/components/chat/useSlashCommandRunner'
import type { ComposerSubmitOptions } from '@/components/chat/lexical/plugins/KeyboardPlugin'
import { showInfoToast } from '@/lib/toast'
import type { AttachedFile, PendingToolResult } from '../types'
import type { RenderingPattern, DialogueDetection, NarrationDelimiters } from '@/lib/schemas/template.types'

// Platform detection for keyboard shortcuts
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

interface ChatComposerProps {
  id: string
  /**
   * External markdown value (draft restore / resend / post-send clear and the
   * source-mode textarea). NOT updated on every keystroke — the Lexical editor
   * owns the live text. Use the editor handle (`inputRef`) to read it for send.
   */
  input: string
  setInput: (value: string) => void
  /** Whether the composer currently holds non-blank content (drives Send). */
  hasContent: boolean
  /** Debounced editor content-presence reporter (wired to the page). */
  onContentChange: (hasContent: boolean) => void
  /** Debounced full-markdown emit for draft persistence. */
  onPersistDraft?: (markdown: string) => void
  attachedFiles: AttachedFile[]
  onRemoveAttachedFile: (fileId: string) => void
  /** Pending tool results to display in composer */
  pendingToolResults: PendingToolResult[]
  /** Remove a pending tool result */
  onRemovePendingToolResult: (id: string) => void
  /** External ref for the editor, enabling parent components to focus it */
  inputRef?: React.MutableRefObject<ComposerEditorHandle | null>
  /**
   * Shut the composer without claiming a send is in flight. Raised while a
   * regeneration holds the floor: the operator should not be able to type a new
   * message on top of a line that is mid-replacement, but none of the
   * `sending`-flagged chrome (the stop button, the "Generating..." send title)
   * belongs to a re-roll.
   */
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
  showSource: boolean
  setShowSource: (show: boolean) => void
  uploadingFile: boolean
  toolExecutionStatus: { tool: string; status: 'pending' | 'success' | 'error'; message: string } | null
  /** Dismiss the tool-execution notice early; it also self-expires once settled. */
  onDismissToolExecutionStatus: () => void
  /** Patterns for styling roleplay text in preview */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling in preview */
  dialogueDetection?: DialogueDetection | null
  roleplayTemplateId?: string | null
  /** The template leaves narration unmarked and quotes dialogue (`isProseTemplate`). */
  proseMode?: boolean
  /** Whether document editing mode is enabled */
  documentEditingMode: boolean
  /** Toggle document editing mode on/off */
  onToggleDocumentEditingMode: () => void
  /** Callback to open the document picker for Document Mode */
  onOpenDocumentClick?: () => void
  /** Whether Document Mode is currently active (split/focus) */
  isDocumentModeActive?: boolean

  // Callbacks
  /**
   * Submit the composer. `opts.establishedFact` posts the line as established
   * fact (Deus Ex Machina) — armed with `/deus`, or sent once with
   * Cmd/Ctrl+Shift+Enter. Return `false` when nothing was sent, so an armed
   * composer stays armed.
   */
  onSubmit: (e: React.FormEvent, opts?: ComposerSubmitOptions) => boolean | void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onAttachFileClick?: () => void
  onImagePaste: (file: File) => Promise<void>
  onLibraryFileClick: () => void
  onStandaloneGenerateImageClick: () => void
  onInsertAnnouncementClick: () => void
  onComposeMailClick: () => void
  /** Open the Inform dialog — a word out of character to one or more seats. */
  onInformClick: () => void
  /**
   * Seat display names keyed by chat participant id, so the pending-inform
   * chips can name who is still to be told. Omit and the chips stay silent.
   */
  informParticipantNames?: Record<string, string>
  /** Hard stop: cut the reply off, keep what streamed, cede the floor. */
  onStopStreaming: () => void
  /** Soft interrupt: raise (or lower) the operator's hand. */
  onToggleRaisedHand: () => void
  /** The operator's hand is up, waiting on the next speaker's answer. */
  handRaised?: boolean
  /**
   * Whether anyone could be asked to yield — a room with a rotation (more than
   * one character). A lone character's reply hands the floor back anyway.
   */
  canRaiseHand?: boolean
  /** A hard stop is being put away on the server. */
  stopping?: boolean
  /** Callback when a pending tool result is added */
  onPendingToolResult?: (result: Omit<PendingToolResult, 'id' | 'createdAt'>) => void
  /** Whether this chat resolves a non-empty Pascal custom-tool roster */
  customToolsAvailable?: boolean
  /** Open Pascal's custom-tool dialog (the gutter wand) */
  onCustomToolsClick?: () => void
  /** Open Run Tool — on a tool's form when given an id (the `/` commands) */
  onOpenRunTool?: (toolId?: string) => void
  /** Open Pascal's custom-tool dialog — on a tool's form when given one (the `/` commands) */
  onOpenCustomTool?: (initial?: SlashCustomToolRef) => void
  /** Called after a `/` command runs a tool at once, so the chat can refetch */
  onSlashToolRan?: () => void
  /** The character a `/` command's immediate built-in run acts as — Run Tool's default */
  slashDefaultCharacterId?: string | null
  /** Current roleplay template narration delimiters (e.g. '*' or ['[', ']']) */
  narrationDelimiters?: NarrationDelimiters | null
  /** Callback to open a new terminal session */
  onOpenTerminalClick?: () => void
  /** Whether Terminal Mode is currently active (hides the open-terminal button) */
  isTerminalModeActive?: boolean
  /**
   * The character the human is currently speaking as — rendered as a persistent
   * full-height portrait directly left of the toolbar cluster. Null when the
   * human plays no character (e.g. an all-LLM room).
   */
  speakingAs?: {
    name: string
    title?: string | null
    character?: AvatarImageSource | null
  } | null
  /**
   * In Their Own Words is armed for the speaking-as seat: a typed line opens
   * the review dialog before it posts — waiting on the operator (`ask`) or
   * restating at once (`always`). Null when not armed. Informational only —
   * the gate itself lives in `useImpersonationVoice`.
   */
  voiceRehearsal?: VoiceRehearsalCue | null
  /** Character ids the `@` typeahead lists first — this chat's cast. */
  mentionPriorityCharacterIds?: readonly string[]
}

export function ChatComposer({
  id,
  input,
  setInput,
  hasContent,
  onContentChange,
  onPersistDraft,
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
  showSource,
  setShowSource,
  uploadingFile,
  toolExecutionStatus,
  onDismissToolExecutionStatus,
  renderingPatterns: _renderingPatterns,
  dialogueDetection: _dialogueDetection,
  roleplayTemplateId,
  proseMode,
  documentEditingMode,
  onToggleDocumentEditingMode,
  onOpenDocumentClick,
  isDocumentModeActive,
  inputRef: externalInputRef,
  onSubmit,
  onFileSelect,
  onAttachFileClick,
  onImagePaste,
  onLibraryFileClick,
  onStandaloneGenerateImageClick,
  onInsertAnnouncementClick,
  onComposeMailClick,
  onInformClick,
  informParticipantNames,
  onStopStreaming,
  onToggleRaisedHand,
  handRaised = false,
  canRaiseHand = false,
  stopping = false,
  onPendingToolResult,
  customToolsAvailable,
  onCustomToolsClick,
  onOpenRunTool,
  onOpenCustomTool,
  onSlashToolRan,
  slashDefaultCharacterId = null,
  narrationDelimiters,
  onOpenTerminalClick,
  isTerminalModeActive,
  speakingAs,
  voiceRehearsal = null,
  mentionPriorityCharacterIds,
}: ChatComposerProps) {
  // Every input surface in here is shut by either flag, so ask the question
  // once rather than at each control.
  const composerLocked = disabled || sending
  const isGenerating = streaming || waitingForResponse

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<ComposerEditorHandle>(null)

  // Deus Ex Machina: the next line is posted as established fact. Armed per
  // chat (the state holds the chat id it was armed in), so switching chats
  // disarms it; never persisted with the draft, so a reload disarms it too.
  const [factArmedForChat, setFactArmedForChat] = useState<string | null>(null)
  const factArmed = factArmedForChat === id
  // The Cmd/Ctrl+Shift+Enter shortcut sends one line as fact without arming;
  // the flag rides from the key handler to the form submit through this ref.
  const shortcutFactRef = useRef(false)
  const currentText = useCallback(
    () => (showSource ? input : editorRef.current?.getMarkdown() ?? ''),
    [showSource, input],
  )
  const toggleEstablishedFact = useCallback(() => {
    if (factArmed) {
      setFactArmedForChat(null)
      return
    }
    // A fact needs words: an attachments-only composer cannot be armed.
    if (!currentText().trim() && attachedFiles.length > 0) {
      showInfoToast('A fact must be written down — attachments alone cannot be established.')
      return
    }
    setFactArmedForChat(id)
  }, [factArmed, currentText, attachedFiles.length, id])
  const handleFormSubmit = useCallback((e: React.FormEvent) => {
    const establishedFact = factArmed || shortcutFactRef.current
    shortcutFactRef.current = false
    const sent = onSubmit(e, establishedFact ? { establishedFact: true } : undefined)
    if (establishedFact && sent !== false) setFactArmedForChat(null)
  }, [factArmed, onSubmit])
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

  // The `/` command menu runs the gutter's own handlers and the two shared tool
  // dialogs; zero-parameter tools run at once through the same routes.
  const { runBuiltInNow, runCustomNow } = useSlashCommandRunner({
    chatId: id,
    defaultCharacterId: slashDefaultCharacterId,
    onRan: onSlashToolRan,
  })
  const slashCommands = useMemo<SlashCommandContext | null>(() => {
    if (!onOpenRunTool || !onOpenCustomTool) return null
    return {
      chatId: id,
      actions: {
        attach: () => {
          fileInputRef.current?.click()
          onAttachFileClick?.()
        },
        library: onLibraryFileClick,
        image: onStandaloneGenerateImageClick,
        announce: onInsertAnnouncementClick,
        mail: onComposeMailClick,
        inform: onInformClick,
        deus: toggleEstablishedFact,
        ...(onPendingToolResult ? buildQuickRollActions(id, onPendingToolResult) : {}),
      },
      openRunTool: onOpenRunTool,
      openCustomTool: onOpenCustomTool,
      runBuiltInNow,
      runCustomNow,
      customToolsAvailable: !!customToolsAvailable,
    }
  }, [
    id,
    onAttachFileClick,
    onLibraryFileClick,
    onStandaloneGenerateImageClick,
    onInsertAnnouncementClick,
    onComposeMailClick,
    onInformClick,
    toggleEstablishedFact,
    onPendingToolResult,
    onOpenRunTool,
    onOpenCustomTool,
    runBuiltInNow,
    runCustomNow,
    customToolsAvailable,
  ])

  // Submit handler: the editor owns the live text, so we just dispatch the
  // form submit — the page's onSubmit reads markdown straight from the editor
  // handle (`getMarkdown()`), which is why we no longer round-trip through
  // setInput here (that was the per-keystroke re-render source).
  const handleEditorSubmit = useCallback((opts?: ComposerSubmitOptions) => {
    // Belt and braces: the editor is already disabled, but a keystroke racing
    // the lock must not put a message on top of a turn in flight.
    if (composerLocked) return
    const markdown = editorRef.current?.getMarkdown() ?? ''
    if (opts?.establishedFact) {
      if (!markdown.trim()) {
        showInfoToast('A fact must be written down — there is nothing here to establish.')
        return
      }
      shortcutFactRef.current = true
    }
    if (markdown.trim() || attachedFiles.length > 0 || pendingToolResults.length > 0) {
      const form = document.querySelector<HTMLFormElement>(`#composer-form-${id}`)
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true }))
        setTimeout(() => {
          editorRef.current?.focus({ preventScroll: true })
        }, 10)
      }
    }
  }, [id, attachedFiles.length, pendingToolResults.length, composerLocked])

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
          <Icon name="alert-triangle" className="w-5 h-5 flex-shrink-0" />
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
            role="status"
            aria-live="polite"
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
              <Icon name="check-circle" className="w-5 h-5 flex-shrink-0" />
            ) : (
              <Icon name="alert-circle" className="w-5 h-5 flex-shrink-0" />
            )}
            <span className="qt-label flex-1">{toolExecutionStatus.message}</span>
            <button
              type="button"
              onClick={onDismissToolExecutionStatus}
              className="qt-button-ghost flex-shrink-0 p-1"
              title="Dismiss"
              aria-label="Dismiss notice"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
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
              {/* Prose is actually arriving in these two stages — first turn or
                  re-roll — so both get the quill rather than the waiting dot. */}
              {responseStatus.stage === 'streaming' || responseStatus.stage === 'regenerating' ? (
                <QuillAnimation size="sm" label={null} />
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

        {/* Pending Informs — notes waiting on a seat's next turn. Sits with the
            attachment chips, one row above the form and directly over the
            gutter, rather than inside the gutter column: a chip beside the
            tools would narrow the editor every time one appeared. */}
        {informParticipantNames && (
          <PendingInformChips chatId={id} participantNames={informParticipantNames} />
        )}

        {/* Deus Ex Machina, armed: the next line is posted as established
            fact. Announced politely to assistive tech as it comes and goes. */}
        <div aria-live="polite">
          {factArmed && (
            <div className="qt-chat-attachment-list mb-2">
              <div className="qt-chat-tool-result-chip">
                <Icon name="zap" className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-info" />
                <span className="text-foreground">Deus Ex Machina: this line will be established as fact</span>
                <button
                  type="button"
                  onClick={() => setFactArmedForChat(null)}
                  className="qt-chat-attachment-chip-remove"
                  title="Disarm Deus Ex Machina"
                  aria-label="Disarm Deus Ex Machina"
                >
                  <Icon name="close" className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

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
                  <Icon name="image" className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-success" />
                ) : (
                  <Icon name="file" className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-info" />
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
                  <Icon name="close" className="w-4 h-4" />
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
                  <Icon name="close" className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Formatting toolbar - shown above the form when document editing mode is enabled */}
        {documentEditingMode && lexicalEditor && (
          <FormattingToolbar
            roleplayTemplateId={roleplayTemplateId}
            editor={lexicalEditor}
            disabled={composerLocked || !hasActiveCharacters}
            showSource={showSource}
            sourceTextareaRef={sourceTextareaRef}
            setInput={setInput}
            onToggleSource={() => {
              if (showSource) {
                // Leaving source mode — push textarea edits into Lexical.
                editorRef.current?.setMarkdown(input)
              } else {
                // Entering source mode — seed the textarea from the editor's
                // live content (page `input` lags while typing in rich mode).
                setInput(editorRef.current?.getMarkdown() ?? '')
              }
              setShowSource(!showSource)
            }}
            narrationDelimiters={narrationDelimiters}
          />
        )}

        <form id={`composer-form-${id}`} onSubmit={handleFormSubmit} className="qt-chat-composer-inner">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={onFileSelect}
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
            className="hidden"
          />

          {/* "Speaking as" portrait — full-height, directly left of the toolbar
              cluster; hidden on the narrowest viewports where there's no room.
              The outer wrapper owns the responsive show/hide so it doesn't
              collide with the avatar's own display utility. */}
          {speakingAs && (
            <div className="hidden sm:flex self-stretch flex-shrink-0">
              <SpeakingAsAvatar
                name={speakingAs.name}
                title={speakingAs.title}
                src={speakingAs.character}
                canType={hasActiveCharacters && !composerLocked && !streaming && !waitingForResponse}
                voiceRehearsal={voiceRehearsal}
              />
            </div>
          )}

          {/* Left side toolbar - gutter tools, then main toolbar buttons */}
          <div className="qt-chat-toolbar-row">
            <div className="qt-composer-gutter-column">
            {/* Gutter tools - Attach, Generate, RNG */}
            <ComposerGutterTools
              onAttachFileClick={handleAttachFileClick}
              uploadingFile={uploadingFile}
              onLibraryFileClick={onLibraryFileClick}
              onStandaloneGenerateImageClick={onStandaloneGenerateImageClick}
              onInsertAnnouncementClick={onInsertAnnouncementClick}
              onComposeMailClick={onComposeMailClick}
              onInformClick={onInformClick}
              chatId={id}
              onPendingToolResult={onPendingToolResult}
              customToolsAvailable={customToolsAvailable}
              onCustomToolsClick={onCustomToolsClick}
              disabled={composerLocked || !hasActiveCharacters}
            />
            </div>

            {/* Main toolbar buttons - composition mode, document, terminal */}
            <div className="qt-chat-toolbar">
              {/* Composition mode toggle button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleDocumentEditingMode()
                }}
                className={`qt-chat-toolbar-button ${documentEditingMode ? 'qt-chat-toolbar-button-active' : ''}`}
                title={(documentEditingMode
                  ? `Switch to chat mode (Enter to send)`
                  : `Switch to composition mode (${isMac ? 'Cmd' : 'Ctrl'}+Enter to send)`)
                  + ` · ${isMac ? 'Cmd' : 'Ctrl'}+Shift+Enter sends as established fact`}
              >
                <Icon name="file" className="w-5 h-5" />
              </button>

              {/* Open Document button — stays available even with documents
                  already open, so the user can keep adding more. */}
              {onOpenDocumentClick && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDocumentClick()
                  }}
                  className="qt-chat-toolbar-button qt-doc-open-button"
                  title={isDocumentModeActive
                    ? 'Open another document'
                    : `Open document (${isMac ? 'Cmd' : 'Ctrl'}+Shift+D)`}
                >
                  <Icon name="pencil" className="w-5 h-5" />
                </button>
              )}

              {/* Open Terminal button */}
              {onOpenTerminalClick && !isTerminalModeActive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenTerminalClick()
                  }}
                  className="qt-chat-toolbar-button"
                  title="Open terminal"
                >
                  <Icon name="code" className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {showSource && (
            <textarea
              ref={sourceTextareaRef}
              className="qt-chat-composer-input qt-source-mode-textarea"
              aria-label="Message (Markdown source)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={composerLocked || !hasActiveCharacters}
              style={{ lineHeight: '1.5' }}
            />
          )}
          {/* Keep Lexical mounted but hidden during source mode to preserve undo history */}
          <div
            className={`flex-1 min-w-0 self-stretch${factArmed ? ' qt-chat-composer-established-fact' : ''}`}
            style={showSource ? { display: 'none' } : undefined}
          >
            <LexicalComposerWrapper
              ref={composerRefCallback}
              input={input}
              onContentChange={onContentChange}
              onPersistDraft={onPersistDraft}
              suspendSync={showSource}
              onSubmit={handleEditorSubmit}
              onImagePaste={onImagePaste}
              documentEditingMode={documentEditingMode}
              disabled={composerLocked || !hasActiveCharacters}
              mentionPriorityCharacterIds={mentionPriorityCharacterIds}
              slashCommands={slashCommands}
              proseMode={proseMode}
              placeholder={!hasActiveCharacters ? "Add a character to start chatting..." : attachedFiles.length > 0 ? "Add a message (optional)..." : ""}
            />
          </div>

          {/* Right side buttons: Send, raise a hand (soft interrupt), Stop (hard). */}
          <div className="qt-chat-composer-actions">
            <button
              type="submit"
              disabled={composerLocked || isGenerating || (!hasContent && attachedFiles.length === 0 && pendingToolResults.length === 0) || !hasActiveCharacters}
              className="qt-chat-composer-send"
              title={!hasActiveCharacters
                ? "Add a character to start chatting"
                : isGenerating
                  ? "Generating..."
                  : factArmed
                    ? 'Send as established fact'
                    : voiceRehearsal && speakingAs
                      ? voiceRehearsalTitle(voiceRehearsal, speakingAs.name, 'send')
                      : "Send message"}
              aria-label={factArmed ? 'Send as established fact' : 'Send message'}
            >
              <Icon name="send" className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleRaisedHand()
              }}
              disabled={!isGenerating || !canRaiseHand || stopping}
              className={`qt-chat-composer-send qt-chat-interrupt-button${handRaised ? ' qt-chat-interrupt-button-raised' : ''}`}
              aria-pressed={handRaised}
              aria-label={handRaised ? 'Lower your hand' : 'Raise your hand to interrupt'}
              title={!isGenerating
                ? 'Raise your hand (while someone is speaking)'
                : !canRaiseHand
                  ? 'Only one character is present — the floor returns to you after this reply'
                  : handRaised
                    ? 'Hand raised — the next speaker will be asked to yield. Click to lower it.'
                    : 'Raise your hand — the next speaker may yield the floor to you'}
            >
              <Icon name="hand-raised" className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onStopStreaming()
              }}
              disabled={!isGenerating || stopping}
              className="qt-chat-composer-send qt-chat-stop-button"
              aria-label="Stop"
              title={stopping
                ? 'Stopping…'
                : isGenerating
                  ? 'Stop — cut the reply off here and take the floor'
                  : 'Stop (while someone is speaking)'}
            >
              <Icon name="stop-sign" className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
