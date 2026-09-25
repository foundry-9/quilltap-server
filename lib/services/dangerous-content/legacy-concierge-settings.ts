/**
 * Translating the retired Concierge settings into `conciergeSettings`.
 *
 * Before Concierge overhaul phase 4 the Concierge's settings lived in three
 * places: `chat_settings.dangerousContentSettings` (with the retired
 * OFF / DETECT_ONLY / AUTO_ROUTE mode), the top-level
 * `uncensoredImageDescriptionProfileId`, and `cheapLLMSettings.imagePromptProfileId`.
 * One pure translation serves both paths that still meet the old shape: the
 * `add-concierge-settings-v1` migration and a backup restore from before 4.10.
 *
 *   OFF          → enabled: false (pre-screen and summary classification off)
 *   DETECT_ONLY  → enabled: true, preScreen.enabled: true, summaryClassification: true
 *   AUTO_ROUTE   → enabled: true, preScreen.enabled: true, summaryClassification: true
 *
 * DETECT_ONLY gaining failover is the deliberate behaviour change of record.
 * One refinement keeps an explicit operator choice alive: under the old
 * resolver an Unmoderated chat routed to the uncensored desk even under a
 * global OFF, so an OFF user who has any Unmoderated chat translates to
 * `enabled: true` with the pre-screen off.
 *
 * Pure — no I/O.
 *
 * @module services/dangerous-content/legacy-concierge-settings
 */

/** The retired `dangerousContentSettings` shape, as stored. Every field may be missing. */
export interface LegacyDangerousContentSettings {
  mode?: string;
  threshold?: number;
  scanTextChat?: boolean;
  scanImagePrompts?: boolean;
  scanImageGeneration?: boolean;
  uncensoredTextProfileId?: string | null;
  uncensoredImageProfileId?: string | null;
  displayMode?: string;
  showWarningBadges?: boolean;
  customClassificationPrompt?: string | null;
  autoSwitchAfterRefusals?: number;
}

/** The three legacy sources for one user, already parsed. */
export interface LegacyConciergeSources {
  dangerousContentSettings?: LegacyDangerousContentSettings | null;
  uncensoredImageDescriptionProfileId?: string | null;
  cheapLLMSettings?: { imagePromptProfileId?: string | null } | null;
  /** Whether the user has any chat set Unmoderated. */
  hasUnmoderatedChats?: boolean;
}

/** The `conciergeSettings` object written by this migration. */
export interface MigratedConciergeSettings {
  enabled: boolean;
  uncensoredTextProfileId: string | null;
  uncensoredImageProfileId: string | null;
  uncensoredVisionProfileId: string | null;
  imagePromptProfileId: string | null;
  autoSwitchAfterRefusals: number;
  newChatsStartAs: 'moderated';
  display: { mode: 'SHOW' | 'BLUR' | 'COLLAPSE'; showWarningBadges: boolean };
  preScreen: {
    enabled: boolean;
    threshold: number;
    scanTextChat: boolean;
    scanImagePrompts: boolean;
    scanImageGeneration: boolean;
    customClassificationPrompt: string | null;
    summaryClassification: boolean;
  };
}

const DISPLAY_MODES = new Set(['SHOW', 'BLUR', 'COLLAPSE']);

function clampThreshold(value: unknown): number {
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : 0.7;
}

function clampAutoSwitch(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? value : 2;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function idOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Translate one user's legacy settings into `conciergeSettings`. A row with no
 * `dangerousContentSettings` at all reads as the retired schema default,
 * `mode: 'OFF'`.
 */
export function mapLegacyConciergeSettings(sources: LegacyConciergeSources): MigratedConciergeSettings {
  const dc = sources.dangerousContentSettings ?? {};
  const mode = dc.mode === 'DETECT_ONLY' || dc.mode === 'AUTO_ROUTE' ? dc.mode : 'OFF';
  const classifierWasOn = mode !== 'OFF';
  const enabled = classifierWasOn || sources.hasUnmoderatedChats === true;

  return {
    enabled,
    uncensoredTextProfileId: idOrNull(dc.uncensoredTextProfileId),
    uncensoredImageProfileId: idOrNull(dc.uncensoredImageProfileId),
    uncensoredVisionProfileId: idOrNull(sources.uncensoredImageDescriptionProfileId),
    imagePromptProfileId: idOrNull(sources.cheapLLMSettings?.imagePromptProfileId),
    autoSwitchAfterRefusals: clampAutoSwitch(dc.autoSwitchAfterRefusals),
    newChatsStartAs: 'moderated',
    display: {
      mode: (DISPLAY_MODES.has(dc.displayMode ?? '') ? dc.displayMode : 'SHOW') as 'SHOW' | 'BLUR' | 'COLLAPSE',
      showWarningBadges: bool(dc.showWarningBadges, true),
    },
    preScreen: {
      enabled: classifierWasOn,
      threshold: clampThreshold(dc.threshold),
      scanTextChat: bool(dc.scanTextChat, true),
      scanImagePrompts: bool(dc.scanImagePrompts, true),
      scanImageGeneration: bool(dc.scanImageGeneration, false),
      customClassificationPrompt: typeof dc.customClassificationPrompt === 'string' && dc.customClassificationPrompt.length > 0
        ? dc.customClassificationPrompt
        : null,
      summaryClassification: classifierWasOn,
    },
  };
}

/**
 * A settings record as a pre-4.10 backup carries it: the three legacy
 * sources, and possibly (from a 4.10+ backup) `conciergeSettings` already.
 */
export type SettingsWithLegacyConcierge<T> = T & LegacyConciergeSources & {
  conciergeSettings?: MigratedConciergeSettings | Record<string, unknown> | null
}

/**
 * Give a restored settings record its `conciergeSettings`, translated from
 * the legacy sources when it has none. A record that already carries one is
 * returned unchanged. The legacy keys are left for the repository's schema to
 * strip.
 */
export function withConciergeSettingsFromLegacy<T extends object>(
  settings: SettingsWithLegacyConcierge<T>,
  hasUnmoderatedChats: boolean,
): SettingsWithLegacyConcierge<T> {
  if (settings.conciergeSettings) return settings
  return {
    ...settings,
    conciergeSettings: mapLegacyConciergeSettings({
      dangerousContentSettings: settings.dangerousContentSettings,
      uncensoredImageDescriptionProfileId: settings.uncensoredImageDescriptionProfileId,
      cheapLLMSettings: settings.cheapLLMSettings,
      hasUnmoderatedChats,
    }),
  }
}
