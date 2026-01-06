import '@testing-library/jest-dom'
import fetchMock from 'jest-fetch-mock'

fetchMock.enableMocks()

const shouldSilenceConsole = process.env.ENABLE_TEST_LOGS !== 'true'

if (shouldSilenceConsole) {
  const consoleMethodsToSilence: Array<'log' | 'info' | 'debug' | 'warn' | 'trace' | 'error'> = [
    'log',
    'info',
    'debug',
    'warn',
    'trace',
    'error',
  ]
  const noop = (..._args: any[]) => {}
  const silencedSpies = consoleMethodsToSilence.map((method) => jest.spyOn(console, method).mockImplementation(noop))

  afterAll(() => {
    silencedSpies.forEach((spy) => spy.mockRestore())
  })
}

// Mock our session utilities to avoid running full plugin initialization in tests
const mockGetServerSession = jest.fn().mockResolvedValue(null)

jest.mock('@/lib/auth/session', () => ({
  getServerSession: mockGetServerSession,
  getRequiredSession: jest.fn(async () => {
    const session = await mockGetServerSession()
    if (!session?.user?.id) {
      throw new Error('Unauthorized: No valid session')
    }
    return session
  }),
  getCurrentUserId: jest.fn(async () => {
    const session = await mockGetServerSession()
    return session?.user?.id ?? null
  }),
  getRequiredUserId: jest.fn(async () => {
    const session = await mockGetServerSession()
    if (!session?.user?.id) {
      throw new Error('Unauthorized: No valid session')
    }
    return session.user.id
  }),
}))

// Mock session provider for tests
jest.mock('@/components/providers/session-provider', () => ({
  useSession: jest.fn(() => ({
    data: null,
    status: 'unauthenticated',
    update: jest.fn(),
  })),
  useSessionOptional: jest.fn(() => ({
    data: null,
    status: 'unauthenticated',
    update: jest.fn(),
  })),
  Providers: ({ children }: any) => children,
}))

// Mock environment variables for tests
// Note: NODE_ENV is read-only and set by Jest automatically
process.env.BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests-32-chars-long!!'
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret'
process.env.ENCRYPTION_MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER || 'test-pepper-for-unit-tests-32-chars-long!'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quilltap-test'
process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'test-s3-access-key'
process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'test-s3-secret-key'

// Set up globals required for Next.js
// Note: We check if they're undefined to avoid conflicts with jsdom's implementation
if (!globalThis.Request) {
  globalThis.Request = class {
    constructor(input: string | Request, init?: RequestInit) {
      if (typeof input === 'string') {
        Object.defineProperty(this, 'url', { value: input })
      }
      if (init) {
        Object.defineProperty(this, 'init', { value: init })
      }
    }
  } as any
}

if (!globalThis.Response) {
  globalThis.Response = class {
    constructor(body?: any, init?: ResponseInit) {
      if (body !== undefined) Object.defineProperty(this, 'body', { value: body })
      if (init) Object.defineProperty(this, 'init', { value: init })
    }
  } as any
}

if (!globalThis.Headers) {
  globalThis.Headers = class {
    private map = new Map<string, string>()
    set(name: string, value: string) { this.map.set(name.toLowerCase(), value) }
    get(name: string) { return this.map.get(name.toLowerCase()) }
    has(name: string) { return this.map.has(name.toLowerCase()) }
    delete(name: string) { this.map.delete(name.toLowerCase()) }
    forEach(cb: Function) { this.map.forEach((v, k) => cb(v, k)) }
  } as any
}

// Mock OpenAI to avoid dangerously loading browser checks
jest.mock('openai', () => {
  const mockCreate = jest.fn(() =>
    Promise.resolve({
      choices: [{ message: { content: 'test' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  )

  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      models: { list: jest.fn(() => Promise.resolve({ data: [] })) },
    })),
  }
})

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(() =>
          Promise.resolve({
            content: [{ type: 'text', text: 'test response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          })
        ),
      },
    })),
  }
})

// Add TextEncoder and TextDecoder for Node.js tests
if (typeof TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

// Mock cookies for NextRequest
if (!(globalThis as any).Cookies) {
  ;(globalThis as any).Cookies = class {
    get(_name: string) { return null }
    getAll() { return [] }
    has(_name: string) { return false }
    delete(_name: string) {}
    set(_name: string, _value: string) {}
    clear() {}
  }
}

// Mock next/server Response
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server')
  const jsonMock = jest.fn((data: any, init?: any) => ({
    status: init?.status || 200,
    json: async () => data,
    headers: new Map(),
  }))

  return {
    ...actual,
    NextResponse: {
      ...actual.NextResponse,
      json: jsonMock,
    },
  }
})


// Mock encryption library
jest.mock('@/lib/encryption', () => ({
  decryptApiKey: jest.fn(),
  encryptApiKey: jest.fn(),
  maskApiKey: jest.fn(),
  testEncryption: jest.fn(),
}))

// Mock LLM plugin factory
jest.mock('@/lib/llm/plugin-factory', () => ({
  createLLMProvider: jest.fn(),
  createImageProvider: jest.fn(),
  getAllAvailableProviders: jest.fn(() => []),
  getAllAvailableImageProviders: jest.fn(() => []),
  isProviderFromPlugin: jest.fn(() => true),
}))

// Mock provider validation - default to valid
jest.mock('@/lib/plugins/provider-validation', () => ({
  validateProviderConfig: jest.fn().mockReturnValue({
    valid: true,
    errors: [],
  }),
}))

// Mock LLM module (re-exports from plugin-factory)
jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(),
  createImageProvider: jest.fn(),
  getAllAvailableProviders: jest.fn(() => []),
  getAllAvailableImageProviders: jest.fn(() => []),
  isProviderFromPlugin: jest.fn(() => true),
}))

// Mock file tag inheritance
jest.mock('@/lib/files/tag-inheritance', () => ({
  getInheritedTags: jest.fn().mockResolvedValue([]),
  mergeTags: jest.fn().mockImplementation((a: string[], b: string[]) => [...new Set([...a, ...b])]),
}))

// Mock Repositories
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
  getUserRepositories: jest.fn(),
  resetRepositories: jest.fn(),
  clearUserRepositoryCache: jest.fn(),
}))

// Mock S3 operations - used by cascade-delete and other modules
jest.mock('@/lib/s3/operations', () => ({
  uploadFile: jest.fn().mockResolvedValue(undefined),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock file content')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  fileExists: jest.fn().mockResolvedValue(true),
  getPresignedUrl: jest.fn().mockResolvedValue('https://mock-s3.com/presigned-url'),
  getPresignedUploadUrl: jest.fn().mockResolvedValue('https://mock-s3.com/presigned-upload-url'),
  getPublicUrl: jest.fn().mockResolvedValue('https://mock-s3.com/public-url'),
  getFileMetadata: jest.fn().mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() }),
  listFiles: jest.fn().mockResolvedValue([]),
}))

// Mock S3 client module
jest.mock('@/lib/s3/client', () => ({
  getS3Client: jest.fn().mockReturnValue({}),
  getS3Bucket: jest.fn().mockReturnValue('mock-bucket'),
  buildS3Key: jest.fn().mockImplementation((params: { userId: string; fileId: string; filename: string; projectId?: string | null; folderPath?: string }) => {
    const { userId, fileId, filename, projectId, folderPath } = params;
    if (projectId) {
      const normalizedFolder = folderPath && folderPath !== '/' ? folderPath.replace(/^\//, '') : '';
      return `users/${userId}/${projectId}/${normalizedFolder}${fileId}_${filename}`;
    }
    return `users/${userId}/_general/${fileId}_${filename}`;
  }),
}))

// Mock vector store for embedding operations
jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn().mockReturnValue({
    deleteStore: jest.fn().mockResolvedValue(undefined),
    getStore: jest.fn().mockResolvedValue(null),
  }),
  CharacterVectorStore: jest.fn().mockImplementation(() => ({
    addMemory: jest.fn().mockResolvedValue(undefined),
    searchSimilar: jest.fn().mockResolvedValue([]),
    deleteMemory: jest.fn().mockResolvedValue(undefined),
  })),
}))

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  }),
) as jest.Mock
