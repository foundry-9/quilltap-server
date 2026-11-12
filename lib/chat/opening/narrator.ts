/**
 * The Green Room's narrator — how the opening tells the operator what it is
 * doing while it does it.
 *
 * The opening (casting's slow half: dressing, packing, the staff's posts and
 * the greeting) runs inside the Salon's own stream, and narrates there with
 * `greenRoom` frames (`lib/chat/stream-frames.ts`). Everything that narrates —
 * the opening's phases, `seatArrival`, the outfit and inventory choosers — is
 * handed a {@link GreenRoomNarrator}; it never knows whether anyone is
 * listening. {@link inertNarrator} is the narrator for a script, the CLI, an
 * autonomous room's run start, or a join nobody is watching.
 *
 * Client-safe types; the frame-writing implementation lives in
 * `narrator-frames.ts` (server-only), so the Salon can import the event
 * vocabulary from here without dragging the stream encoder along.
 *
 * Design of record: docs/developer/features/complete/refactor-green-room-and-opening.md (D7)
 *
 * @module chat/opening/narrator
 */

import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

/** One resolved garment in a slot preview. */
export interface OutfitPreviewEntry {
  id: string
  title: string
  isComposite: boolean
}

/** The decided per-slot outfit, rendered read-only in the Green Room panel. */
export type OutfitPreviewSlots = Record<WardrobeItemType, OutfitPreviewEntry[]>

/** How a narrated line should be read. */
export type GreenRoomLogLevel = 'info' | 'warn' | 'error'

/**
 * Everything the opening says. `phase` names the opening phase that just
 * began; `status` is the headline; `log` an activity line; `wardrobeStart` /
 * `wardrobeResult` frame one character's outfit choice; `inventory` what a
 * character chose to carry in; `done` closes the opening.
 */
export interface GreenRoomNarrator {
  phase(key: string, label: string): void
  status(message: string): void
  log(message: string, level?: GreenRoomLogLevel): void
  wardrobeStart(characterId: string, characterName: string): void
  wardrobeResult(characterId: string, characterName: string, slots: OutfitPreviewSlots): void
  inventory(characterId: string, characterName: string, items: string[]): void
  /** The opening is complete (or was stopped). */
  done(): void
}

/** The narrator nobody hears. */
export const inertNarrator: GreenRoomNarrator = {
  phase: () => {},
  status: () => {},
  log: () => {},
  wardrobeStart: () => {},
  wardrobeResult: () => {},
  inventory: () => {},
  done: () => {},
}
