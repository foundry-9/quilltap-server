'use client'

/**
 * FilePermissionsManager Component
 *
 * UI for viewing and managing LLM file write permissions.
 * Shows granted permissions with ability to revoke them.
 */

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface Permission {
  id: string
  scope: 'SINGLE_FILE' | 'PROJECT' | 'GENERAL'
  projectId?: string | null
  projectName?: string | null
  fileId?: string | null
  filename?: string | null
  grantedAt: string
  grantedInChatId?: string | null
  createdAt: string
}

interface FilePermissionsManagerProps {
  /** Optional class name */
  className?: string
}

function getScopeDisplayName(permission: Permission): string {
  switch (permission.scope) {
    case 'SINGLE_FILE':
      return `Single file: ${permission.filename || permission.fileId || 'Unknown'}`
    case 'PROJECT':
      return `Project: ${permission.projectName || permission.projectId || 'Unknown'}`
    case 'GENERAL':
      return 'All general files'
    default:
      return permission.scope
  }
}

function getScopeIcon(scope: string): string {
  switch (scope) {
    case 'SINGLE_FILE':
      return '📄'
    case 'PROJECT':
      return '📁'
    case 'GENERAL':
      return '🗂️'
    default:
      return '📝'
  }
}

export default function FilePermissionsManager({
  className = '',
}: Readonly<FilePermissionsManagerProps>) {
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)

  const fetchPermissions = useCallback(async () => {
    try {
      setLoading(true)
      clientLogger.debug('[FilePermissionsManager] Fetching permissions')

      const res = await fetch('/api/v1/files/write-permissions')
      if (res.ok) {
        const data = await res.json()
        setPermissions(data.permissions || [])
        clientLogger.debug('[FilePermissionsManager] Loaded permissions', {
          count: data.permissions?.length || 0,
        })
      } else {
        throw new Error('Failed to fetch permissions')
      }
    } catch (error) {
      clientLogger.error('[FilePermissionsManager] Failed to fetch permissions', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to load file permissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPermissions()
  }, [fetchPermissions])

  const handleRevoke = async (permissionId: string) => {
    if (!confirm('Are you sure you want to revoke this permission? The LLM will need to request permission again for future writes.')) {
      return
    }

    try {
      setRevoking(permissionId)
      clientLogger.debug('[FilePermissionsManager] Revoking permission', { permissionId })

      const res = await fetch('/api/v1/files/write-permissions?action=revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionId }),
      })

      if (res.ok) {
        setPermissions(permissions.filter(p => p.id !== permissionId))
        showSuccessToast('Permission revoked')
        clientLogger.info('[FilePermissionsManager] Permission revoked', { permissionId })
      } else {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to revoke permission')
      }
    } catch (error) {
      clientLogger.error('[FilePermissionsManager] Failed to revoke permission', {
        permissionId,
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to revoke permission')
    } finally {
      setRevoking(null)
    }
  }

  const handleRevokeAll = async () => {
    if (!confirm('Are you sure you want to revoke ALL file write permissions? The LLM will need to request permission again for any future writes.')) {
      return
    }

    try {
      setRevoking('all')
      clientLogger.debug('[FilePermissionsManager] Revoking all permissions')

      // Revoke each permission
      for (const permission of permissions) {
        await fetch('/api/v1/files/write-permissions?action=revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionId: permission.id }),
        })
      }

      setPermissions([])
      showSuccessToast('All permissions revoked')
      clientLogger.info('[FilePermissionsManager] All permissions revoked')
    } catch (error) {
      clientLogger.error('[FilePermissionsManager] Failed to revoke all permissions', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to revoke some permissions')
      // Refresh to get current state
      fetchPermissions()
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">File Write Permissions</h2>
          <p className="qt-text-small text-muted-foreground mt-1">
            Manage which files the LLM can write without asking
          </p>
        </div>
        {permissions.length > 0 && (
          <button
            onClick={handleRevokeAll}
            disabled={revoking !== null}
            className="qt-button qt-button-secondary text-destructive hover:bg-destructive/10"
          >
            Revoke All
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8">
          <span className="qt-text-small text-muted-foreground">Loading permissions...</span>
        </div>
      ) : permissions.length === 0 ? (
        <div className="text-center py-8 border border-border rounded-lg bg-muted/50">
          <div className="text-4xl mb-2">🔒</div>
          <p className="text-muted-foreground">No file write permissions granted</p>
          <p className="qt-text-xs text-muted-foreground mt-1">
            The LLM will ask for permission before writing files
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {permissions.map((permission) => (
            <div
              key={permission.id}
              className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getScopeIcon(permission.scope)}</span>
                <div>
                  <div className="font-medium">{getScopeDisplayName(permission)}</div>
                  <div className="qt-text-xs text-muted-foreground">
                    Granted {new Date(permission.grantedAt).toLocaleDateString()}
                    {permission.grantedInChatId && ' (during chat)'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleRevoke(permission.id)}
                disabled={revoking !== null}
                className="qt-button qt-button-secondary text-destructive hover:bg-destructive/10"
              >
                {revoking === permission.id ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 p-4 border border-border rounded-lg bg-muted/50">
        <h3 className="font-medium mb-2">About File Write Permissions</h3>
        <ul className="qt-text-small text-muted-foreground space-y-1 list-disc list-inside">
          <li><strong>Single File</strong>: Permission for one specific file only</li>
          <li><strong>Project</strong>: Permission to write any file in a specific project</li>
          <li><strong>General</strong>: Permission to write files not in any project</li>
        </ul>
        <p className="qt-text-small text-muted-foreground mt-2">
          You can revoke permissions at any time. The LLM will need to request permission again.
        </p>
      </div>
    </div>
  )
}
