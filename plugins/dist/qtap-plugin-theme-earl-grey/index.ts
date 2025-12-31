/**
 * Earl Grey Theme Plugin
 *
 * A sophisticated dark theme with deep slate grays and soft blue accents,
 * inspired by the elegance of classic earl grey tea.
 *
 * @module qtap-plugin-theme-earl-grey
 */

import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-theme-earl-grey');

/**
 * Plugin initialization
 * Theme plugins don't require runtime initialization - they're loaded
 * statically by the theme registry from tokens.json and styles.css.
 */
export function initialize(): void {
  logger.debug('Earl Grey theme plugin loaded', {
    version: '1.0.0',
  });
}

/**
 * Plugin metadata export
 */
export const metadata = {
  name: 'qtap-plugin-theme-earl-grey',
  version: '1.0.0',
  type: 'THEME',
} as const;

const earlGreyThemePlugin = {
  initialize,
  metadata,
};

export default earlGreyThemePlugin;
