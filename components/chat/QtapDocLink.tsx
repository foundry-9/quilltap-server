'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { parseQtapUri, type QtapUriParts } from '@/lib/doc-edit/qtap-uri'
import { useQtapDoc } from './QtapDocContext'

/**
 * Renders a `qtap://` document URI found in a message. Per the "definite
 * existing documents" rule (§9a):
 *
 *  - parse failure                → plain text (no link)
 *  - no Document-Mode context     → plain text
 *  - existence check pending      → plain, inert styled text (never a broken link)
 *  - target exists + accessible   → active link that opens Document Mode on click
 *  - target missing/inaccessible  → plain text
 *
 * It NEVER treats a `qtap://` URI as a web URL — clicking is an in-app action
 * (Document Mode split view), never `window.open`.
 */
export function QtapDocLink({ href, children }: { href: string; children: ReactNode }) {
  const ctx = useQtapDoc()

  const parts = useMemo<QtapUriParts | null>(() => {
    try {
      return parseQtapUri(href)
    } catch {
      return null
    }
  }, [href])

  // The resolved existence result, tagged with the href it was checked for, so
  // a stale result from a previous href reads as "pending" rather than leaking.
  const [result, setResult] = useState<{ href: string; exists: boolean } | null>(null)

  useEffect(() => {
    if (!parts || !ctx) return
    let cancelled = false
    // setState only ever runs in the async callback (never synchronously in the
    // effect body), so changing href shows "pending" until the new check lands.
    ctx
      .checkExists(parts)
      .then((exists) => {
        if (!cancelled) setResult({ href, exists })
      })
      .catch(() => {
        if (!cancelled) setResult({ href, exists: false })
      })
    return () => {
      cancelled = true
    }
  }, [parts, ctx, href])

  // Parse failure → plain text.
  if (!parts) return <>{children}</>

  // null = no context or still pending for this href; only `true` activates.
  const exists = result && result.href === href ? result.exists : null

  // Pending, no context, or non-existent/inaccessible → plain styled text.
  if (!ctx || exists !== true) {
    return <span className="qt-qtap-doc qt-qtap-doc--inert">{children}</span>
  }

  return (
    <a
      href={href}
      className="qt-link qt-qtap-doc"
      title={`Open ${href} in the document pane`}
      onClick={(e) => {
        e.preventDefault()
        ctx.open(parts)
      }}
    >
      {children}
    </a>
  )
}
