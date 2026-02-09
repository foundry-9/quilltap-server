/**
 * The Great Estate Theme Plugin
 *
 * Warm gold and mahogany, like a manor house library at golden hour.
 * Playfair Display serif headings, Inter sans-serif body, carbon-fibre
 * texture overlay, and a palette that whispers old money.
 *
 * @module qtap-plugin-theme-great-estate
 */

import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-theme-great-estate');

/**
 * Plugin initialization
 * Theme plugins don't require runtime initialization - they're loaded
 * statically by the theme registry from tokens.json and styles.css.
 */
export function initialize(): void {
  logger.debug('The Great Estate theme loaded');
}

/**
 * Plugin metadata export
 */
export const metadata = {
  name: 'qtap-plugin-theme-great-estate',
  version: '1.0.0',
  type: 'THEME',
} as const;

const greatEstateThemePlugin = {
  initialize,
  metadata,
};

export default greatEstateThemePlugin;
