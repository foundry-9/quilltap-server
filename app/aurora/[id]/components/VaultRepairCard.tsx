'use client'

/**
 * The card the character page shows instead of a dead page when the
 * character's vault is broken (the item GET answers 503).
 *
 * It reads `?action=vault-health` — which answers from the row and the file
 * list, never the vault's hydration — and lists each layout file: present or
 * absent, and for a present one that fails to parse, the parser's complaint.
 * The repair button seeds only what is absent (`?action=repair-vault`); a file
 * that is present but broken is never rewritten, because the settings and the
 * prose it holds live nowhere else. Fixing it is the operator's, in the
 * Scriptorium.
 *
 * @module app/aurora/[id]/components/VaultRepairCard
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { CharacterVaultHealth } from '@/lib/characters/vault/health'

export interface VaultRepairCardProps {
  characterId: string
  onBack: () => void
}

function fileStatus(file: CharacterVaultHealth['files'][number]): string {
  if (!file.present) return file.keystone ? 'missing' : 'absent'
  return file.parses === false ? 'unreadable' : 'in order'
}

export function VaultRepairCard({ characterId, onBack }: VaultRepairCardProps) {
  const queryClient = useQueryClient()
  const [repairing, setRepairing] = useState(false)
  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.characters.vaultHealth(characterId),
    queryFn: ({ signal }) =>
      apiFetch<{ health: CharacterVaultHealth }>(`/api/v1/characters/${characterId}?action=vault-health`, {
        signal,
        cache: 'no-store',
      }),
  })
  const health = data?.health ?? null

  // After a hand repair in the Scriptorium: re-take the inventory and re-read
  // the character, so the page opens itself once the vault reads again.
  const lookAgain = async () => {
    await refetch()
    await queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) })
  }

  const repair = async () => {
    setRepairing(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=repair-vault`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { seeded?: string[]; error?: string }
      if (!res.ok) throw new Error(body.error || 'The vault could not be repaired.')
      console.debug('[VaultRepairCard] Repaired', { characterId, seeded: body.seeded })
      showSuccessToast(
        body.seeded && body.seeded.length > 0
          ? `Restored ${body.seeded.join(' and ')} to their factory settings.`
          : 'Nothing was missing; nothing was written.',
      )
      await refetch()
      await queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) })
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'The vault could not be repaired.')
    } finally {
      setRepairing(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <section className="qt-card w-full max-w-xl space-y-4 p-6" aria-labelledby="vault-repair-heading">
        <h1 id="vault-repair-heading" className="qt-card-title">
          This character&rsquo;s vault is in disarray
        </h1>
        <p className="qt-text-secondary">
          The papers that make up this character could not be read as a whole, so the page cannot open. Below is
          the inventory of what the vault holds. Nothing here has been altered on your behalf.
        </p>

        {isLoading && <p className="qt-text-small">Taking stock of the vault…</p>}

        {health && (
          <>
            {!health.linked && (
              <p className="qt-text-small">This character has no vault at all. Repair will furnish a fresh, empty one.</p>
            )}
            <ul className="space-y-1" aria-label="Vault files">
              {health.files.map((file) => (
                <li key={file.path} className="qt-text-small">
                  <code className="qt-code-inline">{file.path}</code> — {fileStatus(file)}
                  {file.error && <span className="qt-text-destructive"> ({file.error})</span>}
                </li>
              ))}
            </ul>

            {health.needsAttention.length > 0 && (
              <p className="qt-text-small">
                {health.needsAttention.join(', ')} {health.needsAttention.length === 1 ? 'is' : 'are'} present but
                will not parse. Repair leaves such files strictly alone — they hold this character&rsquo;s only copy
                of what they say. Mend {health.needsAttention.length === 1 ? 'it' : 'them'} by hand in the
                Scriptorium, then return here.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {(health.repairable.length > 0 || !health.linked) && (
                <button
                  type="button"
                  className="qt-button qt-button-primary"
                  onClick={() => void repair()}
                  disabled={repairing}
                >
                  {repairing ? 'Repairing…' : `Restore ${health.repairable.join(' and ') || 'the vault'}`}
                </button>
              )}
              <button type="button" className="qt-button qt-button-secondary" onClick={() => void lookAgain()}>
                Look again
              </button>
              <button type="button" className="qt-button qt-button-secondary" onClick={onBack}>
                Back to Characters
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
