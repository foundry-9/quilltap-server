'use client'

import { useState, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showAlert } from '@/lib/alert'

interface ReplacementPair {
  id: string
  oldValue: string
  newValue: string
  caseSensitive: boolean
}

interface ReplacementResult {
  field: string
  location: string
  oldText: string
  newText: string
  context?: string
}

interface RenameSummary {
  characterFields: number
  physicalDescriptions: number
  memories: number
  chatTitles: number
  chatMessages: number
  total: number
}

interface RenamePreviewResponse {
  characterId: string
  characterName: string
  dryRun: boolean
  replacements: ReplacementResult[]
  summary: RenameSummary
}

interface RenameReplaceTabProps {
  characterId: string
  characterName: string
  onRenameComplete?: () => void
}

export function RenameReplaceTab({ characterId, characterName, onRenameComplete }: RenameReplaceTabProps) {
  // Primary name replacement
  const [newName, setNewName] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  // Additional replacements for nicknames/aliases
  const [additionalReplacements, setAdditionalReplacements] = useState<ReplacementPair[]>([])

  // Preview state
  const [preview, setPreview] = useState<RenamePreviewResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addAdditionalReplacement = useCallback(() => {
    setAdditionalReplacements(prev => [
      ...prev,
      { id: crypto.randomUUID(), oldValue: '', newValue: '', caseSensitive: false }
    ])
  }, [])

  const removeAdditionalReplacement = useCallback((id: string) => {
    setAdditionalReplacements(prev => prev.filter(r => r.id !== id))
  }, [])

  const updateAdditionalReplacement = useCallback((id: string, field: keyof ReplacementPair, value: string | boolean) => {
    setAdditionalReplacements(prev =>
      prev.map(r => r.id === id ? { ...r, [field]: value } : r)
    )
  }, [])

  const handlePreview = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setPreview(null)

    try {
      const body: any = {
        dryRun: true,
        additionalReplacements: additionalReplacements
          .filter(r => r.oldValue.trim() && r.newValue.trim())
          .map(r => ({
            oldValue: r.oldValue,
            newValue: r.newValue,
            caseSensitive: r.caseSensitive,
          })),
      }

      // Only include primary rename if new name is provided
      if (newName.trim()) {
        body.primaryRename = {
          oldValue: characterName,
          newValue: newName.trim(),
          caseSensitive,
        }
      }

      const res = await fetch(`/api/v1/characters/${characterId}?action=rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to preview changes')
      }

      const data: RenamePreviewResponse = await res.json()
      setPreview(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Preview failed', { error: message })
    } finally {
      setIsLoading(false)
    }
  }, [characterId, characterName, newName, caseSensitive, additionalReplacements])

  const handleExecute = useCallback(async () => {
    if (!preview) return

    const result = await showAlert(
      `Are you sure you want to rename this character and update ${preview.summary.total} occurrences? This action cannot be undone.`,
      ['Execute', 'Cancel']
    )

    if (result !== 'Execute') {
      return
    }

    setIsExecuting(true)
    setError(null)

    try {
      const body: any = {
        dryRun: false,
        additionalReplacements: additionalReplacements
          .filter(r => r.oldValue.trim() && r.newValue.trim())
          .map(r => ({
            oldValue: r.oldValue,
            newValue: r.newValue,
            caseSensitive: r.caseSensitive,
          })),
      }

      if (newName.trim()) {
        body.primaryRename = {
          oldValue: characterName,
          newValue: newName.trim(),
          caseSensitive,
        }
      }

      const res = await fetch(`/api/v1/characters/${characterId}?action=rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to execute rename')
      }

      const data: RenamePreviewResponse = await res.json()
      showSuccessToast(`Successfully updated ${data.summary.total} occurrences!`)

      // Reset form
      setNewName('')
      setAdditionalReplacements([])
      setPreview(null)

      // Notify parent component
      if (onRenameComplete) {
        onRenameComplete()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      showErrorToast(message)
      console.error('Rename execution failed', { error: message })
    } finally {
      setIsExecuting(false)
    }
  }, [characterId, characterName, newName, caseSensitive, additionalReplacements, preview, onRenameComplete])

  const hasValidInput = newName.trim() || additionalReplacements.some(r => r.oldValue.trim() && r.newValue.trim())

  return (
    <div className="space-y-6">
      {/* Primary Name Change Section */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
        <h3 className="qt-text-section mb-4 text-gray-900 dark:text-white">
          Rename Character
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Change this character&apos;s name across all associated data including details, physical descriptions, memories, and chat conversations.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block qt-text-label mb-2 text-gray-700 dark:text-gray-300">
              Current Name
            </label>
            <input
              type="text"
              value={characterName}
              disabled
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block qt-text-label mb-2 text-gray-700 dark:text-gray-300">
              New Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter new name"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
          />
          Case sensitive matching
        </label>
      </div>

      {/* Additional Replacements Section */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="qt-text-section text-gray-900 dark:text-white">
              Additional Replacements
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Replace nicknames, aliases, or other terms associated with this character.
            </p>
          </div>
          <button
            type="button"
            onClick={addAdditionalReplacement}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>
        </div>

        {additionalReplacements.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic py-4 text-center">
            No additional replacements. Click &quot;Add&quot; to add nicknames or aliases to replace.
          </p>
        ) : (
          <div className="space-y-3">
            {additionalReplacements.map((replacement, index) => (
              <div
                key={replacement.id}
                className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg"
              >
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block qt-text-label-xs mb-1 text-gray-600 dark:text-gray-400">
                      Find
                    </label>
                    <input
                      type="text"
                      value={replacement.oldValue}
                      onChange={(e) => updateAdditionalReplacement(replacement.id, 'oldValue', e.target.value)}
                      placeholder="e.g., Snips"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block qt-text-label-xs mb-1 text-gray-600 dark:text-gray-400">
                      Replace with
                    </label>
                    <input
                      type="text"
                      value={replacement.newValue}
                      onChange={(e) => updateAdditionalReplacement(replacement.id, 'newValue', e.target.value)}
                      placeholder="e.g., Ace"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2 pt-5">
                  <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400" title="Case sensitive">
                    <input
                      type="checkbox"
                      checked={replacement.caseSensitive}
                      onChange={(e) => updateAdditionalReplacement(replacement.id, 'caseSensitive', e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 dark:border-slate-600 text-blue-600"
                    />
                    Aa
                  </label>
                  <button
                    type="button"
                    onClick={() => removeAdditionalReplacement(replacement.id)}
                    className="p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    title="Remove"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="qt-alert-error px-4 py-3 rounded-lg border">
          {error}
        </div>
      )}

      {/* Preview Button */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!hasValidInput || isLoading || isExecuting}
          className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {isLoading ? 'Loading Preview...' : 'Preview Changes'}
        </button>
      </div>

      {/* Preview Results */}
      {preview && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <h3 className="qt-text-section mb-4 text-gray-900 dark:text-white">
            Preview Results
          </h3>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded p-3 text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{preview.summary.characterFields}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Character Fields</div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded p-3 text-center">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{preview.summary.physicalDescriptions}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Descriptions</div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded p-3 text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{preview.summary.memories}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Memories</div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded p-3 text-center">
              <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{preview.summary.chatTitles}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Chat Titles</div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded p-3 text-center">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{preview.summary.chatMessages}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Messages</div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded p-3 text-center border border-blue-200 dark:border-blue-700">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{preview.summary.total}</div>
              <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">Total</div>
            </div>
          </div>

          {/* Detailed Replacements */}
          {preview.replacements.length > 0 ? (
            <div className="mb-4">
              <h4 className="qt-text-label mb-2 text-gray-700 dark:text-gray-300">
                Replacements ({preview.replacements.length})
              </h4>
              <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-700 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-400">Location</th>
                      <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-400">Field</th>
                      <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-400">Change</th>
                      <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-400">Context</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {preview.replacements.slice(0, 100).map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{r.location}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">{r.field}</td>
                        <td className="px-3 py-2">
                          <span className="text-red-600 dark:text-red-400 line-through">{r.oldText}</span>
                          <span className="mx-1 text-gray-400">→</span>
                          <span className="text-green-600 dark:text-green-400">{r.newText}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs max-w-xs truncate" title={r.context}>
                          {r.context}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.replacements.length > 100 && (
                  <div className="px-3 py-2 bg-gray-50 dark:bg-slate-700 text-sm text-gray-600 dark:text-gray-400 text-center">
                    ...and {preview.replacements.length - 100} more
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No occurrences found for the specified replacements.
            </div>
          )}

          {/* Execute Button */}
          {preview.summary.total > 0 && (
            <button
              type="button"
              onClick={handleExecute}
              disabled={isExecuting || isLoading}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isExecuting ? 'Executing...' : `Execute ${preview.summary.total} Replacements`}
            </button>
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="qt-alert-info border rounded-lg p-4">
        <h4 className="qt-text-label mb-2">
          How this works
        </h4>
        <ul className="text-sm space-y-1 list-disc list-inside">
          <li>Enter a new name to rename the character across all associated data</li>
          <li>Add additional replacements for nicknames or aliases (e.g., &quot;Snips&quot; → &quot;Ace&quot;)</li>
          <li>Click &quot;Preview Changes&quot; to see what will be affected before making changes</li>
          <li>All replacements are made within: character details, physical descriptions, memories, and chat conversations</li>
          <li>Only data directly associated with this character will be modified</li>
        </ul>
      </div>
    </div>
  )
}
