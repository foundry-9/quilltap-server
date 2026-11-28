/**
 * Calliope's Atelier — the asset sections (Calliope Live, Spec F, Stage 1).
 *
 * Each section is drawn inside the real operations provider over a fake
 * saver; the draft operations themselves (`themeDraftAction`,
 * `themeDraftUpload`, `fetchThemeDraft`) are mocked. Covered: add, edit and
 * remove in each section, refusal messages, the proprietary note, the
 * unused marks, and a stale revision reloading the draft.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { useMemo, useRef, useState } from 'react'
import { FontsSection } from '@/components/theme-editor/assets/FontsSection'
import { ImagesSection } from '@/components/theme-editor/assets/ImagesSection'
import { IconsSection } from '@/components/theme-editor/assets/IconsSection'
import { DetailsSection, DARK_MODE_EXPLAINED } from '@/components/theme-editor/assets/DetailsSection'
import { FilesPanel } from '@/components/theme-editor/assets/FilesPanel'
import { CHANGED_ELSEWHERE, DraftOperationsContext, useDraftOperationsState } from '@/components/theme-editor/assets/use-draft-operations'
import { ApiFetchError } from '@/lib/query/fetcher'
import type { DraftDetail } from '@/lib/themes/drafts/service'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'

jest.mock('@/components/theme-editor/use-theme-drafts', () => ({
  ...jest.requireActual('@/components/theme-editor/use-theme-drafts'),
  themeDraftAction: jest.fn(),
  themeDraftUpload: jest.fn(),
  fetchThemeDraft: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

const drafts = require('@/components/theme-editor/use-theme-drafts') as {
  themeDraftAction: jest.Mock
  themeDraftUpload: jest.Mock
  fetchThemeDraft: jest.Mock
}
const toast = require('@/lib/toast') as { showWarningToast: jest.Mock; showErrorToast: jest.Mock }

type DraftFile = DraftDetail['files'][number]

const LIMITS = { files: 200, bytes: 26214400, fileBytes: 5242880 }

function file(path: string, size: number, kind: DraftFile['kind'], users: DraftFile['users'] = [], extra: Partial<DraftFile> = {}): DraftFile {
  const usedBy = users.map((u) => (u.kind === 'font' ? `the font ${u.family}` : u.kind === 'token' ? `the token ${u.key}` : u.kind === 'icon' ? `the icon ${u.name}` : u.kind))
  return { path, size, kind, users, usedBy, unused: (kind === 'font' || kind === 'image' || kind === 'licence') && users.length === 0, ...extra }
}

const FONT_FACTS = { family: 'Lora', weight: '400', style: 'normal' as const, variable: false, embedding: 'installable' as const, licence: 'OFL-1.1', licenceUrl: null }

function detail(overrides: Partial<DraftDetail> = {}): DraftDetail {
  const files = [
    file('theme.json', 400, 'manifest'),
    file('tokens.json', 300, 'tokens'),
    file('fonts/Lora-Regular.woff2', 40_000, 'font', [{ kind: 'font', index: 0, family: 'Lora' }], { font: FONT_FACTS }),
    file('fonts/Lora-Bold.ttf', 90_000, 'font', [{ kind: 'font', index: 1, family: 'Lora' }], { font: { ...FONT_FACTS, weight: '700', embedding: 'restricted' } }),
    file('images/paper.png', 120_000, 'image', [{ kind: 'token', key: '--theme-page-image', mode: 'light' }]),
    file('images/spare.jpg', 60_000, 'image'),
    file('icons/star.svg', 900, 'image', [{ kind: 'icon', name: 'star' }]),
  ]
  return {
    id: 'my-theme',
    manifest: {
      id: 'my-theme',
      name: 'My Theme',
      version: '0.1.0',
      fonts: [
        { family: 'Lora', src: 'fonts/Lora-Regular.woff2', weight: '400', style: 'normal', license: 'OFL-1.1' },
        { family: 'Lora', src: 'fonts/Lora-Bold.ttf', weight: '700', style: 'normal', license: 'OFL-1.1' },
      ],
      icons: { star: 'icons/star.svg' },
    },
    tokens: { primitives: {}, tokens: {}, choices: {} },
    revision: 'rev-1',
    uri: 'qtap://Quilltap General/Themes/my-theme',
    compiled: { fontFaces: '', icons: '', custom: '' },
    subsystems: {},
    issues: [],
    images: [
      { path: 'images/paper.png', type: 'image/png', url: '/draft/images/paper.png' },
      { path: 'images/spare.jpg', type: 'image/jpeg', url: '/draft/images/spare.jpg' },
      { path: 'icons/star.svg', type: 'image/svg+xml', url: '/draft/icons/star.svg' },
    ],
    manifestRevision: 'mrev-1',
    files,
    totals: { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), limits: LIMITS },
    mountPointId: 'mp-general',
    updatedAt: '2026-11-14T12:00:00.000Z',
    version: '0.1.0',
    ...overrides,
  }
}

const NO_TOKENS: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} }
const LORA_SANS: ThemeTokensDocument = { primitives: {}, tokens: { '--theme-font-sans': '"Lora", serif' }, choices: {} }

let onConflict: jest.Mock
let flush: jest.Mock

/** A section inside the real operations provider, over a saver that only adopts. */
function Harness({ initial, children }: { initial: DraftDetail; children: (d: DraftDetail) => React.ReactNode }) {
  const [current, setCurrent] = useState(initial)
  const ref = useRef(initial)
  const saver = useMemo(
    () => ({
      flush,
      current: () => ref.current,
      adopt: (fresh: DraftDetail) => {
        ref.current = fresh
        setCurrent(fresh)
      },
    }),
    [],
  )
  const ops = useDraftOperationsState(saver, onConflict)
  return <DraftOperationsContext.Provider value={ops}>{children(current)}</DraftOperationsContext.Provider>
}

function renderSection(initial: DraftDetail, children: (d: DraftDetail) => React.ReactNode) {
  return render(<Harness initial={initial}>{children}</Harness>)
}

function chooseFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } })
}

const fileInputs = (root: ParentNode = document.body) => Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]'))

beforeEach(() => {
  jest.clearAllMocks()
  onConflict = jest.fn()
  flush = jest.fn(async () => {})
  drafts.themeDraftAction.mockImplementation(async () => ({ draft: detail({ manifestRevision: 'mrev-2' }) }))
  drafts.themeDraftUpload.mockImplementation(async () => ({ draft: detail({ manifestRevision: 'mrev-2' }), path: 'x' }))
})

// ---------------------------------------------------------------------------

describe('the operations', () => {
  it('flushes unsaved edits first and calls with the newest manifest revision', async () => {
    renderSection(detail(), (d) => <FilesPanel detail={d} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove images/spare.jpg' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'remove-file', { manifestRevision: 'mrev-1', path: 'images/spare.jpg' }))
    expect(flush).toHaveBeenCalled()
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(drafts.themeDraftAction.mock.invocationCallOrder[0])
  })

  it('reloads the draft on a stale revision and says who may have changed it', async () => {
    const fresh = detail({ manifestRevision: 'mrev-theirs' })
    drafts.themeDraftAction.mockRejectedValueOnce(new ApiFetchError('stale', 409, { error: 'stale', details: { currentManifestRevision: 'mrev-theirs' } }))
    drafts.fetchThemeDraft.mockResolvedValueOnce(fresh)
    renderSection(detail(), (d) => <FilesPanel detail={d} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove images/spare.jpg' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(fresh))
    expect(toast.showWarningToast).toHaveBeenCalledWith(CHANGED_ELSEWHERE)
    expect(CHANGED_ELSEWHERE).toMatch(/Document Mode/)
    expect(CHANGED_ELSEWHERE).toMatch(/character/)
  })

  it('says what still uses a file it would not remove', async () => {
    drafts.themeDraftAction.mockRejectedValueOnce(
      new ApiFetchError('in use', 409, { error: 'The file is still in use', details: { path: 'images/spare.jpg', usedBy: ['the token --theme-x'] } }),
    )
    renderSection(detail(), (d) => <FilesPanel detail={d} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove images/spare.jpg' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(toast.showErrorToast).toHaveBeenCalledWith('The file is still in use — used by the token --theme-x'))
    expect(onConflict).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('Fonts', () => {
  it('lists a family’s faces with licence, the WOFF2 mark and the embedding flag', () => {
    renderSection(detail(), (d) => <FontsSection detail={d} tokens={LORA_SANS} previewing onShowFontTokens={() => {}} />)
    const family = screen.getByRole('region', { name: 'Font family Lora' })
    expect(within(family).getAllByText(/OFL-1\.1/)).toHaveLength(2)
    expect(within(family).getAllByText('Becomes WOFF2 at install')).toHaveLength(1)
    expect(within(family).getAllByText(/forbid embedding/)).toHaveLength(1)
    expect(within(family).queryByText(/No font-family token names this family/)).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('says when no token uses a family, and offers the font stacks', () => {
    const onShow = jest.fn()
    renderSection(detail(), (d) => <FontsSection detail={d} tokens={NO_TOKENS} previewing onShowFontTokens={onShow} />)
    expect(screen.getByText(/No font-family token names this family/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the font stacks' }))
    expect(onShow).toHaveBeenCalled()
  })

  it('shows the proprietary note while any font is proprietary', () => {
    const d = detail()
    const fonts = (d.manifest!.fonts as Array<Record<string, unknown>>).map((f, i) => (i === 1 ? { ...f, license: 'proprietary' } : f))
    renderSection({ ...d, manifest: { ...d.manifest, fonts } }, (x) => <FontsSection detail={x} tokens={LORA_SANS} previewing onShowFontTokens={() => {}} />)
    expect(screen.getByRole('note')).toHaveTextContent(/answers for the right to share/)
  })

  it('reads each file, marks the guesses, asks the licence once, and adds the batch', async () => {
    drafts.themeDraftUpload.mockImplementation(async (_id: string, action: string, f: File) => {
      if (action === 'read-font') {
        return f.name === 'Inter-Regular.woff2'
          ? { font: { read: true, info: { format: 'woff2', family: 'Inter', weight: '400', style: 'normal', variable: false, axes: [], licence: 'SIL Open Font License, Version 1.1', licenceUrl: null, embedding: 'installable' } } }
          : { font: { read: false, reason: 'the name table is missing', guess: { family: 'Inter', weight: '700', style: 'italic', variable: false }, format: 'ttf' } }
      }
      if (action === 'add-licence-file') return { draft: detail({ manifestRevision: 'mrev-l' }), path: 'fonts/OFL.txt' }
      return { draft: detail({ manifestRevision: `mrev-${f.name}` }), path: `fonts/${f.name}` }
    })
    renderSection(detail(), (d) => <FontsSection detail={d} tokens={LORA_SANS} previewing onShowFontTokens={() => {}} />)
    chooseFiles(fileInputs()[0], [new File(['a'], 'Inter-Regular.woff2'), new File(['b'], 'Inter-BoldItalic.ttf')])
    const dialog = await screen.findByRole('dialog', { name: 'Add fonts' })
    await within(dialog).findByText(/guessed from the file name/)
    expect(within(dialog).getAllByText('(guessed)')).toHaveLength(3)
    expect(within(dialog).getByText(/Becomes WOFF2 at install/)).toBeInTheDocument()
    // The licence is taken from what the first file said.
    await waitFor(() => expect(within(dialog).getByLabelText('Licence, for every font above')).toHaveValue('OFL-1.1'))
    chooseFiles(fileInputs(dialog)[0], [new File(['licence'], 'OFL.txt')])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 fonts' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add fonts' })).not.toBeInTheDocument())
    const adds = drafts.themeDraftUpload.mock.calls.filter((c) => c[1] !== 'read-font')
    expect(adds.map((c) => c[1])).toEqual(['add-licence-file', 'add-font', 'add-font'])
    expect(adds[1][3]).toEqual({ manifestRevision: 'mrev-l', license: 'OFL-1.1', family: 'Inter', weight: '400', style: 'normal', licenseFile: 'fonts/OFL.txt' })
    expect(adds[2][3]).toMatchObject({ manifestRevision: 'mrev-Inter-Regular.woff2', weight: '700', style: 'italic' })
  })

  it('keeps the uploaded licence file for a retry after a font fails (#318)', async () => {
    let failedOnce = false
    drafts.fetchThemeDraft.mockResolvedValue(detail({ manifestRevision: 'mrev-fresh' }))
    drafts.themeDraftUpload.mockImplementation(async (_id: string, action: string, f: File) => {
      if (action === 'read-font') {
        return { font: { read: true, info: { format: 'woff2', family: 'Inter', weight: f.name.includes('Bold') ? '700' : '400', style: 'normal', variable: false, axes: [], licence: null, licenceUrl: null, embedding: 'installable' } } }
      }
      if (action === 'add-licence-file') return { draft: detail({ manifestRevision: 'mrev-l' }), path: 'fonts/OFL.txt' }
      if (f.name === 'Inter-Bold.woff2' && !failedOnce) {
        failedOnce = true
        throw new ApiFetchError('stale', 409, { error: 'stale', details: { currentManifestRevision: 'mrev-fresh' } })
      }
      return { draft: detail({ manifestRevision: `mrev-${f.name}` }), path: `fonts/${f.name}` }
    })
    renderSection(detail(), (d) => <FontsSection detail={d} tokens={LORA_SANS} previewing onShowFontTokens={() => {}} />)
    chooseFiles(fileInputs()[0], [new File(['a'], 'Inter-Regular.woff2'), new File(['b'], 'Inter-Bold.woff2')])
    const dialog = await screen.findByRole('dialog', { name: 'Add fonts' })
    fireEvent.change(within(dialog).getByLabelText('Licence, for every font above'), { target: { value: 'OFL-1.1' } })
    chooseFiles(fileInputs(dialog)[0], [new File(['licence'], 'OFL.txt')])
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Add 2 fonts' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 fonts' }))
    const retry = await within(dialog).findByRole('button', { name: 'Add the font' })
    await waitFor(() => expect(retry).toBeEnabled())
    fireEvent.click(retry)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add fonts' })).not.toBeInTheDocument())
    const adds = drafts.themeDraftUpload.mock.calls.filter((c) => c[1] !== 'read-font')
    expect(adds.map((c) => c[1])).toEqual(['add-licence-file', 'add-font', 'add-font', 'add-font'])
    expect(adds[3][2].name).toBe('Inter-Bold.woff2')
    expect(adds[3][3]).toMatchObject({ licenseFile: 'fonts/OFL.txt' })
  })

  it('shows a refused font in the dialog', async () => {
    drafts.themeDraftUpload.mockImplementation(async (_id: string, action: string) => {
      if (action === 'read-font') return { font: { read: true, info: { format: 'woff2', family: 'Inter', weight: '400', style: 'normal', variable: false, axes: [], licence: null, licenceUrl: null, embedding: 'installable' } } }
      throw new ApiFetchError('refused', 422, { error: 'The file is not the font its name says it is' })
    })
    renderSection(detail(), (d) => <FontsSection detail={d} tokens={LORA_SANS} previewing onShowFontTokens={() => {}} />)
    chooseFiles(fileInputs()[0], [new File(['a'], 'Inter.woff2')])
    const dialog = await screen.findByRole('dialog', { name: 'Add fonts' })
    await within(dialog).findByLabelText(/^Family/)
    fireEvent.change(within(dialog).getByLabelText('Licence, for every font above'), { target: { value: 'MIT' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add the font' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The file is not the font its name says it is')
    expect(toast.showErrorToast).not.toHaveBeenCalled()
  })

  it('edits a face', async () => {
    renderSection(detail(), (d) => <FontsSection detail={d} tokens={LORA_SANS} previewing onShowFontTokens={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Lora 700 normal' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Lora' })
    fireEvent.change(within(dialog).getByLabelText('Style'), { target: { value: 'italic' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'update-font', {
        manifestRevision: 'mrev-1',
        index: 1,
        fields: { family: 'Lora', weight: '700', style: 'italic', licenseFile: null, license: 'OFL-1.1' },
      }),
    )
  })

  it('removes a face after an alertdialog', async () => {
    renderSection(detail(), (d) => <FontsSection detail={d} tokens={LORA_SANS} previewing onShowFontTokens={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Lora 400 normal' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'remove-font', { manifestRevision: 'mrev-1', index: 0 }))
  })
})

// ---------------------------------------------------------------------------

describe('Images', () => {
  it('shows the pictures (not the icons) with their size, uses and unused mark', () => {
    renderSection(detail(), (d) => <ImagesSection detail={d} />)
    const grid = screen.getByRole('list', { name: 'Images in this draft' })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
    expect(within(grid).queryByText('icons/star.svg')).not.toBeInTheDocument()
    expect(within(grid).getByText(/In use by the token --theme-page-image/)).toBeInTheDocument()
    expect(within(grid).getByText('Unused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove images/paper.png' })).toBeDisabled()
    expect(screen.getByText(/carries it as WebP/)).toBeInTheDocument()
  })

  it('adds, removes, and chooses the preview image', async () => {
    renderSection(detail(), (d) => <ImagesSection detail={d} />)
    chooseFiles(fileInputs()[0], [new File(['p'], 'sky.png', { type: 'image/png' })])
    await waitFor(() => expect(drafts.themeDraftUpload).toHaveBeenCalledWith('my-theme', 'add-image', expect.any(File), { manifestRevision: 'mrev-1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Use images/spare.jpg as the preview image' }))
    await waitFor(() =>
      expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'set-manifest', { manifestRevision: 'mrev-2', fields: { previewImage: 'images/spare.jpg' } }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove images/spare.jpg' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'remove-file', { manifestRevision: 'mrev-2', path: 'images/spare.jpg' }))
  })

  it('says a refused upload', async () => {
    drafts.themeDraftUpload.mockRejectedValueOnce(new ApiFetchError('too big', 413, { error: 'The picture is larger than a theme may carry' }))
    renderSection(detail(), (d) => <ImagesSection detail={d} />)
    chooseFiles(fileInputs()[0], [new File(['p'], 'huge.png', { type: 'image/png' })])
    await waitFor(() => expect(toast.showErrorToast).toHaveBeenCalledWith('The picture is larger than a theme may carry'))
  })
})

// ---------------------------------------------------------------------------

describe('Icons', () => {
  it('marks the redrawn icons and searches by name', () => {
    renderSection(detail(), (d) => <IconsSection detail={d} />)
    expect(screen.getByRole('button', { name: 'star, redrawn by this theme' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search the icons by name'), { target: { value: 'sta' } })
    const list = screen.getByRole('list', { name: 'Icons' })
    for (const item of within(list).getAllByRole('button')) expect(item.getAttribute('aria-label')).toMatch(/sta/)
  })

  it('uploads a replacement for a chosen icon', async () => {
    renderSection(detail(), (d) => <IconsSection detail={d} />)
    fireEvent.change(screen.getByLabelText('Search the icons by name'), { target: { value: 'sta' } })
    fireEvent.click(screen.getByRole('button', { name: 'star, redrawn by this theme' }))
    const dialog = await screen.findByRole('dialog', { name: 'The star icon' })
    chooseFiles(fileInputs(dialog)[0], [new File(['<svg/>'], 'star.svg', { type: 'image/svg+xml' })])
    await waitFor(() => expect(drafts.themeDraftUpload).toHaveBeenCalledWith('my-theme', 'set-icon', expect.any(File), { manifestRevision: 'mrev-1', name: 'star' }))
  })

  it('shows a refused icon in the dialog', async () => {
    drafts.themeDraftUpload.mockRejectedValueOnce(new ApiFetchError('bad', 422, { error: 'An icon must be an SVG or a WebP' }))
    renderSection(detail(), (d) => <IconsSection detail={d} />)
    fireEvent.change(screen.getByLabelText('Search the icons by name'), { target: { value: 'sta' } })
    fireEvent.click(screen.getByRole('button', { name: 'star, redrawn by this theme' }))
    const dialog = await screen.findByRole('dialog', { name: 'The star icon' })
    chooseFiles(fileInputs(dialog)[0], [new File(['x'], 'star.svg')])
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An icon must be an SVG or a WebP')
  })

  it('removes an override after an alertdialog', async () => {
    renderSection(detail(), (d) => <IconsSection detail={d} />)
    fireEvent.change(screen.getByLabelText('Search the icons by name'), { target: { value: 'sta' } })
    fireEvent.click(screen.getByRole('button', { name: 'star, redrawn by this theme' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'The star icon' })).getByRole('button', { name: 'Remove the override' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'clear-icon', { manifestRevision: 'mrev-1', name: 'star' }))
  })
})

// ---------------------------------------------------------------------------

describe('Subsystems and details', () => {
  it('saves the author, licence, tags and dark mode, and says what dark mode does', async () => {
    renderSection(detail(), (d) => <DetailsSection detail={d} />)
    expect(screen.getByText(DARK_MODE_EXPLAINED)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'A. Writer' } })
    fireEvent.change(screen.getByLabelText('The theme’s licence'), { target: { value: 'MIT' } })
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'serif, warm, Serif' } })
    fireEvent.click(screen.getByLabelText('This theme has a dark mode'))
    fireEvent.click(screen.getByRole('button', { name: 'Save the details' }))
    await waitFor(() =>
      expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'set-manifest', {
        manifestRevision: 'mrev-1',
        fields: { author: 'A. Writer', license: 'MIT', tags: ['serif', 'warm'], supportsDarkMode: false },
      }),
    )
  })

  it('renames a subsystem and gives it a picture', async () => {
    renderSection(detail(), (d) => <DetailsSection detail={d} />)
    const summary = screen.getByText('The Salon', { selector: 'span' }).closest('summary') as HTMLElement
    const details = summary.parentElement as HTMLDetailsElement
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    const name = await within(details).findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'The Parlour' } })
    fireEvent.change(within(details).getByLabelText('Background picture on its page'), { target: { value: 'images/paper.png' } })
    fireEvent.click(within(details).getByRole('button', { name: 'Save The Salon' }))
    await waitFor(() =>
      expect(drafts.themeDraftAction).toHaveBeenCalledWith('my-theme', 'set-subsystem', {
        manifestRevision: 'mrev-1',
        subsystem: 'salon',
        fields: { name: 'The Parlour', backgroundImage: 'images/paper.png' },
      }),
    )
  })

  it('shows a refused manifest edit in place', async () => {
    drafts.themeDraftAction.mockRejectedValueOnce(new ApiFetchError('invalid', 422, { error: 'The manifest would not be valid', details: { errors: ['tags: too many'] } }))
    renderSection(detail(), (d) => <DetailsSection detail={d} />)
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the details' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The manifest would not be valid: tags: too many')
  })
})

// ---------------------------------------------------------------------------

describe('Files', () => {
  it('lists every file with its use, marks the unused, and states the totals', () => {
    renderSection(detail(), (d) => <FilesPanel detail={d} />)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(7)
    const spare = rows.find((r) => within(r).queryByText('images/spare.jpg'))!
    expect(within(spare).getByText('Unused')).toBeInTheDocument()
    expect(within(spare).getByRole('button', { name: 'Remove images/spare.jpg' })).toBeInTheDocument()
    const manifest = rows.find((r) => within(r).queryByText('theme.json'))!
    expect(within(manifest).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/7 of 200 files/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Quilltap General in the Scriptorium' })).toHaveAttribute('href', '/scriptorium/mp-general')
    expect(screen.getByText('Themes/my-theme/')).toBeInTheDocument()
  })
})
