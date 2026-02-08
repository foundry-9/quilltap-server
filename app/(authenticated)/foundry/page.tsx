'use client'

import Link from 'next/link'
import { BrandName } from '@/components/ui/brand-name'

interface SubsystemCard {
  id: string
  name: string
  description: string
  href: string
  icon: React.ReactNode
}

const subsystems: SubsystemCard[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Roleplay templates and prompt configuration',
    href: '/foundry/aurora',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: 'forge',
    name: 'The Forge',
    description: 'API keys, connections, plugins, storage, and data management',
    href: '/foundry/forge',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    id: 'salon',
    name: 'The Salon',
    description: 'Chat behavior, avatars, compression, and automation settings',
    href: '/foundry/salon',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'commonplace-book',
    name: 'The Commonplace Book',
    description: 'Embedding profiles and memory deduplication',
    href: '/foundry/commonplace-book',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    id: 'prospero',
    name: 'Prospero',
    description: 'Task queue, capabilities report, and LLM logs',
    href: '/foundry/prospero',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'dangermouse',
    name: 'Dangermouse',
    description: 'Dangerous content detection and routing settings',
    href: '/foundry/dangermouse',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: 'calliope',
    name: 'Calliope',
    description: 'Appearance, themes, and tag management',
    href: '/foundry/calliope',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
        <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
        <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
        <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
      </svg>
    ),
  },
  {
    id: 'lantern',
    name: 'The Lantern',
    description: 'Image profiles and story background settings',
    href: '/foundry/lantern',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
  },
]

export default function FoundryPage() {
  return (
    <div className="qt-page-container">
      <div className="mb-8">
        <h1 className="qt-heading-1">The Foundry</h1>
        <p className="qt-text-muted mt-2">
          Configure and manage every aspect of your <BrandName /> workspace
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {subsystems.map((subsystem) => (
          <Link
            key={subsystem.id}
            href={subsystem.href}
            className="qt-card-interactive flex flex-col items-start gap-3"
          >
            <span className="qt-text-muted">{subsystem.icon}</span>
            <div>
              <h2 className="qt-card-title">{subsystem.name}</h2>
              <p className="qt-card-description mt-1">{subsystem.description}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <Link href="/" className="qt-link">
          &larr; Back to Home
        </Link>
      </div>
    </div>
  )
}
