'use client'

/**
 * Description Source Step
 *
 * Step 2: Select the source for physical description generation.
 */

import { useState, useRef } from 'react'
import { ImageGallery, type ImageData } from '@/components/images/image-gallery'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { DescriptionSourceType } from '../types'

interface DescriptionSourceStepProps {
  source: DescriptionSourceType
  onSourceChange: (source: DescriptionSourceType) => void
  uploadedImageId: string | null
  uploadedImageUrl: string | null
  onImageUpload: (imageId: string, imageUrl: string) => void
  selectedGalleryImageId: string | null
  selectedGalleryImageUrl: string | null
  onGallerySelect: (imageId: string, imageUrl: string) => void
  needsVisionProfile: boolean
  visionProfileId: string | null
  visionProfiles: ConnectionProfile[]
  onVisionProfileSelect: (profileId: string) => void
  characterId?: string
}

export function DescriptionSourceStep({
  source,
  onSourceChange,
  uploadedImageId,
  uploadedImageUrl,
  onImageUpload,
  selectedGalleryImageId,
  selectedGalleryImageUrl,
  onGallerySelect,
  needsVisionProfile,
  visionProfileId,
  visionProfiles,
  onVisionProfileSelect,
  characterId,
}: DescriptionSourceStepProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      // Add character tag if available
      if (characterId) {
        formData.append('tags', JSON.stringify([{ tagType: 'CHARACTER', tagId: characterId }]))
      }

      const response = await fetch('/api/images', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload image')
      }

      onImageUpload(data.data.id, data.data.url || `/api/images/${data.data.id}/file`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleGalleryImageSelect = (image: ImageData) => {
    onGallerySelect(image.id, image.url || `/api/images/${image.id}/file`)
    setShowGallery(false)
  }

  const sourceOptions: { value: DescriptionSourceType; label: string; description: string }[] = [
    {
      value: 'existing',
      label: 'Use existing character data',
      description: 'Derive physical appearance from the description and personality fields',
    },
    {
      value: 'upload',
      label: 'Upload a new image',
      description: 'Upload an image to analyze and generate physical description',
    },
    {
      value: 'gallery',
      label: 'Select from gallery',
      description: 'Choose an existing image from the character\'s gallery',
    },
    {
      value: 'skip',
      label: 'Skip physical description',
      description: 'Don\'t generate physical descriptions for this character',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Physical Description Source
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose how to generate physical descriptions for image generation.
        </p>
      </div>

      {/* Source Selection */}
      <div className="space-y-3">
        {sourceOptions.map((option) => (
          <label
            key={option.value}
            className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              source === option.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/50'
            }`}
          >
            <input
              type="radio"
              name="descriptionSource"
              value={option.value}
              checked={source === option.value}
              onChange={() => onSourceChange(option.value)}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-foreground">{option.label}</div>
              <div className="text-sm text-muted-foreground">{option.description}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Upload Section */}
      {source === 'upload' && (
        <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-4">
          <h4 className="font-medium text-foreground">Upload Image</h4>

          {uploadedImageUrl ? (
            <div className="space-y-3">
              <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-border">
                { }
                <img
                  src={uploadedImageUrl}
                  alt="Uploaded"
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  onImageUpload('', '')
                }}
                className="text-sm text-destructive hover:underline"
              >
                Remove image
              </button>
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
                id="wizard-image-upload"
              />
              <label
                htmlFor="wizard-image-upload"
                className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                  uploading
                    ? 'border-muted bg-muted/50 cursor-not-allowed'
                    : 'border-border hover:border-primary hover:bg-primary/5'
                }`}
              >
                {uploading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Uploading...</span>
                  </div>
                ) : (
                  <>
                    <svg className="w-8 h-8 text-muted-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm text-muted-foreground">Click to upload image</span>
                    <span className="text-xs text-muted-foreground mt-1">JPEG, PNG, GIF, WebP</span>
                  </>
                )}
              </label>
            </div>
          )}

          {uploadError && (
            <p className="text-sm text-destructive">{uploadError}</p>
          )}
        </div>
      )}

      {/* Gallery Section */}
      {source === 'gallery' && (
        <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-4">
          <h4 className="font-medium text-foreground">Select from Gallery</h4>

          {selectedGalleryImageUrl ? (
            <div className="space-y-3">
              <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-border">
                { }
                <img
                  src={selectedGalleryImageUrl}
                  alt="Selected"
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowGallery(true)}
                className="qt-button-secondary text-sm"
              >
                Change selection
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowGallery(true)}
              className="qt-button-secondary"
            >
              Browse Gallery
            </button>
          )}

          {/* Gallery Modal */}
          {showGallery && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="qt-dialog w-full max-w-4xl max-h-[80vh] m-4 flex flex-col">
                <div className="qt-dialog-header flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Select Image</h3>
                  <button
                    type="button"
                    onClick={() => setShowGallery(false)}
                    className="qt-button-icon qt-button-ghost"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-4 overflow-y-auto flex-1">
                  <ImageGallery
                    tagType={characterId ? 'CHARACTER' : undefined}
                    tagId={characterId}
                    onSelectImage={handleGalleryImageSelect}
                    selectedImageId={selectedGalleryImageId || undefined}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vision Profile Selection (if needed) */}
      {needsVisionProfile && (source === 'upload' || source === 'gallery') && (
        <div className="p-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 space-y-3">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 className="font-medium text-foreground">Vision Profile Required</h4>
              <p className="text-sm text-muted-foreground">
                Your selected AI model cannot process images. Please select a vision-capable model to analyze the image.
              </p>
            </div>
          </div>

          {visionProfiles.length > 0 ? (
            <div>
              <label htmlFor="visionProfile" className="qt-label">
                Vision Profile *
              </label>
              <select
                id="visionProfile"
                value={visionProfileId || ''}
                onChange={(e) => onVisionProfileSelect(e.target.value)}
                className="qt-select"
              >
                <option value="">Select a vision-capable profile...</option>
                {visionProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} - {profile.modelName})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-destructive">
              No vision-capable profiles available. Please create a profile with OpenAI, Anthropic, Google, or Grok.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
