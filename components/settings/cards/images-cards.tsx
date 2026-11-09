'use client'

/**
 * Card bodies for the Images group.
 *
 * @module components/settings/cards/images-cards
 */

import { StoryBackgroundsSettings } from '@/components/settings/chat-settings/StoryBackgroundsSettings'
import { WardrobeImageSettings } from '@/components/settings/chat-settings/WardrobeImageSettings'
import { ImageDescriptionSettings } from '@/components/settings/chat-settings/ImageDescriptionSettings'
import { AestheticEditorField } from '@/components/settings/AestheticEditorField'
import { WithChatSettings } from './with-chat-settings'

export function StoryBackgroundsCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, loadingProfiles, imageProfiles, handleStoryBackgroundsEnabledChange, handleStoryBackgroundsProfileChange }) => (
        <StoryBackgroundsSettings
          settings={settings}
          saving={saving}
          loadingProfiles={loadingProfiles}
          imageProfiles={imageProfiles}
          onEnabledChange={handleStoryBackgroundsEnabledChange}
          onProfileChange={handleStoryBackgroundsProfileChange}
        />
      )}
    </WithChatSettings>
  )
}

export function WardrobeImagesCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, loadingProfiles, imageProfiles, handleWardrobeImageProfileChange, handleWardrobeImageGenerateFromToolsChange }) => (
        <WardrobeImageSettings
          settings={settings}
          saving={saving}
          loadingProfiles={loadingProfiles}
          imageProfiles={imageProfiles}
          onProfileChange={handleWardrobeImageProfileChange}
          onGenerateFromToolsChange={handleWardrobeImageGenerateFromToolsChange}
        />
      )}
    </WithChatSettings>
  )
}

export function DefaultAestheticsCard() {
  return (
    <div className="space-y-6">
      <AestheticEditorField
        label="Default Image Aesthetic"
        description="The overall look for scenes and backgrounds (medium, era, palette, rendering). Feeds story backgrounds and ad-hoc images."
        loadUrl="/api/v1/system/image-aesthetics?kind=lantern"
        namespace="DefaultImageAesthetic"
      />
      <AestheticEditorField
        label="Default Character Aesthetic"
        description="How people and their outfits are depicted. Feeds avatars, plus the figures rendered in story backgrounds and ad-hoc images."
        loadUrl="/api/v1/system/image-aesthetics?kind=aurora"
        namespace="DefaultCharacterAesthetic"
      />
    </div>
  )
}

export function ImageDescriptionCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, loadingProfiles, connectionProfiles, handleImageDescriptionProfileChange }) => (
        <ImageDescriptionSettings
          settings={settings}
          saving={saving}
          loadingProfiles={loadingProfiles}
          connectionProfiles={connectionProfiles}
          onProfileChange={handleImageDescriptionProfileChange}
        />
      )}
    </WithChatSettings>
  )
}
