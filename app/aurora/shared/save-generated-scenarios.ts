/**
 * Persist AI-generated scenarios (from the AI Wizard) to a character, one
 * POST per scenario, surviving individual failures. Returns how many saved
 * and how many failed — both views toast a failure through
 * `scenarioFailureMessage` (#273) — and the rows the server minted. Shared by
 * both views.
 */

import type { CharacterScenario } from '@/lib/schemas/character.types'

/** The error-toast text for scenarios that did not save. */
export function scenarioFailureMessage(failed: number): string {
  return `${failed} scenario${failed === 1 ? '' : 's'} could not be saved.`
}

export async function saveGeneratedScenarios(
  characterId: string,
  scenarios: Array<{ title: string; content: string }>
): Promise<{ saved: number; failed: number; scenarios: CharacterScenario[] }> {
  let saved = 0
  let failed = 0
  const savedScenarios: CharacterScenario[] = []

  for (const scenario of scenarios) {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}/scenarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: scenario.title, content: scenario.content }),
      })
      if (res.ok) {
        const resData = await res.json()
        saved++
        // Collect saved scenario with its server-assigned ID
        if (resData.scenario) {
          savedScenarios.push({
            id: resData.scenario.id,
            title: resData.scenario.title,
            content: resData.scenario.content,
            createdAt: resData.scenario.createdAt,
            updatedAt: resData.scenario.updatedAt,
          })
        }
      } else {
        failed++
        const errorData = await res.json().catch(() => ({}))
        console.error('Failed to create scenario', {
          characterId,
          title: scenario.title,
          status: res.status,
          error: (errorData as { error?: string }).error ?? 'Unknown error',
        })
      }
    } catch (err) {
      failed++
      console.error('Failed to create scenario', {
        characterId,
        title: scenario.title,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { saved, failed, scenarios: savedScenarios }
}
