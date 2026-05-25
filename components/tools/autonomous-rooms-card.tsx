'use client'

import { useState } from 'react'
import useSWR from 'swr'

interface AutonomousRoom {
  id: string
  title: string
  participants: Array<{
    id: string
    type: string
    characterId: string | null
    status: string
  }>
  runState: 'idle' | 'running' | 'paused' | 'stopped' | 'budgetExhausted' | 'error' | null
  runStateMessage: string | null
  currentRunId: string | null
  runStartedAt: string | null
  runEndedAt: string | null
  runTurnsConsumed: number
  runTokensConsumed: number
  scheduleCron: string | null
  scheduleNextRunAt: string | null
  scheduleLastRunAt: string | null
  scheduleFreshnessWindowMs: number | null
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMs: number | null
  budgetEstimatedSpendCapUSD: number | null
  runDestructiveToolsAllowed: number
  runVisibility: string | null
  createdAt: string
  updatedAt: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load')
  return res.json()
}

function badgeColor(state: AutonomousRoom['runState']): string {
  switch (state) {
    case 'running': return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
    case 'idle': return 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
    case 'paused': return 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
    case 'stopped': return 'bg-slate-500/20 text-slate-700 dark:text-slate-300'
    case 'budgetExhausted': return 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
    case 'error': return 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
    default: return 'bg-slate-500/20 text-slate-700 dark:text-slate-300'
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function summarizeBudget(room: AutonomousRoom): string {
  const parts: string[] = []
  if (room.budgetMaxTurns != null) parts.push(`${room.runTurnsConsumed}/${room.budgetMaxTurns} turns`)
  else parts.push(`${room.runTurnsConsumed} turns`)
  if (room.budgetMaxTokens != null) parts.push(`${room.runTokensConsumed.toLocaleString()}/${room.budgetMaxTokens.toLocaleString()} tokens`)
  else parts.push(`${room.runTokensConsumed.toLocaleString()} tokens`)
  if (room.budgetMaxWallClockMs != null && room.runStartedAt) {
    const elapsedMs = (room.runEndedAt ? Date.parse(room.runEndedAt) : Date.now()) - Date.parse(room.runStartedAt)
    parts.push(`${Math.round(elapsedMs / 60000)}/${Math.round(room.budgetMaxWallClockMs / 60000)} min`)
  }
  return parts.join(' · ')
}

export function AutonomousRoomsCard() {
  const { data, isLoading, error, mutate } = useSWR<{ rooms: AutonomousRoom[] }>(
    '/api/v1/system/autonomous-rooms',
    fetcher,
    { refreshInterval: 5_000 },
  )
  const [busyChatId, setBusyChatId] = useState<string | null>(null)

  const action = async (chatId: string, verb: 'start' | 'pause' | 'stop' | 'resume') => {
    setBusyChatId(chatId)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}/autonomous-room?action=${verb}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Failed to ${verb}`)
      }
      await mutate()
    } catch (err) {
      console.error('Autonomous-room action failed', err)
    } finally {
      setBusyChatId(null)
    }
  }

  if (isLoading) {
    return <div className="qt-text-secondary">Loading autonomous rooms…</div>
  }
  if (error) {
    return <div className="qt-alert-error">Failed to load autonomous rooms.</div>
  }
  const allRooms = data?.rooms ?? []
  const rooms = allRooms.filter((room) => {
    if (room.scheduleCron) return true
    return room.runState === 'running' || room.runState === 'paused'
  })
  if (rooms.length === 0) {
    return (
      <div className="qt-text-small qt-text-muted">
        No scheduled autonomous rooms. Set a cron expression on a room when you create it from the Salon to have it appear here. Ad-hoc rooms only show up while they&rsquo;re actively running.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {rooms.map((room) => {
        const state = room.runState ?? 'idle'
        const isRunning = state === 'running'
        const canStart = state === 'idle' || state === 'paused' || state === 'budgetExhausted' || state === 'stopped'
        return (
          <div key={room.id} className="border qt-border-default rounded p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`/salon/${room.id}`}
                    className="font-medium text-foreground hover:underline truncate"
                  >
                    {room.title || '(untitled autonomous room)'}
                  </a>
                  <span className={`text-xs px-2 py-0.5 rounded ${badgeColor(state)}`}>
                    {state}
                  </span>
                  {room.scheduleCron && (
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-500/10 qt-text-muted">
                      cron: {room.scheduleCron}
                    </span>
                  )}
                  {!room.scheduleCron && (
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-500/10 qt-text-muted">
                      manual
                    </span>
                  )}
                </div>
                <div className="qt-text-small mt-1">
                  <span>Last run: {formatTimestamp(room.scheduleLastRunAt)}</span>
                  <span className="mx-2">·</span>
                  <span>Next run: {formatTimestamp(room.scheduleNextRunAt)}</span>
                </div>
                <div className="qt-text-small">
                  {summarizeBudget(room)}
                </div>
                {room.runStateMessage && (
                  <div className="qt-text-small qt-text-muted italic mt-1">
                    {room.runStateMessage}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1 shrink-0">
                <button
                  className="qt-button-secondary text-xs px-2 py-1"
                  onClick={() => action(room.id, isRunning ? 'pause' : 'start')}
                  disabled={busyChatId === room.id || (!isRunning && !canStart)}
                >
                  {isRunning ? 'Pause' : (state === 'paused' || state === 'budgetExhausted' ? 'Resume' : 'Start')}
                </button>
                <button
                  className="qt-button-secondary text-xs px-2 py-1"
                  onClick={() => action(room.id, 'stop')}
                  disabled={busyChatId === room.id || state === 'stopped'}
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
