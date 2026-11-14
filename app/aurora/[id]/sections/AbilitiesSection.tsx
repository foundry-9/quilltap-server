'use client'

/**
 * Abilities — *What may they do, see and be?* Every boolean and tri-state about
 * the character's powers, in one place, each saving on change. A tri-state
 * shows what *Inherit* resolves to now.
 *
 * @module app/aurora/[id]/sections/AbilitiesSection
 */

import { CanDrawDiagramsToggle } from '@/components/characters/CanDrawDiagramsToggle'
import { CanChooseOutfitToggle } from '@/components/wardrobe/CanChooseOutfitToggle'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { SectionCard } from '../components/SectionCard'
import { ToggleRow, TriStateSelect } from '../components/TriStateSelect'
import { useCharacterPage } from '../CharacterPageContext'

/** The built-in default for the wardrobe and inventory permissions (`!== false`). */
const HOUSE_DEFAULT = 'the house default'

export function AbilitiesSection() {
  const { character, autosave, readOnly } = useCharacterPage()
  const { data: coreWhisperEnabled } = useChatSettingsQuery((s) => s.coreWhisper?.enabled ?? true)
  const save = autosave.saveNow
  const name = character.name

  return (
    <div className="space-y-6">
      <SectionCard title="Trust & perception" anchor="trust">
        <ToggleRow
          label="System transparency"
          checked={character.systemTransparency === true}
          disabled={readOnly}
          onChange={(systemTransparency) =>
            void save({ systemTransparency }, 'System transparency could not be saved.')
          }
          description={
            <>
              <p>
                {character.systemTransparency === true ? (
                  <>
                    <em>On:</em> &ldquo;My character will be able to verify everything about their existence,
                    including how they are crafted and how they interact with me.&rdquo;
                  </>
                ) : (
                  <>
                    <em>Off:</em> &ldquo;My character will trust me without being able to verify me. I accept the
                    covenant of that trust.&rdquo;
                  </>
                )}
              </p>
              <p className="mt-2">
                When off, {name} cannot use the <code>self_inventory</code> tool, cannot perceive announcements from
                the Staff (the Lantern, Aurora, the Librarian, and so on), and cannot reach any character vault &mdash;
                their own included &mdash; through the document tools. This overrides any chat- or project-level toggle
                for those three things; turning it on lets those settings have their say.
              </p>
            </>
          }
        />
        <TriStateSelect
          label="Aurora's Core whisper"
          description={
            <>
              Whether Aurora periodically re-offers {name} their own <code>Core/</code> vault folder before they next
              take the floor. A chat may still switch it off for itself.
            </>
          }
          value={character.coreWhisperEnabled}
          inherited={coreWhisperEnabled ?? null}
          inheritedFrom="the Chat settings"
          onLabel="Always offered"
          offLabel="Never offered"
          disabled={readOnly}
          onChange={(coreWhisperEnabled) =>
            void save({ coreWhisperEnabled }, "Aurora's Core whisper setting could not be saved.")
          }
        />
      </SectionCard>

      <SectionCard title="Tools & talents" anchor="talents">
        <ToggleRow
          label="Can answer @-queries (Carina)"
          checked={character.canBeCarina === true}
          disabled={readOnly}
          onChange={(canBeCarina) => void save({ canBeCarina }, 'The Carina setting could not be saved.')}
          description={
            <>
              When on, {name} may be invoked with <code>@Name</code> in any chat to field a quick question by way of
              their personality and tools &mdash; without so much as setting foot in the conversation proper.
            </>
          }
        />
        <CanDrawDiagramsToggle
          checked={character.canDrawDiagrams ?? false}
          style={character.diagramStyle ?? 'handDrawn'}
          saving={false}
          disabled={readOnly}
          onChange={(canDrawDiagrams) => void save({ canDrawDiagrams }, 'The diagram setting could not be saved.')}
          onStyleChange={(diagramStyle) => void save({ diagramStyle }, 'The diagram style could not be saved.')}
        />
      </SectionCard>

      <SectionCard title="Wardrobe & inventory" anchor="wardrobe-permissions">
        <TriStateSelect
          label="Dresses themselves"
          description="Whether they may change their own outfit mid-conversation with the wardrobe tools."
          value={character.canDressThemselves}
          inherited={true}
          inheritedFrom={HOUSE_DEFAULT}
          disabled={readOnly}
          onChange={(canDressThemselves) =>
            void save({ canDressThemselves }, 'The self-dressing setting could not be saved.')
          }
        />
        <TriStateSelect
          label="Creates outfits"
          description="Whether they may make new wardrobe items mid-conversation. Requires tool use."
          value={character.canCreateOutfits}
          inherited={true}
          inheritedFrom={HOUSE_DEFAULT}
          disabled={readOnly}
          onChange={(canCreateOutfits) =>
            void save({ canCreateOutfits }, 'The outfit-creation setting could not be saved.')
          }
        />
        <CanChooseOutfitToggle
          checked={character.canChooseOutfit ?? false}
          saving={false}
          disabled={readOnly}
          onChange={(canChooseOutfit) =>
            void save({ canChooseOutfit }, 'The opening-outfit setting could not be saved.')
          }
        />
        <TriStateSelect
          label="Manages inventory"
          description="Whether they may see, pick up, equip, set down, make and give away the objects they carry, with the inventory tools. Requires tool use."
          value={character.canManageInventory}
          inherited={true}
          inheritedFrom={HOUSE_DEFAULT}
          disabled={readOnly}
          onChange={(canManageInventory) =>
            void save({ canManageInventory }, 'The inventory setting could not be saved.')
          }
        />
      </SectionCard>

      <SectionCard title="Control" anchor="control">
        <ToggleRow
          label="You play this character"
          checked={character.controlledBy === 'user'}
          disabled={readOnly}
          onChange={(mine) =>
            void save({ controlledBy: mine ? 'user' : 'llm' }, 'The control setting could not be saved.')
          }
          description={
            <>
              A user-controlled character is one of your own personas: you write their lines, and they can be chosen
              as the partner in other characters&rsquo; chats. Their default conversation partner no longer applies.
            </>
          }
        />
        <ToggleRow
          label="Non-player character"
          checked={character.npc === true}
          disabled={readOnly}
          onChange={(npc) => void save({ npc }, 'The NPC setting could not be saved.')}
          description="An NPC is a supporting player: listed after the principals in Aurora and left off the home page's character shelf. Nothing about how they chat changes."
        />
      </SectionCard>
    </div>
  )
}
