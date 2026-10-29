/**
 * Composer slash commands — pure tier. See `types.ts` for the portability
 * contract.
 *
 * @module lib/slash-commands
 */

export * from './types';
export { SLASH_TRIGGER, findSlashTrigger } from './trigger';
export { rankSlashCommands } from './ranking';
export { COMPOSER_ACTION_SPECS, buildSlashCommands } from './registry';
