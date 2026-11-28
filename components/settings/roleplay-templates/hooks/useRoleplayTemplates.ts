'use client'

import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { useRoleplayTemplatesQuery } from '@/lib/hooks/use-profiles'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useChatSettingsMutation } from '@/hooks/useChatSettingsMutation'
import { RoleplayTemplate, TemplateFormData, DelimiterFormEntry, INITIAL_FORM_DATA, EMPTY_ADD_ONS } from '../types'
import type { TemplateDelimiter, DelimiterAddOns, UnmarkedStyle } from '@/lib/schemas/template.types'
import { DEFAULT_TAG_TOKEN_PATTERN } from '@/lib/schemas/template.types'
import { generateFormattingPromptHint } from '@/lib/chat/template-prompt-hint'

export interface UseRoleplayTemplatesReturn {
  // Data
  templates: RoleplayTemplate[]
  defaultTemplateId: string | null

  // Loading states
  loading: boolean
  saving: boolean
  defaultSaving: boolean
  error: string | null
  /** A refused save, shown inside the open modal rather than behind it (#252). */
  saveError: string | null
  success: string | null

  // Modal states
  isModalOpen: boolean
  editingTemplate: RoleplayTemplate | null
  formData: TemplateFormData
  previewTemplate: RoleplayTemplate | null
  deleteConfirm: string | null

  // Modal handlers
  openCreateModal: () => void
  openEditModal: (template: RoleplayTemplate) => void
  closeModal: () => void
  setPreviewTemplate: (template: RoleplayTemplate | null) => void
  setDeleteConfirm: (id: string | null) => void
  setFormData: (data: TemplateFormData | ((prev: TemplateFormData) => TemplateFormData)) => void

  // API handlers
  handleDefaultTemplateChange: (templateId: string | null) => Promise<void>
  handleSave: () => Promise<void>
  handleDelete: (templateId: string) => Promise<void>
  handleCopyAsNew: (template: RoleplayTemplate) => void

  // Draft a kind-aware formatting paragraph from the current delimiters and
  // append it to the editable systemPrompt.
  appendFormattingHint: () => void
}

/** Convert a TemplateDelimiter (any kind) to a form entry. */
function delimiterToFormEntry(d: TemplateDelimiter): DelimiterFormEntry {
  const base = {
    name: d.name,
    buttonName: d.buttonName,
    style: d.style,
    // Sensible defaults for the fields not used by this kind.
    delimiterMode: 'single' as const,
    delimiterOpen: '',
    delimiterClose: '',
    marker: '',
    tagOpen: '[',
    tagClose: ']',
    tokenPattern: DEFAULT_TAG_TOKEN_PATTERN,
    hideDelimiter: d.hideDelimiter ?? false,
    matchCurlyQuotes: false,
    closeOptional: false,
    addOns: { ...EMPTY_ADD_ONS, ...(d.addOns ?? {}) },
  }

  if (d.kind === 'linePrefix') {
    return { ...base, kind: 'linePrefix', marker: d.marker }
  }
  if (d.kind === 'tagPrefix') {
    return {
      ...base,
      kind: 'tagPrefix',
      delimiterMode: 'pair',
      tagOpen: d.open,
      tagClose: d.close,
      tokenPattern: d.tokenPattern || DEFAULT_TAG_TOKEN_PATTERN,
    }
  }

  // wrap
  const isPair = Array.isArray(d.delimiters)
  return {
    ...base,
    kind: 'wrap',
    delimiterMode: isPair ? 'pair' : 'single',
    delimiterOpen: isPair ? (d.delimiters as [string, string])[0] : (d.delimiters as string),
    delimiterClose: isPair ? (d.delimiters as [string, string])[1] : (d.delimiters as string),
    matchCurlyQuotes: d.matchCurlyQuotes ?? false,
    closeOptional: d.closeOptional ?? false,
  }
}

/** True if any add-on is non-default (so it's worth persisting). */
function hasAnyAddOn(a: DelimiterAddOns): boolean {
  return a.bold || a.italic || a.reverse || a.underline !== 'none' || a.border !== 'none' || a.font !== ''
}

/**
 * The hide/add-on decorations for a form entry, omitted when at their defaults so
 * simple delimiters stay lean in storage and exports.
 */
function decorationsFor(e: DelimiterFormEntry): { hideDelimiter?: boolean; addOns?: DelimiterAddOns } {
  return {
    ...(e.hideDelimiter ? { hideDelimiter: true } : {}),
    ...(hasAnyAddOn(e.addOns) ? { addOns: e.addOns } : {}),
  }
}

/** Convert form entries back to a TemplateDelimiter array, filtering empties. */
function formEntriesToDelimiters(entries: DelimiterFormEntry[]): TemplateDelimiter[] {
  return entries
    .filter(e => e.name.trim() && e.buttonName.trim())
    .map((e): TemplateDelimiter => {
      const name = e.name.trim()
      const buttonName = e.buttonName.trim()
      const style = e.style.trim() || 'qt-chat-narration'
      const deco = decorationsFor(e)

      if (e.kind === 'linePrefix') {
        return { kind: 'linePrefix', name, buttonName, marker: e.marker, style, ...deco }
      }
      if (e.kind === 'tagPrefix') {
        return {
          kind: 'tagPrefix',
          name,
          buttonName,
          open: e.tagOpen,
          close: e.tagClose,
          tokenPattern: e.tokenPattern.trim() || undefined,
          style,
          ...deco,
        }
      }
      return {
        kind: 'wrap',
        name,
        buttonName,
        delimiters: e.delimiterMode === 'pair'
          ? [e.delimiterOpen, e.delimiterClose] as [string, string]
          : e.delimiterOpen,
        style,
        ...deco,
        ...(e.matchCurlyQuotes ? { matchCurlyQuotes: true } : {}),
        ...(e.closeOptional ? { closeOptional: true } : {}),
      }
    })
}

/** The form's narration choice as stored: a string, a pair, or null (unmarked prose). */
function narrationFromForm(f: TemplateFormData): string | [string, string] | null {
  if (f.narrationDelimiterMode === 'none') return null
  return f.narrationDelimiterMode === 'pair' ? [f.narrationOpen, f.narrationClose] : f.narrationOpen
}

/** The form's unmarked-text style as stored, or null when unstyled. */
function unmarkedFromForm(f: TemplateFormData): UnmarkedStyle | null {
  if (!f.unmarkedEnabled) return null
  const style = f.unmarkedStyle.trim() || 'qt-roleplay-plain'
  return hasAnyAddOn(f.unmarkedAddOns) ? { style, addOns: f.unmarkedAddOns } : { style }
}

/** Populate the form from a stored template (edit and copy-as-new share it). */
function templateToFormData(template: RoleplayTemplate, name: string): TemplateFormData {
  const delimiters = template.narrationDelimiters
  const isPair = Array.isArray(delimiters)
  const unmarked = template.unmarkedStyle ?? null
  return {
    name,
    description: template.description || '',
    systemPrompt: template.systemPrompt,
    narrationDelimiterMode: delimiters === null ? 'none' : isPair ? 'pair' : 'single',
    narrationOpen: isPair ? delimiters[0] : (delimiters || '*'),
    narrationClose: isPair ? delimiters[1] : (delimiters || '*'),
    delimiters: (template.delimiters || []).map(delimiterToFormEntry),
    unmarkedEnabled: unmarked !== null,
    unmarkedStyle: unmarked?.style ?? INITIAL_FORM_DATA.unmarkedStyle,
    unmarkedAddOns: { ...EMPTY_ADD_ONS, ...(unmarked?.addOns ?? {}) },
    markdownAsterisks: template.markdownAsterisks ?? true,
  }
}

export function useRoleplayTemplates(): UseRoleplayTemplatesReturn {
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<RoleplayTemplate | null>(null)
  const [formData, setFormData] = useState<TemplateFormData>(INITIAL_FORM_DATA)

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<RoleplayTemplate | null>(null)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // The template list and the default pick, both from the shared cache.
  const queryClient = useQueryClient()
  const { data: templatesData, isLoading: loading } = useRoleplayTemplatesQuery<RoleplayTemplate>()
  const { data: defaultTemplateId = null } = useChatSettingsQuery(
    (settings) => settings.defaultRoleplayTemplateId ?? null,
  )
  const { save: saveChatSettings, saving: defaultSaving } = useChatSettingsMutation()

  const templates = templatesData ?? []

  const handleDefaultTemplateChange = async (templateId: string | null) => {
    setError(null)
    // The picker reads the shared settings row: the mutation writes it at
    // once and rolls it back (with a toast) if the server refuses.
    const ok = await saveChatSettings(
      { defaultRoleplayTemplateId: templateId },
      { failure: 'Failed to update default template' },
    )
    if (ok) {
      setSuccess('Default template updated successfully')
      setTimeout(() => setSuccess(null), 3000)
    }
  }

  const openCreateModal = () => {
    setSaveError(null)
    setEditingTemplate(null)
    setFormData(INITIAL_FORM_DATA)
    setIsModalOpen(true)
  }

  const openEditModal = (template: RoleplayTemplate) => {
    setSaveError(null)
    setEditingTemplate(template)
    setFormData(templateToFormData(template, template.name))
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setSaveError(null)
    setIsModalOpen(false)
    setEditingTemplate(null)
    setFormData(INITIAL_FORM_DATA)
  }

  // Create (no id) or update (an id); either way the shared list is re-read.
  const saveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string | null; payload: Record<string, unknown> }) =>
      apiFetch(id ? `/api/v1/roleplay-templates/${id}` : '/api/v1/roleplay-templates', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.roleplayTemplates.all }),
  })
  const deleteMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiFetch(`/api/v1/roleplay-templates/${templateId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.roleplayTemplates.all }),
  })

  const handleSave = async () => {
    try {
      setSaving(true)
      setSaveError(null)

      const payload = {
        name: formData.name,
        description: formData.description,
        systemPrompt: formData.systemPrompt,
        narrationDelimiters: narrationFromForm(formData),
        delimiters: formEntriesToDelimiters(formData.delimiters),
        unmarkedStyle: unmarkedFromForm(formData),
        markdownAsterisks: formData.markdownAsterisks,
      }

      await saveMutation.mutateAsync({ id: editingTemplate?.id ?? null, payload })
      setSuccess(editingTemplate ? 'Template updated successfully' : 'Template created successfully')

      closeModal()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      // The modal stays open, so the refusal is shown there.
      const message = apiErrorMessage(err, 'An error occurred')
      setSaveError(message)
      console.error('Error saving roleplay template:', message, err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (templateId: string) => {
    try {
      setSaving(true)
      setError(null)

      await deleteMutation.mutateAsync(templateId)
      setSuccess('Template deleted successfully')
      setDeleteConfirm(null)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = apiErrorMessage(err, 'An error occurred')
      setError(message)
      console.error('Error deleting roleplay template:', message, err)
    } finally {
      setSaving(false)
    }
  }

  const appendFormattingHint = useCallback(() => {
    setFormData(prev => {
      const hint = generateFormattingPromptHint(
        formEntriesToDelimiters(prev.delimiters),
        narrationFromForm(prev),
        { markdownAsterisks: prev.markdownAsterisks },
      )
      if (!hint) return prev
      const separator = prev.systemPrompt.trim() ? '\n\n' : ''
      return { ...prev, systemPrompt: prev.systemPrompt + separator + hint }
    })
  }, [])

  const handleCopyAsNew = (template: RoleplayTemplate) => {
    setSaveError(null)
    setEditingTemplate(null)
    setFormData(templateToFormData(template, `${template.name} (Copy)`))
    setIsModalOpen(true)
  }

  return {
    templates,
    defaultTemplateId,
    loading,
    saving,
    defaultSaving,
    error,
    saveError,
    success,
    isModalOpen,
    editingTemplate,
    formData,
    previewTemplate,
    deleteConfirm,
    openCreateModal,
    openEditModal,
    closeModal,
    setPreviewTemplate,
    setDeleteConfirm,
    setFormData,
    handleDefaultTemplateChange,
    handleSave,
    handleDelete,
    handleCopyAsNew,
    appendFormattingHint,
  }
}
