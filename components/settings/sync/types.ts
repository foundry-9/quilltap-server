/**
 * Type definitions for sync settings UI
 *
 * These types are for the frontend UI components that manage sync instances
 * and display sync operations. Backend sync types are in /lib/sync/types.ts.
 */

/**
 * Sync instance display data for UI
 * Represents a remote Quilltap instance configured for synchronization
 */
export interface SyncInstanceDisplay {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatus | null;
  schemaVersion: string | null;
  appVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Sync operation display data for UI
 * Represents a completed or in-progress sync operation
 */
export interface SyncOperationDisplay {
  id: string;
  instanceId: string;
  instanceName: string;
  direction: SyncDirection;
  status: SyncOperationStatus;
  startedAt: string;
  completedAt: string | null;
  entityCounts: Record<string, number>;
  conflictCount: number;
  errorCount: number;
}

/**
 * Form data for creating or editing a sync instance
 */
export interface SyncFormData {
  name: string;
  url: string;
  apiKey: string;
  isActive: boolean;
}

/**
 * Initial/default values for sync instance form
 */
export const INITIAL_FORM_DATA: SyncFormData = {
  name: '',
  url: '',
  apiKey: '',
  isActive: true,
};

/**
 * Status of a completed sync operation
 */
export type SyncStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

/**
 * Status of a sync operation (including in-progress states)
 */
export type SyncOperationStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

/**
 * Direction of sync operation
 */
export type SyncDirection = 'PUSH' | 'PULL' | 'BIDIRECTIONAL';
