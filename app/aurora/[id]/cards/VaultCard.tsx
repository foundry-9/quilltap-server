'use client'

/**
 * The Vault card: the first path from a character's page to their document
 * store. Names the store (a link into the Scriptorium), counts the folders the
 * character's life is kept in, and says which of the canonical managed files
 * are missing. Read-only: nothing here writes.
 *
 * @module app/aurora/[id]/cards/VaultCard
 */

import Link from 'next/link'
import { SectionCard } from '../components/SectionCard'
import { useCharacterPage } from '../CharacterPageContext'

export function VaultCard() {
  const { stats, vault, character } = useCharacterPage()

  if (!vault) {
    return (
      <SectionCard title="Vault" anchor="vault">
        <p className="qt-text-small">
          {character.archivedAt
            ? 'Packed away with the rest of their effects while they rest in the archive.'
            : 'This character has no document vault yet. One is provisioned the first time their particulars are saved.'}
        </p>
      </SectionCard>
    )
  }

  const folders: Array<{ label: string; count: number | undefined; hint: string }> = [
    { label: 'Core', count: stats?.core, hint: 'the foundational packet Aurora re-offers them' },
    { label: 'Knowledge', count: stats?.knowledge, hint: 'reference material they can draw on' },
    { label: 'Scenarios', count: stats?.scenarioFiles ?? stats?.scenarios, hint: 'the stages a chat may open on' },
    { label: 'Subprompts', count: stats?.subprompts, hint: 'the smaller per-chat instructions' },
    { label: 'Mail', count: stats?.mail, hint: 'letters delivered by Suparṇā' },
  ]
  const missing = stats?.missingCharacterFiles ?? []

  return (
    <SectionCard
      title="Vault"
      anchor="vault"
      description={
        <>
          Everything above is kept, file by file, in{' '}
          <Link href={`/scriptorium/${vault.mountPointId}`} className="qt-link font-medium">
            {vault.name}
          </Link>{' '}
          in the Scriptorium.
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {folders.map((f) => (
          <div key={f.label} className="rounded-lg border qt-border-default p-3" title={f.hint}>
            <dt className="qt-text-xs">{f.label}/</dt>
            <dd className="qt-heading-4 text-foreground">{f.count ?? '—'}</dd>
          </div>
        ))}
      </dl>
      {stats && (
        <p className="qt-text-small">
          <strong className="text-foreground">
            {stats.characterFiles}/{stats.characterFilesTotal}
          </strong>{' '}
          managed character files present
          {missing.length > 0 ? (
            <>
              {' '}— missing: {missing.map((path, i) => (
                <span key={path}>
                  {i > 0 && ', '}
                  <code>{path}</code>
                </span>
              ))}
              . A missing file is written afresh the next time its field is saved.
            </>
          ) : (
            '.'
          )}{' '}
          Reserved keys such as progressions live in <code>metadata.json</code>.
        </p>
      )}
    </SectionCard>
  )
}
