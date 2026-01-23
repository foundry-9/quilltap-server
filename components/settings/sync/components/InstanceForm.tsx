'use client'

/**
 * InstanceForm Component
 *
 * Form for creating or editing sync instances.
 * Provides fields for name, URL, API key (only shown for new instances),
 * and active status checkbox.
 *
 * @module components/settings/sync/components/InstanceForm
 */

import { useEffect } from 'react';
import { SyncFormData } from '../types';

interface InstanceFormProps {
  formData: SyncFormData;
  isEditing: boolean;
  isSaving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onChange: (field: keyof SyncFormData, value: string | boolean) => void;
  onCancel: () => void;
}

/**
 * Form component for creating/editing sync instances
 */
export function InstanceForm({
  formData,
  isEditing,
  isSaving,
  onSubmit,
  onChange,
  onCancel,
}: InstanceFormProps) {
  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
  }, [isEditing, isSaving]);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="sync-instance-name" className="qt-label mb-2">
          Instance Name
        </label>
        <input
          id="sync-instance-name"
          type="text"
          value={formData.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="e.g., Production Server"
          required
          disabled={isSaving}
          className="qt-input"
        />
        <p className="qt-hint">
          A friendly name to identify this sync instance
        </p>
      </div>

      <div>
        <label htmlFor="sync-instance-url" className="qt-label mb-2">
          Instance URL
        </label>
        <input
          id="sync-instance-url"
          type="url"
          value={formData.url}
          onChange={(e) => onChange('url', e.target.value)}
          placeholder="https://quilltap.example.com"
          required
          disabled={isSaving}
          className="qt-input"
        />
        <p className="qt-hint">
          The base URL of the remote Quilltap instance
        </p>
      </div>

      {!isEditing && (
        <div>
          <label htmlFor="sync-instance-api-key" className="qt-label mb-2">
            API Key
          </label>
          <input
            id="sync-instance-api-key"
            type="password"
            value={formData.apiKey}
            onChange={(e) => onChange('apiKey', e.target.value)}
            placeholder="Enter API key"
            required
            disabled={isSaving}
            className="qt-input"
          />
          <p className="qt-hint">
            API key for authenticating with the remote instance. Cannot be changed after creation.
          </p>
        </div>
      )}

      {isEditing && (
        <div className="p-3 rounded-lg bg-muted">
          <p className="qt-text-small">
            <strong>Note:</strong> API keys cannot be changed after creation for security reasons.
            To use a new API key, delete this instance and create a new one.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          id="sync-instance-active"
          type="checkbox"
          checked={formData.isActive}
          onChange={(e) => onChange('isActive', e.target.checked)}
          disabled={isSaving}
          className="qt-checkbox"
        />
        <label htmlFor="sync-instance-active" className="qt-label cursor-pointer">
          Active
        </label>
      </div>
      <p className="qt-hint -mt-2 ml-6">
        Only active instances can be synced
      </p>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={isSaving}
          className="qt-button-primary"
        >
          {isSaving ? (
            <span className="flex items-center gap-2">
              <span className="qt-spinner-sm" />
              {isEditing ? 'Updating...' : 'Creating...'}
            </span>
          ) : (
            <>{isEditing ? 'Update Instance' : 'Create Instance'}</>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="qt-button-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
