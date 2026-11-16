/**
 * Specimens — the shared building blocks.
 *
 * Real components where they render from props alone: `EmptyState` (the
 * empty-state title), `QuillAnimation` (the thinking mark). The rest are
 * utility classes the app writes by hand, so markup is what the app does
 * too.
 *
 * @module components/theme-specimens/specimens/common
 */

import { EmptyState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/ui/icon'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import type { HookElementProps } from '../instances'
import type { SpecimenDef, SpecimenTable } from '../types'

type El = HookElementProps

const button = (label: string, extra = ''): SpecimenDef => ({
  render: ({ el }) => (
    <button type="button" {...el} className={`${el.className}${extra ? ` ${extra}` : ''}`}>
      {label}
    </button>
  ),
})

/** A modifier class drawn on the base it modifies (`qt-button qt-button-primary`). */
const onBase = (base: string, label: string): SpecimenDef => ({
  render: ({ el }) => (
    <button type="button" {...el} className={`${base} ${el.className}`}>
      {label}
    </button>
  ),
})

const badge = (label: string): SpecimenDef => ({
  render: ({ el }) => <span {...el} className={`qt-badge ${el.className}`}>{label}</span>,
})

const alert = (label: string): SpecimenDef => ({
  render: ({ el }) => (
    <div {...el} className={`qt-alert ${el.className}`} role="note">
      {label}
    </div>
  ),
})

const text = (sample: string, tag: 'p' | 'span' = 'p'): SpecimenDef => ({
  render: ({ el }) => (tag === 'p' ? <p {...el}>{sample}</p> : <span {...el}>{sample}</span>),
})

function Card({ slot, el }: { slot?: string; el?: El }) {
  const on = (which: string, fallback: string) => (slot === which && el ? el : { className: fallback })
  return (
    <div {...(slot === 'card' && el ? el : { className: 'qt-card' })} style={{ maxWidth: '24rem' }}>
      <div {...on('header', 'qt-card-header')}>
        <p {...on('title', 'qt-card-title')}>A specimen card</p>
        <p {...on('subtitle', 'qt-card-subtitle')}>Its subtitle</p>
      </div>
      <p {...on('description', 'qt-card-description')}>A description that describes nothing in particular.</p>
    </div>
  )
}

function AvatarParts({ slot, el }: { slot: string; el: El }) {
  const on = (which: string, fallback: string) => (slot === which ? el : { className: fallback })
  return (
    <div className="flex flex-col items-center gap-1" style={{ width: '8rem' }}>
      <span {...on('image', 'qt-avatar-image')} role="img" aria-label="Miss Specimen" style={{ display: 'inline-flex', width: '3rem', height: '3rem', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px' }}>
        M
      </span>
      <span {...on('labels', 'qt-avatar-labels')}>
        <span {...on('name', 'qt-avatar-name')}>Miss Specimen</span>
        <span {...on('title', 'qt-avatar-title')}>the invented</span>
      </span>
    </div>
  )
}

export const COMMON_SPECIMENS: SpecimenTable = {
  'qt-page-container': { render: ({ el }) => <div {...el}><p className="qt-text-small">A page of nothing, centred.</p></div> },
  'qt-card': { render: ({ el }) => <Card slot="card" el={el} /> },
  'qt-card-header': { render: ({ el }) => <Card slot="header" el={el} /> },
  'qt-card-title': { render: ({ el }) => <Card slot="title" el={el} /> },
  'qt-card-subtitle': { render: ({ el }) => <Card slot="subtitle" el={el} /> },
  'qt-card-description': { render: ({ el }) => <Card slot="description" el={el} /> },
  'qt-card-interactive': {
    render: ({ el }) => (
      <button type="button" {...el} className={`qt-card ${el.className}`} style={{ maxWidth: '24rem', textAlign: 'left' }}>
        <span className="qt-card-title">A card you may click</span>
        <span className="qt-card-description block">It goes nowhere.</span>
      </button>
    ),
    note: 'Lifts on hover.',
  },
  'qt-button': button('A plain button', 'qt-button-secondary'),
  'qt-button-primary': onBase('qt-button', 'Primary'),
  'qt-button-secondary': onBase('qt-button', 'Secondary'),
  'qt-button-ghost': onBase('qt-button', 'Ghost'),
  'qt-button-destructive': onBase('qt-button', 'Destructive'),
  'qt-button-success': onBase('qt-button', 'Success'),
  'qt-button-warning': onBase('qt-button', 'Warning'),
  'qt-button-sm': onBase('qt-button qt-button-primary', 'Small'),
  'qt-button-icon': {
    render: ({ el }) => (
      <button type="button" {...el} className={`qt-button qt-button-ghost ${el.className}`} aria-label="An icon button (a specimen)">
        <Icon name="star" className="w-4 h-4" />
      </button>
    ),
  },
  'qt-input': { render: ({ el }) => <input type="text" {...el} aria-label="A specimen input" defaultValue="Something typed" /> },
  'qt-textarea': { render: ({ el }) => <textarea {...el} aria-label="A specimen text area" rows={2} defaultValue="Several lines of nothing." /> },
  'qt-select': {
    render: ({ el }) => (
      <select {...el} aria-label="A specimen select" defaultValue="one">
        <option value="one">The first choice</option>
        <option value="two">The second</option>
      </select>
    ),
  },
  'qt-select-sm': {
    render: ({ el }) => (
      <select {...el} className={`qt-select ${el.className}`} aria-label="A small specimen select" defaultValue="one">
        <option value="one">Small</option>
      </select>
    ),
  },
  'qt-badge': text('Badge', 'span'),
  'qt-badge-primary': badge('Primary'),
  'qt-badge-secondary': badge('Secondary'),
  'qt-badge-success': badge('Success'),
  'qt-badge-warning': badge('Warning'),
  'qt-badge-info': badge('Info'),
  'qt-badge-destructive': badge('Destructive'),
  'qt-badge-outline': badge('Outline'),
  'qt-badge-character': badge('Miss Specimen'),
  'qt-badge-user-character': badge('The operator’s own'),
  'qt-badge-chat': badge('A chat'),
  'qt-badge-tag': badge('invented'),
  'qt-badge-memory': badge('A memory'),
  'qt-badge-project': badge('A project'),
  'qt-alert': text('A plain alert, alarming no one.'),
  'qt-alert-info': alert('For your information: nothing.'),
  'qt-alert-success': alert('All went well, in theory.'),
  'qt-alert-warning': alert('A warning about nothing in particular.'),
  'qt-alert-error': alert('Something went wrong, but only here.'),
  'qt-heading-1': text('Heading one'),
  'qt-heading-2': text('Heading two'),
  'qt-heading-3': text('Heading three'),
  'qt-heading-4': text('Heading four'),
  'qt-page-title': text('A page title'),
  'qt-section-title': text('A section title'),
  'qt-text-section': text('Section heading text'),
  'qt-text-brand': text('Brand-coloured words'),
  'qt-font-brand': text('Quilltap', 'span'),
  'qt-spinner': { render: ({ el }) => <div {...el} role="img" aria-label="A specimen spinner" /> },
  'qt-thinking-indicator': {
    component: 'QuillAnimation',
    render: ({ instance }) => (instance.kind === 'base' ? <QuillAnimation size="lg" label="Writing (a specimen)" /> : null),
  },
  'qt-empty-state-title': {
    component: 'EmptyState',
    render: () => <EmptyState title="Nothing here yet" description="An empty state, invented and empty." icon={<Icon name="sparkles" className="w-6 h-6" />} />,
  },
  'qt-wikilink': {
    render: ({ el }) => (
      <p className="qt-text-small">
        See <a href="#specimen" {...el}>The Specimen Page</a> for nothing at all.
      </p>
    ),
  },
  'qt-file-preview-panel': {
    render: ({ el }) => (
      <div {...el} style={{ maxHeight: '6rem', overflow: 'auto' }}>
        <pre className="qt-text-xs">{'A file of invented text.\nLine two.'}</pre>
      </div>
    ),
  },
  'qt-diagram': {
    render: ({ el }) => (
      <div {...el} role="img" aria-label="A specimen diagram">
        <svg viewBox="0 0 160 40" width="160" height="40" aria-hidden="true">
          <rect x="2" y="8" width="56" height="24" rx="4" fill="none" stroke="currentColor" />
          <line x1="58" y1="20" x2="102" y2="20" stroke="currentColor" />
          <rect x="102" y="8" width="56" height="24" rx="4" fill="none" stroke="currentColor" />
        </svg>
      </div>
    ),
  },
  'qt-avatar-image': { render: ({ el }) => <AvatarParts slot="image" el={el} /> },
  'qt-avatar-labels': { render: ({ el }) => <AvatarParts slot="labels" el={el} /> },
  'qt-avatar-name': { render: ({ el }) => <AvatarParts slot="name" el={el} /> },
  'qt-avatar-title': { render: ({ el }) => <AvatarParts slot="title" el={el} /> },
  'qt-tab-group': {
    render: ({ el }) => (
      <div {...el} role="tablist" aria-label="Specimen in-page tabs">
        <button type="button" role="tab" aria-selected="true" className="qt-tab qt-tab-active">First</button>
        <button type="button" role="tab" aria-selected="false" className="qt-tab">Second</button>
      </div>
    ),
  },
  'qt-tab': {
    render: ({ el, instance }) =>
      instance.attributes['data-tab-kind'] ? (
        <div className="qt-tab-strip" role="tablist" aria-label="Specimen workspace tabs">
          <div {...el}>
            <button type="button" className="qt-tab-select" role="tab" aria-selected="false">
              <span className="qt-tab-label">{instance.attributes['data-tab-kind']}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="qt-tab-group" role="tablist" aria-label="Specimen in-page tabs">
          <button type="button" role="tab" aria-selected={el.className.includes('qt-tab-active') ? 'true' : 'false'} {...el}>
            A tab
          </button>
        </div>
      ),
  },
}
