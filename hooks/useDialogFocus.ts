"use client";

import { useCallback, useEffect, useRef, RefObject, KeyboardEvent } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus for a modal surface (WCAG 2.4.3 / 2.1.2):
 * - on open, moves focus into the dialog (unless something inside — an
 *   `autoFocus` field — already took it);
 * - keeps Tab / Shift+Tab cycling inside it (attach the returned handler as
 *   the dialog's `onKeyDown`);
 * - on close or unmount, hands focus back to whatever held it before.
 *
 * The dialog element needs `tabIndex={-1}` so it can take focus itself.
 */
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  isOpen: boolean
): (e: KeyboardEvent) => void {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous && previous.isConnected) previous.focus();
    };
  }, [isOpen, dialogRef]);

  return useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [dialogRef]
  );
}
