'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import ImageProfilesTab from '@/components/settings/image-profiles-tab'
import { StoryBackgroundsSettings } from '@/components/settings/chat-settings/StoryBackgroundsSettings'

export function ImagesTabContent() {
  const info = useSubsystemInfo('lantern')
  const {
    settings,
    loading,
    saving,
    imageProfiles,
    loadingProfiles,
    handleStoryBackgroundsEnabledChange,
    handleStoryBackgroundsProfileChange,
  } = useChatSettingsContext()

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        {info.thumbnail && (
          <img src={info.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover opacity-60" />
        )}
        <p className="qt-text-small qt-text-muted italic">{info.description}</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Image Profiles" description="Configure image generation providers and models">
          <ImageProfilesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Story Backgrounds" description="Configure automatic story background image generation">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading settings...</div>
            </div>
          ) : settings ? (
            <StoryBackgroundsSettings
              settings={settings}
              saving={saving}
              loadingProfiles={loadingProfiles}
              imageProfiles={imageProfiles}
              onEnabledChange={handleStoryBackgroundsEnabledChange}
              onProfileChange={handleStoryBackgroundsProfileChange}
            />
          ) : (
            <div className="qt-alert-error">Failed to load settings</div>
          )}
        </CollapsibleCard>
      </div>
    </div>
  )
}
