'use client'

/**
 * ProfileCard - Backward-compatible alias for SettingsCard
 *
 * This component is now a thin wrapper around SettingsCard.
 * All new code should use SettingsCard directly.
 * Existing imports of ProfileCard will continue to work.
 */

import {
  SettingsCard,
  SettingsCardBadge,
  SettingsCardMetadata,
  SettingsCardAction,
  SettingsCardDeleteConfig,
  SettingsCardProps,
} from './SettingsCard'

// Re-export types with original names for backward compatibility
export type ProfileCardBadge = SettingsCardBadge
export type ProfileCardMetadata = SettingsCardMetadata
export type ProfileCardAction = SettingsCardAction
export type ProfileCardDeleteConfig = SettingsCardDeleteConfig
export type ProfileCardProps = SettingsCardProps

// ProfileCard is now an alias for SettingsCard
export const ProfileCard = SettingsCard

export default ProfileCard
