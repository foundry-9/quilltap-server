'use client'

/**
 * Appearance — *What do they look like, and what do they wear?* Photos, the
 * physical description (autosaved, no Save button), depiction guidelines, the
 * wardrobe, the inventory and the character's own Atlas.
 *
 * @module app/aurora/[id]/sections/AppearanceSection
 */

import { EmbeddedPhotoGallery } from '@/components/images/EmbeddedPhotoGallery'
import { AestheticEditorField } from '@/components/settings/AestheticEditorField'
import { WardrobeInstructionsSection } from '@/components/wardrobe/WardrobeInstructionsSection'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { useInventoryDialogOptional } from '@/components/providers/inventory-dialog-provider'
import { useAtlasDialogOptional } from '@/components/providers/atlas-dialog-provider'
import { useAtlasList } from '@/lib/hooks/use-atlas'
import { useWardrobeTier } from '@/lib/hooks/use-wardrobe-tier'
import { useInventoryList } from '@/lib/hooks/use-inventory'
import { GENERAL_CONTAINER } from '@/lib/wardrobe/wardrobe-container'
import { SectionCard } from '../components/SectionCard'
import { PhysicalDescriptionCard } from '../cards/PhysicalDescriptionCard'
import { useCharacterPage } from '../CharacterPageContext'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function WardrobeCard() {
  const { characterId, character, readOnly } = useCharacterPage()
  const wardrobeDialog = useWardrobeDialogOptional()
  const own = useWardrobeTier({ container: { scope: 'character', id: characterId } })
  const groups = useWardrobeTier({ container: { scope: 'character', id: characterId }, groups: true })
  const general = useWardrobeTier({ container: GENERAL_CONTAINER })
  const counts = [
    own.items && plural(own.items.length, 'item of their own', 'items of their own'),
    groups.items && groups.items.length > 0 && plural(groups.items.length, 'from their groups', 'from their groups'),
    general.items && plural(general.items.length, 'on the General rail', 'on the General rail'),
  ].filter(Boolean)

  return (
    <SectionCard
      title="Wardrobe"
      anchor="wardrobe"
      description={
        counts.length > 0 ? (
          <>
            Within reach: {counts.join(' · ')}. A project&rsquo;s rail joins these inside that project&rsquo;s
            chats.
          </>
        ) : (
          'What they own and what they may borrow.'
        )
      }
      actions={
        <button
          type="button"
          onClick={() => wardrobeDialog?.open({ characterId })}
          disabled={!wardrobeDialog || readOnly}
          className="qt-button-primary"
        >
          Open wardrobe
        </button>
      }
    >
      <p className="qt-text-small qt-text-secondary">
        The wardrobe opens in a dialog that travels with you — edit, layer and save outfits from here or from inside a
        chat. Whether {character.name} may dress themselves or choose their own opening outfit is set under{' '}
        <em>Abilities</em>.
      </p>
      <WardrobeInstructionsSection container={{ scope: 'character', id: characterId }} />
    </SectionCard>
  )
}

function InventoryCard() {
  const { characterId, character, readOnly } = useCharacterPage()
  const inventoryDialog = useInventoryDialogOptional()
  const { items } = useInventoryList(
    { scope: 'character', id: characterId },
    { includeArchived: false, shared: true },
  )
  const objects = items.filter((item) => !item.isArchetype)
  const carried = objects.filter((item) => item.equippedByDefault)

  return (
    <SectionCard
      title="Inventory"
      anchor="inventory"
      description={`${plural(objects.length, 'object', 'objects')} within ${character.name}'s reach.`}
      actions={
        <button
          type="button"
          onClick={() => inventoryDialog?.open({ characterId })}
          disabled={!inventoryDialog || readOnly}
          className="qt-button-primary"
        >
          Open inventory
        </button>
      }
    >
      {carried.length === 0 ? (
        <p className="qt-text-small qt-text-secondary">
          Nothing is carried by default — they arrive in a chat empty-handed.
        </p>
      ) : (
        <p className="qt-text-small">
          Carried by default on arrival:{' '}
          {carried.map((item, i) => (
            <span key={item.id}>
              {i > 0 && ', '}
              <strong className="qt-text">{item.title || item.name}</strong>
            </span>
          ))}
          .
        </p>
      )}
    </SectionCard>
  )
}

function AtlasCard() {
  const { characterId, character, readOnly } = useCharacterPage()
  const atlasDialog = useAtlasDialogOptional()
  const { entries } = useAtlasList({ scope: 'character', id: characterId }, { includeArchived: false })

  return (
    <SectionCard
      title="The Atlas"
      anchor="atlas"
      description={`${plural(entries.length, 'entry', 'entries')} in ${character.name}'s private atlas.`}
      actions={
        <button
          type="button"
          onClick={() => atlasDialog?.open({ characterId })}
          disabled={!atlasDialog || readOnly}
          className="qt-button-primary"
        >
          Open atlas
        </button>
      }
    >
      <p className="qt-text-small qt-text-secondary">
        Things only {character.name} knows of — a private motorcar, a hidden room. When one is spoken of, {character.name}{' '}
        alone is told what is written here; the project&rsquo;s and General&rsquo;s atlases are told to everyone seated.
      </p>
    </SectionCard>
  )
}

export function AppearanceSection() {
  const { characterId, character, reload, autosave } = useCharacterPage()
  const depictionAutosave = {
    run: <T,>(fn: () => Promise<T>) => autosave.run(fn, 'The depiction guidelines could not be saved.'),
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Photos" anchor="photos">
        <EmbeddedPhotoGallery
          entityType="character"
          entityId={characterId}
          entityName={character.name}
          currentAvatarId={character.defaultImageId}
          onAvatarChange={() => void reload()}
          onRefresh={reload}
          revealAnchor="photos"
        />
      </SectionCard>

      <PhysicalDescriptionCard />

      <SectionCard title="Depiction guidelines" anchor="depiction-guidelines">
        <AestheticEditorField
          label="Depiction Guidelines (the Ariel Clause)"
          description="This character's own rules about how they may or may not be depicted in story backgrounds and ad-hoc images. These are mandatory constraints, passed to the image-prompt generator whenever this character appears — they are never applied to plain avatars."
          loadUrl={`/api/v1/characters/${characterId}?action=depiction-guidelines`}
          namespace={`DepictionGuidelines-${characterId}`}
          autosave={depictionAutosave}
          disabledHint={
            character.characterDocumentMountPointId
              ? undefined
              : 'This character has no document vault yet, so depiction guidelines cannot be stored. Save any of their particulars once to provision the vault, then return here.'
          }
        />
      </SectionCard>

      <WardrobeCard />
      <InventoryCard />
      <AtlasCard />
    </div>
  )
}
