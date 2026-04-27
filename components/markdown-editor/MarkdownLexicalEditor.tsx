'use client'

/**
 * MarkdownLexicalEditor — reusable Lexical-based markdown editor.
 *
 * Self-contained: composer + standard plugin set + formatting toolbar +
 * markdown bidirectional bridge. Designed for forms (project scenarios,
 * future settings panels) that want the same editing affordances the
 * Salon's Document Mode provides without inheriting its chat-specific
 * integrations (line gutter, doc_focus tool plugin, source toggle).
 *
 * Lower-level building blocks (MarkdownBridgePlugin, FormattingCommandPlugin,
 * FormattingToolbar, COMPOSER_TRANSFORMERS, composerTheme) live alongside
 * Document Mode in components/chat/lexical and are reused verbatim.
 */

import { useEffect, useMemo } from 'react'
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
import {
  MarkdownBridgePlugin,
  COMPOSER_TRANSFORMERS,
} from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'
import { FormattingCommandPlugin } from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import FormattingToolbar from '@/components/chat/FormattingToolbar'

interface MarkdownLexicalEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Pass to enable roleplay-template-aware delimiter buttons in the toolbar */
  roleplayTemplateId?: string | null
  /**
   * Forces a Lexical remount when this changes — use when external loads
   * replace the editor's state (e.g. switching scenario files).
   */
  remountKey?: string | number
  className?: string
  /** Identifier for the LexicalComposer namespace (debugging/devtools) */
  namespace?: string
  ariaLabel?: string
}

function EditorBody({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="qt-doc-editor-area qt-lexical-contenteditable"
            aria-label="Markdown editor"
            style={{ lineHeight: '1.6', minHeight: '12rem' }}
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
        input={value}
        setInput={onChange}
        initialMarkdown={value}
      />
      <FormattingCommandPlugin />
    </>
  )
}

function ToolbarSlot({
  roleplayTemplateId,
  disabled,
  onContentChange,
}: {
  roleplayTemplateId?: string | null
  disabled: boolean
  onContentChange: (value: string) => void
}) {
  const [editor] = useLexicalComposerContext()
  return (
    <div className="qt-doc-toolbar">
      <FormattingToolbar
        roleplayTemplateId={roleplayTemplateId}
        editor={editor}
        disabled={disabled}
        setInput={onContentChange}
      />
    </div>
  )
}

export default function MarkdownLexicalEditor({
  value,
  onChange,
  disabled = false,
  roleplayTemplateId,
  remountKey,
  className,
  namespace = 'MarkdownLexicalEditor',
  ariaLabel,
}: MarkdownLexicalEditorProps) {
  const initialConfig = useMemo(
    () => ({
      namespace,
      theme: composerTheme,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        CodeNode,
        CodeHighlightNode,
        TableNode,
        TableCellNode,
        TableRowNode,
      ],
      editable: !disabled,
      onError: (error: Error) => {
        console.error('[MarkdownLexicalEditor] Editor error:', error)
      },
    }),
    // Lexical's initialConfig is read once at mount; we force re-mount via
    // the `key` on LexicalComposer below when remountKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <div className={className} aria-label={ariaLabel}>
      <LexicalComposer key={remountKey ?? 'default'} initialConfig={initialConfig}>
        <ToolbarSlot
          roleplayTemplateId={roleplayTemplateId}
          disabled={disabled}
          onContentChange={onChange}
        />
        <div className="qt-doc-editor-with-gutter">
          <div className="flex-1">
            <EditorBody value={value} onChange={onChange} disabled={disabled} />
          </div>
        </div>
      </LexicalComposer>
    </div>
  )
}
