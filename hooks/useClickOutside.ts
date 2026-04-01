"use client";

import { useEffect, RefObject } from 'react';
import { clientLogger } from '@/lib/client-logger';

export interface UseClickOutsideOptions {
  /**
   * Whether the click outside detection is active.
   * Useful for components that should only detect clicks when open.
   * @default true
   */
  enabled?: boolean;

  /**
   * Additional refs to exclude from the "outside" check.
   * Clicks on these elements will not trigger onClickOutside.
   * Useful for toggle buttons that should not close the dropdown.
   */
  excludeRefs?: RefObject<HTMLElement | null>[];

  /**
   * Optional callback for Escape key press.
   * If provided, will add a keydown listener for Escape.
   */
  onEscape?: () => void;
}

/**
 * Hook to detect clicks outside a referenced element.
 *
 * @param ref - The ref of the element to detect clicks outside of
 * @param onClickOutside - Callback fired when a click occurs outside the ref
 * @param options - Optional configuration
 *
 * @example
 * // Simple usage - always active
 * const dropdownRef = useRef<HTMLDivElement>(null)
 * useClickOutside(dropdownRef, () => setIsOpen(false))
 *
 * @example
 * // Only active when open
 * useClickOutside(menuRef, () => setIsOpen(false), { enabled: isOpen })
 *
 * @example
 * // With escape key and excluded toggle button
 * useClickOutside(paletteRef, onClose, {
 *   enabled: isOpen,
 *   excludeRefs: [toggleButtonRef],
 *   onEscape: onClose,
 * })
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickOutside: () => void,
  options: UseClickOutsideOptions = {}
): void {
  const { enabled = true, excludeRefs = [], onEscape } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Check if click is inside the main ref
      if (ref.current?.contains(target)) {
        return;
      }

      // Check if click is inside any excluded refs
      for (const excludeRef of excludeRefs) {
        if (excludeRef.current?.contains(target)) {
          return;
        }
      }

      // Click is outside all tracked elements
      clientLogger.debug('Click outside detected', {
        hasRef: !!ref.current,
        excludeCount: excludeRefs.length,
      });
      onClickOutside();
    };

    const handleKeyDown = onEscape
      ? (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            onEscape();
          }
        }
      : undefined;

    document.addEventListener('mousedown', handleClickOutside);
    if (handleKeyDown) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (handleKeyDown) {
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [ref, onClickOutside, enabled, excludeRefs, onEscape]);
}
