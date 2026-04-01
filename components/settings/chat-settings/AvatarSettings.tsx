'use client'

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
      <div>
        <h2 className="text-xl font-semibold mb-4">Message Avatar Display</h2>
        <p className="text-muted-foreground mb-4">
          Control how avatars are displayed in chat messages
        </p>

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
      </div>

      {/* Avatar Display Style */}
      <div className="border-t border-border pt-6">
        <h2 className="text-xl font-semibold mb-4">Avatar Display Style</h2>
        <p className="text-muted-foreground mb-4">
          Choose how avatars are shaped and displayed throughout the application
        </p>

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
      </div>
    </>
  )
}
