'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import { ChatSettings, AvatarDisplayMode, AvatarDisplayStyle, AVATAR_MODES, AVATAR_STYLES } from './types'

export interface AvatarSettingsProps {
  settings: ChatSettings
  saving: boolean
  onAvatarModeChange: (mode: AvatarDisplayMode) => Promise<void>
  onAvatarStyleChange: (style: AvatarDisplayStyle) => Promise<void>
}

/**
 * AvatarSettings Component
 * Manages avatar display mode and style preferences
 */
export function AvatarSettings({
  settings,
  saving,
  onAvatarModeChange,
  onAvatarStyleChange,
}: AvatarSettingsProps) {
  return (
    <>
      {/* Avatar Display Mode */}
      <SettingsCard
        title="Message Avatar Display"
        subtitle="Control how avatars are displayed in chat messages"
      >
        <div className="space-y-3">
          {AVATAR_MODES.map((mode) => (
            <label
              key={mode.value}
              className="flex items-start gap-3 p-4 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayMode"
                value={mode.value}
                checked={settings.avatarDisplayMode === mode.value}
                onChange={() => onAvatarModeChange(mode.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{mode.label}</div>
                <div className="qt-text-small">
                  {mode.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </SettingsCard>

      {/* Avatar Display Style */}
      <SettingsCard
        title="Avatar Display Style"
        subtitle="Choose how avatars are shaped and displayed throughout the application"
      >
        <div className="space-y-3">
          {AVATAR_STYLES.map((style) => (
            <label
              key={style.value}
              className="flex items-start gap-3 p-4 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayStyle"
                value={style.value}
                checked={settings.avatarDisplayStyle === style.value}
                onChange={() => onAvatarStyleChange(style.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{style.label}</div>
                <div className="qt-text-small">
                  {style.description}
                </div>
              </div>
              <div className="text-3xl">{style.preview}</div>
            </label>
          ))}
        </div>
      </SettingsCard>
    </>
  )
}
