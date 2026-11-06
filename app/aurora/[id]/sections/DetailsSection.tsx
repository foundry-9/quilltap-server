'use client'

/**
 * Details — *Who are they?* Facts, the Dossier (with the template tools),
 * Progressions, the Vault and the metadata.json fact sheet.
 *
 * @module app/aurora/[id]/sections/DetailsSection
 */

import { TagEditor } from '@/components/tags/tag-editor'
import { CharacterKindPicker } from '@/components/characters/CharacterKindPicker'
import { CharacterFactsFields } from '@/components/characters/fields/CharacterFactsFields'
import { CharacterDossierFields } from '@/components/characters/fields/CharacterDossierFields'
import type { DossierField, MarkdownFieldBinding, Pronouns } from '@/components/characters/fields/types'
import { ProgressionsSection } from '@/components/characters/progressions/ProgressionsSection'
import { resolveCharacterKind } from '@/lib/characters/kind'
import { SectionCard } from '../components/SectionCard'
import { useMarkdownBinding, useTextBinding, useValueBinding } from '../components/autosave-bindings'
import { TemplateTools } from '../cards/TemplateTools'
import { VaultCard } from '../cards/VaultCard'
import { MetadataCard } from '../cards/MetadataCard'
import { useCharacterPage } from '../CharacterPageContext'

export function DetailsSection() {
  const { characterId, character, autosave, readOnly, externalToken, defaultPartnerName } = useCharacterPage()
  const { engine, saveNow } = autosave

  const name = useTextBinding(engine, 'name', character.name)
  const title = useTextBinding(engine, 'title', character.title)
  const pronouns = useValueBinding<Pronouns | null>(engine, 'pronouns', character.pronouns ?? null)
  const birthday = useValueBinding<string | null>(engine, 'birthday', character.birthday ?? null)

  const identity = useMarkdownBinding(engine, 'identity', character.identity, externalToken)
  const description = useMarkdownBinding(engine, 'description', character.description, externalToken)
  const manifesto = useMarkdownBinding(engine, 'manifesto', character.manifesto, externalToken)
  const personality = useMarkdownBinding(engine, 'personality', character.personality, externalToken)
  const firstMessage = useMarkdownBinding(engine, 'firstMessage', character.firstMessage, externalToken)
  const exampleDialogues = useMarkdownBinding(engine, 'exampleDialogues', character.exampleDialogues, externalToken)
  const bindings: Record<DossierField, MarkdownFieldBinding> = {
    identity,
    description,
    manifesto,
    personality,
    firstMessage,
    exampleDialogues,
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Facts" description="The particulars: what they are called, by whom, and since when.">
        <CharacterFactsFields
          name={name}
          title={title}
          pronouns={pronouns}
          birthday={birthday}
          aliases={{
            value: character.aliases ?? [],
            onChange: (aliases) => void saveNow({ aliases }, 'The aliases could not be saved.'),
          }}
          disabled={readOnly}
          kindSlot={
            <CharacterKindPicker
              kind={resolveCharacterKind(character)}
              saving={false}
              disabled={readOnly}
              onChange={(kind) => void saveNow({ kind }, 'The kind of character could not be saved.')}
            />
          }
          tagsSlot={<TagEditor entityType="character" entityId={characterId} />}
        />
      </SectionCard>

      <SectionCard
        title="Dossier"
        description="Who they are from every side: what the world knows, what others see, what holds them together, what they know of themselves — and how they open a conversation."
      >
        <CharacterDossierFields
          bindings={bindings}
          namespace="CharacterPage.dossier"
          disabled={readOnly}
          templateHighlight={{ characterName: character.name, userName: defaultPartnerName }}
          toolbar={<TemplateTools />}
        />
      </SectionCard>

      {/* ProgressionsSection brings its own heading. A progression is a
          time-reckoned fact about the character, the genus of a birthday. */}
      <div id="progressions" className="qt-card scroll-mt-48">
        <ProgressionsSection characterId={characterId} characterName={character.name} />
      </div>

      <VaultCard />
      <MetadataCard />
    </div>
  )
}
