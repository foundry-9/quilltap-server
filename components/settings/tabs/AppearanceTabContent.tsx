'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import AppearanceTab from '@/components/settings/appearance-tab'
import { AvatarSettings } from '@/components/settings/chat-settings/AvatarSettings'
import TagsTab from '@/components/settings/tags-tab'
import { useSettingsSection } from './useSettingsSection'

export function AppearanceTabContent() {
  const info = useSubsystemInfo('calliope')
  const activeSection = useSettingsSection()
  const {
    settings,
    loading,
    saving,
    handleAvatarModeChange,
    handleAvatarStyleChange,
  } = useChatSettingsContext()

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <CollapsibleCard title="Appearance" description="Theme selection, color mode, and display options" sectionId="appearance" forceOpen={activeSection === 'appearance'}>
          <AppearanceTab />
        </CollapsibleCard>

        <CollapsibleCard title="Avatar Settings" description="Configure avatar display mode and style" sectionId="avatar-settings" forceOpen={activeSection === 'avatar-settings'}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading settings...</div>
            </div>
          ) : settings ? (
            <AvatarSettings
              settings={settings}
              saving={saving}
              onAvatarModeChange={handleAvatarModeChange}
              onAvatarStyleChange={handleAvatarStyleChange}
            />
          ) : (
            <div className="qt-alert-error">Failed to load settings</div>
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Tags" description="Create and manage tags for organizing your content" sectionId="tags" forceOpen={activeSection === 'tags'}>
          <TagsTab />
        </CollapsibleCard>
      </div>
    </div>
  )
}
