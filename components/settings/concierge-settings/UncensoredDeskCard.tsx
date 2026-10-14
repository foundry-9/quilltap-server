'use client'

import Link from 'next/link'
import type {
  ConciergeSettings,
  ConciergeSettingsUpdate,
  ConnectionProfile,
  ImageProfile,
} from '@/components/settings/chat-settings/types'

export interface UncensoredDeskCardProps {
  settings: ConciergeSettings
  saving: boolean
  connectionProfiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  loadingProfiles: boolean
  onUpdate: (updates: ConciergeSettingsUpdate) => Promise<void>
}

type ProfileLike = { id: string; name: string; provider: string; modelName?: string; apiKey?: unknown }

/**
 * A stored choice that is no longer on the compatible list (its tick was
 * removed, or it arrived from an older setting that allowed any profile)
 * is still shown, so the select never silently misreports what is saved.
 */
function withSelected<T extends ProfileLike>(list: T[], all: T[], selectedId: string | null | undefined): T[] {
  if (!selectedId || list.some((p) => p.id === selectedId)) return list
  const selected = all.find((p) => p.id === selectedId)
  return selected ? [...list, selected] : list
}

function profileLabel(profile: ProfileLike): string {
  const model = profile.modelName ? ` • ${profile.modelName}` : ''
  return `${profile.name} (${profile.provider}${model})`
}

interface DeskSelectProps {
  id: string
  label: string
  help: string
  value: string | null | undefined
  profiles: ProfileLike[]
  compatibleIds: Set<string>
  emptyOptionLabel: string
  disabled: boolean
  onChange: (profileId: string | null) => void
}

function DeskSelect({ id, label, help, value, profiles, compatibleIds, emptyOptionLabel, disabled, onChange }: DeskSelectProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block qt-text-label">
        {label}
      </label>
      <select
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="qt-select"
      >
        <option value="">{emptyOptionLabel}</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profileLabel(profile)}
            {!compatibleIds.has(profile.id) ? ' — not marked uncensored-compatible' : ''}
          </option>
        ))}
      </select>
      <p className="qt-text-small">{help}</p>
    </div>
  )
}

/**
 * The uncensored desk: which profiles the Concierge asks when the usual
 * providers refuse, plus the LLM that crafts image prompts for it. Always
 * shown, whatever the on-duty switch says, so an Unmoderated chat can
 * always name its profile.
 */
export function UncensoredDeskCard({
  settings,
  saving,
  connectionProfiles,
  imageProfiles,
  loadingProfiles,
  onUpdate,
}: UncensoredDeskCardProps) {
  const compatibleText = connectionProfiles.filter((p) => p.isDangerousCompatible)
  const compatibleVision = compatibleText.filter((p) => p.supportsImageUpload === true)
  const compatibleImage = imageProfiles.filter((p) => p.isDangerousCompatible)

  const compatibleIds = new Set<string>([
    ...compatibleText.map((p) => p.id),
    ...compatibleImage.map((p) => p.id),
  ])

  const disabled = saving || loadingProfiles
  const noneCompatible = !loadingProfiles && compatibleText.length === 0 && compatibleImage.length === 0

  return (
    <div className="space-y-6">
      {noneCompatible && (
        <div className="qt-alert-warning">
          <p className="qt-text-small">
            No profile is marked uncensored-compatible yet, so the desk has no one to send for. Tick
            &ldquo;Uncensored-compatible&rdquo; on a connection profile in{' '}
            <Link href="/settings?tab=providers" className="qt-link">AI Providers</Link>{' '}
            or on an image profile in{' '}
            <Link href="/settings?tab=images" className="qt-link">Images</Link>.
          </p>
        </div>
      )}

      <DeskSelect
        id="concierge-uncensored-text-profile"
        label="Text profile"
        help="Answers a chat when its provider refuses, and every turn of an Unmoderated chat."
        value={settings.uncensoredTextProfileId}
        profiles={withSelected(compatibleText, connectionProfiles, settings.uncensoredTextProfileId)}
        compatibleIds={compatibleIds}
        emptyOptionLabel="Auto-detect (first uncensored-compatible profile)"
        disabled={disabled}
        onChange={(id) => onUpdate({ uncensoredTextProfileId: id })}
      />

      <DeskSelect
        id="concierge-uncensored-image-profile"
        label="Image profile"
        help="Paints what the usual image provider refuses to."
        value={settings.uncensoredImageProfileId}
        profiles={withSelected(compatibleImage, imageProfiles, settings.uncensoredImageProfileId)}
        compatibleIds={compatibleIds}
        emptyOptionLabel="Auto-detect (first uncensored-compatible profile)"
        disabled={disabled}
        onChange={(id) => onUpdate({ uncensoredImageProfileId: id })}
      />

      <DeskSelect
        id="concierge-uncensored-vision-profile"
        label="Vision profile"
        help="Describes an attached image when the image-description profile refuses. Must support image attachments."
        value={settings.uncensoredVisionProfileId}
        profiles={withSelected(compatibleVision, connectionProfiles, settings.uncensoredVisionProfileId)}
        compatibleIds={compatibleIds}
        emptyOptionLabel="Auto-detect (first uncensored-compatible vision profile)"
        disabled={disabled}
        onChange={(id) => onUpdate({ uncensoredVisionProfileId: id })}
      />

      <div className="space-y-1">
        <label htmlFor="concierge-image-prompt-profile" className="block qt-text-label">
          Image prompt crafter
        </label>
        <select
          id="concierge-image-prompt-profile"
          value={settings.imagePromptProfileId || ''}
          onChange={(e) => onUpdate({ imagePromptProfileId: e.target.value || null })}
          disabled={disabled}
          className="qt-select"
        >
          <option value="">Use the cheap LLM</option>
          {connectionProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profileLabel(profile)}
              {!profile.apiKey ? ' ⚠️ No API Key' : ''}
            </option>
          ))}
        </select>
        <p className="qt-text-small">
          Writes the image prompts for the uncensored desk. Any connection profile will do; leave it on the
          cheap LLM unless that one balks.
        </p>
      </div>

      <div className="qt-alert-info">
        <p className="qt-text-small">
          Want the warning badges but never an uncensored model? Set your chats to Locked, or leave every
          desk profile on auto-detect and untick &ldquo;Uncensored-compatible&rdquo; on every profile, so there is
          no one for the Concierge to send for.
        </p>
      </div>
    </div>
  )
}
