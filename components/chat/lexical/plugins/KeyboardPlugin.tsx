'use client';

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $isLineBreakNode,
  $isTextNode,
  type BaseSelection,
} from 'lexical';
import { $isCodeNode, type CodeNode } from '@lexical/code';

/**
 * KeyboardPlugin - Handles keyboard behavior for the chat composer
 *
 * Manages two modes:
 * - Chat mode: Enter to submit, Shift+Enter for new line
 * - Composition mode: Cmd+Enter (Mac) or Ctrl+Enter (non-Mac) to submit
 *
 * Also handles code block escape: pressing Enter on a blank trailing
 * line inside a code block exits the block and creates a new paragraph.
 */

/**
 * The code block the caret should escape from, or null.
 *
 * Escapes only for a collapsed caret at the very end of a code block whose
 * last line is blank (empty or whitespace). The caret takes two shapes there:
 * after typing on the line it is a text point at the end of the last child;
 * straight after Shift+Enter Lexical leaves an ELEMENT point on the CodeNode
 * itself, at offset == its child count. Missing the second shape is why the
 * escape never fired and chat mode sent the message instead.
 */
function $codeBlockToEscape(selection: BaseSelection | null): CodeNode | null {
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  let codeBlock: CodeNode;
  if (anchor.type === 'element') {
    if (!$isCodeNode(anchorNode) || anchor.offset !== anchorNode.getChildrenSize()) return null;
    codeBlock = anchorNode;
  } else {
    const parent = anchorNode.getParent();
    if (!$isCodeNode(parent) || parent.getLastChild()?.is(anchorNode) !== true) return null;
    if (anchor.offset !== anchorNode.getTextContentSize()) return null;
    codeBlock = parent;
  }

  const lines = codeBlock.getTextContent().split('\n');
  if (lines.length < 2 || lines[lines.length - 1].trim() !== '') return null;
  return codeBlock;
}

/** Options a submit carries. `establishedFact`: send this one line as established fact. */
export interface ComposerSubmitOptions {
  establishedFact?: boolean;
}

interface KeyboardPluginProps {
  /** Whether document editing mode is enabled */
  documentEditingMode: boolean;
  /** Callback to submit the message */
  onSubmit: (opts?: ComposerSubmitOptions) => void;
}

export default function KeyboardPlugin({
  documentEditingMode,
  onSubmit,
}: KeyboardPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const isMac =
      typeof navigator !== 'undefined' &&
      navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    const handleKeyEnter = (event: KeyboardEvent | null) => {
      if (event === null) {
        return false;
      }

      // Code block escape: Enter on a blank trailing line exits the block
      // and creates a normal paragraph after it.
      const codeEscaped = editor.getEditorState().read(
        () => $codeBlockToEscape($getSelection()) !== null,
      );

      if (codeEscaped) {
        event.preventDefault();
        editor.update(() => {
          const codeBlock = $codeBlockToEscape($getSelection());
          if (codeBlock === null) return;

          // Drop the blank trailing line: any whitespace-only text after the
          // last line break, then the line break itself. Earlier lines (and
          // their highlight nodes) are left alone.
          let last = codeBlock.getLastChild();
          while ($isTextNode(last) && last.getTextContent().trim() === '') {
            const previous = last.getPreviousSibling();
            last.remove();
            last = previous;
          }
          if ($isLineBreakNode(last)) last.remove();

          const paragraph = $createParagraphNode();
          codeBlock.insertAfter(paragraph);
          paragraph.selectStart();
        });
        return true;
      }

      // Cmd+Shift+Enter (Mac) / Ctrl+Shift+Enter (elsewhere), in either mode:
      // send this one line as established fact, without arming the composer.
      const primaryModifier = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (primaryModifier && event.shiftKey) {
        event.preventDefault();
        onSubmit({ establishedFact: true });
        return true;
      }

      if (documentEditingMode) {
        // Composition mode: Cmd+Enter (Mac) or Ctrl+Enter (non-Mac)
        if (isMac) {
          // Mac: Cmd+Enter (metaKey true, ctrlKey false)
          if (event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            onSubmit();
            return true;
          }
        } else {
          // Non-Mac: Ctrl+Enter (ctrlKey true, metaKey false)
          if (event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            onSubmit();
            return true;
          }
        }
        // Plain Enter in composition mode: let Lexical handle paragraph insertion
        return false;
      } else {
        // Chat mode: Enter to submit, Shift+Enter for linebreak
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
          // Plain Enter: submit
          event.preventDefault();
          onSubmit();
          return true;
        }
        // Shift+Enter or Cmd+Enter or Ctrl+Enter: let Lexical handle it
        return false;
      }
    };

    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      handleKeyEnter,
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, documentEditingMode, onSubmit]);

  return null;
}
