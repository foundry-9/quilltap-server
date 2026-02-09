'use client'

/**
 * Sidebar Header
 *
 * Header area with quill icon as home link.
 * Sidebar is always collapsed — no toggle button.
 *
 * @module components/layout/left-sidebar/sidebar-header
 */

import Link from 'next/link'
import Image from 'next/image'

export function SidebarHeader() {
  return (
    <div className="qt-left-sidebar-header">
      <Link href="/" className="qt-left-sidebar-brand" title="Home">
        <Image
          src="/quill.svg"
          alt="Quilltap"
          width={24}
          height={24}
          className="qt-left-sidebar-brand-icon"
          style={{ width: 'auto', height: 'auto' }}
          aria-hidden="true"
        />
      </Link>
    </div>
  )
}
