'use client'

import { useEffect, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import type { MountPoint, AvailableBackend, MountPointFormData, BackendConfigField } from './types'

interface MountPointFormProps {
  mountPoint?: MountPoint | null
  availableBackends: AvailableBackend[]
  onSubmit: (data: MountPointFormData) => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
}

/**
 * Compute default config values for a backend
 */
function computeDefaultConfig(backend: AvailableBackend | undefined): Record<string, unknown> {
  if (!backend) return {}
  const config: Record<string, unknown> = {}
  backend.configFields.forEach((field) => {
    if (field.defaultValue !== undefined) {
      config[field.name] = field.defaultValue
    }
  })
  return config
}

/**
 * Form component for creating/editing mount points
 */
export function MountPointForm({
  mountPoint,
  availableBackends,
  onSubmit,
  onCancel,
  isSubmitting,
}: MountPointFormProps) {
  const isEditing = !!mountPoint

  // Form state - compute initial backendConfig based on initial backend type
  const initialBackendType = mountPoint?.backendType || 'local'
  const initialBackend = availableBackends.find((b) => b.backendId === initialBackendType)

  const [name, setName] = useState(mountPoint?.name || '')
  const [description, setDescription] = useState(mountPoint?.description || '')
  const [backendType, setBackendType] = useState(initialBackendType)
  const [backendConfig, setBackendConfig] = useState<Record<string, unknown>>(
    mountPoint?.backendConfig || computeDefaultConfig(initialBackend)
  )
  const [scope, setScope] = useState<'system' | 'user'>(mountPoint?.scope || 'system')
  const [enabled, setEnabled] = useState(mountPoint?.enabled ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Get the selected backend definition
  const selectedBackend = availableBackends.find((b) => b.backendId === backendType)

  // Handle backend type change - reset config to defaults when type changes
  const handleBackendTypeChange = (newBackendType: string) => {
    setBackendType(newBackendType)
    // Only reset config when creating a new mount point, not when editing
    if (!isEditing) {
      const newBackend = availableBackends.find((b) => b.backendId === newBackendType)
      setBackendConfig(computeDefaultConfig(newBackend))
    }
  }

  // Log form mount
  useEffect(() => {
    clientLogger.debug('MountPointForm mounted', { isEditing, backendType })
  }, [isEditing, backendType])

  const handleConfigChange = (fieldName: string, value: unknown) => {
    setBackendConfig((prev) => ({
      ...prev,
      [fieldName]: value,
    }))
    // Clear error for this field
    if (errors[fieldName]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[fieldName]
        return next
      })
    }
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!name.trim()) {
      newErrors.name = 'Name is required'
    }

    // Validate required config fields
    if (selectedBackend) {
      selectedBackend.configFields.forEach((field) => {
        if (field.required && !backendConfig[field.name]) {
          newErrors[field.name] = `${field.label} is required`
        }
      })
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    await onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      backendType,
      backendConfig,
      scope,
      enabled,
    })
  }

  const renderConfigField = (field: BackendConfigField) => {
    const value = backendConfig[field.name]
    const error = errors[field.name]
    const inputId = `config-${field.name}`

    switch (field.type) {
      case 'boolean':
        return (
          <div key={field.name} className="flex items-start gap-3">
            <input
              type="checkbox"
              id={inputId}
              checked={!!value}
              onChange={(e) => handleConfigChange(field.name, e.target.checked)}
              className="mt-1"
            />
            <div>
              <label htmlFor={inputId} className="qt-text font-medium cursor-pointer">
                {field.label}
              </label>
              {field.description && (
                <p className="qt-text-small text-muted-foreground">{field.description}</p>
              )}
            </div>
          </div>
        )

      case 'secret':
        return (
          <div key={field.name}>
            <label htmlFor={inputId} className="block qt-text font-medium mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="password"
              id={inputId}
              value={(value as string) || ''}
              onChange={(e) => handleConfigChange(field.name, e.target.value)}
              placeholder={field.placeholder || (isEditing ? '••••••••' : '')}
              className={`qt-input w-full ${error ? 'border-red-500' : ''}`}
            />
            {field.description && (
              <p className="qt-text-small text-muted-foreground mt-1">{field.description}</p>
            )}
            {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
          </div>
        )

      case 'number':
        return (
          <div key={field.name}>
            <label htmlFor={inputId} className="block qt-text font-medium mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="number"
              id={inputId}
              value={(value as number) ?? ''}
              onChange={(e) =>
                handleConfigChange(field.name, e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder={field.placeholder}
              className={`qt-input w-full ${error ? 'border-red-500' : ''}`}
            />
            {field.description && (
              <p className="qt-text-small text-muted-foreground mt-1">{field.description}</p>
            )}
            {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
          </div>
        )

      default:
        return (
          <div key={field.name}>
            <label htmlFor={inputId} className="block qt-text font-medium mb-1">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="text"
              id={inputId}
              value={(value as string) || ''}
              onChange={(e) => handleConfigChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              className={`qt-input w-full ${error ? 'border-red-500' : ''}`}
            />
            {field.description && (
              <p className="qt-text-small text-muted-foreground mt-1">{field.description}</p>
            )}
            {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
          </div>
        )
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label htmlFor="name" className="block qt-text font-medium mb-1">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (errors.name) {
              setErrors((prev) => {
                const next = { ...prev }
                delete next.name
                return next
              })
            }
          }}
          placeholder="e.g., Primary S3 Storage"
          className={`qt-input w-full ${errors.name ? 'border-red-500' : ''}`}
        />
        {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name}</p>}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block qt-text font-medium mb-1">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description for this mount point"
          rows={2}
          className="qt-input w-full resize-none"
        />
      </div>

      {/* Backend Type */}
      <div>
        <label htmlFor="backendType" className="block qt-text font-medium mb-1">
          Storage Backend <span className="text-red-500">*</span>
        </label>
        <select
          id="backendType"
          value={backendType}
          onChange={(e) => handleBackendTypeChange(e.target.value)}
          disabled={isEditing}
          className="qt-input w-full"
        >
          {availableBackends.map((backend) => (
            <option key={backend.backendId} value={backend.backendId}>
              {backend.displayName}
            </option>
          ))}
        </select>
        {selectedBackend?.description && (
          <p className="qt-text-small text-muted-foreground mt-1">{selectedBackend.description}</p>
        )}
        {isEditing && (
          <p className="qt-text-small text-amber-600 dark:text-amber-400 mt-1">
            Backend type cannot be changed after creation
          </p>
        )}
      </div>

      {/* Backend-specific config fields */}
      {selectedBackend && selectedBackend.configFields.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h4 className="qt-text font-medium">Backend Configuration</h4>
          {selectedBackend.configFields.map(renderConfigField)}
        </div>
      )}

      {/* Scope */}
      <div>
        <label htmlFor="scope" className="block qt-text font-medium mb-1">
          Scope
        </label>
        <select
          id="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'system' | 'user')}
          className="qt-input w-full"
        >
          <option value="system">System (all users)</option>
          <option value="user">User (only you)</option>
        </select>
        <p className="qt-text-small text-muted-foreground mt-1">
          System mount points can be used by all users. User mount points are private.
        </p>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <label htmlFor="enabled" className="qt-text cursor-pointer">
          Enabled
        </label>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button type="button" onClick={onCancel} className="qt-button qt-button-secondary">
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting} className="qt-button qt-button-primary">
          {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Mount Point'}
        </button>
      </div>
    </form>
  )
}
