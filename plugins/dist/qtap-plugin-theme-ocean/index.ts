/**
 * Ocean Theme Plugin
 *
 * A calming ocean-inspired theme with deep blues and teals.
 * This plugin provides design tokens and component overrides for
 * a relaxing yet focused chat experience.
 *
 * @module qtap-plugin-theme-ocean
 */

import { logger } from '@/lib/logger';

/**
 * Plugin initialization
 * Theme plugins don't require runtime initialization - they're loaded
 * statically by the theme registry from tokens.json and styles.css.
 */
export function initialize(): void {
  logger.debug('Ocean theme plugin loaded', {
    plugin: 'qtap-plugin-theme-ocean',
    version: '1.1.0',
  });
}

/**
 * Plugin metadata export
 */
export const metadata = {
  name: 'qtap-plugin-theme-ocean',
  version: '1.1.0',
  type: 'THEME',
} as const;

const oceanThemePlugin = {
  initialize,
  metadata,
};

export default oceanThemePlugin;
