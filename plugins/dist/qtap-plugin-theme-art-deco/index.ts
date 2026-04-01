/**
 * Art Deco Theme Plugin
 *
 * The geometry of elegance, the precision of grandeur.
 * Navy-and-gold palette with geometric sans-serif headings,
 * elegant serif body text, and gold accents throughout.
 *
 * @module qtap-plugin-theme-art-deco
 */

import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-theme-art-deco');

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
  name: 'qtap-plugin-theme-art-deco',
  version: '1.0.0',
  type: 'THEME',
} as const;

const artDecoThemePlugin = {
  initialize,
  metadata,
};

export default artDecoThemePlugin;
