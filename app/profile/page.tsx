'use client'

import { ProfileView } from './ProfileView'

/**
 * Profile Page (Single-User Mode) — thin route wrapper around {@link ProfileView}
 * so the workspace can render the same surface as a kept-alive tab.
 */
export default function ProfilePage() {
  return <ProfileView />
}
