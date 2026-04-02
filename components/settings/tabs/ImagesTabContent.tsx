'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import ImageProfilesTab from '@/components/settings/image-profiles-tab'
import { StoryBackgroundsSettings } from '@/components/settings/chat-settings/StoryBackgroundsSettings'
import { useSettingsSection } from './useSettingsSection'

export function ImagesTabContent() {
  const info = useSubsystemInfo('lantern')
  const activeSection = useSettingsSection()
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
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <CollapsibleCard title="Image Profiles" description="Configure image generation providers and models" sectionId="image-profiles" forceOpen={activeSection === 'image-profiles'}>
          <ImageProfilesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Story Backgrounds" description="Configure automatic story background image generation" sectionId="story-backgrounds" forceOpen={activeSection === 'story-backgrounds'}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="qt-text-secondary">Loading settings...</div>
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
