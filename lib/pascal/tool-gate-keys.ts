/**
 * Tool gate keys — every literal object reference a custom tool's
 * availability gate keys on, across every enabled store.
 *
 * A gate's `inventory` / `inventoryCount` key is a reference resolved by
 * `resolveInventoryRef` (id → title → name). The Inventory title lint
 * (`lib/inventory/title-lint.ts`) needs the whole set so a new title cannot
 * land on a key and shadow the object the gate meant.
 *
 * The census is instance-wide, not per invoker: a title in a shared tier is
 * reachable by many invokers, and over-counting a key only over-rejects,
 * which is visible. It reports what it could not look at instead of treating
 * that as "no keys": a failed `Tools/` listing, a file listed but missing on
 * open, a file whose bytes or JSON cannot be read, or no enabled store at
 * all. A definition that parses as JSON but fails the schema is never dealt,
 * so its keys are not live and it is not counted as unread.
 *
 * Server-only.
 *
 * @module lib/pascal/tool-gate-keys
 */

import { logger } from '@/lib/logger';
import { listAllCustomTools } from './custom-tools';

/** One literal reference one gate keys on. */
export interface ToolGateKeyUse {
  /** The reference as written in the definition. */
  ref: string;
  toolName: string;
  clause: 'availableWhen' | 'withheldWhen';
  subject: 'inventory' | 'inventoryCount';
  mountName: string;
  definitionPath: string;
}

/** What the census could not read: the store, the file, and why. */
export interface ToolGateKeyUnread {
  mountName: string;
  definitionPath: string;
  reason: string;
}

export interface ToolGateKeyCensus {
  keys: ToolGateKeyUse[];
  /** Non-empty means the key set is incomplete; a caller that must not guess refuses. */
  unread: ToolGateKeyUnread[];
  /** The stores looked in, so an empty answer still says where it looked. */
  storesConsulted: string[];
}

/** Collect every gate key in every enabled store's `Tools/` folder. */
export async function collectToolGateKeys(): Promise<ToolGateKeyCensus> {
  const library = await listAllCustomTools();
  const keys: ToolGateKeyUse[] = [];
  for (const entry of library.entries) {
    const { definition, mountName, definitionPath } = entry;
    for (const clause of ['availableWhen', 'withheldWhen'] as const) {
      const gate = definition[clause];
      if (!gate) continue;
      for (const subject of ['inventory', 'inventoryCount'] as const) {
        for (const ref of Object.keys(gate[subject] ?? {})) {
          keys.push({ ref, toolName: definition.name, clause, subject, mountName, definitionPath });
        }
      }
    }
  }

  const unread: ToolGateKeyUnread[] = [
    ...library.unread.map(({ mountName, definitionPath, reason }) => ({ mountName, definitionPath, reason })),
    ...library.errors
      .filter((error) => error.stage === 'read' || error.stage === 'json')
      .map(({ mountName, definitionPath, reason }) => ({ mountName, definitionPath, reason })),
  ];
  if (library.storesConsulted.length === 0) {
    // Quilltap General is always enabled, so no store at all is a failed look, not an empty house.
    unread.push({ mountName: '(no enabled stores)', definitionPath: 'Tools/', reason: 'the store listing came back empty' });
  }

  logger.debug('[ToolGateKeys] Census taken', {
    context: 'custom-tools',
    stores: library.storesConsulted,
    definitions: library.entries.length,
    keys: keys.length,
    unread: unread.length,
  });
  return { keys, unread, storesConsulted: library.storesConsulted };
}
