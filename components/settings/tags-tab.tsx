'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useTagStyles } from '@/components/providers/tag-style-provider'
import { DEFAULT_TAG_STYLE, mergeWithDefaultTagStyle } from '@/lib/tags/styles'
import type { TagVisualStyle } from '@/lib/schemas/types'
import { TagBadge } from '@/components/tags/tag-badge'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

interface ChatSettings {
  id: string
  userId: string
  tagStyles: Record<string, TagVisualStyle>
  createdAt: string
  updatedAt: string
}

interface TagOption {
  id: string
  name: string
  quickHide?: boolean
}

export default function TagsTab() {
  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [tagSaving, setTagSaving] = useState(false)
  const [tagOptions, setTagOptions] = useState<TagOption[]>([])
  const [selectedTagId, setSelectedTagId] = useState('')
  const [quickHideSavingId, setQuickHideSavingId] = useState<string | null>(null)
  const { updateStyles: syncTagStyleContext } = useTagStyles()
  const { refresh: refreshQuickHideTags } = useQuickHide()
  const tagFetchIdRef = useRef(0)

  const tagStyles = useMemo(() => settings?.tagStyles ?? {}, [settings?.tagStyles])

  const applyLocalTagStyles = useCallback((nextStyles: Record<string, TagVisualStyle>) => {
    setSettings((prev) => (prev ? { ...prev, tagStyles: nextStyles } : prev))
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/chat-settings')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      setSettings(data)
      syncTagStyleContext(data.tagStyles ?? {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [syncTagStyleContext])

  const fetchTags = useCallback(async () => {
    const requestId = ++tagFetchIdRef.current
    try {
      const res = await fetch('/api/tags', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error('Failed to load tags')
      }
      const data = await res.json()
      if (tagFetchIdRef.current === requestId) {
        setTagOptions((data.tags || []).map((tag: any) => ({
          id: tag.id,
          name: tag.name,
          quickHide: Boolean(tag.quickHide),
        })))
      }
    } catch (err) {
      clientLogger.error('Error loading tags', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchTags()
  }, [fetchSettings, fetchTags])

  const persistTagStyles = useCallback(async (nextStyles: Record<string, TagVisualStyle>) => {
    if (!settings) return

    try {
      setTagSaving(true)
      setError(null)
      setSuccess(false)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagStyles: nextStyles }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update tag styles')
      }

      const updatedSettings = await res.json()
      setSettings(updatedSettings)
      syncTagStyleContext(updatedSettings.tagStyles ?? {})
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setTagSaving(false)
    }
  }, [settings, syncTagStyleContext])

  const handleTagStyleFieldChange = useCallback((tagId: string, updates: Partial<TagVisualStyle>) => {
    if (!settings) return

    const merged = mergeWithDefaultTagStyle(tagStyles[tagId])
    const nextStyles = {
      ...tagStyles,
      [tagId]: {
        ...merged,
        ...updates,
      },
    }

    applyLocalTagStyles(nextStyles)
    persistTagStyles(nextStyles)
  }, [applyLocalTagStyles, persistTagStyles, settings, tagStyles])

  const handleRemoveTagStyle = useCallback((tagId: string) => {
    if (!settings || !tagStyles[tagId]) return
    const { [tagId]: _removed, ...rest } = tagStyles
    applyLocalTagStyles(rest)
    persistTagStyles(rest)
  }, [applyLocalTagStyles, persistTagStyles, settings, tagStyles])

  const handleAddTagStyle = useCallback(() => {
    if (!selectedTagId || !settings) return
    const nextStyles = {
      ...tagStyles,
      [selectedTagId]: { ...DEFAULT_TAG_STYLE },
    }
    applyLocalTagStyles(nextStyles)
    persistTagStyles(nextStyles)
    setSelectedTagId('')
  }, [applyLocalTagStyles, persistTagStyles, selectedTagId, settings, tagStyles])

  const handleQuickHideToggle = useCallback(
    async (tagId: string, nextValue: boolean) => {
      setQuickHideSavingId(tagId)
      setError(null)
      try {
        const res = await fetch(`/api/tags/${tagId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quickHide: nextValue }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update quick-hide')
        }

        const { tag } = await res.json()
        setTagOptions(prev =>
          prev.map(option =>
            option.id === tagId ? { ...option, quickHide: tag.quickHide } : option
          )
        )
        await refreshQuickHideTags()
      } catch (err) {
        clientLogger.error('Error toggling quick-hide', { error: err instanceof Error ? err.message : String(err) })
        setError(err instanceof Error ? err.message : 'Failed to update quick-hide')
      } finally {
        setQuickHideSavingId(current => (current === tagId ? null : current))
      }
    },
    [refreshQuickHideTags]
  )

  const tagLabelLookup = useMemo(() => {
    const entries = new Map<string, string>()
    for (const tag of tagOptions) {
      entries.set(tag.id, tag.name)
    }
    return entries
  }, [tagOptions])

  const tagMetadataLookup = useMemo(() => {
    const entries = new Map<string, TagOption>()
    for (const tag of tagOptions) {
      entries.set(tag.id, tag)
    }
    return entries
  }, [tagOptions])

  const availableForStyling = useMemo(
    () => tagOptions.filter((tag) => !tagStyles[tag.id]),
    [tagOptions, tagStyles]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-destructive py-8">
        Failed to load tag settings
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded p-4 text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
          Settings saved successfully
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-4">Tag Appearance</h2>
        <p className="text-muted-foreground mb-4">
          Map tags to custom emojis and colors. Tags without a custom style use the default gray border/background and show only the tag name.
        </p>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="qt-label mb-1">
                Tag
              </label>
              <select
                value={selectedTagId}
                onChange={(e) => setSelectedTagId(e.target.value)}
                disabled={tagSaving || availableForStyling.length === 0}
                className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select a tag</option>
                {availableForStyling.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleAddTagStyle}
              disabled={!selectedTagId || tagSaving}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              Add Style
            </button>
          </div>

          {Object.keys(tagStyles).length > 0 ? (
            <div className="grid gap-4 grid-cols-1 landscape:grid-cols-3 lg:grid-cols-4">
              {Object.entries(tagStyles).map(([tagId, style]) => {
                const label = tagLabelLookup.get(tagId) || 'Unknown tag'
                const mergedStyle = mergeWithDefaultTagStyle(style)
                const tagMeta = tagMetadataLookup.get(tagId)
                const quickHideEnabled = Boolean(tagMeta?.quickHide)

                return (
                  <div key={tagId} className="border border-border rounded-lg p-4 bg-card shadow-sm flex flex-col">
                    <div className="flex-1">
                      <div className="qt-text-primary">{label}</div>
                      <div className="qt-text-xs mt-2">Preview:</div>
                      <div className="mt-2 mb-4">
                        <TagBadge tag={{ id: tagId, name: label }} styleOverride={mergedStyle} />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="block qt-text-label text-foreground">
                        Emoji
                        <input
                          type="text"
                          maxLength={8}
                          value={mergedStyle.emoji ?? ''}
                          onChange={(e) => handleTagStyleFieldChange(tagId, { emoji: e.target.value.trim() || null })}
                          disabled={tagSaving}
                          placeholder="😀"
                          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                        />
                      </label>

                      <div className="space-y-2 pt-1">
                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.emojiOnly ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { emojiOnly: e.target.checked })}
                            disabled={tagSaving || !mergedStyle.emoji}
                            className="rounded"
                          />
                          <span>Show emoji only</span>
                        </label>

                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.bold ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { bold: e.target.checked })}
                            disabled={tagSaving}
                            className="rounded"
                          />
                          <span className="font-bold">Bold</span>
                        </label>

                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.italic ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { italic: e.target.checked })}
                            disabled={tagSaving}
                            className="rounded"
                          />
                          <span className="italic">Italic</span>
                        </label>

                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.strikethrough ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tagId, { strikethrough: e.target.checked })}
                            disabled={tagSaving}
                            className="rounded"
                          />
                          <span className="line-through">Strikethrough</span>
                        </label>

                        <div className="pt-2 mt-2 border-t border-dashed border-border">
                          <label className="flex items-center gap-2 qt-text-label text-foreground">
                            <input
                              type="checkbox"
                              checked={quickHideEnabled}
                              onChange={(e) => handleQuickHideToggle(tagId, e.target.checked)}
                              disabled={quickHideSavingId === tagId}
                              className="rounded"
                            />
                            <span>Enable quick-hide button</span>
                          </label>
                          <p className="qt-text-xs mt-1">
                            Adds this tag to the navbar quick-hide controls.
                          </p>
                        </div>
                      </div>

                      <label className="block qt-text-label text-foreground">
                        Border + Font Color
                        <input
                          type="color"
                          value={mergedStyle.foregroundColor}
                          onChange={(e) => handleTagStyleFieldChange(tagId, { foregroundColor: e.target.value })}
                          disabled={tagSaving}
                          className="mt-1 block h-10 w-full rounded-md border border-input bg-background"
                        />
                      </label>

                      <label className="block qt-text-label text-foreground">
                        Background Color
                        <input
                          type="color"
                          value={mergedStyle.backgroundColor}
                          onChange={(e) => handleTagStyleFieldChange(tagId, { backgroundColor: e.target.value })}
                          disabled={tagSaving}
                          className="mt-1 block h-10 w-full rounded-md border border-input bg-background"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => handleRemoveTagStyle(tagId)}
                        disabled={tagSaving}
                        className="w-full px-3 py-1.5 text-sm rounded-md text-destructive border border-destructive/30 hover:bg-destructive/10 disabled:opacity-50"
                      >
                        Remove Style
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="qt-text-small border border-dashed border-border rounded-lg p-4">
              No custom tag styles yet. Select a tag above to add an emoji and colors.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
