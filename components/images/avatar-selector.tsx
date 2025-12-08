'use client';

/**
 * AvatarSelector Component
 * Allows selecting an image from the gallery to use as an avatar
 */

import { useState } from 'react';
import { clientLogger } from '@/lib/client-logger';
import { ImageGallery, ImageData } from './image-gallery';
import { ImageUploadDialog } from './image-upload-dialog';

interface AvatarSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageId: string) => void | Promise<void>;
  currentImageId?: string;
  contextType?: 'CHARACTER' | 'PERSONA' | 'CHAT';
  contextId?: string;
}

export function AvatarSelector({
  isOpen,
  onClose,
  onSelect,
  currentImageId,
  contextType,
  contextId,
}: AvatarSelectorProps) {
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>(
    isOpen ? currentImageId : undefined
  );
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);

  if (!isOpen) return null;

  function handleSelectImage(image: ImageData) {
    setSelectedImageId(image.id);
  }

  async function handleConfirm() {
    if (selectedImageId) {
      try {
        await onSelect(selectedImageId);
        // Don't call onClose() here - let the callback handle closing the modal
      } catch (err) {
        clientLogger.error('Error in avatar selection:', { error: err instanceof Error ? err.message : String(err) })
        // onSelect should handle error toasts, but let it propagate if needed
      }
    }
  }

  function handleUploadSuccess() {
    // Reload gallery by changing key
    setGalleryKey((prev) => prev + 1);
  }

  function handleClose() {
    setSelectedImageId(currentImageId);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleClose}>
        <div
          className="bg-background border border-border rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">Select Avatar</h2>
            <button
              onClick={() => setShowUploadDialog(true)}
              className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Import Image
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-4 flex-1 overflow-y-auto">
            <ImageGallery
              key={galleryKey}
              tagType={contextType}
              tagId={contextId}
              onSelectImage={handleSelectImage}
              selectedImageId={selectedImageId}
            />
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-muted border-t border-border flex justify-between items-center">
            <button
              onClick={() => {
                setSelectedImageId(undefined);
                onSelect('');
                onClose();
              }}
              className="px-4 py-2 text-sm font-medium text-foreground hover:bg-accent rounded transition-colors"
            >
              Clear Avatar
            </button>
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedImageId}
                className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Set as Avatar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={handleUploadSuccess}
        contextType={contextType}
        contextId={contextId}
      />
    </>
  );
}
