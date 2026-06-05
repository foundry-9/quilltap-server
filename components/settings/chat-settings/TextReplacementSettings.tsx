'use client'

/**
 * TextReplacementSettings
 *
 * Chat-tab settings UI for the Layer 1.5 word-boundary text-replacement
 * feature. Combines a master on/off toggle (persisted via the chat-settings
 * hook) with a CRUD editor for the global rule list (persisted via the
 * /api/v1/settings/text-replacements REST endpoints).
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  useTextReplacementRules,
  findReplacement,
} from '@/lib/text-replacement/useTextReplacementRules'
import type { TextReplacementRule } from '@/lib/schemas/text-replacement.types'
import type { ChatSettings } from './types'

/**
 * Word-boundary trigger characters. Mirrors the set in
 * `components/chat/lexical/plugins/TextReplacementPlugin.tsx`. Newline is
 * intentionally excluded — see the plugin for the rationale.
 */
const TRIGGER_CHARS = new Set([' ', ' ', '\t', '.', ',', ';', ':', '!', '?', ')'])
const isBoundaryChar = (ch: string): boolean => TRIGGER_CHARS.has(ch)

export interface TextReplacementSettingsProps {
  settings: ChatSettings
  saving: boolean
  onMasterToggleChange: (value: boolean) => Promise<void>
}

interface NewRuleForm {
  fromText: string
  toText: string
  caseSensitive: boolean
}

const EMPTY_FORM: NewRuleForm = {
  fromText: '',
  toText: '',
  caseSensitive: false,
}

export function TextReplacementSettings({
  settings,
  saving,
  onMasterToggleChange,
}: TextReplacementSettingsProps) {
  const enabled = settings.textReplacementsEnabled ?? true
  const { rules, isLoading, mutate, compiled } = useTextReplacementRules()

  const [form, setForm] = useState<NewRuleForm>(EMPTY_FORM)
  const [addError, setAddError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tryItText, setTryItText] = useState('')
  const tryItRef = useRef<HTMLTextAreaElement>(null)
  /** Pending cursor position to set after a replacement-triggered re-render. */
  const tryItPendingCursor = useRef<number | null>(null)

  const handleTryItKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Mirror the plugin's bail conditions exactly so the preview is faithful
    // to what the live composer will do.
    if (!enabled) return
    if (compiled.empty) return
    if (e.nativeEvent.isComposing) return
    if (!TRIGGER_CHARS.has(e.key)) return

    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start !== end) return // collapsed selection only

    const value = ta.value
    // Skip mid-word edits — only fire when the cursor sits at the end of a
    // word (next char is either EOF or another boundary char).
    const nextChar = value[start]
    if (nextChar !== undefined && !isBoundaryChar(nextChar)) return

    let wordStart = start
    while (wordStart > 0 && !isBoundaryChar(value[wordStart - 1])) wordStart--
    if (wordStart === start) return // cursor sits on a boundary

    const word = value.slice(wordStart, start)
    const replacement = findReplacement(word, compiled)
    if (replacement === undefined) return

    e.preventDefault()
    const triggerChar = e.key
    const newValue =
      value.slice(0, wordStart) + replacement + triggerChar + value.slice(start)
    const cursor = wordStart + replacement.length + triggerChar.length
    tryItPendingCursor.current = cursor
    setTryItText(newValue)
  }

  // After a replacement-triggered re-render, restore the cursor position.
  // Plain state change otherwise leaves the cursor at end-of-textarea.
  useEffect(() => {
    if (tryItPendingCursor.current === null) return
    const pos = tryItPendingCursor.current
    tryItPendingCursor.current = null
    const ta = tryItRef.current
    if (!ta) return
    ta.selectionStart = pos
    ta.selectionEnd = pos
  }, [tryItText])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    setAddError(null)
    const fromText = form.fromText.trim()
    const toText = form.toText
    if (!fromText || !toText) {
      setAddError('Both trigger and replacement are required.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/v1/settings/text-replacements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromText, toText, caseSensitive: form.caseSensitive }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to add rule (HTTP ${res.status})`)
      }
      setForm(EMPTY_FORM)
      await mutate()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add rule.')
    } finally {
      setBusy(false)
    }
  }

  const handlePatch = async (id: string, patch: Partial<TextReplacementRule>) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/settings/text-replacements/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to update rule (HTTP ${res.status})`)
      }
      await mutate()
    } catch (err) {
      console.error('[TextReplacementSettings] patch failed', err)
      // Re-fetch to restore the on-screen value to whatever the server has.
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/settings/text-replacements/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to delete rule (HTTP ${res.status})`)
      }
      await mutate()
    } catch (err) {
      console.error('[TextReplacementSettings] delete failed', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <label className="qt-settings-toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onMasterToggleChange(e.target.checked)}
          disabled={saving}
          className="qt-checkbox mt-1"
        />
        <div className="flex-1">
          <div className="qt-settings-section-heading">Text replacement (autocorrect)</div>
          <div className="qt-text-small mt-1">
            Replaces literal triggers with replacement text on word boundaries (space, tab,
            and the usual terminal punctuation) as you type in the Salon composer and the
            Document Mode rich editor. Pure literal matching — no snippets, no regex. One
            Cmd/Ctrl+Z reverts a replacement. Source-mode editors (raw Markdown, plain text)
            are unaffected.
          </div>
        </div>
      </label>

      {/* Add new rule */}
      <form
        onSubmit={handleAdd}
        className="qt-settings-shell space-y-3"
        aria-label="Add a text-replacement rule"
      >
        <div className="qt-settings-section-heading">Add a rule</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,auto] gap-2 items-end">
          <label className="flex flex-col gap-1">
            <span className="qt-text-small text-muted-foreground">Trigger</span>
            <input
              type="text"
              value={form.fromText}
              onChange={(e) => setForm({ ...form, fromText: e.target.value })}
              maxLength={100}
              placeholder="e.g. teh"
              className="qt-input"
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="qt-text-small text-muted-foreground">Replacement</span>
            <input
              type="text"
              value={form.toText}
              onChange={(e) => setForm({ ...form, toText: e.target.value })}
              maxLength={1000}
              placeholder="e.g. the"
              className="qt-input"
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !form.fromText.trim() || !form.toText}
            className="qt-button-primary self-end"
          >
            Add
          </button>
        </div>
        <label className="flex items-center gap-2 qt-text-small">
          <input
            type="checkbox"
            checked={form.caseSensitive}
            onChange={(e) => setForm({ ...form, caseSensitive: e.target.checked })}
            disabled={busy}
            className="qt-checkbox"
          />
          <span>Case-sensitive</span>
        </label>
        {addError && <div className="qt-text-small text-destructive">{addError}</div>}
      </form>

      {/* Existing rules */}
      <div className="qt-settings-shell p-0">
        <div className="p-4 border-b qt-border-default">
          <div className="qt-settings-section-heading">Rules</div>
          <div className="qt-text-small text-muted-foreground">
            {isLoading
              ? 'Loading…'
              : `${rules?.length ?? 0} rule${(rules?.length ?? 0) === 1 ? '' : 's'} defined.`}
          </div>
        </div>
        {rules && rules.length > 0 ? (
          <ul>
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onPatch={(patch) => handlePatch(rule.id, patch)}
                onDelete={() => handleDelete(rule.id)}
                disabled={busy}
              />
            ))}
          </ul>
        ) : !isLoading ? (
          <div className="p-4 qt-text-small text-muted-foreground italic">
            No rules yet — add one above.
          </div>
        ) : null}
      </div>

      {/* Try-it textarea */}
      <div className="qt-settings-shell qt-settings-field-group">
        <div className="qt-settings-section-heading">Try it</div>
        <div className="qt-text-small text-muted-foreground">
          Type here and add a trigger character (space, period, etc.) to see your rules
          fire. This box does not save anything.
          {!enabled && ' (Master toggle is off — replacements are paused.)'}
        </div>
        <textarea
          ref={tryItRef}
          value={tryItText}
          onChange={(e) => setTryItText(e.target.value)}
          onKeyDown={handleTryItKeyDown}
          rows={3}
          className="qt-input w-full"
          placeholder="Type a trigger word, then press space…"
        />
      </div>
    </div>
  )
}

interface RuleRowProps {
  rule: TextReplacementRule
  onPatch: (patch: Partial<TextReplacementRule>) => Promise<void>
  onDelete: () => Promise<void>
  disabled: boolean
}

function RuleRow({ rule, onPatch, onDelete, disabled }: RuleRowProps) {
  const [fromText, setFromText] = useState(rule.fromText)
  const [toText, setToText] = useState(rule.toText)

  const commitFromText = () => {
    const next = fromText.trim()
    if (next && next !== rule.fromText) {
      onPatch({ fromText: next })
    } else if (next !== fromText) {
      setFromText(next)
    }
  }

  const commitToText = () => {
    if (toText && toText !== rule.toText) {
      onPatch({ toText })
    }
  }

  return (
    <li className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,auto,auto,auto] gap-2 items-center p-3 border-t qt-border-default first:border-t-0">
      <input
        type="text"
        value={fromText}
        onChange={(e) => setFromText(e.target.value)}
        onBlur={commitFromText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitFromText()
          }
        }}
        maxLength={100}
        className="qt-input"
        disabled={disabled}
      />
      <input
        type="text"
        value={toText}
        onChange={(e) => setToText(e.target.value)}
        onBlur={commitToText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitToText()
          }
        }}
        maxLength={1000}
        className="qt-input"
        disabled={disabled}
      />
      <label className="flex items-center gap-1 qt-text-small whitespace-nowrap">
        <input
          type="checkbox"
          checked={rule.caseSensitive}
          onChange={(e) => onPatch({ caseSensitive: e.target.checked })}
          disabled={disabled}
          className="qt-checkbox"
        />
        <span>Case</span>
      </label>
      <label className="flex items-center gap-1 qt-text-small whitespace-nowrap">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onPatch({ enabled: e.target.checked })}
          disabled={disabled}
          className="qt-checkbox"
        />
        <span>On</span>
      </label>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="qt-button-secondary"
        aria-label={`Delete rule for "${rule.fromText}"`}
      >
        Delete
      </button>
    </li>
  )
}
