/**
 * Storybook Preset for Quilltap Theme Development
 *
 * This preset provides the configuration needed to preview Quilltap themes
 * in Storybook. It includes default tokens, component classes, and
 * theme-switching decorators.
 *
 * @module @quilltap/theme-storybook/preset
 *
 * @example
 * // .storybook/main.ts
 * import type { StorybookConfig } from '@storybook/react-vite';
 *
 * const config: StorybookConfig = {
 *   stories: ['../stories/*.stories.tsx'],
 *   addons: ['@quilltap/theme-storybook/preset'],
 *   framework: '@storybook/react-vite',
 * };
 *
 * export default config;
 */

import { dirname, join } from 'path';

/**
 * Get the absolute path to a file in this package
 */
function getAbsolutePath(value: string): string {
  return dirname(require.resolve(join('@quilltap/theme-storybook', value)));
}

/**
 * Storybook preset configuration
 */
export function managerEntries(entry: string[] = []): string[] {
  return entry;
}

/**
 * Preview entries - CSS files to load
 */
export function previewAnnotations(entry: string[] = []): string[] {
  return [
    ...entry,
    join(__dirname, '../preview.js'),
  ];
}

/**
 * Static directories
 */
export function staticDirs(): string[] {
  return [];
}

const preset = {
  managerEntries,
  previewAnnotations,
  staticDirs,
};

export default preset;
