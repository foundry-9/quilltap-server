# Quilltap Testing Guide

This guide documents testing conventions, patterns, and infrastructure for Quilltap unit tests.

## Table of Contents

- [Overview](#overview)
- [Test Infrastructure](#test-infrastructure)
- [Writing Tests](#writing-tests)
- [Mock Patterns](#mock-patterns)
- [Test Organization](#test-organization)
- [Running Tests](#running-tests)
- [Coverage](#coverage)
- [Best Practices](#best-practices)

## Overview

Quilltap uses Jest for unit testing with the following goals:

- **Comprehensive coverage** of business logic, utilities, and critical paths
- **Fast execution** through effective mocking and parallelization
- **Maintainable tests** using factories, centralized mocks, and clear patterns
- **CI integration** via pre-commit hooks that run tests before allowing commits

### Test Types

- **Unit tests** (`__tests__/unit/`) - Test individual functions, classes, and modules in isolation
- **Integration tests** (`__tests__/integration/`) - Test API routes and multi-module interactions
- **E2E tests** (Playwright) - Test complete user workflows in the browser

This guide focuses on **unit tests**.

## Test Infrastructure

### Configuration

Tests are configured in [jest.config.ts](../jest.config.ts):

- **Environment**: jsdom (for React component testing)
- **Setup file**: [jest.setup.ts](../jest.setup.ts) - Global mocks and test utilities
- **Coverage**: v8 provider with text, lcov, and json-summary reporters
- **Transform**: Handles TypeScript, JSX, and ESM modules

### Global Mocks

[jest.setup.ts](../jest.setup.ts) provides mocked versions of:

- **LLM Providers**: OpenAI, Anthropic, Google, AWS Bedrock
- **Authentication**: Arctic, jose, openid-client
- **Database**: MongoDB client and connections
- **Storage**: File storage manager, vector store
- **Infrastructure**: Session utilities, encryption, repositories

These mocks are available in all tests automatically.

### Test Fixtures

Two critical fixture files power most tests:

#### 1. [test-factories.ts](__tests__/unit/lib/fixtures/test-factories.ts)

Factory functions for creating test data with sensible defaults:

```typescript
import { createMockCharacter, createMockChat, createMockMemory } from '../fixtures/test-factories'

const character = createMockCharacter({
  name: 'Test Character',
  userId: 'user-123'
})

const chat = createMockChat({
  characterIds: [character.id],
  userId: 'user-123'
})
```

Available factories:
- `createMockCharacter()` - Character entities
- `createMockChat()` - Chat sessions
- `createMockMessage()` - Chat messages
- `createMockMemory()` - Memory entities
- `createMockProfile()` - User profiles
- `createMockTag()` - Tags
- `createMockFile()` - File metadata
- `createMockExport()` / `createMockImport()` - Export/import data
- `createMockSyncInstance()` - Sync configurations
- And many more...

**Best practice**: Always use factories instead of manually constructing test objects.

#### 2. [mock-repositories.ts](__tests__/unit/lib/fixtures/mock-repositories.ts)

Centralized repository mocking utilities:

```typescript
import { createMockUserRepositories, configureFindById } from '../fixtures/mock-repositories'

const mockRepos = createMockUserRepositories()
const character = createMockCharacter()

configureFindById(mockRepos.charactersRepository, character)

// Test code that calls charactersRepository.findById()
```

Available utilities:
- `createMockUserRepositories()` - Full set of user-scoped repositories
- `createMockGlobalRepositories()` - Global/system repositories
- `configureFindById()` - Set up findById mock responses
- `configureFindAll()` - Set up findAll/list mock responses
- `configureCreate()` - Set up create mock responses
- `configureUpdate()` - Set up update mock responses
- `configureDelete()` - Set up delete mock responses

## Writing Tests

### File Structure

Tests mirror the source structure with `.test.ts` or `.test.tsx` suffix:

```
Source:                         Test:
lib/services/search.service.ts  __tests__/unit/lib/services/search.service.test.ts
hooks/useDialogState.ts         __tests__/unit/hooks/useDialogState.test.ts
components/chat/ChatInput.tsx   __tests__/unit/components/chat/ChatInput.test.tsx
```

### Basic Test Template

```typescript
/**
 * Unit Tests for [Module Name]
 * Tests lib/[path]/[module].ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

// Import the module under test
import { functionToTest } from '@/lib/module'

// Import test utilities
import { createMockCharacter } from '../fixtures/test-factories'

// Mock dependencies that aren't globally mocked
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}))

describe('Module Name', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('functionToTest', () => {
    it('should handle normal case', () => {
      const input = 'test input'
      const result = functionToTest(input)
      expect(result).toBe('expected output')
    })

    it('should handle edge case', () => {
      const result = functionToTest(null)
      expect(result).toBeNull()
    })

    it('should throw on invalid input', () => {
      expect(() => functionToTest(undefined)).toThrow('Invalid input')
    })
  })
})
```

### Testing Async Functions

```typescript
describe('asyncFunction', () => {
  it('should resolve with result', async () => {
    const result = await asyncFunction('param')
    expect(result).toEqual({ success: true })
  })

  it('should reject on error', async () => {
    await expect(asyncFunction('bad')).rejects.toThrow('Error message')
  })
})
```

### Testing with Repositories

```typescript
import { createMockUserRepositories, configureFindById } from '../fixtures/mock-repositories'
import { createMockChat } from '../fixtures/test-factories'
import { getChatWithCharacters } from '@/lib/services/chat.service'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn()
}))

describe('getChatWithCharacters', () => {
  let mockRepos: ReturnType<typeof createMockUserRepositories>

  beforeEach(() => {
    mockRepos = createMockUserRepositories()
    const { getRepositories } = require('@/lib/repositories/factory')
    getRepositories.mockReturnValue(mockRepos)
  })

  it('should return chat with characters', async () => {
    const chat = createMockChat()
    const character = createMockCharacter()
    
    configureFindById(mockRepos.chatsRepository, chat)
    configureFindAll(mockRepos.charactersRepository, [character])

    const result = await getChatWithCharacters('chat-123', 'user-123')

    expect(result).toEqual({
      chat,
      characters: [character]
    })
  })
})
```

## Mock Patterns

### Module Mocking

Mock external dependencies at the top of test files:

```typescript
// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}))

// Mock a service module
jest.mock('@/lib/services/other-service', () => ({
  functionFromOtherService: jest.fn()
}))
```

### Function Mocking

```typescript
const mockFunction = jest.fn()

// Set return value
mockFunction.mockReturnValue('result')

// Set async return value
mockFunction.mockResolvedValue({ data: 'result' })

// Set error
mockFunction.mockRejectedValue(new Error('Failed'))

// Verify calls
expect(mockFunction).toHaveBeenCalledWith('arg1', 'arg2')
expect(mockFunction).toHaveBeenCalledTimes(1)
```

### Repository Mocking Pattern

Standard pattern for mocking repository methods:

```typescript
const mockRepos = createMockUserRepositories()

// Configure specific responses
mockRepos.chatsRepository.findById = jest.fn().mockResolvedValue(createMockChat())
mockRepos.charactersRepository.findAll = jest.fn().mockResolvedValue([createMockCharacter()])

// Or use helper utilities
configureFindById(mockRepos.chatsRepository, createMockChat())
configureFindAll(mockRepos.charactersRepository, [createMockCharacter()])
```

### Testing API Routes

```typescript
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/characters/route'
import { createMockCharacter } from '../fixtures/test-factories'
import { createMockUserRepositories } from '../fixtures/mock-repositories'

jest.mock('@/lib/repositories/factory')
jest.mock('@/lib/auth/session')

describe('GET /api/v1/characters', () => {
  let mockRepos: ReturnType<typeof createMockUserRepositories>

  beforeEach(() => {
    mockRepos = createMockUserRepositories()
    const { getRepositories } = require('@/lib/repositories/factory')
    getRepositories.mockReturnValue(mockRepos)

    const { getSessionUserId } = require('@/lib/auth/session')
    getSessionUserId.mockResolvedValue('user-123')
  })

  it('should return characters list', async () => {
    const characters = [createMockCharacter(), createMockCharacter()]
    mockRepos.charactersRepository.findAll = jest.fn().mockResolvedValue(characters)

    const request = new NextRequest('http://localhost:3000/api/v1/characters')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ characters })
  })
})
```

### Testing React Hooks

```typescript
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDialogState } from '@/hooks/useDialogState'

describe('useDialogState', () => {
  it('should initialize with closed state', () => {
    const { result } = renderHook(() => useDialogState())
    expect(result.current.isOpen).toBe(false)
  })

  it('should open and close dialog', () => {
    const { result } = renderHook(() => useDialogState())

    act(() => {
      result.current.open()
    })
    expect(result.current.isOpen).toBe(true)

    act(() => {
      result.current.close()
    })
    expect(result.current.isOpen).toBe(false)
  })
})
```

### Testing React Components

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { CharacterCard } from '@/components/characters/CharacterCard'
import { createMockCharacter } from '../fixtures/test-factories'

describe('CharacterCard', () => {
  it('should render character name', () => {
    const character = createMockCharacter({ name: 'Test Character' })
    render(<CharacterCard character={character} />)
    
    expect(screen.getByText('Test Character')).toBeInTheDocument()
  })

  it('should call onSelect when clicked', () => {
    const character = createMockCharacter()
    const onSelect = jest.fn()
    
    render(<CharacterCard character={character} onSelect={onSelect} />)
    
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(character.id)
  })
})
```

## Test Organization

### Describe Blocks

Organize tests hierarchically:

```typescript
describe('SearchService', () => {
  describe('parseQuery', () => {
    it('should parse simple query', () => { /* ... */ })
    it('should handle empty query', () => { /* ... */ })
    it('should parse with filters', () => { /* ... */ })
  })

  describe('matchContent', () => {
    it('should match exact phrase', () => { /* ... */ })
    it('should be case insensitive', () => { /* ... */ })
    it('should return null for no match', () => { /* ... */ })
  })
})
```

### Test Naming

Use descriptive names that explain the scenario and expected outcome:

```typescript
// Good
it('should return null when chat is not found', () => { /* ... */ })
it('should throw error when user is not authorized', () => { /* ... */ })
it('should compress messages when context exceeds threshold', () => { /* ... */ })

// Avoid
it('works', () => { /* ... */ })
it('test chat', () => { /* ... */ })
it('returns data', () => { /* ... */ })
```

### Setup and Teardown

```typescript
describe('Module', () => {
  // Runs once before all tests in this describe block
  beforeAll(() => {
    // One-time setup
  })

  // Runs before each test
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Runs after each test
  afterEach(() => {
    // Cleanup
  })

  // Runs once after all tests in this describe block
  afterAll(() => {
    // Final cleanup
  })
})
```

## Running Tests

### NPM Scripts

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- search.service.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should parse query"

# Run integration tests
npm run test:integration
```

### Pre-commit Hook

The `.githooks/pre-commit` hook automatically:
1. Kills the dev server
2. Runs ESLint
3. Runs all unit tests
4. Runs `npx tsc` to check types
5. Builds plugins
6. Runs full Next.js build

Tests must pass before commits are allowed. This ensures code quality but can slow iteration during active development.

### Debugging Tests

```bash
# Run with verbose output
npm test -- --verbose

# Run single test file with debugging
node --inspect-brk node_modules/.bin/jest search.service.test.ts

# Use VSCode debugger
# Add breakpoint, press F5, select "Jest Current File"
```

## Coverage

### Viewing Coverage

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

### Coverage Reports

Coverage data is generated in multiple formats:

- **Text**: Displayed in terminal
- **LCOV**: `coverage/lcov.info` (for CI tools)
- **JSON**: `coverage/coverage-summary.json`
- **HTML**: `coverage/lcov-report/index.html` (detailed browser view)

### Current Coverage Goals

Quilltap does not currently enforce coverage thresholds, allowing flexibility during rapid development. However, these informal targets guide our testing:

- **Critical paths** (services, API layer): Aim for 80-85%
- **Business logic** (utilities, repositories): Aim for 70-80%
- **Components**: Aim for 60-70%
- **Global**: Aim for 70%+

## Best Practices

### 1. Test Behavior, Not Implementation

```typescript
// Good - tests the behavior
it('should return formatted time string', () => {
  const result = formatTime(1000)
  expect(result).toBe('1s')
})

// Avoid - tests implementation details
it('should call Date constructor', () => {
  formatTime(1000)
  expect(Date).toHaveBeenCalled() // Too coupled to implementation
})
```

### 2. Use Factories for Test Data

```typescript
// Good - uses factory
const character = createMockCharacter({ name: 'Test' })

// Avoid - manual construction
const character = {
  id: 'char-123',
  userId: 'user-123',
  name: 'Test',
  description: '',
  createdAt: new Date(),
  updatedAt: new Date(),
  // ... 20 more required fields
}
```

### 3. Keep Tests Independent

```typescript
// Good - each test is isolated
describe('CharacterService', () => {
  beforeEach(() => {
    mockRepos = createMockUserRepositories()
  })

  it('test 1', () => { /* uses fresh mockRepos */ })
  it('test 2', () => { /* uses fresh mockRepos */ })
})

// Avoid - tests depend on each other
let sharedCharacter: Character
it('should create character', () => {
  sharedCharacter = await createCharacter()
})
it('should update character', () => {
  await updateCharacter(sharedCharacter.id) // Depends on previous test
})
```

### 4. Test Edge Cases

```typescript
describe('parseQuery', () => {
  it('should parse normal query', () => { /* ... */ })
  
  // Edge cases
  it('should handle empty string', () => { /* ... */ })
  it('should handle null', () => { /* ... */ })
  it('should handle undefined', () => { /* ... */ })
  it('should handle very long input', () => { /* ... */ })
  it('should handle special characters', () => { /* ... */ })
})
```

### 5. Clear Assertions

```typescript
// Good - specific assertions
expect(result).toEqual({ id: 'chat-123', name: 'Test Chat' })
expect(mockFunction).toHaveBeenCalledWith('expected-arg')

// Avoid - vague assertions
expect(result).toBeTruthy()
expect(mockFunction).toHaveBeenCalled()
```

### 6. Mock External Dependencies Only

```typescript
// Good - only mocks external dependencies
jest.mock('@/lib/mongodb/client') // External
jest.mock('openai') // External

// Avoid - mocking the module under test
jest.mock('@/lib/services/search.service') // This is what we're testing!
```

### 7. Use Descriptive Test Data

```typescript
// Good - clear what's being tested
const query = 'search term'
const emptyQuery = ''
const longQuery = 'a'.repeat(1000)

// Avoid - unclear test data
const q = 'test'
const q2 = ''
const q3 = 'aaaaaaa...'
```

## Common Patterns by Module Type

### Testing Services

Focus on business logic, error handling, and repository interactions:

```typescript
import { createMockUserRepositories, configureFindById } from '../fixtures/mock-repositories'

describe('ChatService', () => {
  let mockRepos: ReturnType<typeof createMockUserRepositories>

  beforeEach(() => {
    mockRepos = createMockUserRepositories()
  })

  it('should filter chats by excluded tags', () => { /* ... */ })
  it('should throw error when chat not found', () => { /* ... */ })
  it('should log warning when cache miss', () => { /* ... */ })
})
```

### Testing Utilities

Focus on input/output transformations and edge cases:

```typescript
describe('formatTime', () => {
  it('should format seconds', () => {
    expect(formatTime(30)).toBe('30s')
  })

  it('should format minutes and seconds', () => {
    expect(formatTime(90)).toBe('1m 30s')
  })

  it('should handle zero', () => {
    expect(formatTime(0)).toBe('0s')
  })

  it('should handle negative values', () => {
    expect(formatTime(-10)).toBe('0s')
  })
})
```

### Testing API Routes

Focus on authentication, authorization, request/response formats:

```typescript
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/characters/route'

jest.mock('@/lib/auth/session')
jest.mock('@/lib/repositories/factory')

describe('POST /api/v1/characters', () => {
  it('should create character', async () => { /* ... */ })
  it('should return 401 when not authenticated', async () => { /* ... */ })
  it('should validate required fields', async () => { /* ... */ })
  it('should use action dispatch for sub-actions', async () => { /* ... */ })
})
```

### Testing Hooks

Focus on state management, side effects, cleanup:

```typescript
import { renderHook, act } from '@testing-library/react'

describe('useAsyncOperation', () => {
  it('should track loading state', async () => {
    const { result } = renderHook(() => useAsyncOperation())
    
    expect(result.current.loading).toBe(false)
    
    act(() => {
      result.current.execute(async () => {})
    })
    
    expect(result.current.loading).toBe(true)
  })
})
```

### Testing Components

Focus on rendering, user interactions, accessibility:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'

describe('ChatInput', () => {
  it('should render textarea', () => {
    render(<ChatInput onSend={jest.fn()} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should call onSend with message', () => {
    const onSend = jest.fn()
    render(<ChatInput onSend={onSend} />)
    
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByText('Send'))
    
    expect(onSend).toHaveBeenCalledWith('Hello')
  })
})
```

## Troubleshooting

### Common Issues

#### ESM Module Errors

If you see "Cannot use import statement outside a module":

1. Check `jest.config.ts` has correct `transformIgnorePatterns`
2. Add the package to the transform ignore patterns if needed

#### MongoDB Mock Issues

If MongoDB mocks aren't working:

1. Verify [jest.setup.ts](../jest.setup.ts) is being loaded
2. Check the mock is defined before the test imports the module
3. Clear the Jest cache: `npx jest --clearCache`

#### Type Errors in Tests

TypeScript strict mode applies to tests. Common fixes:

```typescript
// Add type assertions
const result = someFunction() as SomeType

// Use non-null assertion when you know it's safe
const value = maybeUndefined!

// Provide explicit types
const mock = jest.fn<ReturnType, Parameters>()
```

#### Async Test Timeouts

If tests timeout on async operations:

```typescript
// Increase timeout for specific test
it('should complete long operation', async () => {
  // Test code
}, 10000) // 10 second timeout

// Or set timeout for all tests in describe
describe('SlowModule', () => {
  jest.setTimeout(10000)
  
  it('test 1', async () => { /* ... */ })
})
```

## Resources

### Internal References

- [jest.config.ts](../jest.config.ts) - Jest configuration
- [jest.setup.ts](../jest.setup.ts) - Global mocks and setup
- [test-factories.ts](__tests__/unit/lib/fixtures/test-factories.ts) - Test data factories
- [mock-repositories.ts](__tests__/unit/lib/fixtures/mock-repositories.ts) - Repository mocks
- [__tests__/unit/](__tests__/unit/) - Example unit tests

### External Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Jest Matchers](https://jestjs.io/docs/expect)
- [Testing Best Practices](https://testingjavascript.com/)

---

**Last Updated**: 2026-01-22  
**Maintainer**: Foundry-9 LLC
