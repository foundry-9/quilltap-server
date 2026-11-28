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

import { useRef, useState, useCallback, useMemo, useEffect, useLayoutEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
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
import YAML from 'yaml'
import { composerTheme } from '@/components/chat/lexical/theme'
import { MarkdownBridgePlugin, COMPOSER_TRANSFORMERS } from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'
import { FormattingCommandPlugin } from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import { SmartTypographyPlugin } from '@/components/chat/lexical/plugins/SmartTypographyPlugin'
import { TextReplacementPlugin } from '@/components/chat/lexical/plugins/TextReplacementPlugin'
import { CharTypeaheadPlugin } from '@/components/chat/lexical/plugins/CharTypeaheadPlugin'
import { EMOJI_PROFILE } from '@/lib/char-insert/profiles/emoji'
import { UNICODE_PROFILE } from '@/lib/char-insert/profiles/unicode'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import DocumentChangeTracker from './DocumentChangeTracker'
import DocumentFocusPlugin from './DocumentFocusPlugin'
import { showConfirmation } from '@/lib/alert'
import { formatQtapUri } from '@/lib/doc-edit/qtap-uri'
import { showSuccessToast } from '@/lib/toast'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'
import { activateOnKey } from '@/components/ui/activate-on-key'
import { CodeEditor, type CodeEditorHandle } from '@/components/code-editor'
import type { ActiveDocument, DocumentMode, FocusRequest } from '../hooks/useDocumentMode'
import type { DocumentChangeOrigin } from '../hooks/document-saver'
import { documentEditorKind, documentTypeLabel, focusLineInText } from './document-editor-kind'
import { DOCUMENT_EDITOR_NODES, frontmatterLineCount } from './markdown-source-lines'

interface DocumentPaneProps {
  document: ActiveDocument
  mode: DocumentMode
  isDirty: boolean
  isSaving: boolean
  /** Increments on each external content load to force editor remount */
  contentVersion: number
  roleplayTemplateId?: string | null
  /** Pixel offset from content top where AI attention eye sits; null when unset */
  attentionTop?: number | null
  /** Content at document open / last save — used to diff changed lines for the gutter */
  baselineContent: string
  getScrollPosition: (filePath: string) => number
  setScrollPosition: (filePath: string, pos: number) => void
  /** `origin: 'source'` when the text came from a raw surface, never the rich editor's re-serialization (#307). */
  onContentChange: (content: string, origin?: DocumentChangeOrigin) => void
  onBlur: () => void
  onFlushSave: () => void
  onToggleFocusMode: () => void
  onCloseDocument: () => void
  onDeleteDocument: () => void
  onTitleChange?: (title: string) => void
  /** doc_focus tool request from the LLM */
  focusRequest?: FocusRequest | null
  onFocusResolved?: (pixelTop: number) => void
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

/** How long the code editor waits after typing before handing the text up; the document's own autosave waits after that. */
const CODE_EDITOR_EMIT_MS = 150

interface ExtractedFrontmatter {
  rawBlock: string | null
  body: string
  data: Record<string, unknown>
}

function parseLooseFrontmatterData(yamlContent: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue

    const key = trimmed.slice(0, colonIndex).trim()
    const value = trimmed.slice(colonIndex + 1).trim()
    if (!key) continue
    data[key] = value || '\u2014'
  }
  return data
}

function extractFrontmatter(content: string): ExtractedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!match) {
    return {
      rawBlock: null,
      body: content,
      data: {},
    }
  }

  const rawBlock = match[0]
  const yamlContent = match[1]
  const body = content.slice(rawBlock.length)

  try {
    const parsed = YAML.parse(yamlContent)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        rawBlock,
        body,
        data: parsed as Record<string, unknown>,
      }
    }
  } catch {
    // If YAML parsing fails, fall back to a line-based view so metadata still appears.
  }

  return {
    rawBlock,
    body,
    data: parseLooseFrontmatterData(yamlContent),
  }
}

function frontmatterValueToText(value: unknown): string {
  if (value === null || value === undefined) return '\u2014'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toChipValues(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value
      .map((item) => frontmatterValueToText(item).trim())
      .filter(Boolean)
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null

  const inlineItems = trimmed.slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  return inlineItems.length > 0 ? inlineItems : null
}

function FrontmatterTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  return (
    <div className="qt-frontmatter">
      <div className="qt-frontmatter-title">Document Info</div>
      <table className="qt-frontmatter-table">
        <tbody>
          {entries.length > 0 ? entries.map(([key, value]) => {
            const chipValues = toChipValues(value)
            return (
              <tr key={key}>
                <th>{key}</th>
                <td>
                  {chipValues ? (
                    <div className="qt-frontmatter-chip-list">
                      {chipValues.map((chipValue, index) => (
                        <span key={`${key}-${chipValue}-${index}`} className="qt-badge qt-badge-tag">{chipValue}</span>
                      ))}
                    </div>
                  ) : (
                    <span>{frontmatterValueToText(value)}</span>
                  )}
                </td>
              </tr>
            )
          }) : (
            <tr>
              <th>frontmatter</th>
              <td>\u2014</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Inner editor plugins that need Lexical context
 */
function DocumentEditorPlugins({
  content,
  lineOffset,
  onContentChange,
  baselineContent,
  onChangedLines,
  onLinePositions,
  scrollContainerRef,
  focusRequest,
  onFocusResolved,
  onFocusProcessed,
}: {
  content: string
  /** Lines of the file before `content` (its frontmatter), for doc_focus `line`. */
  lineOffset: number
  onContentChange: (content: string) => void
  baselineContent: string
  onChangedLines: (lines: Set<number>) => void
  onLinePositions: (positions: LinePosition[], totalHeight: number) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  focusRequest?: FocusRequest | null
  onFocusResolved?: (pixelTop: number) => void
  onFocusProcessed?: () => void
}) {
  const { data: composerSpellcheck } = useChatSettingsQuery((settings) => settings.composerSpellcheck)
  const spellCheck = composerSpellcheck ?? true

  return (
    <>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="qt-doc-editor-area qt-lexical-contenteditable"
            aria-label="Document editor"
            style={{ lineHeight: '1.6', minHeight: '100%' }}
            spellCheck={spellCheck}
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
        preserveAsterisks
        preserveUnderscores
        preserveBackticks
        preserveTildes
      />
      <FormattingCommandPlugin />
      {/* Above TextReplacementPlugin: `:` and ` ` are word-boundary triggers for
          both, and the character typeahead only swallows the keystroke when it
          actually commits. One mount per dataset profile. */}
      <CharTypeaheadPlugin profile={EMOJI_PROFILE} />
      <CharTypeaheadPlugin profile={UNICODE_PROFILE} />
      {/* Above TextReplacementPlugin: `.` is a trigger for both, and smart
          typography must resolve `...` before text replacement claims the word
          boundary. Registration order is load-bearing — see the interaction
          table in SmartTypographyPlugin. */}
      <SmartTypographyPlugin />
      <TextReplacementPlugin />
      <DocumentChangeTracker
        baselineContent={baselineContent}
        onChangedLines={onChangedLines}
        onLinePositions={onLinePositions}
      />
      {focusRequest !== undefined && onFocusResolved && onFocusProcessed && (
        <DocumentFocusPlugin
          focusRequest={focusRequest ?? null}
          markdown={content}
          lineOffset={lineOffset}
          scrollContainerRef={scrollContainerRef}
          onFocusResolved={onFocusResolved}
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
  showSource,
  sourceTextareaRef,
  onContentChange,
  onToggleSource,
}: {
  roleplayTemplateId?: string | null
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
        showSource={showSource}
        sourceTextareaRef={sourceTextareaRef}
        setInput={onContentChange}
        onToggleSource={onToggleSource}
      />
    </div>
  )
}

/**
 * The raw-text surface: Markdown's source view and every file that is neither
 * Markdown nor highlighted code. Its bytes go straight to and from the store.
 */
function DocumentTextarea({
  ariaLabel,
  textareaRef,
  scrollContainerRef,
  content,
  onContentChange,
  onBlur,
  onScroll,
}: {
  ariaLabel: string
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  content: string
  onContentChange: (content: string) => void
  onBlur: () => void
  onScroll: () => void
}) {
  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onBlur={onBlur} onScroll={onScroll}>
      <textarea
        aria-label={ariaLabel}
        ref={textareaRef}
        className="w-full h-full p-4 qt-bg-input qt-text-primary font-mono text-sm resize-none outline-none"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        spellCheck={false}
        style={{ lineHeight: '1.6', minHeight: '100%', backgroundColor: 'var(--color-background)' }}
      />
    </div>
  )
}

export default function DocumentPane({
  document,
  mode,
  isDirty,
  isSaving,
  contentVersion,
  roleplayTemplateId,
  attentionTop = null,
  baselineContent,
  getScrollPosition,
  setScrollPosition,
  onContentChange,
  onBlur,
  onFlushSave,
  onToggleFocusMode,
  onCloseDocument,
  onDeleteDocument,
  onTitleChange,
  focusRequest,
  onFocusResolved,
  onFocusProcessed,
}: DocumentPaneProps) {
  // In the tabbed workspace each document is already its own (maximizable) tab,
  // so the split/focus toggle is redundant there; keep it only on the legacy
  // single-pane `/salon/[id]` route (where this is null).
  const inWorkspace = useWorkspaceTabId() != null

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [editTitle, setEditTitle] = useState(document.displayTitle)
  const { copied: uriCopied, copy: copyUri } = useCopyToClipboard(1200)
  // Gutter state — populated by DocumentChangeTracker plugin
  const [changedLines, setChangedLines] = useState<Set<number>>(new Set())
  const [linePositions, setLinePositions] = useState<LinePosition[]>([])
  const [totalHeight, setTotalHeight] = useState(0)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Markdown → the rich editor; JSON and CSS → the code editor; the rest → a
  // textarea, so their bytes are never round-tripped through a Markdown
  // serialiser (document-editor-kind.ts). The size is read when the file is
  // loaded, so a file never changes editor under the author's hands.
  const editorKind = useMemo(
    () => documentEditorKind(document.filePath, document.content.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided per load (contentVersion), not per keystroke
    [document.filePath, contentVersion],
  )
  const isMarkdown = editorKind === 'markdown'
  const codeLanguage = editorKind === 'json' || editorKind === 'css' ? editorKind : null
  const codeEditorRef = useRef<CodeEditorHandle>(null)
  const extractedContent = useMemo(() => {
    if (!isMarkdown) {
      return {
        current: {
          rawBlock: null,
          body: document.content,
          data: {},
        },
        baseline: {
          rawBlock: null,
          body: baselineContent,
          data: {},
        },
      }
    }

    return {
      current: extractFrontmatter(document.content),
      baseline: extractFrontmatter(baselineContent),
    }
  }, [isMarkdown, document.content, baselineContent])
  const currentFrontmatterRawBlock = extractedContent.current.rawBlock
  const currentBodyContent = extractedContent.current.body
  const baselineBodyContent = extractedContent.baseline.body
  const hasFrontmatter = currentFrontmatterRawBlock !== null
  const wordCount = useMemo(
    () => countWords(isMarkdown ? currentBodyContent : document.content),
    [isMarkdown, currentBodyContent, document.content],
  )
  const documentUri = useMemo(() => {
    if (document.scope === 'project' || document.scope === 'general') {
      return formatQtapUri({
        scope: document.scope,
        path: document.filePath,
      })
    }

    return formatQtapUri({
      scope: 'document_store',
      mountPoint: document.mountPoint?.trim() || 'self',
      path: document.filePath,
    })
  }, [document.scope, document.mountPoint, document.filePath])

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
      nodes: [...DOCUMENT_EDITOR_NODES],
      onError: (error: Error) => {
        console.error('[DocumentPane] Editor error:', error)
      },
    }),
    [],
  )

  // Sync editTitle with document prop when not actively editing
  useEffect(() => {
    if (!isEditingTitle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when document changes
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
    // Leaving source mode: flush any pending edits before Lexical re-parses
    // the markdown, so raw source bytes are persisted before serialization.
    // The flush must run outside the state updater — updaters are pure and
    // may execute during render, which would setState on the parent mid-render.
    if (showSource) onFlushSave()
    setShowSource((prev) => !prev)
  }, [showSource, onFlushSave])

  const handleMarkdownBodyChange = useCallback((updatedBody: string) => {
    if (!currentFrontmatterRawBlock) {
      onContentChange(updatedBody)
      return
    }
    onContentChange(`${currentFrontmatterRawBlock}${updatedBody}`)
  }, [currentFrontmatterRawBlock, onContentChange])

  // A raw-text surface (Markdown's Source view, the plain textarea) mounts no
  // Lexical bridge, so its first change after a reload is the user's own edit
  // and must not be absorbed as a re-serialization (#307).
  const handleSourceChange = useCallback(
    (content: string) => onContentChange(content, 'source'),
    [onContentChange],
  )

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

  // The code editor scrolls inside itself: keep and restore the place there.
  useLayoutEffect(() => {
    if (!codeLanguage) return
    const el = codeEditorRef.current?.scrollElement() ?? null
    if (!el) return
    scrollContainerRef.current = el
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [codeLanguage, handleScroll])

  // doc_focus in the code editor: scroll to the line asked for (or the line
  // holding the anchor or highlight) without taking the keyboard from the author.
  useEffect(() => {
    if (!codeLanguage || !focusRequest) return
    // The text match first and `line` only as its fallback, as the tool
    // describes it and as the Markdown editor resolves it (#309).
    const line = focusLineInText(document.content, focusRequest)
    if (line) codeEditorRef.current?.revealLine(line, { focus: false })
    onFocusProcessed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each request is handled once, against the text as it stands
  }, [focusRequest, codeLanguage])

  /** The code editor's pending keystrokes, handed up now (before a blur saves, or the document closes). */
  const flushCodeEditor = useCallback(() => {
    codeEditorRef.current?.flush()
  }, [])
  const handleCodeBlur = useCallback(() => {
    flushCodeEditor()
    onBlur()
  }, [flushCodeEditor, onBlur])
  const handleClose = useCallback(() => {
    flushCodeEditor()
    onCloseDocument()
  }, [flushCodeEditor, onCloseDocument])

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

  const handleDeleteClick = useCallback(async () => {
    const confirmed = await showConfirmation(
      `Delete "${document.displayTitle}"? This removes the underlying file and cannot be undone.`,
    )
    if (!confirmed) return
    onDeleteDocument()
  }, [document.displayTitle, onDeleteDocument])

  const handleCopyUri = useCallback(async () => {
    if (await copyUri(documentUri)) {
      showSuccessToast('Document URL copied')
    }
  }, [copyUri, documentUri])

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

  return (
    <div className="flex flex-col h-full">
      {/* Document Header */}
      <div className="qt-doc-header">
        <span className="qt-doc-badge">Document</span>

        {isEditingTitle ? (
          <input
            aria-label="Document title"
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
            role="button"
            tabIndex={0}
            onKeyDown={activateOnKey}
            title="Click to rename"
          >
            {document.displayTitle}
          </span>
        )}

        <div className="flex items-center gap-1">
          {/* Toggle focus/split — legacy single-pane route only; in the
              workspace the document is its own maximizable tab. */}
          {!inWorkspace && (
            <button
              type="button"
              className="qt-doc-header-button"
              onClick={onToggleFocusMode}
              title={mode === 'focus' ? 'Show chat' : 'Maximize'}
              aria-label={mode === 'focus' ? 'Show chat' : 'Maximize document'}
            >
              {mode === 'focus'
                ? <Icon name="compress" className="w-4 h-4" />
                : <Icon name="expand" className="w-4 h-4" />
              }
            </button>
          )}

          {/* Delete the underlying file */}
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={handleDeleteClick}
            title="Delete document"
            aria-label="Delete document"
          >
            <Icon name="trash" className="w-4 h-4" />
          </button>

          {/* Exit document mode */}
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={handleClose}
            title="Exit document mode"
            aria-label="Exit document mode"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="qt-doc-uri-row">
        <span className="qt-doc-uri-label">URL</span>
        <span className="qt-doc-uri-value" title={documentUri}>{documentUri}</span>
        <button
          type="button"
          className="qt-doc-uri-copy-button"
          onClick={handleCopyUri}
          title={uriCopied ? 'Copied' : 'Copy URL'}
          aria-label={uriCopied ? 'Copied URL' : 'Copy URL'}
        >
          <Icon name="copy" className="w-3.5 h-3.5" />
        </button>
      </div>

      {isMarkdown ? (
        /* Shared editor shell — key forces remount on external content changes */
        <LexicalComposer key={contentVersion} initialConfig={initialConfig}>
          <DocumentToolbarWrapper
            roleplayTemplateId={roleplayTemplateId}
            showSource={showSource}
            sourceTextareaRef={sourceTextareaRef}
            onContentChange={handleSourceChange}
            onToggleSource={toggleSourceMode}
          />

          {showSource ? (
            <DocumentTextarea
              ariaLabel="Document source"
              textareaRef={sourceTextareaRef}
              scrollContainerRef={scrollContainerRef}
              content={document.content}
              onContentChange={handleSourceChange}
              onBlur={onBlur}
              onScroll={handleScroll}
            />
          ) : (
            <div ref={scrollContainerRef} className="qt-doc-editor-with-gutter" onBlur={onBlur} onScroll={handleScroll}>
              <DocumentGutter
                changedLines={changedLines}
                attentionTop={attentionTop}
                linePositions={linePositions}
                totalHeight={totalHeight}
              />
              <div className="flex-1">
                {hasFrontmatter && (
                  <FrontmatterTable data={extractedContent.current.data} />
                )}
                <DocumentEditorPlugins
                  content={currentBodyContent}
                  lineOffset={frontmatterLineCount(currentFrontmatterRawBlock)}
                  onContentChange={handleMarkdownBodyChange}
                  baselineContent={baselineBodyContent}
                  onChangedLines={handleChangedLines}
                  onLinePositions={handleLinePositions}
                  scrollContainerRef={scrollContainerRef}
                  focusRequest={focusRequest}
                  onFocusResolved={onFocusResolved}
                  onFocusProcessed={onFocusProcessed}
                />
              </div>
            </div>
          )}
        </LexicalComposer>
      ) : codeLanguage ? (
        /* JSON and CSS: the code editor, which highlights them and hands back
         * exactly the bytes it was given. A change from outside (a character's
         * doc_* write) replaces the text and keeps the caret where it can. */
        <div className="flex-1 min-h-0 flex flex-col" onBlur={handleCodeBlur}>
          <CodeEditor
            ref={codeEditorRef}
            value={document.content}
            language={codeLanguage}
            onChange={onContentChange}
            ariaLabel="Document content"
            debounceMs={CODE_EDITOR_EMIT_MS}
            height="100%"
            className="qt-doc-code-editor flex-1 min-h-0"
          />
        </div>
      ) : (
        /* Plain-text editor for other files — no Lexical, no markdown
         * bridge, no formatting toolbar. Bytes go straight to/from disk. */
        <DocumentTextarea
          ariaLabel="Document content"
          scrollContainerRef={scrollContainerRef}
          content={document.content}
          onContentChange={handleSourceChange}
          onBlur={onBlur}
          onScroll={handleScroll}
        />
      )}

      {/* Status Bar */}
      <div className="qt-doc-status-bar">
        <span className="qt-doc-status-item">{documentTypeLabel(document.filePath)}</span>
        <span className="qt-doc-status-item">{wordCount.toLocaleString()} word{wordCount !== 1 ? 's' : ''}</span>
        <span className="qt-doc-status-item">
          <span className={saveStatus.dot} />
          {saveStatus.label}
        </span>
        {/* Screen readers hear each completed save, not every Unsaved/Saving
            flicker while typing. */}
        <span className="sr-only" role="status" aria-live="polite">
          {saveStatus.label === 'Saved' ? 'Saved' : ''}
        </span>
      </div>
    </div>
  )
}
