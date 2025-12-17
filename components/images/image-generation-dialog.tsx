'use client';

/**
 * ImageGenerationDialog Component
 * Phase 5: UI Integration for Image Generation
 *
 * Dialog for generating images using configured LLM providers
 * Supports different generation options based on selected provider
 */

import { useState, useEffect, FormEvent } from 'react';

interface GenerationOption {
  n?: number;
  size?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  aspectRatio?: string;
}

interface ImageGenerationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  contextType?: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME';
  contextId?: string;
}

interface ConnectionProfile {
  id: string;
  name: string;
  provider: string;
  modelName: string;
}

type PreviewImage = {
  id: string;
  data: string;
  mimeType: string;
  revisedPrompt?: string;
};

const OPENAI_SIZES = ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'];
const DEFAULT_SIZES = ['1024x1024', '512x512'];

export function ImageGenerationDialog({
  isOpen,
  onClose,
  onSuccess,
  contextType,
  contextId
}: ImageGenerationDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);

  // Generation options
  const [options, setOptions] = useState<GenerationOption>({
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    style: 'vivid',
  });

  // Load image-capable profiles on open
  useEffect(() => {
    if (isOpen) {
      loadProfiles();
    }
  }, [isOpen]);

  async function loadProfiles() {
    setLoadingProfiles(true);
    setError(null);
    try {
      const response = await fetch('/api/profiles?imageCapable=true');
      if (!response.ok) {
        throw new Error('Failed to load profiles');
      }
      const data = await response.json();
      setProfiles(data.profiles || []);
      if (data.profiles && data.profiles.length > 0) {
        setSelectedProfileId(data.profiles[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
      setProfiles([]);
    } finally {
      setLoadingProfiles(false);
    }
  }

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);
  const isOpenAI = selectedProfile?.provider === 'OPENAI';
  const isGemini = selectedProfile?.provider === 'GOOGLE';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerating(true);
    setPreviewImages([]);

    try {
      if (!prompt.trim()) {
        throw new Error('Please enter a prompt');
      }

      if (!selectedProfileId) {
        throw new Error('Please select a provider');
      }

      const requestBody: any = {
        prompt: prompt.trim(),
        profileId: selectedProfileId,
        options: {},
      };

      // Add tags if context is provided
      if (contextType && contextId) {
        requestBody.tags = [{ tagType: contextType, tagId: contextId }];
      }

      // Add generation options
      if (options.n && options.n > 1) {
        requestBody.options.n = options.n;
      }
      if (options.size) {
        requestBody.options.size = options.size;
      }
      if (isOpenAI && options.quality) {
        requestBody.options.quality = options.quality;
      }
      if (isOpenAI && options.style) {
        requestBody.options.style = options.style;
      }
      if (isGemini && options.aspectRatio) {
        requestBody.options.aspectRatio = options.aspectRatio;
      }

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate images');
      }

      // Show preview of generated images
      const previews: PreviewImage[] = data.data.map((img: any, idx: number) => ({
        id: img.id || `preview-${idx}`,
        data: img.url || '',
        mimeType: img.mimeType,
        revisedPrompt: img.revisedPrompt,
      }));

      setPreviewImages(previews);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate images');
    } finally {
      setGenerating(false);
    }
  }

  function handleConfirm() {
    handleClose();
    onSuccess?.();
  }

  function handleClose() {
    setPrompt('');
    setSelectedProfileId('');
    setError(null);
    setPreviewImages([]);
    setOptions({
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      style: 'vivid',
    });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="qt-dialog-overlay" onClick={handleClose}>
      <div
        className="qt-dialog max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="qt-dialog-header sticky top-0">
          <h2 className="qt-dialog-title">Generate Image</h2>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-6">
            {/* Provider Selection */}
            <div>
              <label className="block text-sm qt-text-primary mb-2">
                Provider
              </label>
              {loadingProfiles ? (
                <div className="qt-text-small">Loading providers...</div>
              ) : profiles.length === 0 ? (
                <div className="qt-alert-warning">
                  <p className="text-sm">
                    No image-capable providers configured. Please set up OpenAI, Google, Grok, or OpenRouter in your connection profiles.
                  </p>
                </div>
              ) : (
                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="qt-select"
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.modelName})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Prompt Input */}
            <div>
              <label className="block text-sm qt-text-primary mb-2">
                Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate..."
                rows={4}
                maxLength={4000}
                className="qt-textarea resize-none"
              />
              <p className="mt-1 qt-text-xs">
                {prompt.length}/4000 characters
              </p>
            </div>

            {/* Generation Options */}
            {selectedProfile && (
              <div className="qt-panel space-y-4">
                <h3 className="text-sm font-semibold qt-text-primary">Generation Options</h3>

                {/* Number of Images */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block qt-text-xs qt-text-primary mb-1">
                      Number of Images
                    </label>
                    <select
                      value={options.n || 1}
                      onChange={(e) => setOptions({ ...options, n: Number.parseInt(e.target.value) })}
                      className="qt-select"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Image Size */}
                  <div>
                    <label className="block qt-text-xs qt-text-primary mb-1">
                      Size
                    </label>
                    <select
                      value={options.size || '1024x1024'}
                      onChange={(e) => setOptions({ ...options, size: e.target.value })}
                      className="qt-select"
                    >
                      {(isOpenAI ? OPENAI_SIZES : DEFAULT_SIZES).map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* OpenAI Specific Options */}
                {isOpenAI && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block qt-text-xs qt-text-primary mb-1">
                        Quality
                      </label>
                      <select
                        value={options.quality || 'standard'}
                        onChange={(e) => setOptions({ ...options, quality: e.target.value as any })}
                        className="qt-select"
                      >
                        <option value="standard">Standard</option>
                        <option value="hd">HD</option>
                      </select>
                    </div>

                    <div>
                      <label className="block qt-text-xs qt-text-primary mb-1">
                        Style
                      </label>
                      <select
                        value={options.style || 'vivid'}
                        onChange={(e) => setOptions({ ...options, style: e.target.value as any })}
                        className="qt-select"
                      >
                        <option value="vivid">Vivid</option>
                        <option value="natural">Natural</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Gemini Specific Options */}
                {isGemini && (
                  <div>
                    <label className="block qt-text-xs qt-text-primary mb-1">
                      Aspect Ratio
                    </label>
                    <select
                      value={options.aspectRatio || ''}
                      onChange={(e) => setOptions({ ...options, aspectRatio: e.target.value || undefined })}
                      className="qt-select"
                    >
                      <option value="">Default</option>
                      <option value="16:9">16:9 (Landscape)</option>
                      <option value="4:3">4:3 (Landscape)</option>
                      <option value="1:1">1:1 (Square)</option>
                      <option value="3:4">3:4 (Portrait)</option>
                      <option value="9:16">9:16 (Portrait)</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Context Info */}
            {contextType && contextId && (
              <div className="qt-alert-info">
                <p className="text-sm">
                  Generated images will be automatically tagged with this {contextType.toLowerCase()}.
                </p>
              </div>
            )}

            {/* Preview Images */}
            {previewImages.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold qt-text-primary mb-3">Generated Images</h3>
                <div className="grid grid-cols-2 gap-3">
                  {previewImages.map((img) => (
                    <div key={img.id} className="qt-card">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.data}
                        alt="Generated"
                        className="w-full h-48 object-cover bg-muted rounded"
                      />
                      {img.revisedPrompt && (
                        <div className="px-3 py-2 border-t border-border mt-2">
                          <p className="qt-text-xs">
                            <span className="font-semibold">Revised:</span> {img.revisedPrompt}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
          <div className="qt-dialog-footer sticky bottom-0">
            <button
              type="button"
              onClick={handleClose}
              disabled={generating}
              className="qt-button qt-button-secondary"
            >
              Cancel
            </button>
            {previewImages.length > 0 ? (
              <button
                type="button"
                onClick={handleConfirm}
                className="qt-button qt-button-primary"
              >
                Done
              </button>
            ) : (
              <button
                type="submit"
                disabled={generating || !selectedProfileId || profiles.length === 0}
                className="qt-button qt-button-primary"
              >
                {generating ? 'Generating...' : 'Generate'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
