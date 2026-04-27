'use client';

/**
 * ExternalControlPlugin
 *
 * A Lexical editor plugin that exposes imperative methods for external control
 * of the editor, including focus management, scroll behavior, and text insertion.
 */

import { useEffect, useImperativeHandle, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from 'lexical';

/**
 * Handle for imperative control of the Lexical editor
 */
export interface ExternalControlHandle {
  /**
   * Focus the editor
   * @param options - Optional focus options
   */
  focus: (options?: FocusOptions) => void;

  /**
   * Scroll the editor into view
   * @param options - Optional scroll behavior options
   */
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;

  /**
   * Prepend text to the beginning of the editor
   * @param text - Text to prepend
   */
  prependText: (text: string) => void;
}

/**
 * Props for ExternalControlPlugin
 */
interface ExternalControlPluginProps {
  /** Ref to expose imperative methods for external control */
  controlRef: React.RefObject<ExternalControlHandle | null>;
}

/**
 * ExternalControlPlugin
 *
 * Provides imperative control methods for a Lexical editor instance.
 * Use the controlRef to access focus(), scrollIntoView(), and prependText() methods.
 */
export function ExternalControlPlugin({
  controlRef,
}: ExternalControlPluginProps): null {
  const [editor] = useLexicalComposerContext();

  /**
   * Focus the editor root element
   */
  const focus = useCallback(
    (options?: FocusOptions) => {
      const rootElement = editor.getRootElement();
      if (rootElement) {
        rootElement.focus(options);
      }
    },
    [editor]
  );

  /**
   * Scroll the editor root element into view
   */
  const scrollIntoView = useCallback(
    (options?: ScrollIntoViewOptions) => {
      const rootElement = editor.getRootElement();
      if (rootElement) {
        rootElement.scrollIntoView(options);
      }
    },
    [editor]
  );

  /**
   * Prepend text to the beginning of the editor with spacing
   */
  const prependText = useCallback(
    (text: string) => {
      editor.update(() => {
        const root = $getRoot();
        const firstChild = root.getFirstChild();

        // Create paragraph node with the text
        const textParagraph = $createParagraphNode().append(
          $createTextNode(text)
        );

        // Create empty paragraph for spacing
        const emptyParagraph = $createParagraphNode();

        if (firstChild) {
          // Insert before existing first child: textParagraph, emptyParagraph, firstChild, ...
          firstChild.insertBefore(emptyParagraph);
          emptyParagraph.insertBefore(textParagraph);
        } else {
          // No existing content, append both
          root.append(textParagraph);
          root.append(emptyParagraph);
        }

        // Focus the editor after insertion
        focus();
      });
    },
    [editor, focus]
  );

  /**
   * Expose the imperative handle
   */
  useImperativeHandle(
    controlRef,
    () => ({
      focus,
      scrollIntoView,
      prependText,
    }),
    [focus, scrollIntoView, prependText]
  );

  return null;
}
