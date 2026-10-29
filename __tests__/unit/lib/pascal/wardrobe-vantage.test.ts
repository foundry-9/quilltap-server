/**
 * `defaultWardrobeVantage` — the Workbench's opening wardrobe lens, derived
 * from the store a definition lives in (pascal-wardrobe-effect-picker §1.2).
 */

import { defaultWardrobeVantage } from '@/lib/pascal/tool-draft'
import type { CustomToolDestinations } from '@/lib/pascal/workbench'

const store = (mountPointId: string) => ({ mountPointId, mountName: mountPointId, existingToolNames: [] })

const destinations: CustomToolDestinations = {
  general: store('mp-general'),
  characters: [
    { characterId: 'char-imogen', characterName: 'Imogen', ...store('mp-imogen') },
    // A vault that is also linked to a group: the character wins.
    { characterId: 'char-bertie', characterName: 'Bertie', ...store('mp-shared') },
  ],
  groups: [
    {
      groupId: 'group-regulars',
      groupName: 'The Regulars',
      stores: [{ ...store('mp-regulars'), official: true }, { ...store('mp-shared'), official: false }],
    },
  ],
  projects: [{ projectId: 'proj-thornfield', projectName: 'Thornfield', stores: [store('mp-thornfield')] }],
  other: [store('mp-loose')],
}

describe('defaultWardrobeVantage', () => {
  it("opens a character vault's tool on that character", () => {
    expect(defaultWardrobeVantage('mp-imogen', destinations)).toEqual({ kind: 'character', characterId: 'char-imogen' })
  })

  it("opens a group store's tool on the group wardrobe", () => {
    expect(defaultWardrobeVantage('mp-regulars', destinations)).toEqual({
      kind: 'container',
      container: { scope: 'group', id: 'group-regulars' },
    })
  })

  it("opens a project store's tool on the project wardrobe", () => {
    expect(defaultWardrobeVantage('mp-thornfield', destinations)).toEqual({
      kind: 'container',
      container: { scope: 'project', id: 'proj-thornfield' },
    })
  })

  it('opens a General-store tool on Quilltap General', () => {
    expect(defaultWardrobeVantage('mp-general', destinations)).toEqual({
      kind: 'container',
      container: { scope: 'general', id: null },
    })
  })

  it('opens an unattached store or an unsaved file on nobody', () => {
    expect(defaultWardrobeVantage('mp-loose', destinations)).toEqual({ kind: 'none' })
    expect(defaultWardrobeVantage(null, destinations)).toEqual({ kind: 'none' })
  })

  it('prefers the character when a vault is also attached to a group', () => {
    expect(defaultWardrobeVantage('mp-shared', destinations)).toEqual({ kind: 'character', characterId: 'char-bertie' })
  })
})
