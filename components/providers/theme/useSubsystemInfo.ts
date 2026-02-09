'use client';

/**
 * Subsystem Info Hook
 *
 * Merges default Foundry subsystem definitions with theme-provided
 * overrides so that any component can display the correct name,
 * description, and images for each subsystem.
 *
 * @module providers/theme/useSubsystemInfo
 */

import { useMemo } from 'react';
import { useTheme } from './useTheme';
import {
  DEFAULT_SUBSYSTEM_DEFINITIONS,
  CHILD_SUBSYSTEM_IDS,
  type SubsystemId,
  type SubsystemDefinition,
} from '@/lib/foundry/subsystem-defaults';

/**
 * Resolved subsystem info — defaults with theme overrides merged in.
 */
export interface ResolvedSubsystemInfo extends SubsystemDefinition {}

/**
 * Get resolved info for a single subsystem.
 *
 * Returns the default definition with any active-theme overrides
 * merged on top (name, description, thumbnail, backgroundImage).
 */
export function useSubsystemInfo(id: SubsystemId): ResolvedSubsystemInfo {
  const { subsystems } = useTheme();

  return useMemo(() => {
    const defaults = DEFAULT_SUBSYSTEM_DEFINITIONS[id];
    const overrides = subsystems?.[id];
    if (!overrides) return defaults;

    const bgImage = overrides.backgroundImage ?? defaults.backgroundImage;
    return {
      ...defaults,
      name: overrides.name ?? defaults.name,
      description: overrides.description ?? defaults.description,
      thumbnail: overrides.thumbnail === 'none' ? '' : (overrides.thumbnail ?? defaults.thumbnail),
      backgroundImage: bgImage === 'none' ? '' : bgImage,
    };
  }, [id, subsystems]);
}

/**
 * Get resolved info for all child subsystems (the 8 cards on the Foundry hub).
 *
 * Returns an array in the canonical display order.
 */
export function useAllSubsystemInfo(): ResolvedSubsystemInfo[] {
  const { subsystems } = useTheme();

  return useMemo(() => {
    return CHILD_SUBSYSTEM_IDS.map((id) => {
      const defaults = DEFAULT_SUBSYSTEM_DEFINITIONS[id];
      const overrides = subsystems?.[id];
      if (!overrides) return defaults;

      const bgImage = overrides.backgroundImage ?? defaults.backgroundImage;
      return {
        ...defaults,
        name: overrides.name ?? defaults.name,
        description: overrides.description ?? defaults.description,
        thumbnail: overrides.thumbnail === 'none' ? '' : (overrides.thumbnail ?? defaults.thumbnail),
        backgroundImage: bgImage === 'none' ? '' : bgImage,
      };
    });
  }, [subsystems]);
}
