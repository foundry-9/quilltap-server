/**
 * @module ImagePastePlugin
 * Lexical editor plugin that detects image paste events and delegates to a callback.
 * Handles clipboard data extraction, file renaming, and async processing without blocking
 * the paste command handler.
 */

'use client';

import { COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';

interface ImagePastePluginProps {
  /** Callback when an image is pasted */
  onImagePaste: (file: File) => Promise<void>;
}

/**
 * ImagePastePlugin - Headless Lexical plugin for handling image paste events
 *
 * Registers a PASTE_COMMAND handler that:
 * - Extracts image files from clipboard data
 * - Renames pasted images with timestamp and extension
 * - Delegates to onImagePaste callback (fire-and-forget)
 * - Allows normal text paste behavior if no image is found
 *
 * @param props - Plugin configuration
 * @returns null (headless plugin)
 */
export function ImagePastePlugin({ onImagePaste }: ImagePastePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregister = editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (!items) {
          return false;
        }

        // Find first image item in clipboard
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            // Prevent default paste behavior
            event.preventDefault();

            // Extract file and rename it
            const file = item.getAsFile();
            if (file) {
              const extension = file.type.split('/')[1] || 'png';
              const renamedFile = new File(
                [file],
                `pasted-image-${Date.now()}.${extension}`,
                { type: file.type }
              );

              // Fire and forget - don't await in command handler
              onImagePaste(renamedFile);
            }

            // Stop propagation - image was handled
            return true;
          }
        }

        // No image found - let Lexical handle normal paste
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );

    return unregister;
  }, [editor, onImagePaste]);

  // Headless plugin
  return null;
}
