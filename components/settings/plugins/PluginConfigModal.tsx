'use client'

import { useState, useEffect, useCallback } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
/**
 * Configuration field schema from plugin manifest
 */
interface ConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'password' | 'url' | 'email'
  default?: unknown
  required?: boolean
  description?: string
  options?: Array<{ label: string; value: unknown }>
  min?: number
  max?: number
}

/**
 * Props for the PluginConfigModal component
 */
interface PluginConfigModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal closes */
  onClose: () => void
  /** Plugin name (e.g., 'qtap-plugin-curl') */
  pluginName: string
  /** Display title for the plugin */
  pluginTitle: string
  /** Callback when config is saved successfully */
  onSuccess?: () => void
}

/**
 * Modal for configuring plugin settings
 *
 * Dynamically renders form fields based on the plugin's configSchema
 * and saves configuration to the database via API.
 */
export function PluginConfigModal({
  isOpen,
  onClose,
  pluginName,
  pluginTitle,
  onSuccess,
}: PluginConfigModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configSchema, setConfigSchema] = useState<ConfigField[]>([])
  const [formData, setFormData] = useState<Record<string, unknown>>({})

  // Load current configuration
  const loadConfig = useCallback(async () => {
    if (!isOpen || !pluginName) return

    setLoading(true)
    setError(null)

    try {

      const response = await fetch(`/api/v1/plugins/${encodeURIComponent(pluginName)}?action=get-config`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load configuration')
      }

      setConfigSchema(data.configSchema || [])
      setFormData(data.config || {})

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load configuration'
      console.error('Failed to load plugin config', { pluginName, error: message })
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [isOpen, pluginName])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Handle form field changes
  const handleFieldChange = (key: string, value: unknown) => {
    setFormData(prev => ({
      ...prev,
      [key]: value,
    }))
  }

  // Save configuration
  const handleSubmit = async () => {
    setSaving(true)
    setError(null)

    try {

      const response = await fetch(`/api/v1/plugins/${encodeURIComponent(pluginName)}?action=set-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: formData }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save configuration')
      }

      showSuccessToast('Configuration saved successfully')
      onSuccess?.()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save configuration'
      console.error('Failed to save plugin config', { pluginName, error: message })
      setError(message)
      showErrorToast(message)
    } finally {
      setSaving(false)
    }
  }

  // Render a form field based on its type
  const renderField = (field: ConfigField) => {
    const value = formData[field.key]

    switch (field.type) {
      case 'text':
      case 'password':
      case 'url':
      case 'email':
        return (
          <input
            type={field.type}
            id={field.key}
            value={(value as string) || ''}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className="qt-input w-full"
            placeholder={field.description}
          />
        )

      case 'textarea':
        return (
          <textarea
            id={field.key}
            value={(value as string) || ''}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className="qt-input w-full min-h-[100px] font-mono text-sm"
            placeholder={field.description}
            rows={5}
          />
        )

      case 'number':
        return (
          <input
            type="number"
            id={field.key}
            value={(value as number) ?? field.default ?? ''}
            onChange={(e) => handleFieldChange(field.key, e.target.value ? Number(e.target.value) : undefined)}
            className="qt-input w-full"
            min={field.min}
            max={field.max}
          />
        )

      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              id={field.key}
              checked={Boolean(value ?? field.default)}
              onChange={(e) => handleFieldChange(field.key, e.target.checked)}
              className="w-4 h-4 rounded border-border"
            />
            <span className="qt-text-small">{field.description || 'Enable'}</span>
          </label>
        )

      case 'select':
        return (
          <select
            id={field.key}
            value={String(value ?? field.default ?? '')}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className="qt-input w-full"
          >
            <option value="">Select...</option>
            {field.options?.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        )

      default:
        return null
    }
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${pluginTitle} Settings`}
      maxWidth="lg"
      footer={
        <FormActions
          onCancel={onClose}
          onSubmit={handleSubmit}
          submitLabel="Save"
          isLoading={saving}
          isDisabled={loading}
        />
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-r-transparent" />
            <span className="qt-text-small">Loading configuration...</span>
          </div>
        </div>
      ) : error ? (
        <ErrorAlert message={error} />
      ) : configSchema.length === 0 ? (
        <div className="text-center py-8">
          <p className="qt-text-small">This plugin has no configurable settings.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {configSchema.map((field) => (
            <div key={field.key} className="space-y-1">
              {field.type !== 'boolean' && (
                <label htmlFor={field.key} className="block qt-text-label">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
              )}
              {renderField(field)}
              {field.description && field.type !== 'boolean' && (
                <p className="qt-text-small text-muted-foreground">{field.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </BaseModal>
  )
}

export default PluginConfigModal
