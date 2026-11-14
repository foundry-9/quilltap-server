'use client';

/**
 * AvatarSelector Component
 * Allows selecting an image from the gallery to use as an avatar
 */

import { useState } from 'react';
import { BaseModal } from '@/components/ui/BaseModal';
import { ImageGallery, ImageData } from './image-gallery';
import { ImageUploadDialog } from './image-upload-dialog';

interface AvatarSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageId: string) => void | Promise<void>;
  currentImageId?: string;
  contextType?: 'CHARACTER' | 'CHAT';
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
        console.error('Error in avatar selection:', { error: err instanceof Error ? err.message : String(err) })
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
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title="Select Avatar"
        maxWidth="4xl"
        className="w-full mx-4 overflow-hidden"
        headerActions={
          <button
            onClick={() => setShowUploadDialog(true)}
            className="qt-button qt-button-primary"
          >
            Import Image
          </button>
        }
        footerClassName="qt-dialog-footer flex justify-between items-center"
        footer={
          <>
            <button
              onClick={() => {
                setSelectedImageId(undefined);
                onSelect('');
                onClose();
              }}
              className="qt-button qt-button-ghost"
            >
              Clear Avatar
            </button>
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                className="qt-button qt-button-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedImageId}
                className="qt-button qt-button-primary"
              >
                Set as Avatar
              </button>
            </div>
          </>
        }
      >
        <ImageGallery
          key={galleryKey}
          tagType={contextType}
          tagId={contextId}
          onSelectImage={handleSelectImage}
          selectedImageId={selectedImageId}
        />
      </BaseModal>

      {/* Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={handleUploadSuccess}
        contextType={contextType}
        contextId={contextId}
        generateOrientation="portrait"
      />
    </>
  );
}
