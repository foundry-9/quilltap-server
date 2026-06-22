/**
 * Salon List Route
 *
 * Thin wrapper around {@link SalonListView}; the view body is extracted so it can also
 * render as a workspace tab. See `docs/developer/features/tabbed-workspace.md`.
 */

import { SalonListView } from './SalonListView'

export default function ChatsPage() {
  return <SalonListView />
}
