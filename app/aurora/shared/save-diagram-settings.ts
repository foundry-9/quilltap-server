/**
 * Persist a character's diagram settings — `canDrawDiagrams` and/or
 * `diagramStyle`, both in the vault's `properties.json` — with an immediate
 * PUT. Shared by the character detail and edit views; each owns its own
 * optimistic local update and rolls it back (re-fetches) when this throws.
 */

import { showSuccessToast } from '@/lib/toast'
import type { DiagramStyle } from '@/lib/markdown/diagrams'

export interface DiagramSettingsPatch {
  canDrawDiagrams?: boolean
  diagramStyle?: DiagramStyle
}

function successMessage(patch: DiagramSettingsPatch): string {
  if (patch.canDrawDiagrams !== undefined) {
    return patch.canDrawDiagrams
      ? 'The pen is theirs — this character may now draw diagrams'
      : 'The pen is put away — this character will draw no more diagrams'
  }
  return patch.diagramStyle === 'clean'
    ? 'Their diagrams will be drawn clean and ruled'
    : 'Their diagrams will be sketched by hand'
}

export async function saveDiagramSettings(characterId: string, patch: DiagramSettingsPatch): Promise<void> {
  const res = await fetch(`/api/v1/characters/${characterId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('Failed to update diagram settings')
  showSuccessToast(successMessage(patch))
}
