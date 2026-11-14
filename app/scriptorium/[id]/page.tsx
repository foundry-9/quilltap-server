/**
 * Document Store Detail Route — redirects into the tabbed workspace with the
 * Scriptorium tab drilled into this store.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function DocumentStoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return redirectToWorkspaceTab('scriptorium', { storeId: id })
}
