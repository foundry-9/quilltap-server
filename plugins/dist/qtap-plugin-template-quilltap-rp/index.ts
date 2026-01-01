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

import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
import { createSingleTemplatePlugin } from '@quilltap/plugin-utils';

/**
 * The Quilltap RP system prompt that defines the formatting rules.
 */
const QUILLTAP_RP_SYSTEM_PROMPT = `[SYSTEM INSTRUCTION: INTERACTION FORMATTING PROTOCOL]
You must adhere to the following custom syntax for all outputs. Do NOT use standard roleplay formatting.

1. SPOKEN DIALOGUE: Write as bare text. Do NOT use quotation marks.
   - Example: Put the gun down, John.
   - Markdown Italics (*text*) denote VOCAL EMPHASIS only, never action.

2. ACTION & NARRATION: Enclose all physical movements, facial expressions, and environmental descriptions in SQUARE BRACKETS [ ].
   - Example: [I lean back in the chair, crossing my arms.]

3. INTERNAL MONOLOGUE: Enclose private thoughts and feelings in CURLY BRACES { }.
   - Example: {He's lying to me. I can feel it.}

4. META/OOC: Any Out-of-Character comments or instructions must start with "// ".
   - Example: // The user is simulating a high-gravity environment now.

5. STRICT COMPLIANCE: You must mirror this formatting in your responses. Never use asterisks for actions.`;

/**
 * The Quilltap RP roleplay template plugin.
 *
 * Uses the createSingleTemplatePlugin utility from @quilltap/plugin-utils
 * for simplified plugin creation.
 */
export const plugin: RoleplayTemplatePlugin = createSingleTemplatePlugin({
  templateId: 'quilltap-rp',
  displayName: 'Quilltap RP',
  description: 'Custom formatting protocol with dialogue as bare text, actions in [brackets], thoughts in {braces}, and OOC with // prefix.',
  systemPrompt: QUILLTAP_RP_SYSTEM_PROMPT,
  author: {
    name: 'Foundry-9 LLC',
    email: 'charles.sebold@foundry-9.com',
    url: 'https://foundry-9.com',
  },
  tags: ['quilltap', 'custom', 'brackets', 'braces'],
  version: '1.0.1',
  enableLogging: true,
});

/**
 * Plugin initialization
 * This is called by the plugin system when the plugin is loaded.
 */
export function initialize(): void | Promise<void> {
  return plugin.initialize?.();
}

/**
 * Plugin metadata export (for backward compatibility)
 */
export const metadata = {
  name: 'qtap-plugin-template-quilltap-rp',
  version: '1.0.1',
  type: 'ROLEPLAY_TEMPLATE',
} as const;

export default { plugin, initialize, metadata };
