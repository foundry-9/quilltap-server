/**
 * Old School Theme Plugin
 *
 * The original Quilltap default theme preserved as a plugin.
 * Warm slate-blue palette with Inter for UI chrome and EB Garamond
 * for branding and long-form content.
 *
 * @module qtap-plugin-theme-old-school
 */

import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-theme-old-school');

/**
 * Plugin initialization
 * Theme plugins don't require runtime initialization - they're loaded
 * statically by the theme registry from tokens.json and styles.css.
 */
export function initialize(): void {
}

/**
 * Plugin metadata export
 */
export const metadata = {
  name: 'qtap-plugin-theme-old-school',
  version: '1.0.0',
  type: 'THEME',
} as const;

const oldSchoolThemePlugin = {
  initialize,
  metadata,
};

export default oldSchoolThemePlugin;
