'use client'

/**
 * Settings Card
 *
 * Card displaying project instructions, mount point selection,
 * and allow any character toggle.
 */

import { useEffect, useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { fetchJson } from '@/lib/fetch-helpers'
import type { Project, EditForm, MountPointInfo } from '../types'

interface MountPointData {
  projectId: string
  mountPointId: string | null
  currentMountPoint: MountPointInfo | null
  defaultMountPoint: MountPointInfo | null
  effectiveMountPoint: MountPointInfo | null
  fileCount: number
}

interface MountPointOption {
  id: string
  name: string
  backendType: string
  healthStatus: string
  isDefault: boolean
}

interface SettingsCardProps {
  project: Project
  editForm: EditForm
  onEditFormChange: (form: EditForm) => void
  onSave: () => void
  onToggleAllowAnyCharacter: () => void
  expanded: boolean
  onToggle: () => void
  onProjectUpdate?: () => void
}

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

export function SettingsCard({
  project,
  editForm,
  onEditFormChange,
  onSave,
  onToggleAllowAnyCharacter,
  expanded,
  onToggle,
  onProjectUpdate,
}: SettingsCardProps) {
  const [mountPointData, setMountPointData] = useState<MountPointData | null>(null)
  const [mountPointOptions, setMountPointOptions] = useState<MountPointOption[]>([])
  const [selectedMountPointId, setSelectedMountPointId] = useState<string>('')
  const [isSavingMountPoint, setIsSavingMountPoint] = useState(false)
  const [mountPointError, setMountPointError] = useState<string | null>(null)
  const [showMigrationConfirm, setShowMigrationConfirm] = useState(false)
  const [pendingMountPointId, setPendingMountPointId] = useState<string | null>(null)

  // Load mount point data
  const loadMountPointData = useCallback(async () => {
    try {
      const [mpDataRes, mpOptionsRes] = await Promise.all([
        fetchJson<MountPointData>(`/api/projects/${project.id}/mount-point`),
        fetchJson<{ mountPoints: MountPointOption[] }>('/api/v1/system/mount-points'),
      ])

      if (mpDataRes.ok && mpDataRes.data) {
        setMountPointData(mpDataRes.data)
        setSelectedMountPointId(mpDataRes.data.mountPointId || '')
      }

      if (mpOptionsRes.ok && mpOptionsRes.data?.mountPoints) {
        setMountPointOptions(mpOptionsRes.data.mountPoints)
      }
    } catch (error) {
      clientLogger.error('Failed to load mount point data', { error })
    }
  }, [project.id])

  useEffect(() => {
    if (expanded) {
      loadMountPointData()
    }
  }, [expanded, loadMountPointData])

  useEffect(() => {
    clientLogger.debug('SettingsCard: rendered', {
      allowAnyCharacter: project.allowAnyCharacter,
      hasInstructions: !!editForm.instructions,
      expanded,
    })
  }, [project.allowAnyCharacter, editForm.instructions, expanded])

  const handleMountPointChange = (newMountPointId: string) => {
    if (mountPointData && mountPointData.fileCount > 0 && newMountPointId !== selectedMountPointId) {
      // Show confirmation if there are files to migrate
      setPendingMountPointId(newMountPointId)
      setShowMigrationConfirm(true)
    } else {
      // No files, proceed directly
      saveMountPoint(newMountPointId)
    }
  }

  const saveMountPoint = async (newMountPointId: string) => {
    setIsSavingMountPoint(true)
    setMountPointError(null)
    setShowMigrationConfirm(false)

    try {
      if (newMountPointId === '') {
        // Clear mount point (use system default)
        const result = await fetchJson<{ success: boolean }>(`/api/projects/${project.id}/mount-point`, {
          method: 'DELETE',
        })

        if (!result.ok) {
          throw new Error(result.error || 'Failed to clear mount point')
        }
      } else {
        // Set mount point
        const result = await fetchJson<{ success: boolean; migration?: { failed: number; errors: Array<{ error: string }> } }>(
          `/api/projects/${project.id}/mount-point`,
          {
            method: 'PUT',
            body: JSON.stringify({ mountPointId: newMountPointId, migrateFiles: true }),
          }
        )

        if (!result.ok) {
          throw new Error(result.error || 'Failed to set mount point')
        }

        if (result.data?.migration?.failed && result.data.migration.failed > 0) {
          setMountPointError(`${result.data.migration.failed} file(s) failed to migrate`)
        }
      }

      setSelectedMountPointId(newMountPointId)
      await loadMountPointData()
      onProjectUpdate?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update mount point'
      setMountPointError(message)
      clientLogger.error('Failed to update mount point', { error })
    } finally {
      setIsSavingMountPoint(false)
      setPendingMountPointId(null)
    }
  }

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Project Settings</h3>
            <p className="qt-text-small qt-text-secondary">
              Instructions &amp; character access
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Project Instructions */}
          <div>
            <label className="qt-text-label block mb-2">Project Instructions</label>
            <p className="qt-text-xs qt-text-secondary mb-2">
              These instructions are included in system prompts for all project chats.
            </p>
            <textarea
              value={editForm.instructions}
              onChange={(e) => onEditFormChange({ ...editForm, instructions: e.target.value })}
              rows={4}
              placeholder="Add instructions for characters in this project..."
              className="qt-textarea w-full"
            />
            <div className="mt-2 flex justify-end">
              <button onClick={onSave} className="qt-button qt-button-primary">
                Save
              </button>
            </div>
          </div>

          {/* Mount Point Selection */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="text-sm font-medium text-foreground mb-1">Storage Location</h4>
            <p className="qt-text-xs qt-text-secondary mb-3">
              Choose where project files are stored.
              {mountPointData?.fileCount ? ` This project has ${mountPointData.fileCount} file(s).` : ''}
            </p>
            <select
              value={selectedMountPointId}
              onChange={(e) => handleMountPointChange(e.target.value)}
              disabled={isSavingMountPoint}
              className="qt-input w-full"
            >
              <option value="">System Default{mountPointData?.defaultMountPoint ? ` (${mountPointData.defaultMountPoint.name})` : ''}</option>
              {mountPointOptions.map((mp) => (
                <option key={mp.id} value={mp.id} disabled={mp.healthStatus === 'unhealthy'}>
                  {mp.name} ({mp.backendType}){mp.healthStatus === 'unhealthy' ? ' - Unhealthy' : ''}
                </option>
              ))}
            </select>
            {mountPointData?.effectiveMountPoint && (
              <p className="qt-text-xs qt-text-secondary mt-2">
                Currently using: {mountPointData.effectiveMountPoint.name} ({mountPointData.effectiveMountPoint.backendType})
              </p>
            )}
            {mountPointError && (
              <p className="qt-text-xs text-destructive mt-2">{mountPointError}</p>
            )}
            {isSavingMountPoint && (
              <p className="qt-text-xs qt-text-secondary mt-2">Updating storage location...</p>
            )}
          </div>

          {/* Migration Confirmation Dialog */}
          {showMigrationConfirm && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
                This project has {mountPointData?.fileCount} file(s). They will be migrated to the new storage location. Continue?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => pendingMountPointId && saveMountPoint(pendingMountPointId)}
                  className="qt-button qt-button-primary text-sm"
                >
                  Migrate Files
                </button>
                <button
                  onClick={() => {
                    setShowMigrationConfirm(false)
                    setPendingMountPointId(null)
                  }}
                  className="qt-button qt-button-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Allow Any Character Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg qt-border qt-bg-surface">
            <div>
              <h4 className="text-sm font-medium text-foreground">Allow Any Character</h4>
              <p className="qt-text-xs qt-text-secondary">
                {project.allowAnyCharacter
                  ? 'Any character can join project chats.'
                  : 'Only roster characters can participate.'}
              </p>
            </div>
            <button
              onClick={onToggleAllowAnyCharacter}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                project.allowAnyCharacter ? 'bg-primary' : 'qt-bg-muted'
              }`}
              role="switch"
              aria-checked={project.allowAnyCharacter}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  project.allowAnyCharacter ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
