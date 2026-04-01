/**
 * Quilltap RP Template Plugin
 *
 * Provides a custom roleplay formatting template with:
 * - Bare text dialogue (no quotes)
 * - [Square brackets] for actions
 * - {Curly braces} for thoughts
 * - // prefix for OOC comments
 *
 * @module qtap-plugin-template-quilltap-rp
 */

import { logger } from '@/lib/logger';

/**
 * Plugin initialization
 * Roleplay template plugins don't require runtime initialization - they're loaded
 * statically by the template registry from the manifest.json.
 */
export function initialize(): void {
  logger.debug('Quilltap RP template plugin loaded', {
    plugin: 'qtap-plugin-template-quilltap-rp',
    version: '1.0.0',
  });
}

/**
 * Plugin metadata export
 */
export const metadata = {
  name: 'qtap-plugin-template-quilltap-rp',
  version: '1.0.0',
  type: 'ROLEPLAY_TEMPLATE',
} as const;

const quilltapRPTemplatePlugin = {
  initialize,
  metadata,
};

export default quilltapRPTemplatePlugin;
