'use client'

/**
 * SyncStatusBadge Component
 *
 * A badge component that displays the status of a sync operation with appropriate colors.
 * Uses qt-* utility classes for theming.
 *
 * @module components/settings/sync/components/SyncStatusBadge
 */

interface SyncStatusBadgeProps {
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
}

/**
 * Badge component showing sync status with color-coded styling
 */
export function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded qt-text-xs font-medium bg-muted qt-text-primary">
        Never synced
      </span>
    );
  }

  // Determine badge styling based on status
  const getStatusStyles = () => {
    switch (status) {
      case 'SUCCESS':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'PARTIAL':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'FAILED':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'IN_PROGRESS':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse';
      case 'PENDING':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
      default:
        return 'bg-muted qt-text-primary';
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'SUCCESS':
        return 'Success';
      case 'PARTIAL':
        return 'Partial';
      case 'FAILED':
        return 'Failed';
      case 'IN_PROGRESS':
        return 'In Progress';
      case 'PENDING':
        return 'Pending';
      default:
        return 'Unknown';
    }
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded qt-text-xs font-medium ${getStatusStyles()}`}
    >
      {getStatusLabel()}
    </span>
  );
}
