'use client';

/**
 * Theme Provider - Backward Compatibility Export
 *
 * This file re-exports the theme provider components and types for backward compatibility.
 * The actual implementation has been refactored into modular files in the ./theme directory.
 *
 * @deprecated Import from './theme' or './theme/index.ts' instead
 * @module providers/theme-provider
 */

export { ThemeProvider, ThemeContext } from './theme/ThemeProvider';
export { useTheme } from './theme/useTheme';
export { useSubsystemInfo, useAllSubsystemInfo } from './theme/useSubsystemInfo';
export type { ResolvedSubsystemInfo } from './theme/useSubsystemInfo';
export type {
  ThemeContextValue,
  ThemeSummary,
  ThemeProviderProps,
  ThemeFont,
  SubsystemOverride,
  ThemeTokensResponse,
  ThemesListResponse,
} from './theme/types';
