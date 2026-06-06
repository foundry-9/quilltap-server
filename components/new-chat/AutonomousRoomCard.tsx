'use client'

import { useMemo } from 'react'
import { Cron } from 'croner'
import type { NewChatAutonomousState } from './types'

// ============================================================================
// AutonomousRoomCard — schedule, budget, visibility, destructive-tool inputs
//
// Shared between the New Room form (components/new-chat/NewChatForm.tsx) and the
// Edit Enclave modal (components/new-chat/EditEnclaveModal.tsx). It is purely
// controlled: it reads `value` (a NewChatAutonomousState in human-friendly units
// — hours, minutes) and emits patches via `onChange`. Unit conversion to/from
// milliseconds happens at each caller's API boundary, never in here.
// ============================================================================

export interface AutonomousRoomCardProps {
  value: NewChatAutonomousState
  onChange: (patch: Partial<NewChatAutonomousState>) => void
  settingsHint?: {
    visibilityDefault?: 'owner_only' | 'household' | 'open'
    destructiveToolPolicy?: 'always_refuse' | 'opt_in_per_room'
    defaultFreshnessHours?: number
  }
  disabled: boolean
}

function tryCronNextRun(expr: string): { ok: true; next: Date | null } | { ok: false; error: string } {
  const trimmed = expr.trim()
  if (!trimmed) return { ok: true, next: null }
  try {
    const job = new Cron(trimmed)
    const next = job.nextRun(new Date())
    return { ok: true, next: next ?? null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid cron' }
  }
}

function visibilityDefaultLabel(v?: 'owner_only' | 'household' | 'open'): string {
  switch (v) {
    case 'household': return 'household'
    case 'open': return 'open'
    case 'owner_only':
    default: return 'owner only'
  }
}

export function AutonomousRoomCard({ value, onChange, settingsHint, disabled }: AutonomousRoomCardProps) {
  const cronResult = useMemo(() => tryCronNextRun(value.scheduleCron), [value.scheduleCron])
  const policyAlwaysRefuse = settingsHint?.destructiveToolPolicy === 'always_refuse'
  const freshnessPlaceholder = settingsHint?.defaultFreshnessHours
    ? `${settingsHint.defaultFreshnessHours} (your default)`
    : '12'

  const setNumber = (field: keyof NewChatAutonomousState, raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      onChange({ [field]: null } as Partial<NewChatAutonomousState>)
      return
    }
    const parsed = field === 'budgetEstimatedSpendCapUSD'
      ? Number.parseFloat(trimmed)
      : Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      onChange({ [field]: null } as Partial<NewChatAutonomousState>)
      return
    }
    onChange({ [field]: parsed } as Partial<NewChatAutonomousState>)
  }

  return (
    <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-5">
      <h3 className="qt-section-title">Autonomous Room</h3>

      <div>
        <label htmlFor="autonomous-cron" className="mb-2 block text-sm qt-text-primary">
          Schedule (cron, optional)
        </label>
        <input
          id="autonomous-cron"
          type="text"
          value={value.scheduleCron}
          onChange={(e) => onChange({ scheduleCron: e.target.value })}
          disabled={disabled}
          placeholder="0 4 * * *"
          className="qt-input font-mono"
        />
        <p className="mt-1 qt-text-xs qt-text-muted">
          Five-field cron in instance-local time (minute hour dom month dow). Leave blank to run only when started manually.
        </p>
        {value.scheduleCron.trim().length > 0 && (
          cronResult.ok ? (
            cronResult.next ? (
              <p className="mt-1 qt-text-xs qt-text-secondary">
                Next run: {cronResult.next.toLocaleString()}
              </p>
            ) : (
              <p className="mt-1 qt-text-xs qt-text-muted">
                Parses, but never fires from now.
              </p>
            )
          ) : (
            <p className="mt-1 qt-text-xs qt-text-destructive">
              Invalid cron: {cronResult.error}
            </p>
          )
        )}
      </div>

      <div>
        <label htmlFor="autonomous-freshness" className="mb-2 block text-sm qt-text-primary">
          Catch-up freshness window (hours)
        </label>
        <input
          id="autonomous-freshness"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value.scheduleFreshnessHours == null ? '' : String(value.scheduleFreshnessHours)}
          onChange={(e) => setNumber('scheduleFreshnessHours', e.target.value)}
          disabled={disabled}
          placeholder={freshnessPlaceholder}
          className="qt-input w-32"
        />
        <p className="mt-1 qt-text-xs qt-text-muted">
          How long after a missed scheduled slot the scheduler should still consider catching up. Blank = your default.
        </p>
      </div>

      <div>
        <p className="mb-2 block text-sm qt-text-primary">Budget caps (per run)</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="autonomous-budget-turns" className="block qt-text-xs qt-text-muted mb-1">Max turns</label>
            <input
              id="autonomous-budget-turns"
              type="text"
              inputMode="numeric"
              value={value.budgetMaxTurns == null ? '' : String(value.budgetMaxTurns)}
              onChange={(e) => setNumber('budgetMaxTurns', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input"
            />
          </div>
          <div>
            <label htmlFor="autonomous-budget-tokens" className="block qt-text-xs qt-text-muted mb-1">Max tokens</label>
            <input
              id="autonomous-budget-tokens"
              type="text"
              inputMode="numeric"
              value={value.budgetMaxTokens == null ? '' : String(value.budgetMaxTokens)}
              onChange={(e) => setNumber('budgetMaxTokens', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input"
            />
          </div>
          <div>
            <label htmlFor="autonomous-budget-wall" className="block qt-text-xs qt-text-muted mb-1">Max wall-clock (min)</label>
            <input
              id="autonomous-budget-wall"
              type="text"
              inputMode="numeric"
              value={value.budgetMaxWallClockMinutes == null ? '' : String(value.budgetMaxWallClockMinutes)}
              onChange={(e) => setNumber('budgetMaxWallClockMinutes', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input"
            />
          </div>
          <div className="col-span-2 md:col-span-3">
            <label htmlFor="autonomous-budget-spend" className="block qt-text-xs qt-text-muted mb-1">Spend cap (USD, optional)</label>
            <input
              id="autonomous-budget-spend"
              type="text"
              inputMode="decimal"
              value={value.budgetEstimatedSpendCapUSD == null ? '' : String(value.budgetEstimatedSpendCapUSD)}
              onChange={(e) => setNumber('budgetEstimatedSpendCapUSD', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input w-40"
            />
          </div>
        </div>
        <p className="mt-1 qt-text-xs qt-text-muted">
          The first cap to be reached draws the run toward its close; leave any blank to skip that cap.
          A cap is a courteous boundary, mind, and not a brick wall: should a run spend its allowance so
          abruptly that the near-end warning never sounds, the company are granted one last turn — a single
          grace round, a touch over budget — to bring the scene to a graceful rest rather than be cut off
          mid-sentence.
        </p>
        <label className="flex items-start gap-2 cursor-pointer mt-3">
          <input
            type="checkbox"
            checked={value.budgetExcludeCacheHits}
            onChange={(e) => onChange({ budgetExcludeCacheHits: e.target.checked })}
            disabled={disabled}
            className="qt-checkbox mt-1"
          />
          <span>
            <span className="qt-text-small font-medium text-foreground">Count only the dear tokens</span>
            <span className="block qt-text-xs qt-text-muted mt-1">
              When ticked, the token cap tallies only the costly cache-miss input and the
              completion — the tokens you truly pay full freight for. Untick it to count
              every token against the cap, prompt-cache hits and all, as the ledger once did.
            </span>
          </span>
        </label>
      </div>

      <div>
        <p className="mb-2 block text-sm qt-text-primary">Visibility</p>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility == null}
              onChange={() => onChange({ runVisibility: null })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">
              Inherit your default <span className="qt-text-muted">(currently: {visibilityDefaultLabel(settingsHint?.visibilityDefault)})</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility === 'owner_only'}
              onChange={() => onChange({ runVisibility: 'owner_only' })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">Owner only — hidden from the main Salon list</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility === 'household'}
              onChange={() => onChange({ runVisibility: 'household' })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">Household — visible per chat-sharing rules</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility === 'open'}
              onChange={() => onChange({ runVisibility: 'open' })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">Open — always visible in the Salon list</span>
          </label>
        </div>
      </div>

      <div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.runDestructiveToolsAllowed && !policyAlwaysRefuse}
            onChange={(e) => onChange({ runDestructiveToolsAllowed: e.target.checked })}
            disabled={disabled || policyAlwaysRefuse}
            className="qt-checkbox mt-1"
          />
          <span>
            <span className="qt-text-small font-medium text-foreground">Pre-authorize destructive tools</span>
            <span className="block qt-text-xs qt-text-muted mt-1">
              Allows tools like <code>doc_delete_file</code> and <code>doc_delete_folder</code> in this room.
              {policyAlwaysRefuse && (
                <> Your user-level policy is set to <em>always refuse</em>; this cannot be overridden per room.</>
              )}
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}
