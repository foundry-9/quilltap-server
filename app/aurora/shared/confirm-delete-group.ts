/**
 * The Aurora grid's group delete: ask first, naming the group, and send the
 * DELETE only when the operator confirms (#272).
 */

import { showConfirmation } from '@/lib/alert'

export async function confirmAndDeleteGroup(
  groupId: string,
  groups: ReadonlyArray<{ id: string; name: string }>,
  deleteGroup: (id: string) => Promise<boolean>,
): Promise<boolean> {
  const name = groups.find((g) => g.id === groupId)?.name ?? 'this group'
  const confirmed = await showConfirmation(
    `Shall the group "${name}" be dissolved? This cannot be undone.`,
  )
  if (!confirmed) return false
  return deleteGroup(groupId)
}
