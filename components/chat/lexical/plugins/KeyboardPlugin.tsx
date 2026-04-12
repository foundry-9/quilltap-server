'use client';

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical';

/**
 * KeyboardPlugin - Handles keyboard behavior for the chat composer
 *
 * Manages two modes:
 * - Chat mode: Enter to submit, Shift+Enter for new line
 * - Document mode: Cmd+Enter (Mac) or Ctrl+Enter (non-Mac) to submit
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
