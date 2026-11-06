'use client'

/**
 * Prompts — *What are they told, and what stage are they on?* The named system
 * prompts (the star is the one default control), the subprompts, and the
 * scenarios. The list itself is the view; there is no read-only copy.
 *
 * @module app/aurora/[id]/sections/PromptsSection
 */

import { SystemPromptsEditor } from '@/components/characters/SystemPromptsEditor'
import { SubpromptsSection } from '@/components/characters/system-prompts-editor/SubpromptsSection'
import { ScenariosCard } from '../cards/ScenariosCard'
import { useCharacterPage } from '../CharacterPageContext'

export function PromptsSection() {
  const { characterId, character, reload } = useCharacterPage()
  return (
    <div className="space-y-6">
      <div id="system-prompts" className="qt-card scroll-mt-48">
        <SystemPromptsEditor characterId={characterId} characterName={character.name} onUpdate={() => void reload()} />
      </div>
      <div id="subprompts" className="qt-card scroll-mt-48">
        <SubpromptsSection characterId={characterId} characterName={character.name} />
      </div>
      <ScenariosCard />
    </div>
  )
}
