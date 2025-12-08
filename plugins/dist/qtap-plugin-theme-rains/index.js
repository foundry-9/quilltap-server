"use strict";
/**
 * Rains Theme Plugin
 *
 * A warm, earthy dark theme with rich browns and amber accents,
 * inspired by rain-soaked autumn evenings.
 *
 * @module qtap-plugin-theme-rains
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = void 0;
exports.initialize = initialize;

/**
 * Plugin initialization
 * Theme plugins don't require runtime initialization - they're loaded
 * statically by the theme registry from tokens.json and styles.css.
 */
function initialize() {
  // Theme plugins are loaded statically by the theme registry
  // This function is called for consistency with the plugin lifecycle
  console.debug('Rains theme plugin loaded', {
    plugin: 'qtap-plugin-theme-rains',
    version: '1.0.0',
  });
}

/**
 * Plugin metadata export
 */
exports.metadata = {
  name: 'qtap-plugin-theme-rains',
  version: '1.0.0',
  type: 'THEME',
};

exports.default = {
  initialize: initialize,
  metadata: exports.metadata,
};
