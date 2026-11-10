/**
 * The item browsers built on the shared folder layer: the Wardrobe, the
 * Inventory and the Atlas. A shared hook or component takes one of these and looks up
 * its URLs, keys and wording by it, rather than each kind keeping a copy.
 *
 * Client-safe: a type only.
 *
 * @module lib/folder-browser/item-kind
 */

export type ItemKind = 'wardrobe' | 'inventory' | 'atlas'
