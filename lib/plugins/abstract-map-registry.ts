/**
 * Abstract Map Registry
 *
 * Intermediate base class for registries that store items in a
 * `Map<string, TItem>` and errors in a `Map<string, string>`.
 *
 * Provides item/error map accessors and shared helper methods
 * so that concrete registries only need to define their unique logic.
 *
 * @module plugins/abstract-map-registry
 */

import { AbstractRegistry, type BaseRegistryState } from './base-registry';

// ============================================================================
// ABSTRACT MAP REGISTRY
// ============================================================================

/**
 * Base class for registries whose state contains a `Map<string, TItem>`
 * for items and a `Map<string, string>` for errors.
 *
 * Subclasses must provide accessors to reach the item and error maps
 * within their specific state shape (since the property names differ
 * across registries — `providers`, `plugins`, `tools`, etc.).
 */
export abstract class AbstractMapRegistry<
  TItem,
  TState extends BaseRegistryState,
> extends AbstractRegistry<TState> {
  /** Return the Map that holds registered items. */
  protected abstract getItemMap(): Map<string, TItem>;

  /** Return the Map that holds registration errors. */
  protected abstract getErrorMap(): Map<string, string>;
}
