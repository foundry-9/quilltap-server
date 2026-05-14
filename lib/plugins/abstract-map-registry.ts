/**
 * Abstract Map Registry
 *
 * Intermediate base class for registries that store items in a
 * `Map<string, TItem>` and registration errors in a `Map<string, TError>`.
 *
 * Provides item/error map accessors and shared helper methods
 * so that concrete registries only need to define their unique logic.
 *
 * `TError` defaults to `string` (the shape used by the provider registries),
 * but structured-error registries can specify their own type — see
 * `SystemPromptRegistry` and `ThemeRegistry`.
 *
 * @module plugins/abstract-map-registry
 */

import { AbstractRegistry, type BaseRegistryState } from './base-registry';

// ============================================================================
// ABSTRACT MAP REGISTRY
// ============================================================================

/**
 * Base class for registries whose state contains a `Map<string, TItem>`
 * for items and a `Map<string, TError>` for errors.
 *
 * Subclasses must provide accessors to reach the item and error maps
 * within their specific state shape (since the property names differ
 * across registries — `providers`, `plugins`, `tools`, `prompts`, `themes`).
 */
export abstract class AbstractMapRegistry<
  TItem,
  TState extends BaseRegistryState,
  TError = string,
> extends AbstractRegistry<TState> {
  /** Return the Map that holds registered items. */
  protected abstract getItemMap(): Map<string, TItem>;

  /** Return the Map that holds registration errors. */
  protected abstract getErrorMap(): Map<string, TError>;
}
