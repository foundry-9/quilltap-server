'use client';

/**
 * useTheme Hook
 *
 * Hook to access theme context from components.
 */

import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';
import type { ThemeContextValue } from './types';

/**
 * Hook to access theme context
 *
 * @throws Error if used outside ThemeProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { colorMode, setColorMode, tokens } = useTheme();
 *   return <div>Current mode: {colorMode}</div>;
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
