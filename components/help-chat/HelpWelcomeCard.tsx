'use client'

interface HelpWelcomeCardProps {
  onOpenDocument: (docId: string) => void
}

const WELCOME_LINKS = [
  { docId: 'homepage', label: 'Getting Started with Quilltap' },
  { docId: 'setup-wizard', label: 'AI Stack Setup Wizard' },
  { docId: 'character-creation', label: 'Creating Characters' },
  { docId: 'chats', label: 'Chats Overview' },
]

export function HelpWelcomeCard({ onOpenDocument }: HelpWelcomeCardProps) {
  return (
    <div className="qt-help-welcome-card">
      <div className="qt-help-welcome-title">Welcome to Quilltap</div>
      <p className="qt-help-welcome-text">
        Ah, a fresh arrival! Splendid. Whether you&apos;ve come to craft characters of
        uncommon depth or simply to see what all the fuss is about, these guides
        shall serve as your faithful valet through the proceedings.
      </p>
      <div className="qt-help-welcome-links">
        {WELCOME_LINKS.map((link) => (
          <button
            key={link.docId}
            type="button"
            onClick={() => onOpenDocument(link.docId)}
            className="qt-help-welcome-link"
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
            {link.label}
          </button>
        ))}
      </div>
      <p className="qt-help-welcome-footer">
        Or browse the topics below, or switch to the <strong>Ask</strong> tab to
        chat with a help character.
      </p>
    </div>
  )
}
