/**
 * Theme hooks — the home dashboard (`components/homepage/`).
 *
 * @module lib/themes/hooks/home
 */

import type { HookDef } from './types'

/** The three home cards, as written in `data-section`. */
export const HOME_SECTIONS = ['chats', 'projects', 'characters'] as const
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
    className: 'qt-homepage-welcome',
    surface: 'home',
    label: 'Welcome block',
    description: 'The greeting at the top of the home page.',
    within: ['qt-homepage-container'],
    since: 1,
  },
  {
    className: 'qt-quick-actions',
    surface: 'home',
    label: 'Quick actions row',
    within: ['qt-homepage-container'],
    since: 1,
  },
  {
    className: 'qt-homepage-grid',
    surface: 'home',
    label: 'Home card grid',
    description: 'Holds the three home cards side by side.',
    within: ['qt-homepage-container'],
    since: 1,
  },
  {
    className: 'qt-homepage-section',
    surface: 'home',
    label: 'Home page card',
    within: ['qt-homepage-grid'],
    variants: [{ attribute: 'data-section', values: HOME_SECTIONS, description: 'Which card: recent chats, active projects or favourite characters.' }],
    since: 1,
  },
  {
    className: 'qt-homepage-section-header',
    surface: 'home',
    label: 'Home card header',
    within: ['qt-homepage-section'],
    since: 1,
  },
  {
    className: 'qt-homepage-section-title',
    surface: 'home',
    label: 'Home card title',
    within: ['qt-homepage-section-header'],
    since: 1,
  },
  {
    className: 'qt-homepage-section-link',
    surface: 'home',
    label: 'Home card "View all" link',
    within: ['qt-homepage-section-header'],
    since: 1,
  },
  {
    className: 'qt-homepage-section-content',
    surface: 'home',
    label: 'Home card body',
    within: ['qt-homepage-section'],
    since: 1,
  },
  {
    className: 'qt-homepage-row',
    surface: 'home',
    label: 'Home list row',
    description: 'One chat or project in the Recent Chats or Active Projects card.',
    within: ['qt-homepage-section-content'],
    since: 1,
  },
  {
    className: 'qt-homepage-empty',
    surface: 'home',
    label: 'Home card empty state',
    within: ['qt-homepage-section-content'],
    since: 1,
  },
  {
    className: 'qt-characters-grid',
    surface: 'home',
    label: 'Favourite characters grid',
    within: ['qt-homepage-section-content'],
    since: 1,
  },
  {
    className: 'qt-character-card',
    surface: 'home',
    label: 'Favourite character card',
    within: ['qt-characters-grid'],
    since: 1,
  },
]
