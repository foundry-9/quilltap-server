'use client'

/**
 * DocumentPane - Split-panel document editor for Document Mode
 *
 * Contains the document header, formatting toolbar, Lexical editor,
 * and status bar. Sits in the right side of the SplitLayout.
 *
 * Scriptorium Phase 3.5
 *
 * @module app/salon/[id]/components/DocumentPane
 */

import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import DocumentGutter, { type LinePosition } from './DocumentGutter'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { composerTheme } from '@/components/chat/lexical/theme'
import { MarkdownBridgePlugin, COMPOSER_TRANSFORMERS } from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'
import { FormattingCommandPlugin } from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import DocumentChangeTracker from './DocumentChangeTracker'
import DocumentFocusPlugin from './DocumentFocusPlugin'
import type { ActiveDocument, DocumentMode, FocusRequest } from '../hooks/useDocumentMode'

interface DocumentPaneProps {
  document: ActiveDocument
  mode: DocumentMode
  isDirty: boolean
  isSaving: boolean
  isLLMEditing: boolean
  /** Increments on each external content load to force editor remount */
  contentVersion: number
  roleplayTemplateId?: string | null
  /** Pixel offset from content top where AI attention eye sits; null when unset */
  attentionTop?: number | null
  /** Content at document open / last save — used to diff changed lines for the gutter */
  baselineContent: string
  getScrollPosition: (filePath: string) => number
  setScrollPosition: (filePath: string, pos: number) => void
  onContentChange: (content: string) => void
  onBlur: () => void
  onToggleFocusMode: () => void
  onCloseDocument: () => void
  onTitleChange?: (title: string) => void
  /** doc_focus tool request from the LLM */
  focusRequest?: FocusRequest | null
  onFocusResolved?: (pixelTop: number) => void
  onFocusCleared?: () => void
  onFocusProcessed?: () => void
}

/**
 * Word count utility
 */
function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Inner editor plugins that need Lexical context
 */
function DocumentEditorPlugins({
  content,
  onContentChange,
  disabled,
  baselineContent,
  onChangedLines,
  onLinePositions,
  scrollContainerRef,
  focusRequest,
  onFocusResolved,
  onFocusCleared,
  onFocusProcessed,
}: {
  content: string
  onContentChange: (content: string) => void
  disabled: boolean
  baselineContent: string
  onChangedLines: (lines: Set<number>) => void
  onLinePositions: (positions: LinePosition[], totalHeight: number) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  focusRequest?: FocusRequest | null
  onFocusResolved?: (pixelTop: number) => void
  onFocusCleared?: () => void
  onFocusProcessed?: () => void
}) {
  const [editor] = useLexicalComposerContext()

  // Sync editable state
  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="qt-doc-editor-area qt-lexical-contenteditable"
            aria-label="Document editor"
            style={{ lineHeight: '1.6', minHeight: '100%' }}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <TablePlugin />
      <MarkdownShortcutPlugin transformers={COMPOSER_TRANSFORMERS} />
      <MarkdownBridgePlugin
        input={content}
        setInput={onContentChange}
        initialMarkdown={content}
      />
      <FormattingCommandPlugin />
      <DocumentChangeTracker
        baselineContent={baselineContent}
        onChangedLines={onChangedLines}
        onLinePositions={onLinePositions}
      />
      {focusRequest !== undefined && onFocusResolved && onFocusCleared && onFocusProcessed && (
        <DocumentFocusPlugin
          focusRequest={focusRequest ?? null}
          scrollContainerRef={scrollContainerRef}
          onFocusResolved={onFocusResolved}
          onFocusCleared={onFocusCleared}
          onFocusProcessed={onFocusProcessed}
        />
      )}
    </>
  )
}

/**
 * Toolbar wrapper that can access the Lexical editor context
 */
function DocumentToolbarWrapper({
  roleplayTemplateId,
  disabled,
  showSource,
  sourceTextareaRef,
  onContentChange,
  onToggleSource,
}: {
  roleplayTemplateId?: string | null
  disabled: boolean
  showSource: boolean
  sourceTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  onContentChange: (content: string) => void
  onToggleSource: () => void
}) {
  const [editor] = useLexicalComposerContext()

  return (
    <div className="qt-doc-toolbar">
      <FormattingToolbar
        roleplayTemplateId={roleplayTemplateId}
        editor={editor}
        disabled={disabled}
        showSource={showSource}
        sourceTextareaRef={sourceTextareaRef}
        setInput={onContentChange}
        onToggleSource={onToggleSource}
      />
    </div>
  )
}

export default function DocumentPane({
  document,
  mode,
  isDirty,
  isSaving,
  isLLMEditing,
  contentVersion,
  roleplayTemplateId,
  attentionTop = null,
  baselineContent,
  getScrollPosition,
  setScrollPosition,
  onContentChange,
  onBlur,
  onToggleFocusMode,
  onCloseDocument,
  onTitleChange,
  focusRequest,
  onFocusResolved,
  onFocusCleared,
  onFocusProcessed,
}: DocumentPaneProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [editTitle, setEditTitle] = useState(document.displayTitle)
  // Gutter state — populated by DocumentChangeTracker plugin
  const [changedLines, setChangedLines] = useState<Set<number>>(new Set())
  const [linePositions, setLinePositions] = useState<LinePosition[]>([])
  const [totalHeight, setTotalHeight] = useState(0)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wordCount = useMemo(() => countWords(document.content), [document.content])

  // Stable callbacks for DocumentChangeTracker — avoid re-registering the update listener
  const handleChangedLines = useCallback((lines: Set<number>) => {
    setChangedLines(lines)
  }, [])

  const handleLinePositions = useCallback((positions: LinePosition[], height: number) => {
    setLinePositions(positions)
    setTotalHeight(height)
  }, [])

  const initialConfig = useMemo(
    () => ({
      namespace: 'DocumentEditor',
      theme: composerTheme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, CodeHighlightNode, TableNode, TableCellNode, TableRowNode],
      editable: !isLLMEditing,
      onError: (error: Error) => {
        console.error('[DocumentPane] Editor error:', error)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    if (!isEditingTitle) {
      setEditTitle(document.displayTitle)
    }
  }, [document.displayTitle, isEditingTitle])

  useEffect(() => {
    if (!isEditingTitle) {
      return
    }

    const frame = requestAnimationFrame(() => titleInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [isEditingTitle])

  const toggleSourceMode = useCallback(() => {
    setShowSource((prev) => !prev)
  }, [])

  // Throttled scroll handler — saves position ~100ms after last scroll event
  const handleScroll = useCallback(() => {
    if (scrollThrottleRef.current) return
    scrollThrottleRef.current = setTimeout(() => {
      scrollThrottleRef.current = null
      if (scrollContainerRef.current) {
        setScrollPosition(document.filePath, scrollContainerRef.current.scrollTop)
      }
    }, 100)
  }, [document.filePath, setScrollPosition])

  // Restore scroll position after contentVersion changes (Lexical remount)
  useEffect(() => {
    const savedPos = getScrollPosition(document.filePath)
    if (savedPos > 0 && scrollContainerRef.current) {
      // Double RAF to ensure Lexical has rendered content before we scroll
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = savedPos
          }
        })
      })
    }
  }, [contentVersion, document.filePath, getScrollPosition])

  // Cleanup throttle timer on unmount
  useEffect(() => {
    return () => {
      if (scrollThrottleRef.current) {
        clearTimeout(scrollThrottleRef.current)
      }
    }
  }, [])

  // Handle title editing
  const handleTitleClick = useCallback(() => {
    setIsEditingTitle(true)
    setEditTitle(document.displayTitle)
  }, [document.displayTitle])

  const handleTitleSubmit = useCallback(() => {
    setIsEditingTitle(false)
    if (editTitle.trim() && editTitle !== document.displayTitle && onTitleChange) {
      onTitleChange(editTitle.trim())
    }
  }, [editTitle, document.displayTitle, onTitleChange])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
      setEditTitle(document.displayTitle)
    }
  }, [handleTitleSubmit, document.displayTitle])

  // Save status display
  const saveStatus = useMemo(() => {
    if (isSaving) return { label: 'Saving...', dot: 'qt-doc-status-saving' }
    if (isDirty) return { label: 'Unsaved', dot: 'qt-doc-status-saving' }
    return { label: 'Saved', dot: 'qt-doc-status-saved' }
  }, [isSaving, isDirty])

  // Editing indicator
  const editingIndicator = useMemo(() => {
    if (isLLMEditing) return 'AI editing...'
    return null
  }, [isLLMEditing])

  return (
    <div className="flex flex-col h-full">
      {/* Document Header */}
      <div className="qt-doc-header">
        <span className="qt-doc-badge">Document</span>

        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="qt-doc-title-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
          />
        ) : (
          <span
            className="qt-doc-title cursor-pointer"
            onClick={handleTitleClick}
            title="Click to rename"
          >
            {document.displayTitle}
          </span>
        )}

        <div className="flex items-center gap-1">
          {/* Toggle focus/split */}
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={onToggleFocusMode}
            title={mode === 'focus' ? 'Show chat' : 'Maximize'}
            aria-label={mode === 'focus' ? 'Show chat' : 'Maximize document'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mode === 'focus' ? (
                // Shrink icon (show chat)
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.5 3.5M15 9V4.5M15 9h4.5M15 9l5.5-5.5M9 15v4.5M9 15H4.5M9 15l-5.5 5.5M15 15v4.5m0-4.5h4.5m-4.5 0l5.5 5.5" />
              ) : (
                // Expand icon (maximize)
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
              )}
            </svg>
          </button>

          {/* Exit document mode */}
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={onCloseDocument}
            title="Exit document mode"
            aria-label="Exit document mode"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Shared editor shell — key forces remount on external content changes */}
      <LexicalComposer key={contentVersion} initialConfig={initialConfig}>
        <DocumentToolbarWrapper
          roleplayTemplateId={roleplayTemplateId}
          disabled={isLLMEditing}
          showSource={showSource}
          sourceTextareaRef={sourceTextareaRef}
          onContentChange={onContentChange}
          onToggleSource={toggleSourceMode}
        />

        {showSource ? (
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onBlur={onBlur} onScroll={handleScroll}>
            <textarea
              ref={sourceTextareaRef}
              className="w-full h-full p-4 qt-bg-input qt-text-primary font-mono text-sm resize-none outline-none"
              value={document.content}
              onChange={(e) => onContentChange(e.target.value)}
              disabled={isLLMEditing}
              spellCheck={false}
              style={{ lineHeight: '1.6', minHeight: '100%' }}
            />
          </div>
        ) : (
          <div ref={scrollContainerRef} className="qt-doc-editor-with-gutter" onBlur={onBlur} onScroll={handleScroll}>
            <DocumentGutter
              changedLines={changedLines}
              attentionTop={attentionTop}
              linePositions={linePositions}
              totalHeight={totalHeight}
            />
            <div className="flex-1">
              <DocumentEditorPlugins
                content={document.content}
                onContentChange={onContentChange}
                disabled={isLLMEditing}
                baselineContent={baselineContent}
                onChangedLines={handleChangedLines}
                onLinePositions={handleLinePositions}
                scrollContainerRef={scrollContainerRef}
                focusRequest={focusRequest}
                onFocusResolved={onFocusResolved}
                onFocusCleared={onFocusCleared}
                onFocusProcessed={onFocusProcessed}
              />
            </div>
          </div>
        )}
      </LexicalComposer>

      {/* Status Bar */}
      <div className="qt-doc-status-bar">
        <span className="qt-doc-status-item">Markdown</span>
        <span className="qt-doc-status-item">{wordCount.toLocaleString()} word{wordCount !== 1 ? 's' : ''}</span>
        <span className="qt-doc-status-item">
          <span className={saveStatus.dot} />
          {saveStatus.label}
        </span>
        {editingIndicator && (
          <span className="qt-doc-status-item ml-auto">{editingIndicator}</span>
        )}
      </div>
    </div>
  )
}
