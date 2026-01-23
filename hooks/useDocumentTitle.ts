"use client";

import { useEffect } from 'react';

const DEFAULT_TITLE = 'Quilltap - AI Chat Platform';

/**
 * Hook to manage the browser document title dynamically.
 *
 * When a title is provided, sets the document title to "Quilltap: {title}".
 * When title is null/undefined, resets to the default title.
 * Automatically restores the default title on unmount.
 *
 * @param title - The chat or page title to display, or null for default
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') {
      return;
    }

    if (title) {
      const newTitle = `Quilltap: ${title}`;
      document.title = newTitle;
    } else {
      document.title = DEFAULT_TITLE;
    }

    // Restore default title on unmount
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
