'use client'

import { AboutView } from './AboutView'

/**
 * About route — thin wrapper around {@link AboutView} so the workspace can
 * render the same surface as a kept-alive tab.
 */
export default function AboutPage() {
  return <AboutView />
}
