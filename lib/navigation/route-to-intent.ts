/**
 * Map an in-app href to a workspace tab intent.
 *
 * The inverse of the old-route redirects: when a link is clicked *inside* the
 * workspace, we open (or focus) the matching tab client-side instead of doing a
 * route navigation that would unmount and rebuild the whole workspace. Returns
 * `null` for hrefs with no tab equivalent (new-chat — a modal, handled by the
 * interceptor — and external links) so those navigate normally.
 *
 * @module lib/navigation/route-to-intent
 */

import type { TabKind } from '@/lib/workspace/types'
import { resolveCharacterPageSection } from '@/lib/characters/page-sections'

export interface TabIntent {
  kind: TabKind
  payload?: unknown
}

export function parseHrefToIntent(href: string): TabIntent | null {
  if (!href || !href.startsWith('/')) return null // external / non-path

  let path = href
  let query = ''
  const qIdx = href.indexOf('?')
  if (qIdx >= 0) {
    path = href.slice(0, qIdx)
    query = href.slice(qIdx + 1)
  }
  const hashIdx = path.indexOf('#')
  if (hashIdx >= 0) path = path.slice(0, hashIdx)
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  // /salon/<id> — a specific conversation (not the list, not new-chat).
  const salonMatch = path.match(/^\/salon\/([^/]+)$/)
  if (salonMatch) {
    const id = salonMatch[1]
    if (id === 'new') return null
    return { kind: 'salon', payload: { chatId: id } }
  }

  // /prospero/<id> (or legacy /projects/<id>) — the Projects tab drilled into
  // that project.
  const projectMatch = path.match(/^\/(?:prospero|projects)\/([^/]+)$/)
  if (projectMatch) {
    return { kind: 'prospero', payload: { projectId: projectMatch[1] } }
  }

  // /scriptorium/<id> — the Scriptorium tab drilled into that store.
  const storeMatch = path.match(/^\/scriptorium\/([^/]+)$/)
  if (storeMatch) {
    return { kind: 'scriptorium', payload: { storeId: storeMatch[1] } }
  }

  // /aurora/groups/<id> — the Characters tab drilled into that group's editor.
  const groupMatch = path.match(/^\/aurora\/groups\/([^/]+)$/)
  if (groupMatch) {
    return { kind: 'aurora', payload: { groupId: groupMatch[1] } }
  }

  // /aurora/<id> — the one character page — and every retired spelling of it
  // (/aurora/<id>/view, /aurora/<id>/edit, /characters/<id>[/view|/edit]). The
  // old pages' `?tab=` is mapped onto the page's sections; `/aurora/new` is the
  // create form, not a character. `?action=chat` is not part of the tab (a
  // persisted tab must not re-open the modal on every reload): callers read it
  // with {@link characterChatActionFromHref}.
  const characterMatch = path.match(/^\/(?:aurora|characters)\/([^/]+)(?:\/(?:view|edit))?$/)
  if (characterMatch && characterMatch[1] !== 'new') {
    const sp = new URLSearchParams(query)
    const section = resolveCharacterPageSection(sp.get('section'), sp.get('tab'))
    return {
      kind: 'character',
      payload: { characterId: characterMatch[1], ...(section ? { section } : {}) },
    }
  }

  switch (path) {
    case '/':
      return { kind: 'home' }
    case '/salon':
    case '/chats':
      return { kind: 'salon-list' }
    case '/aurora':
      return { kind: 'aurora' }
    case '/aurora/new':
      return { kind: 'character-new' }
    case '/profile':
      return { kind: 'profile' }
    case '/about':
      return { kind: 'about' }
    case '/generate-image':
      return { kind: 'generate-image' }
    case '/settings/wizard':
      return { kind: 'settings-wizard' }
    case '/prospero':
      return { kind: 'prospero' }
    case '/scriptorium':
      return { kind: 'scriptorium' }
    case '/files':
      return { kind: 'files' }
    case '/photos':
      return { kind: 'photos' }
    case '/scenarios':
      return { kind: 'scenarios' }
    case '/custom-tools': {
      const sp = new URLSearchParams(query)
      const mountPointId = sp.get('mount') ?? undefined
      const path = sp.get('path') ?? undefined
      const create = sp.get('new') === '1' || undefined
      return {
        kind: 'custom-tools',
        payload: mountPointId || path || create ? { mountPointId, path, create } : undefined,
      }
    }
    case '/calliope/specimens':
      return { kind: 'theme-specimens' }
    case '/calliope': {
      const draftId = new URLSearchParams(query).get('draft') ?? undefined
      return { kind: 'theme-editor', payload: draftId ? { draftId } : undefined }
    }
    case '/settings': {
      const sp = new URLSearchParams(query)
      return {
        kind: 'settings',
        payload: {
          group: sp.get('group') ?? undefined,
          tab: sp.get('tab') ?? undefined,
          section: sp.get('section') ?? undefined,
          persona: sp.get('persona') ?? undefined,
          q: sp.get('q') ?? undefined,
          provider: sp.get('provider') ?? undefined,
        },
      }
    }
    default:
      return null
  }
}

/**
 * The character id when `href` is a character-page link asking for the New
 * Chat modal (`/aurora/<id>?action=chat`, or a retired spelling), else null.
 */
export function characterChatActionFromHref(href: string): string | null {
  const intent = parseHrefToIntent(href)
  if (intent?.kind !== 'character') return null
  const qIdx = href.indexOf('?')
  if (qIdx < 0) return null
  const sp = new URLSearchParams(href.slice(qIdx + 1).split('#')[0])
  if (sp.get('action') !== 'chat') return null
  return (intent.payload as { characterId: string }).characterId
}

/** Read one string field of a tab payload, or undefined. */
function payloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : undefined
}

/** `?a=1&b=2` from the defined entries, or '' when none are. */
function queryOf(entries: Record<string, string | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(entries)) {
    if (value) sp.set(key, value)
  }
  const query = sp.toString()
  return query ? `?${query}` : ''
}

/**
 * The in-app href a workspace tab stands for — the inverse of
 * {@link parseHrefToIntent}, so `parseHrefToIntent(hrefForTabIntent(t))`
 * opens the same tab. The workspace never changes the pathname, so this is
 * how anything that needs "the page the user is on" (the help chat's page
 * context, #247) reads it. A Salon's terminal and document child tabs answer
 * with their conversation; a kind with no route of its own (a standalone
 * document, the Console, the rail-opened wardrobe / inventory / atlas) answers
 * with the nearest one.
 */
export function hrefForTabIntent(kind: TabKind, payload?: unknown): string {
  switch (kind) {
    case 'home':
      return '/'
    case 'salon':
    case 'terminal':
    case 'document': {
      const chatId = payloadString(payload, 'chatId')
      return chatId ? `/salon/${chatId}` : '/salon'
    }
    case 'salon-list':
      return '/salon'
    case 'aurora': {
      const groupId = payloadString(payload, 'groupId')
      return groupId ? `/aurora/groups/${groupId}` : '/aurora'
    }
    case 'character-new':
      return '/aurora/new'
    case 'character': {
      const characterId = payloadString(payload, 'characterId')
      if (!characterId) return '/aurora'
      return `/aurora/${characterId}${queryOf({ section: payloadString(payload, 'section') })}`
    }
    case 'prospero': {
      const projectId = payloadString(payload, 'projectId')
      return projectId ? `/prospero/${projectId}` : '/prospero'
    }
    case 'scriptorium': {
      const storeId = payloadString(payload, 'storeId')
      return storeId ? `/scriptorium/${storeId}` : '/scriptorium'
    }
    case 'document-standalone':
      return '/scriptorium'
    case 'settings':
      return `/settings${queryOf({
        group: payloadString(payload, 'group'),
        tab: payloadString(payload, 'tab'),
        section: payloadString(payload, 'section'),
        persona: payloadString(payload, 'persona'),
        q: payloadString(payload, 'q'),
        provider: payloadString(payload, 'provider'),
      })}`
    case 'settings-wizard':
      return '/settings/wizard'
    case 'files':
      return '/files'
    case 'photos':
      return '/photos'
    case 'scenarios':
      return '/scenarios'
    case 'profile':
      return '/profile'
    case 'about':
      return '/about'
    case 'generate-image':
      return '/generate-image'
    case 'custom-tools': {
      const create = !!payload && typeof payload === 'object' && (payload as { create?: unknown }).create === true
      return `/custom-tools${queryOf({
        mount: payloadString(payload, 'mountPointId'),
        path: payloadString(payload, 'path'),
        new: create ? '1' : undefined,
      })}`
    }
    case 'theme-editor':
      return `/calliope${queryOf({ draft: payloadString(payload, 'draftId') })}`
    case 'theme-specimens':
      return '/calliope/specimens'
    case 'brahma':
      return '/settings?persona=brahma'
    case 'wardrobe':
    case 'inventory':
    case 'atlas':
      return '/aurora'
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}
