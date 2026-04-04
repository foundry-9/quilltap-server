'use client';

/**
 * ImageUploadDialog Component
 * Phase 5: Enhanced with Image Generation
 * Dialog for uploading images, importing from URL, or generating with AI
 */

import { useState, useRef, FormEvent } from 'react';
import { ImageGenerationDialog } from './image-generation-dialog';

interface ImageUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  contextType?: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME';
  contextId?: string;
}

export function ImageUploadDialog({ isOpen, onClose, onSuccess, contextType, contextId }: ImageUploadDialogProps) {
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [showGeneration, setShowGeneration] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUploading(true);

    try {
      if (uploadMode === 'file') {
        if (!selectedFile) {
          throw new Error('Please select a file');
        }

        const formData = new FormData();
        formData.append('file', selectedFile);

        // Add tags if context is provided
        if (contextType && contextId) {
          formData.append('tags', JSON.stringify([{ tagType: contextType, tagId: contextId }]));
        }

        const response = await fetch('/api/v1/images', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to upload image');
        }
      } else {
        // URL import
        if (!imageUrl) {
          throw new Error('Please enter a URL');
        }

        const tags = contextType && contextId ? [{ tagType: contextType, tagId: contextId }] : undefined;

        const response = await fetch('/api/v1/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: imageUrl, tags }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to import image');
        }
      }

      // Success
      handleClose();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload/import image');
    } finally {
      setUploading(false);
    }
  }

  function handleClose() {
    setSelectedFile(null);
    setImageUrl('');
    setError(null);
    setUploadMode('file');
    onClose();
  }

  function handleGenerationClose() {
    setShowGeneration(false);
  }

  function handleGenerationSuccess() {
    handleClose();
    onSuccess?.();
  }

  return (
    <>
      {/* Generation Dialog - shown when generate tab is selected */}
      {showGeneration && (
        <ImageGenerationDialog
          isOpen={true}
          onClose={handleGenerationClose}
          onSuccess={handleGenerationSuccess}
          contextType={contextType as any}
          contextId={contextId}
        />
      )}

      {/* Upload/Import Dialog */}
      {!showGeneration && (
        <div className="qt-dialog-overlay" onClick={handleClose}>
          <div
            className="qt-dialog max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="qt-dialog-header">
              <h2 className="qt-dialog-title">Import Image</h2>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit}>
              <div className="px-6 py-4 space-y-4">
                {/* Upload Mode Toggle */}
                <div className="flex space-x-2 border-b qt-border-default">
                  <button
                    type="button"
                    onClick={() => setUploadMode('file')}
                    className={`px-4 py-2 font-medium transition-colors ${
                      uploadMode === 'file'
                        ? 'text-primary border-b-2 qt-border-primary'
                        : 'qt-text-secondary hover:text-foreground'
                    }`}
                  >
                    Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode('url')}
                    className={`px-4 py-2 font-medium transition-colors ${
                      uploadMode === 'url'
                        ? 'text-primary border-b-2 qt-border-primary'
                        : 'qt-text-secondary hover:text-foreground'
                    }`}
                  >
                    Import from URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGeneration(true)}
                    className={`px-4 py-2 font-medium transition-colors ${
                      showGeneration
                        ? 'text-primary border-b-2 qt-border-primary'
                        : 'qt-text-secondary hover:text-foreground'
                    }`}
                  >
                    Generate with AI
                  </button>
                </div>

                {/* File Upload */}
                {uploadMode === 'file' && (
                  <div>
                    <label className="block text-sm qt-text-primary mb-2">
                      Select Image File
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-foreground border border-input rounded-lg cursor-pointer qt-bg-muted focus:outline-none"
                    />
                    {selectedFile && (
                      <p className="mt-2 qt-text-small">
                        Selected: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                      </p>
                    )}
                  </div>
                )}

                {/* URL Import */}
                {uploadMode === 'url' && (
                  <div>
                    <label className="block text-sm qt-text-primary mb-2">Image URL</label>
                    <input
                      type="url"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://example.com/image.jpg"
                      className="qt-input"
                    />
                  </div>
                )}

                {/* Context Info */}
                {contextType && contextId && (
                  <div className="bg-accent border qt-border-default rounded-md p-3">
                    <p className="text-sm text-primary">
                      This image will be automatically tagged with this {contextType.toLowerCase()}.
                    </p>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="qt-alert-error">
                    <p className="qt-text-small">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="qt-dialog-footer">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={uploading}
                  className="qt-button qt-button-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || (uploadMode === 'file' && !selectedFile) || (uploadMode === 'url' && !imageUrl)}
                  className="qt-button qt-button-primary"
                >
                  {uploading ? 'Uploading...' : uploadMode === 'file' ? 'Upload' : 'Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
