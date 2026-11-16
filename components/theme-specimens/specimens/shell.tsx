/**
 * Specimens — the app shell, the workspace, the home page and the left rail.
 *
 * Markup throughout: every one of these is drawn by a component that reads
 * the workspace, the router or the server. The structure follows the real
 * components so a theme's descendant selectors land as they would in the app.
 *
 * @module components/theme-specimens/specimens/shell
 */

import { Icon } from '@/components/ui/icon'
import type { SpecimenTable } from '../types'

const Tab = ({ active = false, label = 'A specimen tab' }: { active?: boolean; label?: string }) => (
  <div className={`qt-tab${active ? ' qt-tab-active' : ''}`} data-tab-kind="home">
    <button type="button" className="qt-tab-select" role="tab" aria-selected={active ? 'true' : 'false'}>
      <Icon name="themes" className="qt-tab-icon w-4 h-4" />
      <span className="qt-tab-label">{label}</span>
    </button>
    <button type="button" className="qt-tab-close" aria-label={`Close ${label}`}>
      <Icon name="close" className="w-3 h-3" />
    </button>
  </div>
)

const PLACEHOLDER = <p className="qt-text-small p-3">Content invented for the gallery.</p>

export const SHELL_SPECIMENS: SpecimenTable = {
  // --- App shell
  'qt-app-layout': {
    render: ({ el }) => (
      <div {...el} style={{ height: '10rem', minHeight: 0 }}>
        <div className="qt-app-main" style={{ minHeight: 0 }}>
          <div className="qt-app-content">{PLACEHOLDER}</div>
        </div>
      </div>
    ),
    note: 'Drawn at a fixed height; in the app it fills the window.',
  },
  'qt-skip-link': {
    render: ({ el }) => (
      <a {...el} href="#specimen">
        Skip to the content
      </a>
    ),
    note: 'Hidden until it has keyboard focus: Tab to it to see it.',
  },
  'qt-app-main': {
    render: ({ el }) => (
      <div className="qt-app-layout" style={{ height: '8rem', minHeight: 0 }}>
        <div {...el} style={{ minHeight: 0 }}>{PLACEHOLDER}</div>
      </div>
    ),
  },
  'qt-app-content': { render: ({ el }) => <div {...el}>{PLACEHOLDER}</div> },
  'qt-app-scroll': {
    render: ({ el }) => (
      <div className="qt-app-content">
        <div {...el} style={{ maxHeight: '6rem' }}>{PLACEHOLDER}</div>
      </div>
    ),
  },
  'qt-page-toolbar': {
    render: ({ el }) => (
      <div {...el}>
        <div className="qt-page-toolbar-left"><span className="qt-text-small">Left</span></div>
        <div className="qt-page-toolbar-center"><span className="qt-text-small">Centre</span></div>
        <div className="qt-page-toolbar-right"><span className="qt-text-small">Right</span></div>
      </div>
    ),
  },
  'qt-page-toolbar-left': {
    render: ({ el }) => (
      <div className="qt-page-toolbar">
        <div {...el}><button type="button" className="qt-button qt-button-ghost qt-button-sm">Back</button></div>
      </div>
    ),
  },
  'qt-page-toolbar-center': {
    render: ({ el }) => (
      <div className="qt-page-toolbar">
        <div {...el}><span className="qt-text-small">A page title</span></div>
      </div>
    ),
  },
  'qt-page-toolbar-right': {
    render: ({ el }) => (
      <div className="qt-page-toolbar">
        <div {...el}><button type="button" className="qt-button qt-button-primary qt-button-sm">Act</button></div>
      </div>
    ),
  },

  // --- Workspace
  'qt-workspace': {
    render: ({ el }) => (
      <div {...el} style={{ height: '9rem' }}>
        <div className="qt-workspace-pane-chrome" data-pane="left">
          <div className="qt-tab-strip" data-pane="left"><Tab active /></div>
        </div>
        <div className="qt-tab-pane" data-pane="left" data-tab-kind="home">{PLACEHOLDER}</div>
      </div>
    ),
    note: 'Drawn at a fixed height.',
  },
  'qt-workspace-backdrop': {
    render: ({ el }) => (
      <div className="qt-workspace" style={{ height: '6rem', position: 'relative' }}>
        <div {...el}><div className="qt-workspace-backdrop-layer" /></div>
      </div>
    ),
    note: 'Shows a picture only when a subsystem or chat background is set.',
  },
  'qt-workspace-backdrop-layer': {
    render: ({ el }) => (
      <div className="qt-workspace" style={{ height: '6rem', position: 'relative' }}>
        <div className="qt-workspace-backdrop"><div {...el} /></div>
      </div>
    ),
  },
  'qt-workspace-pane-chrome': {
    render: ({ el }) => (
      <div className="qt-workspace">
        <div {...el}>
          <div className="qt-tab-strip" data-pane={el['data-pane'] ?? 'left'}><Tab active /><Tab /></div>
        </div>
      </div>
    ),
  },
  'qt-tab-strip': {
    render: ({ el }) => (
      <div className="qt-workspace-pane-chrome" data-pane={el['data-pane'] ?? 'left'}>
        <div {...el} role="tablist" aria-label="Specimen tabs"><Tab active /><Tab label="Another tab" /></div>
      </div>
    ),
  },
  'qt-tab-select': {
    render: ({ el }) => (
      <div className="qt-tab-strip" role="tablist" aria-label="Specimen tabs">
        <div className="qt-tab" data-tab-kind="home">
          <button type="button" {...el} role="tab">
            <Icon name="themes" className="qt-tab-icon w-4 h-4" />
            <span className="qt-tab-label">A specimen tab</span>
          </button>
        </div>
      </div>
    ),
  },
  'qt-tab-icon': {
    render: ({ el }) => (
      <div className="qt-tab-strip" role="tablist" aria-label="Specimen tabs">
        <div className="qt-tab qt-tab-active" data-tab-kind="home">
          <button type="button" className="qt-tab-select" role="tab" aria-selected="true">
            <Icon name="themes" className={`${el.className} w-4 h-4`} />
            <span className="qt-tab-label">A specimen tab</span>
          </button>
        </div>
      </div>
    ),
  },
  'qt-tab-label': {
    render: ({ el }) => (
      <div className="qt-tab-strip" role="tablist" aria-label="Specimen tabs">
        <div className="qt-tab qt-tab-active" data-tab-kind="home">
          <button type="button" className="qt-tab-select" role="tab" aria-selected="true">
            <span {...el}>A specimen tab</span>
          </button>
        </div>
      </div>
    ),
  },
  'qt-tab-close': {
    render: ({ el }) => (
      <div className="qt-tab-strip" role="tablist" aria-label="Specimen tabs">
        <div className="qt-tab qt-tab-active" data-tab-kind="home">
          <button type="button" className="qt-tab-select" role="tab" aria-selected="true">
            <span className="qt-tab-label">A specimen tab</span>
          </button>
          <button type="button" {...el} aria-label="Close the specimen tab"><Icon name="close" className="w-3 h-3" /></button>
        </div>
      </div>
    ),
  },
  'qt-tab-pane': {
    render: ({ el }) => (
      <div className="qt-workspace" style={{ height: '4rem' }}>
        <div {...el} style={{ position: 'relative', inset: 'auto' }}>{PLACEHOLDER}</div>
      </div>
    ),
  },
  'qt-workspace-divider': {
    render: ({ el }) => (
      <div className="qt-workspace flex" style={{ height: '5rem' }}>
        <div className="flex-1">{PLACEHOLDER}</div>
        <div {...el} role="separator" aria-orientation="vertical" aria-label="Specimen divider" style={{ position: 'relative' }}>
          <div className="qt-workspace-divider-grip" />
        </div>
        <div className="flex-1">{PLACEHOLDER}</div>
      </div>
    ),
  },
  'qt-workspace-divider-grip': {
    render: ({ el }) => (
      <div className="qt-workspace flex" style={{ height: '5rem' }}>
        <div className="flex-1" />
        <div className="qt-workspace-divider" style={{ position: 'relative' }}><div {...el} /></div>
        <div className="flex-1" />
      </div>
    ),
  },
  'qt-workspace-empty': {
    render: ({ el }) => (
      <div className="qt-workspace" style={{ height: '6rem' }}>
        <div {...el}><p className="qt-text-small">No tab is open in this pane.</p></div>
      </div>
    ),
  },
  'qt-tab-drop-zone': {
    render: ({ el }) => (
      <div className="qt-workspace" style={{ height: '6rem', position: 'relative' }}>
        <div {...el} style={{ position: 'absolute', inset: '0.5rem 0.5rem 0.5rem 50%' }} />
      </div>
    ),
    note: 'Appears while a tab is dragged towards the right edge.',
  },

  // --- Home
  'qt-homepage-container': {
    render: ({ el }) => (
      <div {...el}>
        <div className="qt-homepage-welcome"><p className="qt-heading-2">Good evening, Specimen.</p></div>
      </div>
    ),
  },
  'qt-homepage-welcome': {
    render: ({ el }) => (
      <div className="qt-homepage-container">
        <div {...el}>
          <p className="qt-heading-2">Good evening, Specimen.</p>
          <p className="qt-text-small">A welcome invented for the gallery.</p>
        </div>
      </div>
    ),
  },
  'qt-quick-actions': {
    render: ({ el }) => (
      <div className="qt-homepage-container">
        <div {...el}>
          <button type="button" className="qt-button qt-button-primary">New chat</button>
          <button type="button" className="qt-button qt-button-secondary">New character</button>
        </div>
      </div>
    ),
  },
  'qt-homepage-grid': {
    render: ({ el }) => (
      <div className="qt-homepage-container">
        <div {...el}>
          <HomeSection section="chats" />
          <HomeSection section="projects" />
        </div>
      </div>
    ),
  },
  'qt-homepage-section': { render: ({ el }) => <HomeSection el={el} /> },
  'qt-homepage-section-header': { render: ({ el }) => <HomeSection part="header" el={el} /> },
  'qt-homepage-section-title': { render: ({ el }) => <HomeSection part="title" el={el} /> },
  'qt-homepage-section-link': { render: ({ el }) => <HomeSection part="link" el={el} /> },
  'qt-homepage-section-content': { render: ({ el }) => <HomeSection part="content" el={el} /> },
  'qt-homepage-row': { render: ({ el }) => <HomeSection part="row" el={el} /> },
  'qt-homepage-empty': {
    render: ({ el }) => (
      <div className="qt-homepage-section" data-section="projects">
        <div className="qt-homepage-section-header"><p className="qt-homepage-section-title">Projects</p></div>
        <div className="qt-homepage-section-content"><p {...el}>Nothing here yet.</p></div>
      </div>
    ),
  },
  'qt-characters-grid': {
    render: ({ el }) => (
      <div className="qt-homepage-section" data-section="characters">
        <div className="qt-homepage-section-content">
          <div {...el}>
            <CharacterCard name="Miss Specimen" />
            <CharacterCard name="Mr Example" />
          </div>
        </div>
      </div>
    ),
  },
  'qt-character-card': {
    render: ({ el }) => (
      <div className="qt-characters-grid">
        <CharacterCard name="Miss Specimen" el={el} />
      </div>
    ),
  },

  // --- Left rail
  'qt-left-sidebar': {
    render: ({ el }) => <Rail el={el} />,
    note: 'Drawn in place; in the app it is fixed to the left edge.',
  },
  'qt-left-sidebar-content': { render: ({ el }) => <Rail part="content" el={el} /> },
  'qt-collapsed-nav': { render: ({ el }) => <Rail part="nav" el={el} /> },
  'qt-collapsed-nav-button': {
    render: ({ el }) => (
      <nav className="qt-collapsed-nav" aria-label="Specimen navigation">
        <a {...el} href="#specimen" aria-label="A navigation item"><Icon name="projects" className="w-5 h-5" /></a>
      </nav>
    ),
  },
  'qt-left-sidebar-footer': { render: ({ el }) => <Rail part="footer" el={el} /> },
  'qt-left-sidebar-footer-actions': { render: ({ el }) => <Rail part="actions" el={el} /> },
  'qt-left-sidebar-item': {
    render: ({ el }) => (
      <div className="qt-left-sidebar-footer"><div className="qt-left-sidebar-footer-actions">
        <button type="button" {...el} aria-label="A rail button"><Icon name="help" className="qt-left-sidebar-item-icon w-5 h-5" /></button>
      </div></div>
    ),
  },
  'qt-left-sidebar-item-icon': {
    render: ({ el }) => (
      <div className="qt-left-sidebar-footer"><div className="qt-left-sidebar-footer-actions">
        <button type="button" className="qt-left-sidebar-item" data-nav="help" aria-label="A rail button"><Icon name="help" className={`${el.className} w-5 h-5`} /></button>
      </div></div>
    ),
  },
  'qt-left-sidebar-popout': {
    render: ({ el }) => (
      <div className="qt-left-sidebar-footer" style={{ position: 'relative', height: '7rem' }}>
        <div {...el} role="menu" aria-label="Specimen menu" style={{ position: 'absolute', left: '0.5rem', top: '0.5rem' }}>
          <button type="button" role="menuitem" className="qt-button qt-button-ghost qt-button-sm w-full">A menu item</button>
          <button type="button" role="menuitem" className="qt-button qt-button-ghost qt-button-sm w-full">Another</button>
        </div>
      </div>
    ),
  },
  'qt-left-sidebar-profile': {
    render: ({ el }) => (
      <div className="qt-left-sidebar-footer">
        <button type="button" {...el} aria-label="The profile menu"><span className="qt-left-sidebar-profile-avatar">SP</span></button>
      </div>
    ),
  },
  'qt-left-sidebar-profile-avatar': {
    render: ({ el }) => (
      <div className="qt-left-sidebar-footer">
        <button type="button" className="qt-left-sidebar-profile" aria-label="The profile menu"><span {...el}>SP</span></button>
      </div>
    ),
  },
}

function HomeSection({ section = 'chats', part, el }: { section?: string; part?: 'header' | 'title' | 'link' | 'content' | 'row'; el?: Record<string, string> & { className: string } }) {
  const on = (which: typeof part, fallback: string) => (part === which && el ? el : { className: fallback })
  const sectionProps = part === undefined && el ? { 'data-section': section, ...el } : { className: 'qt-homepage-section', 'data-section': section }
  return (
    <section {...sectionProps}>
      <div {...on('header', 'qt-homepage-section-header')}>
        <p {...on('title', 'qt-homepage-section-title')}>Recent chats</p>
        <a href="#specimen" {...on('link', 'qt-homepage-section-link')}>View all</a>
      </div>
      <div {...on('content', 'qt-homepage-section-content')}>
        <div {...on('row', 'qt-homepage-row')}>A conversation invented for the gallery</div>
        <div className="qt-homepage-row">Another, equally fictitious</div>
      </div>
    </section>
  )
}

function CharacterCard({ name, el }: { name: string; el?: Record<string, string> & { className: string } }) {
  return (
    <div {...(el ?? { className: 'qt-character-card' })}>
      <span className="qt-avatar-image inline-flex items-center justify-center w-10 h-10 rounded-full qt-bg-muted">{name.slice(0, 1)}</span>
      <span className="qt-text-small">{name}</span>
    </div>
  )
}

function Rail({ part, el }: { part?: 'content' | 'nav' | 'footer' | 'actions'; el: Record<string, string> & { className: string } }) {
  const on = (which: typeof part, fallback: string) => (part === which ? el : { className: fallback })
  return (
    <aside {...(part === undefined ? el : { className: 'qt-left-sidebar qt-left-sidebar-collapsed' })} style={{ position: 'relative', height: '16rem' }} aria-label="Specimen rail">
      <div {...on('content', 'qt-left-sidebar-content')}>
        <nav {...on('nav', 'qt-collapsed-nav')} aria-label="Specimen navigation">
          <a className="qt-collapsed-nav-button" data-nav="home" aria-current="page" href="#specimen" aria-label="Home"><Icon name="brand" className="w-5 h-5" /></a>
          <a className="qt-collapsed-nav-button" data-nav="projects" href="#specimen" aria-label="Projects"><Icon name="projects" className="w-5 h-5" /></a>
        </nav>
      </div>
      <div {...on('footer', 'qt-left-sidebar-footer')}>
        <div {...on('actions', 'qt-left-sidebar-footer-actions')}>
          <button type="button" className="qt-left-sidebar-item" data-nav="settings" aria-label="Settings"><Icon name="settings" className="qt-left-sidebar-item-icon w-5 h-5" /></button>
        </div>
        <button type="button" className="qt-left-sidebar-profile" aria-label="The profile menu" aria-expanded="false"><span className="qt-left-sidebar-profile-avatar">SP</span></button>
      </div>
    </aside>
  )
}

