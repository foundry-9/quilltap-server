/**
 * Specimens — the Salon.
 *
 * Markup, following `MessageRow`, `StreamingMessage`, `AnnouncementChip`,
 * `PendingToolCalls`, `ToolMessage`, `ChatComposer` and `ParticipantCard`:
 * each reads the chat, its participants or the server. The thinking mark is
 * the real `QuillAnimation`. A bubble is always drawn inside its row and
 * body column, so a theme's `.qt-chat-message-row-user .qt-chat-message-user`
 * selectors land as they would.
 *
 * @module components/theme-specimens/specimens/salon
 */

import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import type { HookElementProps } from '../instances'
import type { SpecimenTable } from '../types'

type El = HookElementProps

const PROSE = 'A line of dialogue invented for the gallery, saying nothing to anyone.'

function Avatar({ name = 'Miss Specimen', el }: { name?: string; el?: El }) {
  return (
    <div {...(el ?? { className: 'qt-chat-desktop-avatar' })} style={{ flexShrink: 0 }}>
      <div className="flex flex-col items-center w-20 gap-1">
        <span className="qt-avatar-image inline-flex items-center justify-center w-12 h-12 rounded-full qt-bg-muted" role="img" aria-label={name}>
          {name.slice(0, 1)}
        </span>
        <span className="qt-avatar-labels"><span className="qt-avatar-name">{name}</span></span>
      </div>
    </div>
  )
}

/** A whole message row. `slot` puts the hook on the named part. */
function Row({
  side = 'assistant',
  slot,
  el,
  children,
  rowExtra = '',
}: {
  side?: 'user' | 'assistant'
  slot?: 'row' | 'avatar' | 'body' | 'bubble' | 'row-side'
  el?: El
  children?: ReactNode
  rowExtra?: string
}) {
  const rowBase = `qt-chat-message-row qt-chat-message-row-${side}${rowExtra ? ` ${rowExtra}` : ''}`
  const rowProps = slot === 'row' && el ? { 'data-role': side, ...el, className: `${el.className} qt-chat-message-row-${side}${rowExtra ? ` ${rowExtra}` : ''}` } : slot === 'row-side' && el ? { 'data-role': side, ...el, className: `qt-chat-message-row ${el.className}` } : { className: rowBase, 'data-role': side }
  const bubbleClass = side === 'user' ? 'qt-chat-message-user' : 'qt-chat-message-assistant'
  return (
    <div {...rowProps}>
      {side === 'assistant' && <Avatar el={slot === 'avatar' ? el : undefined} />}
      <div {...(slot === 'body' && el ? el : { className: 'qt-chat-message-body' })}>
        {children ?? (
          <div {...(slot === 'bubble' && el ? { ...el, className: `chat-message ${el.className}` } : { className: `chat-message ${bubbleClass}` })}>
            <p>{PROSE}</p>
          </div>
        )}
        <ActionBar />
      </div>
    </div>
  )
}

function ActionBar({ el }: { el?: El }) {
  return (
    <div {...(el ?? { className: 'qt-chat-message-action-bar' })}>
      <div className="qt-chat-message-action-bar-icons">
        <button type="button" className="qt-chat-message-action-icon" aria-label="Copy the specimen message"><Icon name="copy" className="w-4 h-4" /></button>
        <button type="button" className="qt-chat-message-action-icon qt-chat-message-action-icon-danger" aria-label="Delete the specimen message"><Icon name="trash" className="w-4 h-4" /></button>
      </div>
      <span className="qt-chat-message-action-timestamp">9:41 pm</span>
    </div>
  )
}

function Chip({ el, staff = 'lantern' }: { el?: El; staff?: string }) {
  return (
    <button type="button" aria-expanded="false" data-staff={staff} {...(el ?? { className: 'qt-chat-announcement-chip' })}>
      <Icon name="sparkles" className="w-3 h-3" />
      <span>The Lantern hung a specimen backdrop</span>
    </button>
  )
}

function ToolCall({ el, tool = 'generate_image' }: { el?: El; tool?: string }) {
  return (
    <div data-tool={tool} {...(el ?? { className: 'qt-chat-tool-call' })} style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem' }}>
      <p className="qt-text-small font-medium">{tool}</p>
      <p className="qt-text-xs">A tool result invented for the gallery.</p>
    </div>
  )
}

function Composer({ slot, el, actions }: { slot?: 'composer' | 'input' | 'send'; el?: El; actions?: El }) {
  return (
    <div {...(slot === 'composer' && el ? el : { className: 'qt-chat-composer' })}>
      <div className="qt-chat-composer-content"><div className="qt-chat-composer-inner flex items-end gap-2">
        <div
          {...(slot === 'input' && el ? el : { className: 'qt-chat-composer-input' })}
          role="textbox"
          aria-label="A specimen composer (it does not send)"
          aria-multiline="true"
          tabIndex={0}
          style={{ flex: 1, minHeight: '2.5rem' }}
        >
          Something the specimen meant to say…
        </div>
        <div {...(actions ?? { className: 'qt-chat-composer-actions' })}>
          <button type="button" {...(slot === 'send' && el ? el : { className: 'qt-chat-composer-send' })} aria-label="Send (a specimen; it sends nothing)">
            <Icon name="send" className="w-4 h-4" />
          </button>
        </div>
      </div></div>
    </div>
  )
}

function Participant({ slot, el }: { slot?: 'card' | 'dot' | 'name'; el?: El }) {
  return (
    <div {...(slot === 'card' && el ? el : { className: 'qt-participant-card' })} style={{ position: 'relative', maxWidth: '18rem' }}>
      <div className="flex items-center gap-2 p-2">
        <div {...(slot === 'dot' && el ? el : { className: 'qt-participant-turn-dot' })} />
        <span className="qt-avatar-image inline-flex items-center justify-center w-8 h-8 rounded-full qt-bg-muted">M</span>
        <span {...(slot === 'name' && el ? el : { className: 'qt-participant-card-name' })}>Miss Specimen</span>
      </div>
    </div>
  )
}

function Roleplay({ el }: { el: El }) {
  return (
    <Row>
      <div className="chat-message qt-chat-message-assistant">
        <div className="qt-chat-message-content">
          <p>
            {!el.className.includes('narration') && <><span className="qt-chat-narration">She set down the specimen cup.</span>{' '}</>}
            <span {...el}>{el.className.includes('dialogue') ? '“Nothing happened,” she said.' : el.className.includes('ooc') ? '((an aside, out of character))' : el.className.includes('monologue') ? 'Did anything happen?' : 'The clock went on not ticking.'}</span>
          </p>
        </div>
      </div>
    </Row>
  )
}

function Storyteller({ board, card }: { board?: El; card?: El }) {
  return (
    <section {...(board ?? { className: 'qt-storyteller-board' })} aria-label="A specimen storyteller's board">
      <div className="qt-storyteller-board-header"><span>This round</span></div>
      <div className="qt-storyteller-cards">
        <div {...(card ?? { className: 'qt-storyteller-card qt-storyteller-card-selected' })}>
          <div className="qt-storyteller-card-head">
            <span className="qt-storyteller-card-order">1</span>
            <span className="qt-storyteller-card-name">Miss Specimen</span>
          </div>
          <div className="qt-storyteller-plan">Means to say something invented.</div>
        </div>
      </div>
    </section>
  )
}

function Formatting({ toolbar, button }: { toolbar?: El; button?: El }) {
  return (
    <div {...(toolbar ?? { className: 'qt-formatting-toolbar' })} role="toolbar" aria-label="Specimen formatting">
      <div className="qt-formatting-toolbar-section">
        <button type="button" {...(button ?? { className: 'qt-formatting-button' })} aria-label="Bold (a specimen)"><strong>B</strong></button>
        <button type="button" className="qt-formatting-button" aria-label="Italic (a specimen)"><em>I</em></button>
      </div>
    </div>
  )
}

function Typeahead({ menu, option }: { menu?: El; option?: El }) {
  return (
    <div {...(menu ?? { className: 'qt-typeahead-menu' })} role="listbox" aria-label="Specimen mentions" style={{ position: 'relative', maxWidth: '16rem' }}>
      <div {...(option ?? { className: 'qt-typeahead-option qt-typeahead-option-active' })} role="option" aria-selected="true">
        <span className="qt-typeahead-option-label">Miss Specimen</span>
      </div>
      <div className="qt-typeahead-option" role="option" aria-selected="false">
        <span className="qt-typeahead-option-label">Mr Example</span>
      </div>
    </div>
  )
}

function DocPane({ pane, header }: { pane?: El; header?: El }) {
  return (
    <div {...(pane ?? { className: 'qt-doc-pane' })} style={{ minHeight: '8rem' }}>
      <div {...(header ?? { className: 'qt-doc-header' })}>
        <span className="qt-doc-title">specimen-notes.md</span>
      </div>
      <div className="p-3"><p>A document invented for the gallery.</p></div>
    </div>
  )
}


export const SALON_SPECIMENS: SpecimenTable = {
  'qt-chat-message-row': { render: ({ el }) => <Row slot="row" el={el} side={el['data-role'] === 'user' ? 'user' : 'assistant'} /> },
  'qt-chat-message-row-user': { render: ({ el }) => <Row side="user" slot="row-side" el={el} /> },
  'qt-chat-message-row-assistant': { render: ({ el }) => <Row side="assistant" slot="row-side" el={el} /> },
  'qt-chat-message-row-courier': {
    render: ({ el }) => (
      <Row rowExtra={el.className}>
        <div className="chat-message qt-chat-message-assistant"><p>Copy this prompt to another app and paste the answer back. (Invented.)</p></div>
      </Row>
    ),
  },
  'qt-chat-established-fact-row': {
    render: ({ el }) => (
      <div className={`qt-chat-message-row ${el.className}`} data-role="staff">
        <div className="qt-chat-message-body">
          <div className="chat-message qt-chat-message-assistant qt-chat-established-fact-band"><p>It is, and always was, raining. (Invented.)</p></div>
        </div>
      </div>
    ),
  },
  'qt-chat-message-row-tool': {
    render: ({ el }) => (
      <div data-role="tool" {...el}>
        <ToolCall />
      </div>
    ),
  },
  'qt-chat-desktop-avatar': { render: ({ el }) => <Row slot="avatar" el={el} /> },
  'qt-chat-avatar-carried': {
    render: ({ el }) => (
      <div className="qt-chat-desktop-avatar">
        <ul {...el} aria-label="Carrying" style={{ display: 'flex', gap: '0.25rem' }}>
          <li className="qt-badge qt-badge-outline">A specimen umbrella</li>
        </ul>
      </div>
    ),
  },
  'qt-chat-message-body': { render: ({ el }) => <Row slot="body" el={el} /> },
  'qt-chat-message-user': { render: ({ el }) => <Row side="user" slot="bubble" el={el} /> },
  'qt-chat-message-assistant': { render: ({ el }) => <Row side="assistant" slot="bubble" el={el} /> },
  'qt-chat-message-streaming': {
    render: ({ el }) => (
      <Row>
        <div {...el} style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem' }}>
          <p>
            A sentence still being written <QuillAnimation size="sm" className="inline-block ml-2 qt-text-secondary" label={null} />
          </p>
        </div>
      </Row>
    ),
  },
  'qt-chat-whisper-label': {
    render: ({ el }) => (
      <Row>
        <div className="chat-message qt-chat-message-assistant qt-chat-message-whisper">
          <div {...el}>whispered to Mr Example</div>
          <p>{PROSE}</p>
        </div>
      </Row>
    ),
  },
  'qt-chat-silent-label': {
    render: ({ el }) => (
      <Row>
        <div className="chat-message qt-chat-message-assistant qt-chat-message-silent">
          <div {...el}>silent</div>
          <p>{PROSE}</p>
        </div>
      </Row>
    ),
  },
  'qt-chat-message-established-fact': {
    render: ({ el }) => (
      <Row side="user">
        <div className="chat-message qt-chat-message-user">
          <div {...el}>Established fact</div>
          <p>The clock in the hall has stopped. (Invented.)</p>
        </div>
      </Row>
    ),
  },
  'qt-chat-established-fact-band': {
    render: ({ el }) => (
      <div className="qt-chat-message-row qt-chat-established-fact-row" data-role="staff">
        <div className="qt-chat-message-body">
          <div className={`chat-message qt-chat-message-assistant ${el.className}`}><p>It is, and always was, raining. (Invented.)</p></div>
        </div>
      </div>
    ),
  },
  'qt-chat-system-bar': {
    render: ({ el }) => (
      <div className="qt-chat-message-row qt-chat-message-row-assistant" data-role="staff" data-staff="lantern">
        <div className="qt-chat-message-body">
          <button type="button" {...el}>
            <Icon name="sparkles" className="w-4 h-4" />
            <span>The Lantern hung a specimen backdrop</span>
          </button>
        </div>
      </div>
    ),
  },
  'qt-chat-announcement-group': {
    render: ({ el }) => (
      <div {...el}>
        <span className="qt-chat-announcement-chip-wrap"><Chip /></span>
        <span className="qt-chat-announcement-chip-wrap"><Chip staff="aurora" /></span>
      </div>
    ),
  },
  'qt-chat-announcement-chip': {
    render: ({ el }) => (
      <div className="qt-chat-announcement-group">
        <span className="qt-chat-announcement-chip-wrap"><Chip el={el} staff={el['data-staff'] ?? 'lantern'} /></span>
      </div>
    ),
  },
  'qt-chat-message-action-bar': {
    render: ({ el }) => (
      <div className="qt-chat-message-row qt-chat-message-row-assistant" data-role="assistant">
        <div className="qt-chat-message-body">
          <div className="chat-message qt-chat-message-assistant"><p>{PROSE}</p></div>
          <ActionBar el={el} />
        </div>
      </div>
    ),
    note: 'In the app it shows on hover over the message.',
  },
  'qt-chat-message-tools': {
    render: ({ el }) => (
      <Row>
        <div className="chat-message qt-chat-message-assistant">
          <div {...el}>
            <details open>
              <summary className="qt-text-small">One tool call</summary>
              <div className="qt-chat-tool-embedded"><ToolCall /></div>
            </details>
          </div>
          <p>{PROSE}</p>
        </div>
      </Row>
    ),
  },
  'qt-chat-pending-tools': {
    render: ({ el }) => (
      <div className="qt-chat-message-row qt-chat-message-row-assistant" data-role="tool">
        <div className="qt-chat-message-body">
          <details {...el} open>
            <summary className="qt-text-small">Calling one tool…</summary>
            <ToolCall tool="wardrobe_wear" />
          </details>
        </div>
      </div>
    ),
  },
  'qt-chat-tool-call': { render: ({ el }) => <div className="qt-chat-message-row-tool" data-role="tool"><ToolCall el={el} tool={el['data-tool'] ?? 'generate_image'} /></div> },
  'qt-chat-tool-embedded': {
    render: ({ el }) => (
      <div className="qt-chat-message-tools">
        <div {...el}><ToolCall /></div>
      </div>
    ),
  },
  'qt-chat-composer': { render: ({ el }) => <Composer slot="composer" el={el} /> },
  'qt-chat-composer-input': { render: ({ el }) => <Composer slot="input" el={el} /> },
  'qt-chat-composer-send': { render: ({ el }) => <Composer slot="send" el={el} /> },
  'qt-chat-toolbar': {
    render: ({ el }) => (
      <div {...el} role="toolbar" aria-label="Specimen Salon toolbar">
        <button type="button" className="qt-chat-toolbar-button" aria-label="Attach (a specimen)"><Icon name="paperclip" className="w-4 h-4" /></button>
        <button type="button" className="qt-chat-toolbar-button qt-chat-toolbar-button-active" aria-label="Document mode (a specimen)"><Icon name="file" className="w-4 h-4" /></button>
      </div>
    ),
  },
  'qt-chat-toolbar-button': {
    render: ({ el }) => (
      <div className="qt-chat-toolbar" role="toolbar" aria-label="Specimen Salon toolbar">
        <button type="button" {...el} aria-label="A toolbar button (a specimen)"><Icon name="paperclip" className="w-4 h-4" /></button>
      </div>
    ),
  },
  'qt-participant-card': { render: ({ el }) => <Participant slot="card" el={el} /> },
  'qt-participant-turn-dot': { render: ({ el }) => <Participant slot="dot" el={el} /> },
  'qt-participant-card-name': { render: ({ el }) => <Participant slot="name" el={el} /> },

  // --- Added in Spec I
  'qt-chat-layout': {
    render: ({ el }) => (
      <div {...el} style={{ display: 'flex', minHeight: '14rem' }}>
        <div className="qt-chat-main" style={{ flex: 1, minWidth: 0 }}>
          <div className="qt-chat-messages-list"><Row /></div>
          <Composer />
        </div>
      </div>
    ),
    note: 'Drawn small: in the app it fills the pane.',
  },
  'qt-chat-messages-list': {
    render: ({ el }) => (
      <div className="qt-chat-messages">
        <div {...el}>
          <Row side="user" />
          <Row />
        </div>
      </div>
    ),
  },
  'qt-chat-message-content': {
    render: ({ el }) => (
      <Row>
        <div className="chat-message qt-chat-message-assistant">
          <div {...el}><p>{PROSE}</p></div>
        </div>
      </Row>
    ),
  },
  'qt-chat-dialogue': { render: ({ el }) => <Roleplay el={el} /> },
  'qt-chat-narration': { render: ({ el }) => <Roleplay el={el} /> },
  'qt-chat-ooc': { render: ({ el }) => <Roleplay el={el} /> },
  'qt-chat-inner-monologue': { render: ({ el }) => <Roleplay el={el} /> },
  'qt-chat-composer-actions': { render: ({ el }) => <Composer actions={el} /> },
  'qt-chat-stop-button': {
    render: ({ el }) => (
      <div className="qt-chat-composer-actions">
        <button type="button" {...el} className={`qt-chat-composer-send ${el.className}`} aria-label="Stop (a specimen; it stops nothing)">
          <Icon name="stop-sign" className="w-5 h-5" />
        </button>
      </div>
    ),
  },
  'qt-chat-attachment-chip': {
    render: ({ el }) => (
      <div className="qt-chat-composer">
        <div className="qt-chat-attachment-list">
          <div {...el}>
            <span className="qt-chat-attachment-chip-icon"><Icon name="file" className="w-4 h-4" /></span>
            <span className="qt-text-xs">specimen-notes.txt</span>
            <button type="button" className="qt-chat-attachment-chip-remove" aria-label="Remove the specimen file"><Icon name="close" className="w-3 h-3" /></button>
          </div>
        </div>
      </div>
    ),
  },
  'qt-chat-attachment-image': {
    render: ({ el }) => (
      <Row>
        <div className="chat-message qt-chat-message-assistant">
          <p>A picture, invented for the gallery:</p>
          <span {...el} className={`${el.className} block w-20 h-20`} role="img" aria-label="A specimen picture" style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }} />
        </div>
      </Row>
    ),
  },
  'qt-chat-thinking': {
    render: ({ el }) => (
      <div {...el}>
        <details className="qt-chat-thinking-details" open>
          <summary className="qt-chat-thinking-summary">
            <span className="qt-chat-thinking-label">Reasoning</span>
          </summary>
          <div className="qt-chat-thinking-body">
            <p>First the specimen considered nothing, then it considered it again.</p>
          </div>
        </details>
      </div>
    ),
  },
  'qt-chat-sidebar': {
    render: ({ el }) => (
      <aside {...el} aria-label="Specimen participants" style={{ position: 'relative', width: el.className.includes('collapsed') ? '4rem' : '18rem' }}>
        <div className="qt-chat-sidebar-header"><span className="qt-chat-sidebar-heading">Participants</span></div>
        {el.className.includes('collapsed') ? (
          <div className="qt-chat-sidebar-collapsed-avatars">
            <span className="qt-avatar-image inline-flex items-center justify-center w-8 h-8 rounded-full qt-bg-muted">M</span>
          </div>
        ) : (
          <Participant />
        )}
      </aside>
    ),
  },
  'qt-courier-bubble': {
    render: ({ el }) => (
      <Row rowExtra="qt-chat-message-row-courier">
        <div {...el}>
          <div className="qt-courier-bubble-header"><span className="qt-courier-bubble-title">Courier: a manual turn</span></div>
          <div className="qt-courier-bubble-prompt"><div className="qt-courier-bubble-prompt-body">Copy this invented prompt to another app.</div></div>
          <p className="qt-courier-bubble-hint">Then paste the answer below.</p>
          <textarea className="qt-courier-bubble-textarea" aria-label="The pasted answer (a specimen)" rows={2} readOnly value="" />
        </div>
      </Row>
    ),
  },
  'qt-green-room': {
    render: ({ el }) => (
      <div {...el} className={`qt-card ${el.className}`}>
        <div className="qt-green-room-header">
          <div className="qt-green-room-headline" role="status">
            <span className="qt-green-room-pulse" aria-hidden="true" />
            <span className="qt-green-room-title">The green room</span>
            <span className="qt-green-room-status">Setting the specimen stage…</span>
          </div>
        </div>
      </div>
    ),
  },
  'qt-storyteller-board': { render: ({ el }) => <Storyteller board={el} /> },
  'qt-storyteller-card': { render: ({ el }) => <Storyteller card={el} /> },
  'qt-formatting-toolbar': { render: ({ el }) => <Formatting toolbar={el} /> },
  'qt-formatting-button': { render: ({ el }) => <Formatting button={el} /> },
  'qt-typeahead-menu': { render: ({ el }) => <Typeahead menu={el} /> },
  'qt-typeahead-option': { render: ({ el }) => <Typeahead option={el} /> },
  'qt-mention-chip': {
    render: ({ el }) => (
      <Row>
        <div className="chat-message qt-chat-message-assistant">
          <p>
            Ask <span {...el}>{el.className.includes('thing') ? 'the Specimen Lamp' : 'Mr Example'}</span> about it.
          </p>
        </div>
      </Row>
    ),
    note: 'In the app a chip shows its card on hover.',
  },
  'qt-doc-pane': { render: ({ el }) => <DocPane pane={el} /> },
  'qt-doc-header': { render: ({ el }) => <DocPane header={el} /> },
}
