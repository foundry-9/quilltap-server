'use client'

/**
 * Wardrobe Images — the designated image profile that draws pictures of
 * garments and outfits (`chatSettings.wardrobeImageSettings.imageProfileId`),
 * and whether the wardrobe tools may queue a picture of an item they create
 * or change (`generateFromTools`, off by default).
 *
 * Null means "the default image profile"; the server resolves it through
 * `resolveWardrobeImageProfile`, which deliberately ignores the Story
 * Backgrounds profile.
 *
 * @module components/settings/chat-settings/WardrobeImageSettings
 */

import { SettingsCard } from '@/components/ui/SettingsCard'
import type { ChatSettings, ImageProfile } from './types'
import { DEFAULT_WARDROBE_IMAGE_SETTINGS } from './types'

export interface WardrobeImageSettingsProps {
  settings: ChatSettings
  saving: boolean
  loadingProfiles: boolean
  imageProfiles: ImageProfile[]
  onProfileChange: (profileId: string | null) => Promise<void>
  onGenerateFromToolsChange: (enabled: boolean) => Promise<void>
}

/** One profile's line in the picker, with the uncensored desks marked. */
export function wardrobeImageProfileLabel(profile: ImageProfile): string {
  const base = `${profile.name} (${profile.provider} - ${profile.modelName})`
  return profile.isDangerousCompatible ? `${base} (uncensored)` : base
}

export function WardrobeImageSettings({
  settings,
  saving,
  loadingProfiles,
  imageProfiles,
  onProfileChange,
  onGenerateFromToolsChange,
}: WardrobeImageSettingsProps) {
  const wardrobeImageSettings = settings.wardrobeImageSettings ?? DEFAULT_WARDROBE_IMAGE_SETTINGS
  const defaultProfile = imageProfiles.find((profile) => profile.isDefault)

  return (
    <SettingsCard
      title="Wardrobe Images"
      subtitle="Pictures of every garment and outfit"
    >
      <div className="space-y-6">
        <div>
          <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer">
            <input
              type="checkbox"
              checked={wardrobeImageSettings.generateFromTools ?? false}
              onChange={(e) => onGenerateFromToolsChange(e.target.checked)}
              disabled={saving}
              className="qt-checkbox mt-1"
            />
            <div className="flex-1">
              <div className="font-medium text-foreground">
                Portraits from the Wardrobe Tools
              </div>
              <div className="qt-text-small mt-1">
                When a character runs up a new garment with the wardrobe tools, or alters one&apos;s
                look, send it round to the artist for a portrait. Each sitting is a paid commission,
                which is why the door stays shut until you open it.
              </div>
            </div>
          </label>
        </div>

        <div className="space-y-2">
          <label htmlFor="wardrobe-image-profile" className="block font-medium text-foreground">
            Wardrobe Artist
          </label>
          <p className="qt-text-small">
            Which artist draws the garments. Pick a desk that will not balk at the odd corset; the
            Concierge&apos;s uncensored desk stands in if it does.
          </p>
          <select
            id="wardrobe-image-profile"
            value={wardrobeImageSettings.imageProfileId ?? ''}
            onChange={(e) => onProfileChange(e.target.value || null)}
            disabled={saving || loadingProfiles}
            className="qt-select w-full max-w-md disabled:opacity-50"
          >
            <option value="">
              {defaultProfile
                ? `The default image profile (${defaultProfile.name})`
                : 'The default image profile'}
            </option>
            {imageProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {wardrobeImageProfileLabel(profile)}
              </option>
            ))}
          </select>
          {imageProfiles.length === 0 && !loadingProfiles && (
            <p className="qt-text-small qt-text-warning">
              The studio stands empty: no image profiles have been engaged. Commission one in Image
              Profiles above before any garment can sit for its portrait.
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
