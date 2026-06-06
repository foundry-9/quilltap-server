'use client'

/**
 * Autonomous Room Badges
 *
 * Compact handles in the page toolbar — one per autonomous chat that is
 * currently idle, paused, or running. Each badge abbreviates the chat
 * title (and the parent project, if any), shows a single budget-remaining
 * readout, and exposes an inline play/pause button.
 *
 * Polling mirrors the queue-status badges and the Settings → System
 * management list: SWR at 5s. A local 1s tick refreshes the time readout
 * between polls for running, time-budgeted rooms.
 *
 * @module components/layout/autonomous-room-badges
 */

import { useEffect, useState } from 'react'
import useSWR from 'swr'

type RunState = 'idle' | 'running' | 'paused' | 'stopped' | 'budgetExhausted' | 'error'

interface AutonomousRoom {
  id: string
  title: string
  projectId: string | null
  projectName: string | null
  runState: RunState | null
  runStateMessage: string | null
  runStartedAt: string | null
  runEndedAt: string | null
  runPausedAccumMs: number
  runTurnsConsumed: number
  runTokensConsumed: number
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMs: number | null
}

const POLL_INTERVAL_MS = 5_000
const TICK_INTERVAL_MS = 1_000

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load')
  return res.json()
}

function abbreviate(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .filter((c) => c.length > 0)
    .join('')
}

function trimZero(s: string): string {
  return s.replace(/\.0$/, '')
}

function formatTokens(n: number): string {
  n = Math.max(0, Math.floor(n))
  const K = 1024
  const M = K * K
  const G = M * K
  if (n < K) return String(n)
  if (n < M) {
    const v = n / K
    return `${v < 10 ? trimZero(v.toFixed(1)) : Math.round(v)}K`
  }
  if (n < G) {
    const v = n / M
    return `${v < 10 ? trimZero(v.toFixed(1)) : Math.round(v)}M`
  }
  const v = n / G
  return `${v < 10 ? trimZero(v.toFixed(1)) : Math.round(v)}B`
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

function timeRemainingMs(room: AutonomousRoom, nowMs: number): number {
  const max = room.budgetMaxWallClockMs
  if (!max) return 0
  if (!room.runStartedAt) return max
  const start = Date.parse(room.runStartedAt)
  if (Number.isNaN(start)) return max
  const end =
    room.runState === 'running'
      ? nowMs
      : room.runEndedAt
      ? Date.parse(room.runEndedAt)
      : nowMs
  // Exclude accumulated paused time so the countdown matches the budget check.
  const elapsed = (Number.isNaN(end) ? nowMs : end) - start - (room.runPausedAccumMs ?? 0)
  return Math.max(0, max - Math.max(0, elapsed))
}

type BudgetReadout =
  | { kind: 'tokens'; label: string; used: number; total: number }
  | { kind: 'messages'; label: string; used: number; total: number }
  | { kind: 'time'; label: string; usedMs: number; totalMs: number }
  | null

function selectBudgetReadout(room: AutonomousRoom, nowMs: number): BudgetReadout {
  if (room.budgetMaxTokens != null) {
    const total = room.budgetMaxTokens
    const used = Math.max(0, room.runTokensConsumed ?? 0)
    const remaining = Math.max(0, total - used)
    return { kind: 'tokens', label: formatTokens(remaining), used, total }
  }
  if (room.budgetMaxTurns != null) {
    const total = room.budgetMaxTurns
    const used = Math.max(0, room.runTurnsConsumed ?? 0)
    const remaining = Math.max(0, total - used)
    return { kind: 'messages', label: String(remaining), used, total }
  }
  if (room.budgetMaxWallClockMs != null) {
    const total = room.budgetMaxWallClockMs
    const remainingMs = timeRemainingMs(room, nowMs)
    const usedMs = Math.max(0, total - remainingMs)
    return { kind: 'time', label: formatTime(remainingMs), usedMs, totalMs: total }
  }
  return null
}

function buildLabel(room: AutonomousRoom): string {
  const chat = abbreviate(room.title || 'untitled')
  if (room.projectName) {
    const project = abbreviate(room.projectName)
    if (project) return `${project}:${chat || '?'}`
  }
  return chat || '?'
}

function buildTooltip(room: AutonomousRoom, readout: BudgetReadout): string {
  const projectLine = room.projectName ?? '(no project)'
  const titleLine = room.title || '(untitled autonomous room)'
  const status = room.runState ?? 'idle'
  let limitLine = 'no budget set'
  if (readout?.kind === 'tokens') {
    limitLine = `tokens: ${readout.used.toLocaleString()}/${readout.total.toLocaleString()}`
  } else if (readout?.kind === 'messages') {
    limitLine = `messages: ${readout.used}/${readout.total}`
  } else if (readout?.kind === 'time') {
    limitLine = `time: ${formatTime(readout.usedMs)}/${formatTime(readout.totalMs)}`
  }
  return `${projectLine}\n${titleLine}\n${limitLine}\nstatus: ${status}`
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <polygon points="2,1 9,5 2,9" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <rect x="2" y="1" width="2" height="8" fill="currentColor" />
      <rect x="6" y="1" width="2" height="8" fill="currentColor" />
    </svg>
  )
}

export function AutonomousRoomBadges() {
  const { data, mutate } = useSWR<{ rooms: AutonomousRoom[] }>(
    '/api/v1/system/autonomous-rooms',
    fetcher,
    { refreshInterval: POLL_INTERVAL_MS },
  )
  const [busyChatId, setBusyChatId] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  const rooms = (data?.rooms ?? []).filter(
    (r) => r.runState === 'idle' || r.runState === 'running' || r.runState === 'paused',
  )

  const hasTimeBudgetedRunning = rooms.some(
    (r) => r.runState === 'running' && r.budgetMaxWallClockMs != null,
  )

  useEffect(() => {
    if (!hasTimeBudgetedRunning) return
    const id = setInterval(() => setNowMs(Date.now()), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [hasTimeBudgetedRunning])

  if (rooms.length === 0) return null

  const handleToggle = async (room: AutonomousRoom, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const isRunning = room.runState === 'running'
    const verb: 'pause' | 'resume' | 'start' = isRunning
      ? 'pause'
      : room.runState === 'paused'
      ? 'resume'
      : 'start'
    // The server flips the run state synchronously (start/resume → running,
    // pause → paused), so we can reflect it optimistically the instant the
    // button is clicked instead of waiting for the POST + revalidation
    // round-trip — which can lag when the server is busy running a turn.
    const optimisticState: RunState = verb === 'pause' ? 'paused' : 'running'
    const applyOptimistic = (cur?: { rooms: AutonomousRoom[] }) => ({
      rooms: (cur?.rooms ?? []).map((r) =>
        r.id === room.id ? { ...r, runState: optimisticState } : r,
      ),
    })
    setBusyChatId(room.id)
    try {
      const post = (async (): Promise<{ rooms: AutonomousRoom[] } | undefined> => {
        const res = await fetch(`/api/v1/chats/${room.id}/autonomous-room?action=${verb}`, {
          method: 'POST',
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || `Failed to ${verb}`)
        }
        // Resolve to undefined so SWR falls through to the revalidation fetch
        // (populateCache: false, revalidate: true) for the authoritative state.
        return undefined
      })()
      await mutate(post, {
        optimisticData: applyOptimistic,
        rollbackOnError: true,
        populateCache: false,
        revalidate: true,
      })
    } catch (err) {
      console.error('Autonomous-room badge action failed', err)
    } finally {
      setBusyChatId(null)
    }
  }

  return (
    <div className="qt-autonomous-badge-group">
      {rooms.map((room) => {
        const isRunning = room.runState === 'running'
        const readout = selectBudgetReadout(room, nowMs)
        const label = buildLabel(room)
        const tooltip = buildTooltip(room, readout)
        const colorClass = isRunning
          ? 'qt-autonomous-badge-running'
          : 'qt-autonomous-badge-idle'
        return (
          <a
            key={room.id}
            href={`/salon/${room.id}`}
            className={`qt-autonomous-badge ${colorClass}`}
            title={tooltip}
          >
            <span>{label}</span>
            {readout && <span>{readout.label}</span>}
            <button
              type="button"
              className="qt-autonomous-badge-button"
              onClick={(e) => handleToggle(room, e)}
              disabled={busyChatId === room.id}
              aria-label={isRunning ? 'Pause' : 'Resume'}
              title={isRunning ? 'Pause' : 'Resume'}
            >
              {isRunning ? <PauseIcon /> : <PlayIcon />}
            </button>
          </a>
        )
      })}
    </div>
  )
}
