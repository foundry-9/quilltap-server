'use client';

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
} from 'lexical';
import { $isCodeNode, $createCodeHighlightNode } from '@lexical/code';

/**
 * KeyboardPlugin - Handles keyboard behavior for the chat composer
 *
 * Manages two modes:
 * - Chat mode: Enter to submit, Shift+Enter for new line
 * - Document mode: Cmd+Enter (Mac) or Ctrl+Enter (non-Mac) to submit
 *
 * Also handles code block escape: pressing Enter on a blank trailing
 * line inside a code block exits the block and creates a new paragraph.
 */

interface KeyboardPluginProps {
  /** Whether document editing mode is enabled */
  documentEditingMode: boolean;
  /** Callback to submit the message */
  onSubmit: () => void;
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

      // Check for code block escape: Enter on a blank trailing line exits
      // the code block and creates a normal paragraph after it.
      const codeEscaped = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();
        const codeBlock = anchorNode.getParent();
        if (!codeBlock || !$isCodeNode(codeBlock)) return false;

        // Get the full text and split into lines
        const text = codeBlock.getTextContent();
        const lines = text.split('\n');

        // Only escape if the last line is blank and cursor is at the very end
        if (lines.length < 2) return false;
        const lastLine = lines[lines.length - 1];
        if (lastLine.trim() !== '') return false;

        // Cursor must be at the end of the code block's text
        const totalLength = text.length;
        const offsetInCode = anchor.offset;

        // For CodeHighlightNode children, calculate offset from the end
        // by checking if we're in the last child at its end
        const lastChild = codeBlock.getLastChild();
        if (lastChild === null) return false;
        if (anchorNode.getKey() !== lastChild.getKey()) return false;
        const lastChildTextLength = lastChild.getTextContentSize();
        if (offsetInCode !== lastChildTextLength) return false;

        return true;
      });

      if (codeEscaped) {
        event.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          const anchorNode = selection.anchor.getNode();
          const codeBlock = anchorNode.getParent();
          if (!codeBlock || !$isCodeNode(codeBlock)) return;

          // Remove the trailing blank line from the code block.
          // The blank line is represented by the last newline in the text.
          const text = codeBlock.getTextContent();
          const trimmedText = text.replace(/\n\s*$/, '');

          // Clear and re-set code block content without trailing blank line
          codeBlock.clear();
          if (trimmedText) {
            const newTextNode = $createCodeHighlightNode(trimmedText);
            codeBlock.append(newTextNode);
          }

          // Insert a new paragraph after the code block
          const paragraph = $createParagraphNode();
          codeBlock.insertAfter(paragraph);
          paragraph.selectStart();
        });
        return true;
      }

      if (documentEditingMode) {
        // Document mode: Cmd+Enter (Mac) or Ctrl+Enter (non-Mac)
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
        // Plain Enter in document mode: let Lexical handle paragraph insertion
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
