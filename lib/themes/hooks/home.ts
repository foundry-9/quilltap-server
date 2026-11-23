/**
 * Theme hooks — the home dashboard (`components/homepage/`).
 *
 * @module lib/themes/hooks/home
 */

import type { HookDef } from './types'

/** The home bands, as written in `data-section`. */
export const HOME_SECTIONS = ['resume', 'chats', 'characters', 'projects'] as const
export type HomeSection = (typeof HOME_SECTIONS)[number]

export const HOME_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-homepage-container',
    surface: 'home',
    label: 'Home page',
    description:
      'A picture a theme paints behind the home page should stand aside while `qt-homepage-backdrop` is set: a dynamic-backgrounds collage is showing instead.',
    states: [{ kind: 'class', className: 'qt-homepage-backdrop', label: 'A dynamic background is showing' }],
    since: 1,
  },
  {
    className: 'qt-homepage-header',
    surface: 'home',
    label: 'Home header line',
    description: 'The greeting and the quick actions, side by side at the top of the home page.',
    within: ['qt-homepage-container'],
    since: 2,
  },
  {
    className: 'qt-homepage-welcome',
    surface: 'home',
    label: 'Welcome block',
    description: 'The greeting at the top of the home page.',
    within: ['qt-homepage-header'],
    since: 1,
  },
  {
    className: 'qt-quick-actions',
    surface: 'home',
    label: 'Quick actions row',
    within: ['qt-homepage-header'],
    since: 1,
  },
  {
    className: 'qt-homepage-grid',
    surface: 'home',
    label: 'Home band stack',
    description: 'Holds the home bands, one under another.',
    within: ['qt-homepage-container'],
    since: 1,
  },
  {
    className: 'qt-homepage-section',
    surface: 'home',
    label: 'Home page band',
    within: ['qt-homepage-grid'],
    variants: [{
      attribute: 'data-section',
      values: HOME_SECTIONS,
      description: 'Which band: the conversation last touched, the recent conversations beside it, the characters or the projects.',
    }],
    since: 1,
  },
  {
    className: 'qt-homepage-section-header',
    surface: 'home',
    label: 'Home band header',
    within: ['qt-homepage-section'],
    since: 1,
  },
  {
    className: 'qt-homepage-section-title',
    surface: 'home',
    label: 'Home band title',
    within: ['qt-homepage-section-header'],
    since: 1,
  },
  {
    className: 'qt-homepage-section-link',
    surface: 'home',
    label: 'Home band "View all" link',
    within: ['qt-homepage-section-header'],
    since: 1,
  },
  {
    className: 'qt-homepage-section-content',
    surface: 'home',
    label: 'Home band body',
    within: ['qt-homepage-section'],
    since: 1,
  },
  {
    className: 'qt-homepage-row',
    surface: 'home',
    label: 'Home list row',
    description: 'One conversation in the recent list, or one project tile on the projects shelf.',
    within: ['qt-homepage-section-content'],
    since: 1,
  },
  {
    className: 'qt-homepage-empty',
    surface: 'home',
    label: 'Home band empty state',
    within: ['qt-homepage-section-content'],
    since: 1,
  },
  {
    className: 'qt-homepage-resume-picture',
    surface: 'home',
    label: 'Resume card picture',
    description: 'The story background of the conversation last touched (or its cast, when it has none), across the top of the resume card.',
    within: ['qt-homepage-section'],
    since: 2,
  },
  {
    className: 'qt-homepage-resume-title',
    surface: 'home',
    label: 'Resume card title',
    description: 'The title, in full, of the conversation last touched.',
    within: ['qt-homepage-section-content'],
    since: 2,
  },
  {
    className: 'qt-characters-grid',
    surface: 'home',
    label: 'Character portrait wall',
    within: ['qt-homepage-section-content'],
    since: 1,
  },
  {
    className: 'qt-character-card',
    surface: 'home',
    label: 'Character portrait',
    description: 'One character on the home page: a portrait and a name. The last place on the wall, for everyone who did not fit, wears it too.',
    within: ['qt-characters-grid'],
    since: 1,
  },
  {
    className: 'qt-character-card-popover',
    surface: 'home',
    label: 'Character portrait card',
    description: 'The card that opens on a portrait at rest or in focus: title, model, the latest conversation and the character\'s page.',
    within: ['qt-character-card'],
    since: 2,
  },
]
