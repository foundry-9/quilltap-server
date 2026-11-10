'use client'

/**
 * A chip on an absent character's name — or on a thing from the Atlas — at its
 * first mention in a chat.
 *
 * Hovering it shows their card — name, aliases, age, public progressions,
 * pronouns and identity — the
 * same particulars the model is given in its referent ledger. Click pins the
 * card open so a long identity can be scrolled and read. The chips replace the
 * Host's old introduction card in the conversation.
 *
 * A thing's chip (`kind: 'thing'`, from `?action=atlas-mentions`) shows the
 * entry instead: its name, what else it is called, its graphic prompt, its
 * knowledge rendered as Markdown, its current picture and the tier it is
 * filed in — what the characters who can reach it are told.
 *
 * Marked runs reach here from `MessageContent` through
 * {@link MentionChipsContext}; see `lib/chat/mention-markers.ts` for how a
 * name is marked without breaking the roleplay styling around it.
 */

import { createContext, useContext, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '@/components/ui/Tooltip'
import { MENTION_OPEN, splitMentionMarkers } from '@/lib/chat/mention-markers'
import type { AtlasCard, AtlasOrigin } from '@/lib/schemas/atlas.types'

/** One chip, as `?action=absent-mentions` returns it (less the message id). */
export interface AbsentMentionChip {
  kind?: 'person'
  characterId: string
  /** The name or alias exactly as written in the message. */
  text: string
  card: {
    name: string
    aliases: string[]
    pronouns: string | null
    /** Age and public progressions, one line each. */
    facts: string[]
    body: string
  }
}

/** One thing's chip, as `?action=atlas-mentions` returns it (less the message id). */
export interface AtlasMentionChip {
  kind: 'thing'
  entryId: string
  /** The term exactly as written in the message. */
  text: string
  card: AtlasCard
}

/** Any chip: a person's or a thing's. */
export type MentionChipData = AbsentMentionChip | AtlasMentionChip

/** The chips for the message being rendered, indexed as the markers number them. */
export const MentionChipsContext = createContext<ReadonlyArray<MentionChipData> | null>(null)

/** Where an entry is filed, for the popup. */
function atlasTierLabel(origin: AtlasOrigin): string {
  switch (origin.scope) {
    case 'general':
      return 'Quilltap General'
    case 'project':
      return `Project · ${origin.name}`
    case 'group':
      return `Group · ${origin.name}`
    case 'character':
      return `${origin.name}'s vault`
  }
}

function AtlasCardView({ card }: { card: AtlasCard }) {
  return (
    <div className="qt-tooltip-body">
      <div className="qt-tooltip-title">{card.name}</div>
      {card.imageFileId && (
        <img
          className="qt-tooltip-image"
          src={`/api/v1/files/${card.imageFileId}?action=thumbnail`}
          alt={`A picture of ${card.name}`}
        />
      )}
      {card.aliases.length > 0 && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-section-label">Also called</div>
          <div>{card.aliases.join(', ')}</div>
        </div>
      )}
      {card.graphicPrompt && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-section-label">Appearance</div>
          <div className="qt-tooltip-quote">{card.graphicPrompt}</div>
        </div>
      )}
      {card.knowledge && (
        <div className="qt-tooltip-section qt-tooltip-markdown">
          <div className="qt-tooltip-section-label">What is known</div>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.knowledge}</ReactMarkdown>
        </div>
      )}
      <div className="qt-tooltip-hint">From the Atlas · {atlasTierLabel(card.origin)} · click to pin</div>
    </div>
  )
}

function MentionCard({ card }: { card: AbsentMentionChip['card'] }) {
  return (
    <div className="qt-tooltip-body">
      <div className="qt-tooltip-title">{card.name}</div>
      {card.aliases.length > 0 && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-section-label">Also known as</div>
          <div>{card.aliases.join(', ')}</div>
        </div>
      )}
      {card.facts.length > 0 && (
        <div className="qt-tooltip-section">
          {card.facts.map((fact) => (
            <div key={fact}>{fact}</div>
          ))}
        </div>
      )}
      {card.pronouns && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-section-label">Pronouns</div>
          <div>{card.pronouns}</div>
        </div>
      )}
      {card.body && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-quote">{card.body}</div>
        </div>
      )}
      <div className="qt-tooltip-hint">Not in this conversation · click to pin</div>
    </div>
  )
}

/**
 * One chip. `kind` says whose: a person's (the default) or a thing's; it is
 * read from the mention when not given.
 */
export function MentionChip({
  mention,
  kind = mention.kind ?? 'person',
  children,
}: {
  mention: MentionChipData
  kind?: 'person' | 'thing'
  children: ReactNode
}) {
  if (kind === 'thing' && mention.kind === 'thing') {
    return (
      <Tooltip content={<AtlasCardView card={mention.card} />} interactive pinnable delay={250}>
        <span
          className="qt-mention-chip qt-mention-chip-thing"
          tabIndex={0}
          role="button"
          aria-label={`${mention.card.name}, from the Atlas`}
        >
          {children}
        </span>
      </Tooltip>
    )
  }
  const person = mention as AbsentMentionChip
  return (
    <Tooltip content={<MentionCard card={person.card} />} interactive pinnable delay={250}>
      <span
        className="qt-mention-chip"
        tabIndex={0}
        role="button"
        aria-label={`${person.card.name}, not in this conversation`}
      >
        {children}
      </span>
    </Tooltip>
  )
}

/** Renders marked text: plain runs as text, marked names as chips. */
function MentionText({ text }: { text: string }) {
  const chips = useContext(MentionChipsContext)
  const runs = splitMentionMarkers(text)
  return (
    <>
      {runs.map((run, i) => {
        if (typeof run === 'string') return run
        const mention = chips?.[run.index]
        return mention
          ? <MentionChip key={i} mention={mention}>{run.text}</MentionChip>
          : run.text
      })}
    </>
  )
}

/**
 * A text run for the message renderer: unchanged unless it carries a mention
 * marker, in which case the marked names become chips.
 */
export function withMentionChips(text: string, key?: string | number): ReactNode {
  return text.includes('') ? <MentionText key={key} text={text} /> : text
}
