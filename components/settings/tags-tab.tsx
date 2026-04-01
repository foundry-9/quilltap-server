'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTagStyles } from '@/components/providers/tag-style-provider'
import { DEFAULT_TAG_STYLE, mergeWithDefaultTagStyle } from '@/lib/tags/styles'
import type { TagVisualStyle } from '@/lib/schemas/types'
import { TagBadge } from '@/components/tags/tag-badge'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

interface TagOption {
  id: string
  name: string
  quickHide?: boolean
  visualStyle?: TagVisualStyle | null
}

export default function TagsTab() {
  const [loading, setLoading] = useState(true)
  const [tagSaving, setTagSaving] = useState<string | null>(null)
  const [tagOptions, setTagOptions] = useState<TagOption[]>([])
  const [selectedTagId, setSelectedTagId] = useState('')
  const [quickHideSavingId, setQuickHideSavingId] = useState<string | null>(null)
  const { refresh: refreshTagStyles } = useTagStyles()
  const { refresh: refreshQuickHideTags } = useQuickHide()
  const tagFetchIdRef = useRef(0)
  const colorDebounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map())

  const fetchTags = useCallback(async () => {
    const requestId = ++tagFetchIdRef.current
    setLoading(true)
    try {
      const res = await fetch('/api/v1/tags', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error('Failed to load tags')
      }
      const data = await res.json()
      if (tagFetchIdRef.current === requestId) {
        setTagOptions((data.tags || []).map((tag: any) => ({
          id: tag.id,
          name: tag.name,
          quickHide: Boolean(tag.quickHide),
          visualStyle: tag.visualStyle ?? null,
        })))
      }
    } catch (err) {
      console.error('Error loading tags', { error: err instanceof Error ? err.message : String(err) })
      showErrorToast('Failed to load tags')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  const updateTagVisualStyle = useCallback(async (tagId: string, visualStyle: TagVisualStyle | null) => {
    setTagSaving(tagId)

    try {
      const res = await fetch(`/api/v1/tags/${tagId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visualStyle }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update tag style')
      }

      const { tag } = await res.json()

      // Update local state
      setTagOptions(prev =>
        prev.map(option =>
          option.id === tagId ? { ...option, visualStyle: tag.visualStyle ?? null } : option
        )
      )

      // Refresh the global tag style context
      await refreshTagStyles()

      showSuccessToast('Tag style saved')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setTagSaving(null)
    }
  }, [refreshTagStyles])

  const handleTagStyleFieldChange = useCallback((tagId: string, updates: Partial<TagVisualStyle>) => {
    const tag = tagOptions.find(t => t.id === tagId)
    if (!tag) return

    const merged = mergeWithDefaultTagStyle(tag.visualStyle)
    const newStyle: TagVisualStyle = {
      ...merged,
      ...updates,
    }

    // Update local state immediately for responsiveness
    setTagOptions(prev =>
      prev.map(option =>
        option.id === tagId ? { ...option, visualStyle: newStyle } : option
      )
    )

    // Persist to server
    updateTagVisualStyle(tagId, newStyle)
  }, [tagOptions, updateTagVisualStyle])

  // Debounced handler for color picker changes to avoid toast spam while dragging
  const handleColorChange = useCallback((tagId: string, updates: Partial<TagVisualStyle>) => {
    const tag = tagOptions.find(t => t.id === tagId)
    if (!tag) return

    const merged = mergeWithDefaultTagStyle(tag.visualStyle)
    const newStyle: TagVisualStyle = {
      ...merged,
      ...updates,
    }

    // Update local state immediately for instant preview
    setTagOptions(prev =>
      prev.map(option =>
        option.id === tagId ? { ...option, visualStyle: newStyle } : option
      )
    )

    // Clear any existing debounce timer for this tag
    const existingTimer = colorDebounceTimers.current.get(tagId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Set new debounced save
    const timer = setTimeout(() => {
      updateTagVisualStyle(tagId, newStyle)
      colorDebounceTimers.current.delete(tagId)
    }, 500)

    colorDebounceTimers.current.set(tagId, timer)
  }, [tagOptions, updateTagVisualStyle])

  // Clean up debounce timers on unmount
  useEffect(() => {
    const timers = colorDebounceTimers.current
    return () => {
      timers.forEach(timer => clearTimeout(timer))
    }
  }, [])

  const handleRemoveTagStyle = useCallback((tagId: string) => {
    // Remove visual style by setting it to null
    updateTagVisualStyle(tagId, null)
  }, [updateTagVisualStyle])

  const handleAddTagStyle = useCallback(() => {
    if (!selectedTagId) return

    // Add default style to the selected tag
    updateTagVisualStyle(selectedTagId, { ...DEFAULT_TAG_STYLE })
    setSelectedTagId('')
  }, [selectedTagId, updateTagVisualStyle])

  const handleQuickHideToggle = useCallback(
    async (tagId: string, nextValue: boolean) => {
      setQuickHideSavingId(tagId)
      try {
        const res = await fetch(`/api/v1/tags/${tagId}`, {
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
        showSuccessToast('Quick-hide setting saved')
      } catch (err) {
        console.error('Error toggling quick-hide', { error: err instanceof Error ? err.message : String(err) })
        showErrorToast(err instanceof Error ? err.message : 'Failed to update quick-hide')
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

  // Tags that have a visual style defined
  const tagsWithStyles = useMemo(
    () => tagOptions.filter((tag) => tag.visualStyle !== null && tag.visualStyle !== undefined),
    [tagOptions]
  )

  // Tags that don't have a visual style yet
  const availableForStyling = useMemo(
    () => tagOptions.filter((tag) => tag.visualStyle === null || tag.visualStyle === undefined),
    [tagOptions]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
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
                disabled={tagSaving !== null || availableForStyling.length === 0}
                className="qt-select w-full"
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
              disabled={!selectedTagId || tagSaving !== null}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              Add Style
            </button>
          </div>

          {tagsWithStyles.length > 0 ? (
            <div className="grid gap-4 grid-cols-1 landscape:grid-cols-3 lg:grid-cols-4">
              {tagsWithStyles.map((tag) => {
                const label = tagLabelLookup.get(tag.id) || 'Unknown tag'
                const mergedStyle = mergeWithDefaultTagStyle(tag.visualStyle)
                const quickHideEnabled = Boolean(tag.quickHide)
                const isSaving = tagSaving === tag.id

                return (
                  <div key={tag.id} className="border border-border rounded-lg p-4 bg-card shadow-sm flex flex-col">
                    <div className="flex-1">
                      <div className="qt-text-primary">{label}</div>
                      <div className="qt-text-xs mt-2">Preview:</div>
                      <div className="mt-2 mb-4">
                        <TagBadge tag={{ id: tag.id, name: label }} styleOverride={mergedStyle} />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="block qt-text-label text-foreground">
                        Emoji
                        <input
                          type="text"
                          maxLength={8}
                          value={mergedStyle.emoji ?? ''}
                          onChange={(e) => handleTagStyleFieldChange(tag.id, { emoji: e.target.value.trim() || null })}
                          disabled={isSaving}
                          placeholder="😀"
                          className="qt-input mt-1 block w-full text-sm"
                        />
                      </label>

                      <div className="space-y-2 pt-1">
                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.emojiOnly ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tag.id, { emojiOnly: e.target.checked })}
                            disabled={isSaving || !mergedStyle.emoji}
                            className="rounded"
                          />
                          <span>Show emoji only</span>
                        </label>

                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.bold ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tag.id, { bold: e.target.checked })}
                            disabled={isSaving}
                            className="rounded"
                          />
                          <span className="font-bold">Bold</span>
                        </label>

                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.italic ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tag.id, { italic: e.target.checked })}
                            disabled={isSaving}
                            className="rounded"
                          />
                          <span className="italic">Italic</span>
                        </label>

                        <label className="flex items-center gap-2 qt-text-label text-foreground">
                          <input
                            type="checkbox"
                            checked={mergedStyle.strikethrough ?? false}
                            onChange={(e) => handleTagStyleFieldChange(tag.id, { strikethrough: e.target.checked })}
                            disabled={isSaving}
                            className="rounded"
                          />
                          <span className="line-through">Strikethrough</span>
                        </label>

                        <div className="pt-2 mt-2 border-t border-dashed border-border">
                          <label className="flex items-center gap-2 qt-text-label text-foreground">
                            <input
                              type="checkbox"
                              checked={quickHideEnabled}
                              onChange={(e) => handleQuickHideToggle(tag.id, e.target.checked)}
                              disabled={quickHideSavingId === tag.id}
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
                          onChange={(e) => handleColorChange(tag.id, { foregroundColor: e.target.value })}
                          disabled={isSaving}
                          className="qt-input mt-1 block h-10 w-full"
                        />
                      </label>

                      <label className="block qt-text-label text-foreground">
                        Background Color
                        <input
                          type="color"
                          value={mergedStyle.backgroundColor}
                          onChange={(e) => handleColorChange(tag.id, { backgroundColor: e.target.value })}
                          disabled={isSaving}
                          className="qt-input mt-1 block h-10 w-full"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => handleRemoveTagStyle(tag.id)}
                        disabled={isSaving}
                        className="w-full px-3 py-1.5 text-sm rounded-md qt-text-destructive border qt-border-destructive/30 hover:qt-bg-destructive/10 disabled:opacity-50"
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
