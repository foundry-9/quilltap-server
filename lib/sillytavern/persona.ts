/**
 * SillyTavern Persona Import/Export
 */

export interface STPersona {
  name: string
  description: string
  title?: string
  personality?: string
  scenario?: string
  mes_example?: string
  avatar?: string
  [key: string]: any
}

/**
 * Import SillyTavern persona data to internal format
 * @deprecated Use importSTPersonaAsCharacter for new imports
 */
export function importSTPersona(stData: STPersona) {
  return {
    name: stData.name,
    description: stData.description,
    title: stData.title || '',
    personalityTraits: stData.personality || '',
    sillyTavernData: stData, // Store original for full fidelity
  }
}

/**
 * Import SillyTavern persona data as a Character with controlledBy: 'user'
 * Characters Not Personas - Phase 6
 *
 * This is the new preferred method for importing personas, as personas
 * are now just characters that are user-controlled.
 */
export function importSTPersonaAsCharacter(stData: STPersona) {
  return {
    name: stData.name,
    description: stData.description,
    title: stData.title || '',
    personality: stData.personality || '', // Use 'personality' for characters
    controlledBy: 'user' as const, // Mark as user-controlled
    sillyTavernData: stData, // Store original for full fidelity
    // Character-specific defaults
    talkativeness: 0.5,
    defaultConnectionProfileId: null, // User-controlled characters don't need an LLM
  }
}

/**
 * Export internal persona to SillyTavern format
 */
export function exportSTPersona(persona: any): STPersona {
  // If we have original ST data, use it as base
  const baseData: STPersona = persona.sillyTavernData || {
    name: persona.name,
    description: persona.description,
  }

  // Override with current values
  return {
    ...baseData,
    name: persona.name,
    description: persona.description,
    title: persona.title || '',
    personality: persona.personalityTraits || '',
  }
}

