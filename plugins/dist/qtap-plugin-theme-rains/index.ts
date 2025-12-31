/**
 * Rains Theme Plugin
 *
 * A warm, earthy dark theme with rich browns and amber accents,
 * inspired by rain-soaked autumn evenings.
 *
 * @module qtap-plugin-theme-rains
 */

import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-theme-rains');

/**
 * Plugin initialization
 * Theme plugins don't require runtime initialization - they're loaded
 * statically by the theme registry from tokens.json and styles.css.
 */
export function initialize(): void {
  logger.debug('Rains theme plugin loaded', {
    version: '1.0.0',
  });
}

/**
 * Plugin metadata export
 */
export const metadata = {
  name: 'qtap-plugin-theme-rains',
  version: '1.0.0',
  type: 'THEME',
} as const;

const rainsThemePlugin = {
  initialize,
  metadata,
};

export default rainsThemePlugin;
