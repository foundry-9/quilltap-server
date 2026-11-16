/**
 * Specimens — the character page, dialogs and settings.
 *
 * The settings card is the real `CollapsibleCard` (it renders from props);
 * each `data-card` value is drawn as markup, since the real card would write
 * its section id as a DOM id and collide with an open Settings tab. The rest
 * is markup following `app/aurora/[id]`, `BaseModal` (which portals to the
 * body, so it cannot be shown in place) and `SettingsView`. The dialog is
 * drawn inside its frame: the gallery's frames contain fixed positioning.
 *
 * @module components/theme-specimens/specimens/pages
 */

import type { ReactNode } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Icon } from '@/components/ui/icon'
import type { HookElementProps } from '../instances'
import type { SpecimenTable } from '../types'

type El = HookElementProps

function CharacterHeader({ slot, el }: { slot?: string; el?: El }) {
  const on = (which: string, fallback: string) => (slot === which && el ? el : { className: fallback })
  return (
    <div {...on('header', 'qt-character-header')}>
      <span {...on('avatar', 'qt-character-avatar')} role="img" aria-label="Miss Specimen" style={{ display: 'inline-flex', width: '4rem', height: '4rem', alignItems: 'center', justifyContent: 'center' }}>
        M
      </span>
      <div {...on('identity', 'qt-character-identity')}>
        <p className="qt-heading-2">Miss Specimen</p>
        <div {...on('tags', 'qt-character-tags')}>
          <span className="qt-badge qt-badge-tag">invented</span>
          <span className="qt-badge qt-badge-tag">fictitious</span>
        </div>
        <div {...on('stats', 'qt-character-stats')}>
          <span className="qt-text-xs">12 chats</span> <span className="qt-text-xs">3 memories</span>
        </div>
      </div>
      <div {...on('actions', 'qt-character-actions')}>
        <button type="button" className="qt-button qt-button-primary qt-button-sm">Chat</button>
        <button type="button" className="qt-button qt-button-ghost qt-button-sm">Edit</button>
      </div>
    </div>
  )
}

function SectionCard({ slot, el }: { slot?: 'card' | 'header' | 'body'; el?: El }) {
  const card = slot === 'card' && el ? { 'data-section': 'facts', ...el, className: `qt-card ${el.className}` } : { className: 'qt-card qt-section-card', 'data-section': 'facts' }
  return (
    <section {...card}>
      <div {...(slot === 'header' && el ? el : { className: 'qt-section-card-header' })}>
        <p className="qt-heading-4">Facts</p>
        <p className="qt-text-small">What everyone knows of her. (Invented.)</p>
      </div>
      <div {...(slot === 'body' && el ? el : { className: 'qt-section-card-body' })}>
        <p className="qt-text-small">She keeps a specimen umbrella and never opens it.</p>
      </div>
    </section>
  )
}

function Dialog({ slot, el, children }: { slot?: string; el?: El; children?: ReactNode }) {
  const on = (which: string, fallback: string) => (slot === which && el ? el : { className: fallback })
  return (
    <div {...on('overlay', 'qt-dialog-overlay')} style={{ position: 'absolute', inset: 0, padding: '1rem' }}>
      <div {...on('dialog', 'qt-dialog')} role="dialog" aria-label="A specimen dialog" data-qt-modal="" style={{ maxWidth: '28rem', width: '100%' }}>
        <div {...on('header', 'qt-dialog-header')}>
          <div className="min-w-0">
            <p {...on('title', 'qt-dialog-title')}>A specimen dialog</p>
            <p {...on('description', 'qt-dialog-description')}>Its subtitle, equally invented</p>
          </div>
          <button type="button" {...on('close', 'qt-dialog-close')} aria-label="Close the specimen dialog">
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>
        <div {...on('body', 'qt-dialog-body qt-dialog-body-default')}>
          {children ?? <p className="qt-text-small">The body of a dialog that asks nothing.</p>}
        </div>
        <div {...on('footer', 'qt-dialog-footer qt-dialog-footer-default')}>
          <button type="button" className="qt-button qt-button-secondary">Cancel</button>
          <button type="button" className="qt-button qt-button-primary">Very well</button>
        </div>
      </div>
    </div>
  )
}

const dialogFrame = (node: ReactNode) => <div style={{ position: 'relative', height: '16rem' }}>{node}</div>

function SettingsLayout({ slot, el }: { slot?: string; el?: El }) {
  const on = (which: string, fallback: string) => (slot === which && el ? el : { className: fallback })
  return (
    <div {...on('layout', 'qt-settings-layout')}>
      <nav {...on('rail', 'qt-settings-rail')} aria-label="Specimen settings groups">
        <a href="#specimen" className="qt-settings-rail-item" data-group="connections" aria-current="page">
          Connections <span className="qt-settings-rail-count">3</span>
        </a>
        <a href="#specimen" className="qt-settings-rail-item" data-group="appearance">Appearance</a>
      </nav>
      <div {...on('panel', 'qt-settings-panel')}>
        <p className="qt-text-small">A settings card would sit here.</p>
        <div {...on('divider', 'qt-settings-advanced-divider')} role="separator">Advanced</div>
      </div>
    </div>
  )
}

/** A settings card as markup, for the `data-card` values and the class states. */
function CardMarkup({ el, open = false, chevronOpen = false, slot }: { el?: El; open?: boolean; chevronOpen?: boolean; slot?: string }) {
  const on = (which: string, fallback: string) => (slot === which && el ? el : { className: fallback })
  const cardEl = slot === 'card' && el ? el : { className: 'qt-collapsible-card' }
  const label = el?.['data-card'] ?? 'specimen'
  return (
    <div {...cardEl}>
      <button type="button" aria-expanded={open ? 'true' : 'false'} {...on('header', 'qt-collapsible-card-header')}>
        <span className="flex items-center gap-3 min-w-0">
          <span {...on('icon', 'qt-collapsible-card-icon')}><Icon name="settings" className="w-4 h-4" /></span>
          <span className="qt-card-title">{label}</span>
        </span>
        <Icon name="chevron-down" className={slot === 'chevron' && el ? el.className : `qt-collapsible-card-chevron${chevronOpen ? ' qt-collapsible-card-chevron-open' : ''}`} />
      </button>
      {open && <div {...on('body', 'qt-collapsible-card-body')}><p className="qt-text-small">A setting that sets nothing.</p></div>}
    </div>
  )
}

export const PAGE_SPECIMENS: SpecimenTable = {
  // --- Character page
  'qt-character-page': {
    render: ({ el }) => (
      <div {...el}>
        <CharacterHeader />
        <SectionCard />
      </div>
    ),
  },
  'qt-character-header': { render: ({ el }) => <div className="qt-character-page"><CharacterHeader slot="header" el={el} /></div> },
  'qt-character-avatar': { render: ({ el }) => <div className="qt-character-page"><CharacterHeader slot="avatar" el={el} /></div> },
  'qt-character-identity': { render: ({ el }) => <div className="qt-character-page"><CharacterHeader slot="identity" el={el} /></div> },
  'qt-character-tags': { render: ({ el }) => <div className="qt-character-page"><CharacterHeader slot="tags" el={el} /></div> },
  'qt-character-stats': { render: ({ el }) => <div className="qt-character-page"><CharacterHeader slot="stats" el={el} /></div> },
  'qt-character-actions': { render: ({ el }) => <div className="qt-character-page"><CharacterHeader slot="actions" el={el} /></div> },
  'qt-character-archived-banner': {
    render: ({ el }) => (
      <div className="qt-character-page">
        <div {...el} role="status">This specimen has been archived. (Not really.)</div>
      </div>
    ),
  },
  'qt-section-card': { render: ({ el }) => <div className="qt-character-page"><SectionCard slot="card" el={el} /></div> },
  'qt-section-card-header': { render: ({ el }) => <div className="qt-character-page"><SectionCard slot="header" el={el} /></div> },
  'qt-section-card-body': { render: ({ el }) => <div className="qt-character-page"><SectionCard slot="body" el={el} /></div> },

  // --- Dialogs
  'qt-dialog-overlay': { render: ({ el }) => dialogFrame(<Dialog slot="overlay" el={el} />), note: 'Drawn inside its frame; in the app it covers the window.' },
  'qt-dialog': { render: ({ el }) => dialogFrame(<Dialog slot="dialog" el={el} />) },
  'qt-dialog-header': { render: ({ el }) => dialogFrame(<Dialog slot="header" el={el} />) },
  'qt-dialog-title': { render: ({ el }) => dialogFrame(<Dialog slot="title" el={el} />) },
  'qt-dialog-description': { render: ({ el }) => dialogFrame(<Dialog slot="description" el={el} />) },
  'qt-dialog-close': { render: ({ el }) => dialogFrame(<Dialog slot="close" el={el} />) },
  'qt-dialog-body': { render: ({ el }) => dialogFrame(<Dialog slot="body" el={el} />) },
  'qt-dialog-footer': { render: ({ el }) => dialogFrame(<Dialog slot="footer" el={el} />) },

  // --- Settings
  'qt-settings-header': {
    render: ({ el }) => (
      <div {...el}>
        <p className="qt-page-title">Settings</p>
        <p className="qt-text-small">Every knob in the house, invented for the gallery.</p>
      </div>
    ),
  },
  'qt-settings-persona-row': {
    render: ({ el }) => (
      <div {...el} role="group" aria-label="Specimen staff lenses">
        <button type="button" className="qt-settings-persona-chip" aria-pressed="true">The Lantern</button>
        <button type="button" className="qt-settings-persona-chip" aria-pressed="false">Aurora</button>
      </div>
    ),
  },
  'qt-settings-persona-chip': {
    render: ({ el }) => (
      <div className="qt-settings-persona-row" role="group" aria-label="Specimen staff lenses">
        <button type="button" {...el}>The Lantern</button>
      </div>
    ),
  },
  'qt-settings-search': {
    render: ({ el }) => (
      <div {...el}>
        <input type="search" className="qt-input" aria-label="Search the specimen settings" placeholder="Search the settings" />
      </div>
    ),
  },
  'qt-settings-lens-banner': {
    render: ({ el }) => (
      <div {...el}>
        <p className="qt-text-small">Seen through the Lantern&rsquo;s eyes. (A specimen lens.)</p>
      </div>
    ),
  },
  'qt-settings-layout': { render: ({ el }) => <SettingsLayout slot="layout" el={el} /> },
  'qt-settings-rail': { render: ({ el }) => <SettingsLayout slot="rail" el={el} /> },
  'qt-settings-rail-item': {
    render: ({ el }) => (
      <div className="qt-settings-layout">
        <nav className="qt-settings-rail" aria-label="Specimen settings groups">
          <a href="#specimen" {...el}>{el['data-group'] ?? 'A group'}</a>
        </nav>
      </div>
    ),
  },
  'qt-settings-rail-count': {
    render: ({ el }) => (
      <nav className="qt-settings-rail" aria-label="Specimen settings groups">
        <a href="#specimen" className="qt-settings-rail-item" data-group="connections">Connections <span {...el}>3</span></a>
      </nav>
    ),
  },
  'qt-settings-panel': { render: ({ el }) => <SettingsLayout slot="panel" el={el} /> },
  'qt-settings-advanced-divider': { render: ({ el }) => <SettingsLayout slot="divider" el={el} /> },
  'qt-collapsible-card': {
    component: 'CollapsibleCard',
    render: ({ el, instance }) =>
      instance.kind === 'base' ? (
        <CollapsibleCard title="A specimen card" description="It opens and closes, and sets nothing." icon={<Icon name="settings" className="w-4 h-4" />}>
          <p className="qt-text-small">A setting that sets nothing.</p>
        </CollapsibleCard>
      ) : (
        <CardMarkup slot="card" el={el} />
      ),
    note: 'The first instance is the real card; open it to see its body. Each data-card value is drawn as markup.',
  },
  'qt-collapsible-card-header': {
    render: ({ el, instance }) => <CardMarkup slot="header" el={el} open={instance.attributes['aria-expanded'] === 'true'} />,
  },
  'qt-collapsible-card-icon': { render: ({ el }) => <CardMarkup slot="icon" el={el} /> },
  'qt-collapsible-card-chevron': { render: ({ el, instance }) => <CardMarkup slot="chevron" el={el} open={instance.kind === 'state'} /> },
  'qt-collapsible-card-body': { render: ({ el }) => <CardMarkup slot="body" el={el} open chevronOpen /> },

  // --- Added in Spec I
  'qt-floating-dialog': {
    render: ({ el }) => (
      <div {...el} role="dialog" aria-label="A specimen floating dialog" style={{ position: 'relative', maxWidth: '24rem' }}>
        <div className="qt-floating-dialog-header">
          <div className="qt-floating-dialog-title">A floating dialog</div>
          <div className="qt-floating-dialog-actions">
            <button type="button" className="qt-floating-dialog-close" aria-label="Close (a specimen)">
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="qt-floating-dialog-body"><p>It floats, and asks nothing of anyone.</p></div>
      </div>
    ),
    note: 'Drawn in place: in the app it floats over the page and can be dragged.',
  },
  'qt-slide-over-panel': {
    render: ({ el }) => (
      <div {...el} role="dialog" aria-label="A specimen slide-over panel" style={{ position: 'relative', width: '20rem', maxWidth: '100%', height: 'auto' }}>
        <div className="qt-slide-over-header"><p className="qt-heading-4">A slide-over panel</p></div>
        <div className="p-4"><p>It slid in from the edge, as panels do.</p></div>
      </div>
    ),
    note: 'Drawn in place: in the app it slides in from the edge of the window.',
  },
}
