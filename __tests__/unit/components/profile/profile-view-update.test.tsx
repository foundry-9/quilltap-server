/** #299: a saved profile shows at once; the page no longer waits for a refetch. */
import React from 'react'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { ProfileView } from '@/app/profile/ProfileView'

jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: any) => <a>{children}</a> }))
jest.mock('@/components/profile', () => ({
  ProfileInfoSection: ({ profile }: any) => <div data-testid="info">{profile.name}</div>,
  ProfileEditSection: ({ onProfileUpdate, profile }: any) => (
    <button onClick={() => onProfileUpdate({ ...profile, name: 'New Name' })}>save</button>
  ),
  DataDirectorySection: () => null,
}))

describe('ProfileView', () => {
  it('shows the saved profile without waiting for a refetch', async () => {
    ;(global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ profile: { id: 'u1', name: 'Old Name', email: null } }) }))
    renderWithQuery(<ProfileView />)
    expect((await screen.findByTestId('info')).textContent).toBe('Old Name')

    ;(global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ profile: { id: 'u1', name: 'New Name', email: null } }) }))
    fireEvent.click(screen.getByText('save'))
    expect((await screen.findByTestId('info')).textContent).toBe('New Name')
  })
})
