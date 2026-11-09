'use client'

/**
 * The Green Room's state in the Salon — what the opening (or a narrated join)
 * has said so far, folded from `greenRoom` stream frames.
 *
 * Each opening or watched join is one *room*. The newest room is pinned above
 * the transcript while it is live; the operator may close it, which **docks**
 * it: the room then sits in the transcript as a collapsed card at the point
 * where its part of the conversation began, and scrolls with everything else.
 * Starting a new room docks the one before it, so earlier records are kept in
 * their places for the rest of the session.
 *
 * Purely client-side: none of this is persisted, and none of it reaches a
 * model.
 *
 * @module app/salon/[id]/hooks/useGreenRoom
 */

import { useCallback, useMemo, useReducer } from 'react'
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
  /** Stable for the session; the docked card's render-item id derives from it. */
  id: string
  /** The opening (or join) is still running. */
  running: boolean
  /** Closed by the operator (or superseded): lives in the transcript, not above it. */
  docked: boolean
  /** The record's disclosure is open. Held here so a virtualized row keeps it. */
  expanded: boolean
  /**
   * Ids of the messages already in the transcript when this room began. A
   * docked room is placed after the last of them that is still on the page —
   * at the head of its own part of the conversation.
   */
  priorMessageIds: string[]
  /** What the panel is narrating: the chat's opening, or one character's arrival. */
  title: string
  status: string
  wardrobe: GreenRoomWardrobePanel[]
  packed: Array<{ characterId: string; characterName: string; items: string[] }>
  logs: Array<{ message: string; level: GreenRoomLogLevel; ts: number }>
}

export interface GreenRoomRooms {
  rooms: GreenRoomState[]
}

const INITIAL: GreenRoomRooms = { rooms: [] }

let roomSeq = 0
function newRoom(title: string, priorMessageIds: string[]): GreenRoomState {
  roomSeq += 1
  return {
    id: `gr-${Date.now().toString(36)}-${roomSeq}`,
    running: true,
    docked: false,
    expanded: false,
    priorMessageIds,
    title,
    status: '',
    wardrobe: [],
    packed: [],
    logs: [],
  }
}

type Action =
  | { type: 'begin'; title: string; priorMessageIds: string[] }
  | { type: 'event'; event: GreenRoomEvent }
  | { type: 'end' }
  | { type: 'dock'; id: string }
  | { type: 'toggle'; id: string }

/** Fold one event into a single room. Pure. */
function applyEvent(room: GreenRoomState, event: GreenRoomEvent): GreenRoomState {
  switch (event.event) {
    case 'phase':
      return room
    case 'status':
      return { ...room, status: event.message }
    case 'log':
      return { ...room, logs: [...room.logs, { message: event.message, level: event.level, ts: Date.now() }] }
    case 'wardrobeStart':
      return {
        ...room,
        wardrobe: [
          ...room.wardrobe.filter((p) => p.characterId !== event.characterId),
          { characterId: event.characterId, characterName: event.characterName, slots: null },
        ],
      }
    case 'wardrobeResult': {
      const exists = room.wardrobe.some((p) => p.characterId === event.characterId)
      const panel = { characterId: event.characterId, characterName: event.characterName, slots: event.slots }
      return {
        ...room,
        wardrobe: exists
          ? room.wardrobe.map((p) => (p.characterId === event.characterId ? panel : p))
          : [...room.wardrobe, panel],
      }
    }
    case 'inventory':
      return {
        ...room,
        packed: [
          ...room.packed.filter((p) => p.characterId !== event.characterId),
          { characterId: event.characterId, characterName: event.characterName, items: event.items },
        ],
      }
    case 'done':
      return { ...room, running: false }
    default:
      return assertNever(event)
  }
}

function mapRoom(state: GreenRoomRooms, id: string, fn: (room: GreenRoomState) => GreenRoomState): GreenRoomRooms {
  return { rooms: state.rooms.map((r) => (r.id === id ? fn(r) : r)) }
}

/** Fold one action into the session's rooms. Pure. Events land on the newest room. */
export function greenRoomReducer(state: GreenRoomRooms, action: Action): GreenRoomRooms {
  switch (action.type) {
    case 'begin': {
      // A new room docks the one before it, which keeps its record in place.
      const prior = state.rooms.map((r) => (r.docked ? r : { ...r, docked: true }))
      return { rooms: [...prior, newRoom(action.title, action.priorMessageIds)] }
    }
    case 'end': {
      const last = state.rooms[state.rooms.length - 1]
      if (!last || !last.running) return state
      return mapRoom(state, last.id, (r) => ({ ...r, running: false }))
    }
    case 'event': {
      const last = state.rooms[state.rooms.length - 1]
      if (!last) {
        // A frame with no `begin` before it: open a room at the head of the transcript.
        return { rooms: [applyEvent(newRoom('The Green Room', []), action.event)] }
      }
      return mapRoom(state, last.id, (r) => applyEvent(r, action.event))
    }
    case 'dock':
      return mapRoom(state, action.id, (r) => (r.docked ? r : { ...r, docked: true, expanded: false }))
    case 'toggle':
      return mapRoom(state, action.id, (r) => ({ ...r, expanded: !r.expanded }))
    default:
      return assertNever(action)
  }
}

/** The Green Room's rooms and the things that change them. */
export function useGreenRoom() {
  const [state, dispatch] = useReducer(greenRoomReducer, INITIAL)
  const begin = useCallback(
    (title: string, priorMessageIds: string[] = []) => dispatch({ type: 'begin', title, priorMessageIds }),
    [],
  )
  const onEvent = useCallback((event: GreenRoomEvent) => dispatch({ type: 'event', event }), [])
  const end = useCallback(() => dispatch({ type: 'end' }), [])
  const dock = useCallback((id: string) => dispatch({ type: 'dock', id }), [])
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), [])

  const { pinned, docked } = useMemo(() => {
    const last = state.rooms[state.rooms.length - 1]
    return {
      pinned: last && !last.docked ? last : null,
      docked: state.rooms.filter((r) => r.docked),
    }
  }, [state.rooms])

  return { pinned, docked, begin, onEvent, end, dock, toggle }
}
