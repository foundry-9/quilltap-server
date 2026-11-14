/**
 * What the wizard's Validate button should do with what is in a key field.
 *
 * A key is tested before it is stored, so a mistyped key never becomes an
 * `api_keys` row, and a key is stored at most once per provider per wizard
 * run: re-validating replaces the row this run created rather than adding
 * another. A key the operator already had (settings mode shows it as
 * `EXISTING_KEY_MASK`) is tested as stored and never overwritten.
 */

import { EXISTING_KEY_MASK } from './useProviderWizardState'

export type KeyValidationPlan =
  /** The provider takes no key (Ollama, built-in): test the connection alone. */
  | { kind: 'no-key' }
  /** The field is empty. */
  | { kind: 'missing' }
  /** The field still shows an existing stored key: test that key by id. */
  | { kind: 'stored'; apiKeyId: string }
  /** A typed key: test it unsaved, then store it — replacing `replaceId` if set. */
  | { kind: 'new'; key: string; replaceId: string | null }

export function planKeyValidation(input: {
  requiresKey: boolean
  key: string
  apiKeyId: string | null
  storedByWizard: boolean
}): KeyValidationPlan {
  if (!input.requiresKey) return { kind: 'no-key' }

  const key = input.key.trim()
  if (!key) return { kind: 'missing' }

  if (key === EXISTING_KEY_MASK) {
    return input.apiKeyId ? { kind: 'stored', apiKeyId: input.apiKeyId } : { kind: 'missing' }
  }

  return {
    kind: 'new',
    key,
    replaceId: input.storedByWizard && input.apiKeyId ? input.apiKeyId : null,
  }
}
