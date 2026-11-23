/**
 * Calliope's Atelier — what the asset sections show, read from a draft.
 *
 * Pure and client-safe: the fonts the manifest declares, gathered by family
 * and matched to their files; which families a font-family token or
 * primitive names; the icon overrides; the author, tags and subsystem
 * fields as the manifest holds them; and the asset sections themselves,
 * which the editor lists below the token sections (Spec F, Stage 1).
 * Nothing here decides what a file is used by — that is the server's
 * file list, read from the engine's `bundleFileUsage`.
 *
 * @module components/theme-editor/assets/model
 */

import { parseFontStack, tokenModes, type ThemeTokensDocument } from '@/lib/themes/engine/client'
import type { DraftDetail } from '../use-theme-drafts'
import type { EditorFilter } from '../model'

type DraftFile = DraftDetail['files'][number]

// ---------------------------------------------------------------------------
// The sections

export type AssetSectionKind = 'fonts' | 'images' | 'icons' | 'styles' | 'details' | 'files'

/** A section the editor draws below the token sections. */
export interface AssetSectionView {
  kind: AssetSectionKind
  /** Prefixed, so it never meets a registry group id (`fonts` is one). */
  id: string
  label: string
  description: string
  /** Words a search answers to besides the label and description. */
  keywords: readonly string[]
}

export const ASSET_SECTIONS: readonly AssetSectionView[] = [
  {
    kind: 'fonts',
    id: 'asset-fonts',
    label: 'Fonts',
    description: 'The typefaces this theme carries, with their weights, styles and licences.',
    keywords: ['font', 'typeface', 'family', 'woff', 'woff2', 'ttf', 'otf', 'licence', 'license', 'weight'],
  },
  {
    kind: 'images',
    id: 'asset-images',
    label: 'Images',
    description: 'Pictures for backgrounds, textures and the preview card.',
    keywords: ['image', 'picture', 'background', 'texture', 'preview', 'png', 'jpg', 'webp', 'svg'],
  },
  {
    kind: 'icons',
    id: 'asset-icons',
    label: 'Icons',
    description: 'Every icon in Quilltap, and any this theme redraws.',
    keywords: ['icon', 'glyph', 'svg', 'webp'],
  },
  {
    kind: 'styles',
    id: 'asset-styles',
    label: 'Custom CSS',
    description: 'The theme’s own stylesheet, with the hooks, tokens and images to hand.',
    keywords: ['css', 'stylesheet', 'styles', 'custom', 'rule', 'selector', 'hook', 'keyframes', 'animation'],
  },
  {
    kind: 'details',
    id: 'asset-details',
    label: 'Subsystems and details',
    description: 'What the subsystems are called and wear, and the theme’s author, licence, tags and dark mode.',
    keywords: ['subsystem', 'author', 'licence', 'license', 'tags', 'dark mode', 'manifest', 'name', 'description', 'thumbnail'],
  },
  {
    kind: 'files',
    id: 'asset-files',
    label: 'Files',
    description: 'Every file in the draft, what uses it, and the totals against the limits.',
    keywords: ['file', 'size', 'unused', 'limit', 'scriptorium', 'folder'],
  },
]

/**
 * The asset sections under `filter`: all of them unfiltered; under a search,
 * those whose label, description or keywords answer it; under "changed only"
 * alone, none (it narrows the tokens, and these are not tokens).
 */
export function assetSectionViews(filter: EditorFilter): AssetSectionView[] {
  const q = filter.query.trim().toLowerCase()
  if (!q) return filter.changedOnly ? [] : [...ASSET_SECTIONS]
  return ASSET_SECTIONS.filter(
    (s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.keywords.some((k) => k.includes(q) || q.includes(k)),
  )
}

// ---------------------------------------------------------------------------
// Paths and sizes

/** A bundle path as the file list spells it (no leading `./`). */
export function normalisePath(p: string): string {
  return p.trim().replace(/^(\.\/)+/, '')
}

/** The file at `p` in the draft, or null. */
export function fileAt(files: readonly DraftFile[], p: string): DraftFile | null {
  const want = normalisePath(p)
  return files.find((f) => f.path === want) ?? null
}

/** Where the draft serves the image at `p`, or null. */
export function imageUrl(detail: Pick<DraftDetail, 'images'>, p: string): string | null {
  const want = normalisePath(p)
  return detail.images.find((i) => i.path === want)?.url ?? null
}

// ---------------------------------------------------------------------------
// Fonts

export const FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf'] as const
export const LICENCE_FILE_EXTENSIONS = ['.txt', '.md'] as const
export const ICON_EXTENSIONS = ['.svg', '.webp'] as const
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.avif,.svg'

/** The licences offered by name (Spec F decision 4); anything else is typed. */
export const NAMED_LICENCES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'OFL-1.1', label: 'SIL Open Font License 1.1' },
  { id: 'Apache-2.0', label: 'Apache License 2.0' },
  { id: 'MIT', label: 'MIT License' },
  { id: 'UFL-1.0', label: 'Ubuntu Font Licence 1.0' },
  { id: 'CC0-1.0', label: 'CC0 1.0 (public domain)' },
]
export const PROPRIETARY = 'proprietary'

/** A named licence a font's own licence text points to, or null. */
export function licenceFromHint(hint: string | null | undefined): string | null {
  if (!hint) return null
  const h = hint.toLowerCase()
  if (h.includes('open font license') || h.includes('scripts.sil.org/ofl') || h.includes('openfontlicense')) return 'OFL-1.1'
  if (h.includes('apache')) return 'Apache-2.0'
  if (h.includes('ubuntu font licen')) return 'UFL-1.0'
  if (h.includes('cc0') || h.includes('public domain')) return 'CC0-1.0'
  if (/\bmit license\b/.test(h)) return 'MIT'
  return null
}

/** Whether an install re-encodes this font file as WOFF2 (Spec F decision 2). */
export function becomesWoff2(p: string): boolean {
  return /\.(ttf|otf)$/i.test(p)
}

/** One `fonts[]` entry of the manifest, with its place in the list and its file. */
export interface FontEntry {
  index: number
  family: string
  src: string
  weight: string | null
  style: string | null
  display: string | null
  license: string | null
  licenseFile: string | null
  file: DraftFile | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** The manifest's font entries, in order, each with its file (a malformed entry is skipped). */
export function fontEntries(manifest: Record<string, unknown> | null, files: readonly DraftFile[]): FontEntry[] {
  const raw = Array.isArray(manifest?.fonts) ? (manifest.fonts as unknown[]) : []
  const out: FontEntry[] = []
  raw.forEach((f, index) => {
    if (!f || typeof f !== 'object') return
    const e = f as Record<string, unknown>
    const family = str(e.family)
    const src = str(e.src)
    if (!family || !src) return
    out.push({
      index,
      family,
      src: normalisePath(src),
      weight: str(e.weight),
      style: str(e.style),
      display: str(e.display),
      license: str(e.license),
      licenseFile: str(e.licenseFile) ? normalisePath(e.licenseFile as string) : null,
      file: fileAt(files, src),
    })
  })
  return out
}

/** Font entries gathered by family (ignoring case), families in name order, faces by weight then style. */
export function fontFamilies(entries: readonly FontEntry[]): Array<{ family: string; faces: FontEntry[] }> {
  const byKey = new Map<string, { family: string; faces: FontEntry[] }>()
  for (const e of entries) {
    const key = e.family.toLowerCase()
    const group = byKey.get(key) ?? { family: e.family, faces: [] }
    group.faces.push(e)
    byKey.set(key, group)
  }
  const weightOf = (e: FontEntry) => Number.parseInt((e.weight ?? '400').split(/\s+/)[0], 10) || 400
  return [...byKey.values()]
    .sort((a, b) => a.family.localeCompare(b.family))
    .map((g) => ({ ...g, faces: [...g.faces].sort((a, b) => weightOf(a) - weightOf(b) || (a.style ?? 'normal').localeCompare(b.style ?? 'normal')) }))
}

/** The weight a sample line is drawn in: the face's weight, or the middle of a variable range. */
export function sampleWeight(weight: string | null): number {
  const parts = (weight ?? '400').trim().split(/\s+/).map((w) => (w === 'bold' ? 700 : w === 'normal' ? 400 : Number.parseInt(w, 10)))
  const valid = parts.filter((n) => Number.isFinite(n))
  if (valid.length === 0) return 400
  if (valid.length === 1) return valid[0]
  return Math.round((valid[0] + valid[1]) / 200) * 100
}

/**
 * Every family a font-family token or primitive of the tokens document
 * names, in either mode, lower-cased. A value that does not parse as a font
 * stack names nothing.
 */
export function familiesInUse(tokens: ThemeTokensDocument): Set<string> {
  const out = new Set<string>()
  const take = (value: string | undefined) => {
    if (!value) return
    const stack = parseFontStack(value)
    if (stack) for (const f of stack.families) out.add(f.toLowerCase())
  }
  for (const v of Object.values(tokens.tokens)) {
    const { value, dark } = tokenModes(v)
    take(value)
    take(dark)
  }
  for (const p of Object.values(tokens.primitives)) {
    if (p.type !== 'font-family') continue
    take(p.value)
    take(p.dark)
  }
  return out
}

/** The licence files in the draft, for the licence-file picker. */
export function licenceFiles(files: readonly DraftFile[]): DraftFile[] {
  return files.filter((f) => f.kind === 'licence')
}

// ---------------------------------------------------------------------------
// Images and icons

/** The draft's pictures: its image files, less those only an icon uses or that live under `icons/`. */
export function pictureFiles(files: readonly DraftFile[]): DraftFile[] {
  return files.filter((f) => f.kind === 'image' && !f.path.startsWith('icons/') && !(f.users.length > 0 && f.users.every((u) => u.kind === 'icon')))
}

/** The manifest's icon overrides, name → bundle path. */
export function iconOverrides(manifest: Record<string, unknown> | null): Record<string, string> {
  const raw = manifest?.icons
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [name, p] of Object.entries(raw as Record<string, unknown>)) if (typeof p === 'string' && p.trim()) out[name] = normalisePath(p)
  return out
}

/** Whether the app tints an icon override (an SVG is a mask over the text colour; a WebP is drawn as it is). */
export function isTintedIcon(p: string): boolean {
  return /\.svg$/i.test(p)
}

// ---------------------------------------------------------------------------
// The manifest's details

export interface AuthorFields {
  name: string
  email: string
  url: string
}

/** The manifest's author, as three fields (a plain string is the name). */
export function readAuthor(manifest: Record<string, unknown> | null): AuthorFields {
  const a = manifest?.author
  if (typeof a === 'string') return { name: a, email: '', url: '' }
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>
    return { name: str(o.name) ?? '', email: str(o.email) ?? '', url: str(o.url) ?? '' }
  }
  return { name: '', email: '', url: '' }
}

/** The author as the manifest takes it: a string when only the name is given, else an object; null with no name. */
export function authorValue(a: AuthorFields): string | { name: string; email?: string; url?: string } | null {
  const name = a.name.trim()
  if (!name) return null
  const email = a.email.trim()
  const url = a.url.trim()
  if (!email && !url) return name
  return { name, ...(email ? { email } : {}), ...(url ? { url } : {}) }
}

/** The manifest's tags. */
export function readTags(manifest: Record<string, unknown> | null): string[] {
  return Array.isArray(manifest?.tags) ? (manifest.tags as unknown[]).filter((t): t is string => typeof t === 'string') : []
}

/** Tags typed as a comma-separated list: trimmed, empties and repeats (ignoring case) dropped. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(',')) {
    const t = part.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

/** One subsystem's fields as the manifest writes them (paths unresolved, '' when unset). */
export function subsystemFields(manifest: Record<string, unknown> | null, id: string): { name: string; description: string; thumbnail: string; backgroundImage: string } {
  const all = manifest?.subsystems
  const raw = all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, unknown>)[id] : null
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const field = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  return { name: field('name'), description: field('description'), thumbnail: normaliseIfPath(field('thumbnail')), backgroundImage: normaliseIfPath(field('backgroundImage')) }
}

const normaliseIfPath = (v: string) => (v && v !== 'none' && !/^(data:|https?:|\/)/i.test(v) ? normalisePath(v) : v)
