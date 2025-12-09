import crypto from 'crypto'
import speakeasy from 'speakeasy'
import { encryptData, decryptData } from '@/lib/encryption'
import { getRepositories } from '@/lib/repositories/factory'
import {
  verifyTOTP,
  generateBackupCodes,
  createTrustedDevice,
  verifyTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
} from '@/lib/auth/totp'

jest.mock('speakeasy', () => ({
  generateSecret: jest.fn(),
  totp: { verify: jest.fn() },
}))

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(),
}))

jest.mock('@/lib/encryption', () => ({
  encryptData: jest.fn(),
  decryptData: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const getRepositoriesMock = getRepositories as jest.MockedFunction<typeof getRepositories>
const encryptDataMock = encryptData as jest.MockedFunction<typeof encryptData>
const decryptDataMock = decryptData as jest.MockedFunction<typeof decryptData>
const verifyMock = speakeasy.totp.verify as jest.MockedFunction<typeof speakeasy.totp.verify>

describe('TOTP utilities', () => {
  let mockRepos: {
    users: {
      findById: jest.Mock
      update: jest.Mock
    }
  }

  beforeEach(() => {
    mockRepos = {
      users: {
        findById: jest.fn(),
        update: jest.fn(),
      },
    }

    getRepositoriesMock.mockImplementation(() => mockRepos)
    jest.clearAllMocks()
  })

  describe('verifyTOTP', () => {
    it('accepts valid TOTP codes and resets attempt counters', async () => {
      const user = {
        id: 'user-1',
        totp: {
          enabled: true,
          ciphertext: 'cipher',
          iv: 'iv',
          authTag: 'tag',
        },
        backupCodes: undefined,
        totpAttempts: undefined,
      }

      mockRepos.users.findById.mockResolvedValue(user)
      decryptDataMock.mockReturnValue('SECRET')
      verifyMock.mockReturnValue(true)

      const result = await verifyTOTP('user-1', '123456')

      expect(result).toBe(true)
      expect(decryptDataMock).toHaveBeenCalledWith('cipher', 'iv', 'tag', 'user-1')
      expect(mockRepos.users.update).toHaveBeenCalledWith('user-1', { totpAttempts: undefined })
    })

    it('falls back to encrypted backup codes when TOTP fails', async () => {
      const createdAt = '2024-02-01T00:00:00.000Z'
      const user = {
        id: 'user-1',
        totp: {
          enabled: true,
          ciphertext: 'cipher',
          iv: 'iv',
          authTag: 'tag',
        },
        backupCodes: {
          ciphertext: 'backup-cipher',
          iv: 'backup-iv',
          authTag: 'backup-tag',
          createdAt,
        },
        totpAttempts: undefined,
      }

      mockRepos.users.findById.mockResolvedValue(user)
      decryptDataMock.mockImplementation((ciphertext: string) => {
        if (ciphertext === 'backup-cipher') {
          return JSON.stringify(['BACKUP1', 'BACKUP2'])
        }
        return 'SECRET'
      })
      verifyMock.mockReturnValue(false)
      encryptDataMock.mockReturnValue({
        encrypted: 'new',
        iv: 'new-iv',
        authTag: 'new-tag',
      })

      const result = await verifyTOTP('user-1', 'BACKUP1')

      expect(result).toBe(true)
      expect(mockRepos.users.update).toHaveBeenNthCalledWith(1, 'user-1', {
        backupCodes: {
          ciphertext: 'new',
          iv: 'new-iv',
          authTag: 'new-tag',
          createdAt,
        },
      })
      expect(mockRepos.users.update).toHaveBeenNthCalledWith(2, 'user-1', {
        totpAttempts: undefined,
      })
    })

    it('stops verification attempts when the account is locked', async () => {
      const lockedUntil = new Date(Date.now() + 60_000).toISOString()
      const user = {
        id: 'user-1',
        totp: {
          enabled: true,
          ciphertext: 'cipher',
          iv: 'iv',
          authTag: 'tag',
        },
        backupCodes: undefined,
        totpAttempts: {
          count: 3,
          lastAttempt: new Date().toISOString(),
          lockedUntil,
        },
      }

      mockRepos.users.findById.mockResolvedValue(user)

      const result = await verifyTOTP('user-1', '123456')

      expect(result).toBe(false)
      expect(verifyMock).not.toHaveBeenCalled()
      expect(mockRepos.users.update).not.toHaveBeenCalled()
    })

    it('records failed attempts and increments counters when nothing matches', async () => {
      const user = {
        id: 'user-1',
        totp: {
          enabled: true,
          ciphertext: 'cipher',
          iv: 'iv',
          authTag: 'tag',
        },
        backupCodes: {
          ciphertext: 'backup-cipher',
          iv: 'backup-iv',
          authTag: 'backup-tag',
          createdAt: new Date().toISOString(),
        },
        totpAttempts: undefined,
      }

      mockRepos.users.findById.mockResolvedValue(user)
      decryptDataMock.mockImplementation((ciphertext: string) => {
        if (ciphertext === 'backup-cipher') {
          return JSON.stringify(['OTHER'])
        }
        return 'SECRET'
      })
      verifyMock.mockReturnValue(false)

      const result = await verifyTOTP('user-1', 'WRONG')

      expect(result).toBe(false)
      expect(mockRepos.users.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          totpAttempts: expect.objectContaining({
            count: 1,
          }),
        })
      )
    })
  })

  describe('backup code generation', () => {
    it('creates deterministic uppercase codes when crypto is mocked', () => {
      const randomBytesSpy = jest
        .spyOn(crypto, 'randomBytes')
        .mockReturnValue(Buffer.from([0xde, 0xad, 0xbe, 0xef]))

      const codes = generateBackupCodes(3)

      expect(codes).toEqual(['DEADBEEF', 'DEADBEEF', 'DEADBEEF'])

      randomBytesSpy.mockRestore()
    })
  })

  describe('trusted devices', () => {
    const userAgent =
      'Mozilla/5.0 (Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

    it('stores hashed metadata when creating a trusted device', async () => {
      const tokenBuffer = Buffer.alloc(32, 1)
      const expectedToken = tokenBuffer.toString('hex')
      const expectedHash = crypto.createHash('sha256').update(expectedToken).digest('hex')
      const randomBytesSpy = jest.spyOn(crypto, 'randomBytes').mockReturnValue(tokenBuffer)
      const randomUUIDSpy = jest.spyOn(crypto, 'randomUUID').mockReturnValue('device-1')

      const user = {
        id: 'user-1',
        trustedDevices: [],
      }
      mockRepos.users.findById.mockResolvedValue(user)

      jest.useFakeTimers()
      jest.setSystemTime(new Date('2024-03-01T00:00:00.000Z'))

      const result = await createTrustedDevice('user-1', userAgent)

      expect(result).toEqual({
        token: expectedToken,
        deviceId: 'device-1',
      })
      expect(mockRepos.users.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          trustedDevices: [
            expect.objectContaining({
              id: 'device-1',
              tokenHash: expectedHash,
              name: 'Chrome on macOS',
              createdAt: '2024-03-01T00:00:00.000Z',
            }),
          ],
        })
      )

      randomBytesSpy.mockRestore()
      randomUUIDSpy.mockRestore()
      jest.useRealTimers()
    })

    it('verifies valid device tokens and updates lastUsedAt', async () => {
      const token = 'trusted-token'
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      const device = {
        id: 'device-1',
        tokenHash,
        name: 'Chrome on macOS',
        createdAt: '2024-03-01T00:00:00.000Z',
        lastUsedAt: '2024-03-01T00:00:00.000Z',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }
      const user = {
        id: 'user-1',
        trustedDevices: [device],
      }
      mockRepos.users.findById.mockResolvedValue(user)

      jest.useFakeTimers()
      jest.setSystemTime(new Date('2024-03-02T00:00:00.000Z'))

      const result = await verifyTrustedDevice('user-1', token)

      expect(result).toBe(true)
      expect(mockRepos.users.update).toHaveBeenCalledWith('user-1', {
        trustedDevices: [
          expect.objectContaining({
            id: 'device-1',
            lastUsedAt: '2024-03-02T00:00:00.000Z',
          }),
        ],
      })

      jest.useRealTimers()
    })

    it('removes expired devices when verification is attempted', async () => {
      const token = 'expired-token'
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      const device = {
        id: 'device-1',
        tokenHash,
        name: 'Chrome on macOS',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-01T00:00:00.000Z',
        expiresAt: '2024-02-01T00:00:00.000Z',
      }
      const user = {
        id: 'user-1',
        trustedDevices: [device],
      }
      mockRepos.users.findById.mockResolvedValue(user)

      const result = await verifyTrustedDevice('user-1', token)

      expect(result).toBe(false)
      expect(mockRepos.users.update).toHaveBeenCalledWith('user-1', { trustedDevices: [] })
    })

    it('lists only active devices without returning token hashes', async () => {
      const now = new Date('2024-03-01T00:00:00.000Z')
      jest.useFakeTimers()
      jest.setSystemTime(now)
      const user = {
        id: 'user-1',
        trustedDevices: [
          {
            id: 'device-1',
            tokenHash: 'hash-1',
            name: 'Chrome on macOS',
            createdAt: '2024-02-01T00:00:00.000Z',
            lastUsedAt: '2024-02-10T00:00:00.000Z',
            expiresAt: '2024-04-01T00:00:00.000Z',
          },
          {
            id: 'device-2',
            tokenHash: 'hash-2',
            name: 'Safari on macOS',
            createdAt: '2023-12-01T00:00:00.000Z',
            lastUsedAt: '2023-12-02T00:00:00.000Z',
            expiresAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      }
      mockRepos.users.findById.mockResolvedValue(user)

      const devices = await listTrustedDevices('user-1')

      expect(devices).toEqual([
        {
          id: 'device-1',
          name: 'Chrome on macOS',
          createdAt: '2024-02-01T00:00:00.000Z',
          lastUsedAt: '2024-02-10T00:00:00.000Z',
          expiresAt: '2024-04-01T00:00:00.000Z',
        },
      ])

      jest.useRealTimers()
    })

    it('revokes a single trusted device', async () => {
      const user = {
        id: 'user-1',
        trustedDevices: [
          { id: 'device-1' },
          { id: 'device-2' },
        ],
      }
      mockRepos.users.findById.mockResolvedValue(user)

      const result = await revokeTrustedDevice('user-1', 'device-1')

      expect(result).toBe(true)
      expect(mockRepos.users.update).toHaveBeenCalledWith('user-1', {
        trustedDevices: [{ id: 'device-2' }],
      })
    })

    it('revokes all trusted devices at once', async () => {
      const user = {
        id: 'user-1',
        trustedDevices: [{ id: 'device-1' }, { id: 'device-2' }],
      }
      mockRepos.users.findById.mockResolvedValue(user)

      const count = await revokeAllTrustedDevices('user-1')

      expect(count).toBe(2)
      expect(mockRepos.users.update).toHaveBeenCalledWith('user-1', {
        trustedDevices: undefined,
      })
    })
  })
})
