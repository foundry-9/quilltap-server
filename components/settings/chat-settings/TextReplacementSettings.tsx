'use client'

/**
 * TextReplacementSettings
 *
 * Chat-tab settings UI for the Layer 1.5 word-boundary text-replacement
 * feature. Combines a master on/off toggle (persisted via the chat-settings
 * hook) with a CRUD editor for the global rule list (persisted via the
 * /api/v1/settings/text-replacements REST endpoints).
 */

import { useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch, ApiFetchError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import {
  useTextReplacementRules,
  findReplacement,
} from '@/lib/text-replacement/useTextReplacementRules'
import type { TextReplacementRule } from '@/lib/schemas/text-replacement.types'
import { TEXT_REPLACEMENT_TRIGGER_CHARS, isTextReplacementBoundary } from '@/lib/text-replacement/boundary'
import { DEFAULT_TEXT_REPLACEMENTS_ENABLED, type ChatSettings } from './types'
import { useTryItTextarea } from './hooks/useTryItTextarea'
import { SettingsToggleRow } from './components/SettingsToggleRow'

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

const RULES_URL = '/api/v1/settings/text-replacements'

/** The server's sentence, else what could not be done and the HTTP status. */
function ruleErrorMessage(err: unknown, verb: 'add' | 'update' | 'delete'): string {
  const fallback = err instanceof ApiFetchError ? `Failed to ${verb} rule (HTTP ${err.status})` : `Failed to ${verb} rule.`
  return apiErrorMessage(err, fallback)
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
  const enabled = settings.textReplacementsEnabled ?? DEFAULT_TEXT_REPLACEMENTS_ENABLED
  const { rules, isLoading, compiled } = useTextReplacementRules()

  const [form, setForm] = useState<NewRuleForm>(EMPTY_FORM)
  const [addError, setAddError] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const refreshRules = () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.textReplacements })

  const addRule = useMutation({
    mutationFn: (body: NewRuleForm) =>
      apiFetch(RULES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm(EMPTY_FORM)
      return refreshRules()
    },
  })

  const patchRule = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TextReplacementRule> }) =>
      apiFetch(`${RULES_URL}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onError: (err) => {
      console.error('[TextReplacementSettings] patch failed', ruleErrorMessage(err, 'update'))
    },
    // On failure too: re-fetch to restore the on-screen value to whatever the server has.
    onSettled: () => refreshRules(),
  })

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiFetch(`${RULES_URL}/${id}`, { method: 'DELETE' }),
    onSuccess: () => refreshRules(),
    onError: (err) => {
      console.error('[TextReplacementSettings] delete failed', ruleErrorMessage(err, 'delete'))
    },
  })

  const busy = addRule.isPending || patchRule.isPending || deleteRule.isPending

  const { text: tryText, setText: setTryText, ref: tryRef, rewrite: rewriteTry } = useTryItTextarea()

  const handleTryItKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Mirror the plugin's bail conditions exactly so the preview is faithful
    // to what the live composer will do.
    if (!enabled) return
    if (compiled.empty) return
    if (e.nativeEvent.isComposing) return
    if (!TEXT_REPLACEMENT_TRIGGER_CHARS.has(e.key)) return

    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start !== end) return // collapsed selection only

    const value = ta.value
    // Skip mid-word edits — only fire when the cursor sits at the end of a
    // word (next char is either EOF or another boundary char).
    const nextChar = value[start]
    if (nextChar !== undefined && !isTextReplacementBoundary(nextChar)) return

    let wordStart = start
    while (wordStart > 0 && !isTextReplacementBoundary(value[wordStart - 1])) wordStart--
    if (wordStart === start) return // cursor sits on a boundary

    const word = value.slice(wordStart, start)
    const replacement = findReplacement(word, compiled)
    if (replacement === undefined) return

    e.preventDefault()
    const triggerChar = e.key
    const newValue =
      value.slice(0, wordStart) + replacement + triggerChar + value.slice(start)
    const cursor = wordStart + replacement.length + triggerChar.length
    rewriteTry(newValue, cursor)
  }

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    setAddError(null)
    const fromText = form.fromText.trim()
    const toText = form.toText
    if (!fromText || !toText) {
      setAddError('Both trigger and replacement are required.')
      return
    }
    try {
      await addRule.mutateAsync({ fromText, toText, caseSensitive: form.caseSensitive })
    } catch (err) {
      setAddError(ruleErrorMessage(err, 'add'))
    }
  }

  const handlePatch = (id: string, patch: Partial<TextReplacementRule>) => {
    patchRule.mutate({ id, patch })
  }

  const handleDelete = (id: string) => {
    deleteRule.mutate(id)
  }

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <SettingsToggleRow
        checked={enabled}
        disabled={saving}
        onChange={onMasterToggleChange}
        heading="Text replacement (autocorrect)"
      >
        Replaces literal triggers with replacement text on word boundaries (space, tab,
        and the usual terminal punctuation) as you type in the Salon composer and the
        Document Mode rich editor. Pure literal matching — no snippets, no regex. One
        Cmd/Ctrl+Z reverts a replacement. Source-mode editors (raw Markdown, plain text)
        are unaffected.
      </SettingsToggleRow>

      {/* Add new rule */}
      <form
        onSubmit={handleAdd}
        className="qt-settings-shell space-y-3"
        aria-label="Add a text-replacement rule"
      >
        <div className="qt-settings-section-heading">Add a rule</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,auto] gap-2 items-end">
          <label className="flex flex-col gap-1">
            <span className="qt-text-small qt-text-secondary">Trigger</span>
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
            <span className="qt-text-small qt-text-secondary">Replacement</span>
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
        {addError && <div className="qt-text-small qt-text-destructive">{addError}</div>}
      </form>

      {/* Existing rules */}
      <div className="qt-settings-shell p-0">
        <div className="p-4 border-b qt-border-default">
          <div className="qt-settings-section-heading">Rules</div>
          <div className="qt-text-small qt-text-secondary">
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
          <div className="p-4 qt-text-small qt-text-secondary italic">
            No rules yet — add one above.
          </div>
        ) : null}
      </div>

      {/* Try-it textarea */}
      <div className="qt-settings-shell qt-settings-field-group">
        <div className="qt-settings-section-heading">Try it</div>
        <div className="qt-text-small qt-text-secondary">
          Type here and add a trigger character (space, period, etc.) to see your rules
          fire. This box does not save anything.
          {!enabled && ' (Master toggle is off — replacements are paused.)'}
        </div>
        <textarea
          aria-label="Try text replacement"
          ref={tryRef}
          value={tryText}
          onChange={(e) => setTryText(e.target.value)}
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
  onPatch: (patch: Partial<TextReplacementRule>) => void
  onDelete: () => void
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
        aria-label="Replace this text"
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
        aria-label="With this text"
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
