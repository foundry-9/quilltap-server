/**
 * The title lint's "already linted" scope.
 *
 * The Inventory mutations (`item-mutations.ts`) lint a write with the whole
 * context in hand — the chat's project tier, the record before and after —
 * and then project the folder through `inventory-writes.ts`, which reaches
 * the document store like any other writer. The document-write layer
 * (`title-lint-documents.ts`) lints writes made by ordinary document tools;
 * it must not lint the mutation layer's projection a second time. The
 * projection runs inside {@link withInventoryWritesLinted}, and the document
 * layer asks {@link inventoryWritesAreLinted}.
 *
 * Kept free of imports beyond `async_hooks` so the low-level store can ask
 * without loading the Inventory. Process-wide: Next.js may evaluate this
 * module once per bundle, and every copy must share one scope.
 *
 * @module lib/inventory/lint-scope
 */

import { AsyncLocalStorage } from 'async_hooks';
import { processSingleton } from '@/lib/utils/process-singleton';

const scope = processSingleton('quilltap.inventory.title-lint-scope', () => new AsyncLocalStorage<true>());

/** Run `fn` with its document writes marked as already linted by the Inventory mutations. */
export function withInventoryWritesLinted<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run(true, fn);
}

/** True inside {@link withInventoryWritesLinted}. */
export function inventoryWritesAreLinted(): boolean {
  return scope.getStore() === true;
}

// ---------------------------------------------------------------------------
// Which paths the document-write layer lints. Plain string tests, so the store
// can decide without loading anything; the Inventory's own predicates
// (`isInventoryItemDocumentPath`) refine them once loaded.
// ---------------------------------------------------------------------------

/** A root-level `Tools/*.tool.json` custom-tool definition. */
export function isToolDefinitionPath(relativePath: string): boolean {
  return /^tools\/[^/]+\.tool\.json$/i.test(relativePath.replace(/^\/+/, ''));
}

/** `Inventory/` itself or anything inside it. */
export function isTitleLintFolder(relativePath: string): boolean {
  const lower = relativePath.replace(/^\/+|\/+$/g, '').toLowerCase();
  return lower === 'inventory' || lower.startsWith('inventory/');
}

/** A path whose write, delete or move the title lint must see. */
export function isTitleLintPath(relativePath: string): boolean {
  return isToolDefinitionPath(relativePath) || (isTitleLintFolder(relativePath) && /\.json$/i.test(relativePath));
}
