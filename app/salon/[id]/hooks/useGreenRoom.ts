'use client'

/**
 * The Green Room's state in the Salon — what the opening (or a narrated join)
 * has said so far, folded from `greenRoom` stream frames.
 *
 * The panel shows while the opening runs and collapses to a one-line "Opened"
 * row once `done` arrives; the record of who chose what stays behind that
 * disclosure for the rest of the session.
 *
 * @module app/salon/[id]/hooks/useGreenRoom
 */

import { useCallback, useReducer } from 'react'
import type { GreenRoomEvent } from '@/lib/chat/stream-frames'
import type { GreenRoomLogLevel, OutfitPreviewSlots } from '@/lib/chat/opening/narrator'
import { assertNever } from '@/lib/chat/stream-frames'

export interface GreenRoomWardrobePanel {
  characterId: string
  characterName: string
  /** Null while the character is still choosing. */
  slots: OutfitPreviewSlots | null
}

export interface GreenRoomState {
  /** Nothing has been said yet this session. */
  idle: boolean
  /** The opening (or join) is still running. */
  running: boolean
  /** What the panel is narrating: the chat's opening, or one character's arrival. */
  title: string
  status: string
  wardrobe: GreenRoomWardrobePanel[]
  packed: Array<{ characterId: string; characterName: string; items: string[] }>
  logs: Array<{ message: string; level: GreenRoomLogLevel; ts: number }>
}

const INITIAL: GreenRoomState = {
  idle: true,
  running: false,
  title: 'The Green Room',
  status: '',
  wardrobe: [],
  packed: [],
  logs: [],
}

type Action =
  | { type: 'begin'; title: string }
  | { type: 'event'; event: GreenRoomEvent }
  | { type: 'end' }

/** Fold one `greenRoom` event into the panel's state. Pure. */
export function greenRoomReducer(state: GreenRoomState, action: Action): GreenRoomState {
  switch (action.type) {
    case 'begin':
      return { ...INITIAL, idle: false, running: true, title: action.title }
    case 'end':
      return state.idle ? state : { ...state, running: false }
    case 'event': {
      const base = state.idle ? { ...INITIAL, idle: false, running: true } : state
      const event = action.event
      switch (event.event) {
        case 'phase':
          return base
        case 'status':
          return { ...base, status: event.message }
        case 'log':
          return { ...base, logs: [...base.logs, { message: event.message, level: event.level, ts: Date.now() }] }
        case 'wardrobeStart':
          return {
            ...base,
            wardrobe: [
              ...base.wardrobe.filter((p) => p.characterId !== event.characterId),
              { characterId: event.characterId, characterName: event.characterName, slots: null },
            ],
          }
        case 'wardrobeResult': {
          const exists = base.wardrobe.some((p) => p.characterId === event.characterId)
          const panel = { characterId: event.characterId, characterName: event.characterName, slots: event.slots }
          return {
            ...base,
            wardrobe: exists
              ? base.wardrobe.map((p) => (p.characterId === event.characterId ? panel : p))
              : [...base.wardrobe, panel],
          }
        }
        case 'inventory':
          return {
            ...base,
            packed: [
              ...base.packed.filter((p) => p.characterId !== event.characterId),
              { characterId: event.characterId, characterName: event.characterName, items: event.items },
            ],
          }
        case 'done':
          return { ...base, running: false }
        default:
          return assertNever(event)
      }
    }
    default:
      return assertNever(action)
  }
}

/** The Green Room panel's state and the three things that change it. */
export function useGreenRoom() {
  const [state, dispatch] = useReducer(greenRoomReducer, INITIAL)
  const begin = useCallback((title: string) => dispatch({ type: 'begin', title }), [])
  const onEvent = useCallback((event: GreenRoomEvent) => dispatch({ type: 'event', event }), [])
  const end = useCallback(() => dispatch({ type: 'end' }), [])
  return { state, begin, onEvent, end }
}
