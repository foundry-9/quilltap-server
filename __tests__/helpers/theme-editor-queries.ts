/**
 * Scoped queries for the theme editor's component tests.
 *
 * jsdom answers `element.labels` by walking the whole document, and a
 * `<label for>`'s `control` by walking it again, so every label-text or
 * accessible-name query costs a walk of the document per element it visits.
 * The editor mounts several hundred labelled rows (jsdom has no
 * IntersectionObserver, so `LazyRow` mounts them all), which made whole-
 * document queries cubic — slow enough to time the suites out on CI. Query
 * inside the part of the editor a test is about instead.
 */

import { screen, within } from '@testing-library/react'

/** Queries inside the row of the token named `name` (e.g. `--theme-card`). */
export function tokenRow(name: string) {
  const row = screen.getByText(name, { selector: 'p' }).closest<HTMLElement>('[role=group]')
  if (!row) throw new Error(`No token row for ${name}`)
  return within(row)
}

/** Queries inside the primitives panel. */
export function primitivesPanel() {
  const panel = screen.getByText('Add a primitive').closest<HTMLElement>('details')
  if (!panel) throw new Error('No primitives panel')
  return within(panel)
}

/** Queries inside the editor's toolbar (level, search, open all, undo). */
export function editorToolbar() {
  return within(screen.getByRole('toolbar'))
}

/** Waits for the editor to show the Card row, the first a draft opens on. */
export async function waitForCardRow(): Promise<void> {
  await screen.findByText('--theme-card', { selector: 'p' })
  tokenRow('--theme-card').getByLabelText('Card, light value')
}
