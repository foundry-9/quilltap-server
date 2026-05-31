import { getAnnouncementImportance } from './system-message-labels'
import type { Message } from '../types'

function ann(
  systemSender: NonNullable<Message['systemSender']>,
  systemKind?: string,
  content = '',
): Pick<Message, 'systemSender' | 'systemKind' | 'content'> {
  return { systemSender, systemKind: systemKind ?? null, content }
}

describe('getAnnouncementImportance', () => {
  it('rates Librarian file changes high and incidental reads low', () => {
    expect(getAnnouncementImportance(ann('librarian', 'saved'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'deleted'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'folder-created'))).toBe('high')
    expect(getAnnouncementImportance(ann('librarian', 'opened'))).toBe('low')
    expect(getAnnouncementImportance(ann('librarian', 'summary'))).toBe('medium')
  })

  it('rates Host arrivals/status high and time calls low', () => {
    expect(getAnnouncementImportance(ann('host', 'add'))).toBe('high')
    expect(getAnnouncementImportance(ann('host', 'remove'))).toBe('high')
    expect(getAnnouncementImportance(ann('host', 'status-change'))).toBe('high')
    expect(getAnnouncementImportance(ann('host', 'timestamp'))).toBe('low')
  })

  it('rates Concierge danger high', () => {
    expect(getAnnouncementImportance(ann('concierge', 'danger'))).toBe('high')
  })

  it('rates Lantern, Aurora and Ariel medium', () => {
    expect(getAnnouncementImportance(ann('lantern', 'background'))).toBe('medium')
    expect(getAnnouncementImportance(ann('aurora', 'avatar'))).toBe('medium')
    expect(getAnnouncementImportance(ann('ariel', 'session-opened'))).toBe('medium')
  })

  it('rates Prospero context and Commonplace recalls low', () => {
    expect(getAnnouncementImportance(ann('prospero', 'project-context'))).toBe('low')
    expect(getAnnouncementImportance(ann('prospero', 'general-context'))).toBe('low')
    expect(getAnnouncementImportance(ann('commonplaceBook', 'memory-recap'))).toBe('low')
    // Prospero connection changes are the medium exception within a low sender.
    expect(getAnnouncementImportance(ann('prospero', 'connection-profile-change'))).toBe('medium')
  })

  it('falls back to the per-sender "*" tier for unknown kinds', () => {
    expect(getAnnouncementImportance(ann('prospero', 'some-future-kind'))).toBe('low')
    expect(getAnnouncementImportance(ann('lantern', 'some-future-kind'))).toBe('medium')
  })

  it('infers the kind from content when systemKind is absent', () => {
    // Host time-call phrasing → timestamp → low
    expect(
      getAnnouncementImportance(ann('host', undefined, 'The Host marks the time at half past three.')),
    ).toBe('low')
    // Host arrival phrasing → add → high
    expect(
      getAnnouncementImportance(ann('host', undefined, 'The Host welcomes Beatrice to the table.')),
    ).toBe('high')
  })

  it('defaults to medium when there is no systemSender', () => {
    expect(getAnnouncementImportance({ systemSender: null, systemKind: null, content: '' })).toBe('medium')
  })
})
