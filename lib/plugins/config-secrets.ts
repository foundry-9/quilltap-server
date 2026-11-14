/**
 * Which keys of a plugin's stored config are secrets, and the one redactor
 * that removes them before a config leaves the instance (a `.qtap` export or a
 * backup).
 *
 * A config field is secret when its manifest declares `type: 'password'` or
 * `secret: true`. `secret` is read loosely from the field object, so a
 * manifest that predates the schema field still counts. When the plugin's
 * manifest cannot be resolved, nothing is known about its keys, so the whole
 * config is withheld (`redactedKeys: ['*']`).
 *
 * @module plugins/config-secrets
 */

import { logger } from '@/lib/logger';
import { getPlugin } from '@/lib/plugins/registry';

const secretsLogger = logger.child({ module: 'plugins:config-secrets' });

/** True when a config-schema field holds a secret. */
export function isSecretConfigField(field: unknown): boolean {
  if (!field || typeof field !== 'object') return false;
  const f = field as { type?: unknown; secret?: unknown };
  return f.type === 'password' || f.secret === true;
}

/** The secret keys a config schema declares. */
export function secretKeysOfConfigSchema(configSchema: unknown): Set<string> {
  if (!Array.isArray(configSchema)) return new Set();
  return new Set(
    configSchema
      .filter(isSecretConfigField)
      .map((field) => (field as { key?: unknown }).key)
      .filter((key): key is string => typeof key === 'string')
  );
}

/**
 * The secret keys of an installed plugin's config, or `null` when the plugin's
 * manifest is not available on this instance.
 */
export function resolveSecretConfigKeys(pluginName: string): Set<string> | null {
  const plugin = getPlugin(pluginName);
  if (!plugin) return null;
  return secretKeysOfConfigSchema(plugin.manifest.configSchema ?? []);
}

/**
 * Remove a plugin config's secret keys. `redactedKeys` names what was removed
 * (`['*']` when the whole config was withheld).
 */
export function redactPluginConfigSecrets(
  pluginName: string,
  config: Record<string, unknown>
): { config: Record<string, unknown>; redactedKeys: string[] } {
  const secretKeys = resolveSecretConfigKeys(pluginName);
  if (secretKeys === null) {
    secretsLogger.warn('Plugin manifest unavailable — withholding entire config', { pluginName });
    return { config: {}, redactedKeys: ['*'] };
  }
  const entries = Object.entries(config ?? {});
  const redactedKeys = entries.filter(([key]) => secretKeys.has(key)).map(([key]) => key);
  secretsLogger.debug('Redacted plugin config secrets', { pluginName, redactedKeys });
  return {
    config: Object.fromEntries(entries.filter(([key]) => !secretKeys.has(key))),
    redactedKeys,
  };
}
