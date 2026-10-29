'use client'

/**
 * StorytellerBoard — the round's bids, laid out for the operator's choosing.
 *
 * Shown above the composer while a storyteller round is open: one card per
 * invited seat, filled in as the bids arrive (live off the send's stream, and
 * through the `storytellerRounds` realtime topic for anything that lands after
 * the stream has closed). The operator ticks the bids that go ahead and runs
 * them in order or all at once, or lets the round lie. Dragging the cards sets
 * the order by hand; untouched, the chosen bids run in the room's rotation. Once the round has run
 * the board folds into one line naming who was chosen, until the next round.
 *
 * A Destroy bid wears the strongest warning and must be chosen on its own;
 * "Select all" never includes it (D7).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Avatar, type AvatarImageSource } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/icon'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import { showErrorToast } from '@/lib/toast'
import {
  TIER_LABELS,
  type StorytellerBid,
  type StorytellerOrder,
  type StorytellerRound,
} from '@/lib/schemas/storyteller.types'

/** Cadence of the offline fallback poll, in ms. */
const FALLBACK_POLL_MS = 60_000

export interface StorytellerRoundResponse {
  round: StorytellerRound | null
}

interface StorytellerBoardProps {
  chatId: string
  /** The room is speaking — the board's buttons wait. */
  busy: boolean
  /** Avatar source for a seat, by participant id. */
  avatarFor: (participantId: string) => AvatarImageSource | string | null | undefined
  /**
   * Run the chosen bids (streams through the Salon's own transport). `keepOrder`
   * says the operator arranged the cards by hand, so `participantIds` is the order.
   */
  onRun: (roundId: string, participantIds: string[], order: StorytellerOrder, keepOrder: boolean) => Promise<boolean>
}

const TIER_BADGE: Record<string, string> = {
  simple: 'qt-badge-secondary',
  lookup: 'qt-badge-info',
  act: 'qt-badge-warning',
  destroy: 'qt-badge-destructive',
}

function cardClass(bid: StorytellerBid, selected: boolean, draggable: boolean, dragging: boolean): string {
  const classes = ['qt-storyteller-card']
  if (selected) classes.push('qt-storyteller-card-selected')
  if (draggable) classes.push('qt-storyteller-card-draggable')
  if (dragging) classes.push('qt-storyteller-card-dragging')
  if (bid.status === 'bid' && bid.tier === 'act') classes.push('qt-storyteller-card-act')
  if (bid.status === 'bid' && bid.tier === 'destroy') classes.push('qt-storyteller-card-destroy')
  if (bid.status !== 'bid' && bid.status !== 'pending') classes.push('qt-storyteller-card-quiet')
  return classes.join(' ')
}

function statusLine(bid: StorytellerBid): string | null {
  switch (bid.status) {
    case 'pending':
      return 'Considering…'
    case 'pass':
      return bid.plan ? `Passes: ${bid.plan}` : `Passes${bid.reason ? ` — ${bid.reason}` : ''}`
    case 'error':
      return `No bid — ${bid.reason ?? 'the call failed'}`
    case 'kept-quiet':
      return 'Kept quiet this round'
    default:
      return null
  }
}

/**
 * The board's card order: the operator's arrangement where there is one, with
 * any card it does not name (a late bid) following in the round's own order.
 */
export function arrangeBids(bids: StorytellerBid[], arrangement: string[] | null): StorytellerBid[] {
  if (!arrangement) return bids
  const byId = new Map(bids.map((b) => [b.participantId, b]))
  const placed = arrangement.flatMap((id) => {
    const bid = byId.get(id)
    return bid ? [bid] : []
  })
  const named = new Set(arrangement)
  return [...placed, ...bids.filter((b) => !named.has(b.participantId))]
}

interface SortableCardProps {
  bid: StorytellerBid
  selected: boolean
  /** Only a seat that bid to speak can be moved; the rest hold still but still make room. */
  draggable: boolean
  children: ReactNode
}

function SortableCard({ bid, selected, draggable, children }: Readonly<SortableCardProps>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: bid.participantId,
    disabled: !draggable,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  // The card is its own activator, so Space on the checkbox inside stays a tick, not a pick-up.
  const ref = (node: HTMLDivElement | null) => {
    setNodeRef(node)
    setActivatorNodeRef(node)
  }
  return (
    <div
      ref={ref}
      style={style}
      className={cardClass(bid, selected, draggable, isDragging)}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      aria-roledescription={draggable ? 'draggable bid' : undefined}
    >
      {children}
    </div>
  )
}

function ordinal(n: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
  return words[n - 1] ?? `#${n}`
}

/** Patch one card into a cached round (the stream's `storytellerBid` frames). */
export function withBid(round: StorytellerRound, bid: StorytellerBid): StorytellerRound {
  const bids = round.bids.some((b) => b.participantId === bid.participantId)
    ? round.bids.map((b) => (b.participantId === bid.participantId ? bid : b))
    : [...round.bids, bid]
  return { ...round, bids }
}

export function StorytellerBoard({ chatId, busy, avatarFor, onRun }: Readonly<StorytellerBoardProps>) {
  const queryClient = useQueryClient()
  const refetchInterval = useRealtimeRefetchInterval(FALLBACK_POLL_MS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  /** The operator's hand-set card order (participant ids); null until they drag. */
  const [arrangement, setArrangement] = useState<string[] | null>(null)
  const sensors = useSensors(
    // A short travel before a drag starts, so a click on the checkbox stays a click.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // A long press on touch, so a swipe still scrolls the cards.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const { data } = useQuery({
    queryKey: queryKeys.chats.storytellerRound(chatId),
    queryFn: ({ signal }) =>
      apiFetch<StorytellerRoundResponse>(`/api/v1/chats/${chatId}?action=storyteller-round`, { signal }),
    enabled: Boolean(chatId),
    refetchInterval,
  })
  const round = data?.round ?? null
  const roundId = round?.id ?? null

  // A new round starts with nothing ticked and the cards in their own order.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selection is per round; reset when the round changes
    setSelected(new Set())
    setArrangement(null)
  }, [roundId])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats.storytellerRound(chatId) })
  }, [queryClient, chatId])

  const ask = useMutation({
    mutationFn: (participantId: string) =>
      apiFetch<{ bid: StorytellerBid }>(`/api/v1/chats/${chatId}?action=storyteller-ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, participantId }),
      }),
    onError: (error) => showErrorToast(apiErrorMessage(error, 'Could not ask for that bid')),
    onSettled: invalidate,
  })

  const lie = useMutation({
    mutationFn: () =>
      apiFetch<{ closed: boolean }>(`/api/v1/chats/${chatId}?action=storyteller-lie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId }),
      }),
    onError: (error) => showErrorToast(apiErrorMessage(error, 'Could not close the round')),
    onSettled: invalidate,
  })

  const cards = useMemo(() => arrangeBids(round?.bids ?? [], arrangement), [round, arrangement])
  const biddable = useMemo(() => cards.filter((b) => b.status === 'bid'), [cards])
  // In board order, which is the run order once the operator has arranged it.
  const chosenBids = biddable.filter((b) => selected.has(b.participantId))
  const arranged = arrangement !== null

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = cards.map((b) => b.participantId)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    setArrangement(arrayMove(ids, from, to))
  }
  const destroyChosen = chosenBids.some((b) => b.tier === 'destroy')
  const destroyMixed = destroyChosen && chosenBids.length > 1

  const toggle = (bid: StorytellerBid) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(bid.participantId)) {
        next.delete(bid.participantId)
      } else if (bid.tier === 'destroy') {
        // A Destroy bid goes ahead alone.
        return new Set([bid.participantId])
      } else {
        for (const other of biddable) if (other.tier === 'destroy') next.delete(other.participantId)
        next.add(bid.participantId)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(biddable.filter((b) => b.tier !== 'destroy').map((b) => b.participantId)))
  }

  const run = async (order: StorytellerOrder) => {
    if (!roundId || chosenBids.length === 0) return
    setRunning(true)
    try {
      await onRun(roundId, chosenBids.map((b) => b.participantId), order, arranged)
    } finally {
      setRunning(false)
      invalidate()
    }
  }

  if (!round) return null

  // A closed round folds to one line, until the next round opens.
  if (round.status !== 'open') {
    const names = round.selection?.names ?? []
    let text: string
    if (round.status === 'running') text = `Speaking now: ${names.join(', ')}`
    else if (round.closedReason === 'let-lie') text = 'The last round was let lie.'
    else if (round.closedReason === 'superseded' || round.closedReason === 'abandoned') text = 'The last round closed unrun.'
    else text = names.length > 0 ? `Last round: ${names.join(', ')}${round.selection?.order === 'simultaneous' ? ' (all at once)' : ''}` : 'The last round has run.'
    return (
      <div className="qt-storyteller-summary" role="status">
        <Icon name="users" className="w-3.5 h-3.5" />
        <span>{text}</span>
      </div>
    )
  }

  const pending = round.bids.filter((b) => b.status === 'pending').length
  const disabled = busy || running

  return (
    <section className="qt-storyteller-board" aria-label="The storyteller's board">
      <div className="qt-storyteller-board-header">
        <span>
          The company bids
          {pending > 0 && <span className="qt-storyteller-meta"> — {pending} still considering…</span>}
        </span>
        <span className="qt-storyteller-board-tools">
          {arranged && (
            <button
              type="button"
              className="qt-button-ghost qt-button-sm"
              onClick={() => setArrangement(null)}
              disabled={disabled}
              title="Put the cards back and let the room's rotation set the order"
            >
              Reset order
            </button>
          )}
          <button type="button" className="qt-button-ghost qt-button-sm" onClick={selectAll} disabled={disabled || biddable.length === 0}>
            Select all
          </button>
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={cards.map((b) => b.participantId)} strategy={rectSortingStrategy}>
          <div className="qt-storyteller-cards">
            {cards.map((bid) => {
              const isSelected = selected.has(bid.participantId)
              const line = statusLine(bid)
              const runPosition = arranged && isSelected ? chosenBids.findIndex((b) => b.participantId === bid.participantId) + 1 : 0
              return (
                <SortableCard key={bid.participantId} bid={bid} selected={isSelected} draggable={bid.status === 'bid' && !disabled}>
                  <div className="qt-storyteller-card-head">
                    {runPosition > 0 && (
                      <span className="qt-storyteller-card-order" title={`Speaks ${ordinal(runPosition)}`}>{runPosition}</span>
                    )}
                    {bid.status === 'bid' && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(bid)}
                        disabled={disabled}
                        aria-label={`Let ${bid.characterName} go ahead`}
                      />
                    )}
                    <Avatar name={bid.characterName} src={avatarFor(bid.participantId) ?? null} size="xs" />
                    <span className="qt-storyteller-card-name" title={bid.characterName}>{bid.characterName}</span>
                    {bid.status === 'bid' && bid.tier && (
                      <span className={`qt-badge ${TIER_BADGE[bid.tier]}`}>{TIER_LABELS[bid.tier]}</span>
                    )}
                  </div>

                  {bid.status === 'bid' && bid.plan && <div className="qt-storyteller-plan">{bid.plan}</div>}
                  {line && <div className="qt-storyteller-meta">{line}</div>}

                  {bid.status === 'bid' && bid.tier === 'destroy' && (
                    <div className="qt-storyteller-warning">
                      This bid means to delete something, and cannot be undone. It goes ahead alone.
                    </div>
                  )}
                  {bid.status === 'bid' && bid.tierRaised && bid.statedTier && bid.tier && (
                    <div className="qt-storyteller-meta">
                      Asked for {TIER_LABELS[bid.statedTier]}, named {bid.tier === 'act' ? 'an' : 'a'} {TIER_LABELS[bid.tier]} tool.
                    </div>
                  )}
                  {bid.status === 'bid' && bid.tools.length > 0 && (
                    <div className="qt-storyteller-meta">Tools: {bid.tools.join(', ')}</div>
                  )}
                  {bid.status === 'bid' && bid.reason && <div className="qt-storyteller-meta">{bid.reason}</div>}

                  <div className="qt-storyteller-meta">
                    Talkativeness {bid.talkativeness.toFixed(2)}
                    {bid.silent ? ' · silent' : ''}
                  </div>

                  {(bid.status === 'kept-quiet' || bid.status === 'error') && (
                    <button
                      type="button"
                      className="qt-button-secondary qt-button-sm"
                      onClick={() => ask.mutate(bid.participantId)}
                      disabled={disabled || ask.isPending}
                    >
                      Ask anyway
                    </button>
                  )}
                </SortableCard>
              )
            })}
          </div>
        </SortableContext>
      </DndContext>

      {biddable.length > 1 && (
        <div className="qt-storyteller-meta">
          {arranged
            ? 'Chosen bids run in the order shown.'
            : 'Drag the cards to set the running order; left alone, the room’s rotation decides.'}
        </div>
      )}

      {destroyMixed && (
        <div className="qt-storyteller-warning">A Destroy bid must be chosen on its own.</div>
      )}

      <div className="qt-storyteller-actions">
        <button
          type="button"
          className="qt-button-primary qt-button-sm"
          onClick={() => run('sequential')}
          disabled={disabled || chosenBids.length === 0 || destroyMixed}
        >
          Run in order
        </button>
        <button
          type="button"
          className="qt-button-secondary qt-button-sm"
          onClick={() => run('simultaneous')}
          disabled={disabled || chosenBids.length < 2 || destroyMixed}
          title="Simple and Lookup bids speak at once; Act and Destroy bids follow one at a time"
        >
          All at once
        </button>
        <button
          type="button"
          className="qt-button-ghost qt-button-sm"
          onClick={() => lie.mutate()}
          disabled={disabled || lie.isPending}
        >
          Let it lie
        </button>
      </div>
    </section>
  )
}

export default StorytellerBoard
