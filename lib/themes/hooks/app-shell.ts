/**
 * Theme hooks — app shell (`components/layout/app-layout.tsx`,
 * `components/layout/page-toolbar.tsx`).
 *
 * @module lib/themes/hooks/app-shell
 */

import type { HookDef } from './types'

export const APP_SHELL_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-app-layout',
    surface: 'app-shell',
    label: 'App layout',
    description: 'The whole signed-in window: the left rail beside the main column.',
    since: 1,
  },
  {
    className: 'qt-skip-link',
    surface: 'app-shell',
    label: 'Skip-to-content link',
    description: 'Visually hidden until focused.',
    within: ['qt-app-layout'],
    since: 1,
  },
  {
    className: 'qt-app-main',
    surface: 'app-shell',
    label: 'Main column',
    description: 'Everything right of the left rail: the content and the footer.',
    within: ['qt-app-layout'],
    since: 1,
  },
  {
    className: 'qt-app-content',
    surface: 'app-shell',
    label: 'Main content (`<main>`)',
    description:
      'The `<main>` landmark. Inside the signed-in shell it holds the page toolbar and the scroll area; on the setup, unlock and sign-in pages it is the whole page.',
    since: 1,
  },
  {
    className: 'qt-app-scroll',
    surface: 'app-shell',
    label: 'Content scroll area',
    description: 'The scrolling region under the page toolbar that holds the page or the workspace.',
    within: ['qt-app-content'],
    since: 1,
  },
  {
    className: 'qt-page-toolbar',
    surface: 'app-shell',
    label: 'Page toolbar',
    description: 'The one global toolbar across the top of the content; it follows the focused workspace pane.',
    within: ['qt-app-content'],
    since: 1,
  },
  {
    className: 'qt-page-toolbar-left',
    surface: 'app-shell',
    label: 'Page toolbar, left group',
    within: ['qt-page-toolbar'],
    since: 1,
  },
  {
    className: 'qt-page-toolbar-center',
    surface: 'app-shell',
    label: 'Page toolbar, centre group',
    within: ['qt-page-toolbar'],
    since: 1,
  },
  {
    className: 'qt-page-toolbar-right',
    surface: 'app-shell',
    label: 'Page toolbar, right group',
    within: ['qt-page-toolbar'],
    since: 1,
  },
]
