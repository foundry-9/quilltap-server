'use client'

/**
 * ScenarioEditorModal — modal for creating or editing a scenario file.
 *
 * Wraps the reusable `MarkdownLexicalEditor` with name / description / default
 * fields, plus filename for the create flow. Save persists via the parent's
 * `onSave` callback (which routes to a scope-specific `createScenario` or
 * `updateScenario` mutator — project- or general-scoped).
 *
 * Built on top of `BaseModal`, which portals to `document.body` so the modal
 * escapes the qt-page-container's stacking context.
 *
 * @module components/scenarios/ScenarioEditorModal
 */

import { useEffect, useMemo, useState } from 'react'
import BaseModal from '@/components/ui/BaseModal'
import FormActions from '@/components/ui/FormActions'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import type { Scenario } from './types'

interface ScenarioEditorModalProps {
  isOpen: boolean
  /** Existing scenario being edited; null when creating. */
  scenario: Scenario | null
  /** Label used in the "Use this scenario as the {scope} default" checkbox. */
  defaultScopeLabel?: string
  onClose: () => void
  onSave: (input: {
    filename?: string  // only for create
    name: string
    description?: string
    isDefault: boolean
    body: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function ScenarioEditorModal({
  isOpen,
  scenario,
  defaultScopeLabel = 'default',
  onClose,
  onSave,
}: ScenarioEditorModalProps) {
  const isEdit = scenario !== null
  const [filename, setFilename] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    /* eslint-disable react-hooks/set-state-in-effect -- syncs local form state to parent-driven scenario prop on modal open */
    if (scenario) {
      setFilename(scenario.filename)
      setName(scenario.name)
      setDescription(scenario.description ?? '')
      setIsDefault(scenario.isDefault)
      setBody(scenario.body)
    } else {
      setFilename('')
      setName('')
      setDescription('')
      setIsDefault(false)
      setBody('')
    }
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, scenario])

  const remountKey = useMemo(
    () => (scenario ? `edit:${scenario.path}` : 'new'),
    [scenario],
  )

  async function handleSave() {
    if (saving) return
    setError(null)

    const trimmedBody = body.trim()
    if (trimmedBody.length === 0) {
      setError('Scenario body cannot be empty.')
      return
    }
    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      setError('Scenario must have a name.')
      return
    }
    if (!isEdit) {
      const trimmedFilename = filename.trim()
      if (trimmedFilename.length === 0) {
        setError('Filename is required.')
        return
      }
    }

    setSaving(true)
    try {
      const result = await onSave({
        ...(isEdit ? {} : { filename: filename.trim() }),
        name: trimmedName,
        ...(description.trim().length > 0 && { description: description.trim() }),
        isDefault,
        body: trimmedBody,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Edit scenario — ${scenario?.name}` : 'New scenario'}
      maxWidth="3xl"
      showCloseButton
      closeOnClickOutside={false}
      footer={
        <FormActions
          onCancel={onClose}
          onSubmit={handleSave}
          submitLabel={isEdit ? 'Save changes' : 'Create scenario'}
          isLoading={saving}
        />
      }
    >
      <div className="space-y-4">
        {!isEdit && (
          <div>
            <label className="qt-text-label block mb-1" htmlFor="scenario-filename">
              Filename
            </label>
            <p className="qt-text-xs qt-text-secondary mb-1">
              Used as the file&apos;s name on disk (without `.md`). Allowed characters only; spaces are kept.
            </p>
            <input
              id="scenario-filename"
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="qt-input w-full"
              placeholder="welcome-to-the-estate"
              maxLength={100}
            />
          </div>
        )}

        <div>
          <label className="qt-text-label block mb-1" htmlFor="scenario-name">
            Name
          </label>
          <p className="qt-text-xs qt-text-secondary mb-1">
            Display title used in the new-chat dropdown.
            {isEdit && (
              <> Stored in the file&apos;s frontmatter; if absent, the filename stands in.</>
            )}
          </p>
          <input
            id="scenario-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="qt-input w-full"
            placeholder="Welcome to the Estate"
            maxLength={200}
          />
        </div>

        <div>
          <label className="qt-text-label block mb-1" htmlFor="scenario-description">
            Description (optional)
          </label>
          <p className="qt-text-xs qt-text-secondary mb-1">
            One-line subtitle shown beneath the name in the dropdown.
          </p>
          <input
            id="scenario-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="qt-input w-full"
            placeholder="A summer evening at the great estate."
            maxLength={500}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="scenario-default"
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="qt-checkbox"
          />
          <label htmlFor="scenario-default" className="qt-text-small">
            Use this scenario as the {defaultScopeLabel} default for new chats
          </label>
        </div>

        <div>
          <label className="qt-text-label block mb-1">
            Scenario body
          </label>
          <p className="qt-text-xs qt-text-secondary mb-2">
            The text that&apos;s woven into the system prompt. <code>{'{{char}}'}</code> and <code>{'{{user}}'}</code> are substituted at chat time.
          </p>
          <MarkdownLexicalEditor
            value={body}
            onChange={setBody}
            remountKey={remountKey}
            namespace="ScenarioEditor"
            ariaLabel="Scenario body"
            className="qt-bg-input qt-border rounded"
          />
        </div>

        {error && (
          <div className="qt-text-destructive text-sm" role="alert">
            {error}
          </div>
        )}
      </div>
    </BaseModal>
  )
}
