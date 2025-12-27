'use client'

/**
 * Sync Settings Tab
 *
 * Main component for managing sync instances and viewing sync history.
 * Allows users to add remote Quilltap instances, test connections,
 * trigger manual syncs, and view operation history.
 *
 * @module components/settings/sync
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { SyncFormData, SyncInstanceDisplay, INITIAL_FORM_DATA } from './types'
import { useSyncInstances, useSyncOperations, useSyncTrigger, useSyncApiKeys, useSyncCleanup, useSyncProgress } from './hooks'
import { InstanceList, InstanceForm, SyncHistoryPanel, ApiKeyPanel, CleanupPanel, SyncProgressBar } from './components'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import type { SyncDirection } from '@/lib/sync/types'

/**
 * Main sync settings tab component
 */
export default function SyncTab() {
  // Form state
  const [formData, setFormData] = useState<SyncFormData>(INITIAL_FORM_DATA)
  const [editingInstance, setEditingInstance] = useState<SyncInstanceDisplay | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)

  // Hooks
  const instances = useSyncInstances()
  const operations = useSyncOperations()
  const syncTrigger = useSyncTrigger()
  const apiKeys = useSyncApiKeys()
  const cleanup = useSyncCleanup()

  // Track the name of the instance being synced for progress display
  const [syncingInstanceName, setSyncingInstanceName] = useState<string>('')

  // Get instance name for progress bar
  const currentSyncingInstance = useMemo(() => {
    if (syncTrigger.syncingInstanceId) {
      const instance = instances.instances.find(i => i.id === syncTrigger.syncingInstanceId)
      return instance?.name || ''
    }
    return ''
  }, [syncTrigger.syncingInstanceId, instances.instances])

  // Update syncing instance name when sync starts
  useEffect(() => {
    if (currentSyncingInstance) {
      setSyncingInstanceName(currentSyncingInstance)
    }
  }, [currentSyncingInstance])

  // Progress tracking
  const syncProgress = useSyncProgress(
    syncTrigger.activeOperationId,
    syncingInstanceName
  )

  // Fetch data on mount
  // Using a ref to track mount state prevents race conditions during initial navigation
  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      // Small delay to ensure component is fully mounted
      // This prevents race conditions during client-side navigation
      await new Promise(resolve => setTimeout(resolve, 0))

      if (!isMounted) return

      // Execute fetches - they handle their own error states
      instances.fetchInstances()
      operations.fetchOperations()
      apiKeys.fetchKeys()
    }

    fetchData()

    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only fetch once on mount - fetch functions are stable

  // Log renders
  useEffect(() => {
    clientLogger.debug('SyncTab: rendered', {
      instanceCount: instances.instances.length,
      operationCount: operations.operations.length,
      apiKeyCount: apiKeys.keys.length,
      isFormOpen,
      editingInstanceId: editingInstance?.id,
    })
  }, [instances.instances.length, operations.operations.length, apiKeys.keys.length, isFormOpen, editingInstance])

  // Open create form
  const openCreateForm = useCallback(() => {
    setEditingInstance(null)
    setFormData(INITIAL_FORM_DATA)
    setIsFormOpen(true)
  }, [])

  // Open edit form
  const openEditForm = useCallback((instance: SyncInstanceDisplay) => {
    clientLogger.debug('SyncTab: opening edit form', { instanceId: instance.id })
    setEditingInstance(instance)
    setFormData({
      name: instance.name,
      url: instance.url,
      apiKey: '', // Don't populate API key for security
      isActive: instance.isActive,
    })
    setIsFormOpen(true)
  }, [])

  // Close form
  const closeForm = useCallback(() => {
    setIsFormOpen(false)
    setEditingInstance(null)
    setFormData(INITIAL_FORM_DATA)
  }, [])

  // Handle form field change
  const handleFormChange = useCallback((field: keyof SyncFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }, [])

  // Handle form submit
  const handleFormSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    clientLogger.debug('SyncTab: form submitted', {
      isEditing: !!editingInstance,
      formData: { ...formData, apiKey: formData.apiKey ? '[REDACTED]' : '' },
    })

    if (editingInstance) {
      // Update existing instance
      const result = await instances.updateInstance(editingInstance.id, {
        name: formData.name,
        isActive: formData.isActive,
        // Only include API key if it was changed
        ...(formData.apiKey ? { apiKey: formData.apiKey } : {}),
      })
      if (result) {
        closeForm()
      }
    } else {
      // Create new instance
      const result = await instances.createInstance(formData)
      if (result) {
        closeForm()
        // Refresh operations in case the connection test created any
        operations.fetchOperations()
      }
    }
  }, [editingInstance, formData, instances, operations, closeForm])

  // Handle sync trigger
  const handleSync = useCallback(
    async (
      instanceId: string,
      forceFull: boolean = false,
      direction: SyncDirection = 'BIDIRECTIONAL'
    ) => {
      clientLogger.debug('SyncTab: triggering sync', { instanceId, forceFull, direction })
      const result = await syncTrigger.triggerSync(instanceId, forceFull, direction)
      if (result) {
        // Refresh instances to get updated lastSyncAt
        instances.fetchInstances()
        // Refresh operations to show the new operation
        operations.fetchOperations()
      }
    },
    [syncTrigger, instances, operations]
  )

  // Handle connection test
  const handleTest = useCallback(async (instanceId: string) => {
    clientLogger.debug('SyncTab: testing connection', { instanceId })
    const result = await instances.testConnection(instanceId)
    if (result) {
      if (result.success) {
        clientLogger.info('SyncTab: connection test successful', {
          instanceId,
          versionInfo: result.versionInfo,
        })
      } else {
        clientLogger.warn('SyncTab: connection test failed', {
          instanceId,
          error: result.error,
        })
      }
    }
  }, [instances])

  // Handle delete
  const handleDelete = useCallback(async (instanceId: string) => {
    clientLogger.debug('SyncTab: deleting instance', { instanceId })
    await instances.deleteInstance(instanceId)
  }, [instances])

  // Handle progress bar dismiss
  const handleDismissProgress = useCallback(() => {
    syncProgress.clearProgress()
    syncTrigger.clearActiveOperation()
    setSyncingInstanceName('')
  }, [syncProgress, syncTrigger])

  // Loading state
  if (instances.fetchOp.loading && instances.instances.length === 0) {
    return <LoadingState message="Loading sync instances..." />
  }

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="qt-bg-surface qt-border rounded-lg p-4">
        <h2 className="qt-text-primary font-medium mb-2">Sync Settings</h2>
        <p className="qt-text-small text-muted-foreground">
          Configure synchronization with other Quilltap instances. Add remote instances to sync
          your characters, personas, chats, memories, tags, and templates across multiple
          installations. Profiles and API keys are never synced.
        </p>
      </div>

      {/* Sync Progress Bar */}
      {(syncProgress.progress || syncTrigger.syncingInstanceId) && (
        <SyncProgressBar
          progress={syncProgress.progress}
          instanceName={syncingInstanceName}
          isComplete={syncProgress.isComplete}
          isFailed={syncProgress.isFailed}
          onDismiss={handleDismissProgress}
        />
      )}

      {/* API Key Panel - for receiving sync requests */}
      <ApiKeyPanel
        keys={apiKeys.keys}
        newlyCreatedKey={apiKeys.newlyCreatedKey}
        isLoading={apiKeys.fetchOp.loading}
        isCreating={apiKeys.createOp.loading}
        deleteConfirmId={apiKeys.deleteConfirm}
        success={apiKeys.success}
        error={apiKeys.createOp.error || apiKeys.deleteOp.error}
        onCreateKey={apiKeys.createKey}
        onDeleteKey={apiKeys.deleteKey}
        onDeleteConfirmToggle={apiKeys.setDeleteConfirm}
        onClearNewKey={apiKeys.clearNewlyCreatedKey}
      />

      {/* Cleanup Panel - for resetting sync state */}
      <CleanupPanel
        showConfirm={cleanup.showConfirm}
        lastResult={cleanup.lastResult}
        isLoading={cleanup.cleanupOp.loading}
        error={cleanup.cleanupOp.error}
        onShowConfirm={cleanup.setShowConfirm}
        onCleanup={cleanup.executeCleanup}
        onClearResult={cleanup.clearResult}
      />

      {/* Error alerts */}
      {instances.fetchOp.error && (
        <ErrorAlert
          message={instances.fetchOp.error}
          onRetry={instances.fetchInstances}
        />
      )}

      {instances.saveOp.error && (
        <ErrorAlert
          message={instances.saveOp.error}
          onRetry={() => {}}
        />
      )}

      {instances.deleteOp.error && (
        <ErrorAlert
          message={instances.deleteOp.error}
          onRetry={() => {}}
        />
      )}

      {syncTrigger.syncOp.error && (
        <ErrorAlert
          message={syncTrigger.syncOp.error}
          onRetry={() => {}}
        />
      )}

      {instances.testOp.error && (
        <ErrorAlert
          message={`Connection test failed: ${instances.testOp.error}`}
          onRetry={() => {}}
        />
      )}

      {/* Success message */}
      {instances.success && (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
          {instances.success}
        </div>
      )}

      {/* Form section */}
      {isFormOpen ? (
        <div className="qt-bg-card qt-border rounded-lg p-4">
          <h3 className="qt-text-primary font-medium mb-4">
            {editingInstance ? 'Edit Sync Instance' : 'Add Sync Instance'}
          </h3>
          <InstanceForm
            formData={formData}
            isEditing={!!editingInstance}
            isSaving={instances.saveOp.loading}
            onSubmit={handleFormSubmit}
            onChange={handleFormChange}
            onCancel={closeForm}
          />
        </div>
      ) : (
        <InstanceList
          instances={instances.instances}
          syncingInstanceId={syncTrigger.syncingInstanceId}
          deleteConfirmId={instances.deleteConfirm}
          onEdit={openEditForm}
          onDelete={handleDelete}
          onSync={handleSync}
          onTest={handleTest}
          onDeleteConfirmToggle={instances.setDeleteConfirm}
          onCreate={openCreateForm}
        />
      )}

      {/* Sync history panel */}
      {!isFormOpen && (
        <SyncHistoryPanel
          operations={operations.operations}
          isLoading={operations.fetchOp.loading}
        />
      )}
    </div>
  )
}
