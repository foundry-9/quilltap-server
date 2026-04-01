'use client'

import { useState, useEffect } from 'react'
import { MountPointForm } from './MountPointForm'
import type { MountPoint, AvailableBackend, MountPointFormData } from './types'

interface MountPointModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => Promise<void>
  mountPoint?: MountPoint | null
  availableBackends: AvailableBackend[]
  createMountPoint: (data: MountPointFormData) => Promise<MountPoint | null>
  updateMountPoint: (id: string, data: Partial<MountPointFormData>) => Promise<boolean>
}

/**
 * Modal for creating or editing a mount point
 */
export function MountPointModal({
  isOpen,
  onClose,
  onSuccess,
  mountPoint,
  availableBackends,
  createMountPoint,
  updateMountPoint,
}: MountPointModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!mountPoint

  // Log modal state changes
  useEffect(() => {
  }, [isOpen, isEditing])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleSubmit = async (data: MountPointFormData) => {
    setIsSubmitting(true)
    setError(null)

    try {
      if (isEditing && mountPoint) {
        await updateMountPoint(mountPoint.id, data)
      } else {
        const created = await createMountPoint(data)
        if (created) {
        }
      }

      await onSuccess()
      onClose()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save mount point'
      console.error('Failed to save mount point', { error: errorMessage })
      setError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="qt-dialog-overlay">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal */}
      <div className="relative qt-card w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="qt-text-large font-semibold">
            {isEditing ? 'Edit Mount Point' : 'New Mount Point'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 rounded qt-alert-destructive text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <MountPointForm
          mountPoint={mountPoint}
          availableBackends={availableBackends}
          onSubmit={handleSubmit}
          onCancel={onClose}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  )
}
