/**
 * Unit Tests for Text Detection Utility
 * Tests lib/files/text-detection.ts
 * v2.7-dev: Text Content Detection Feature
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

// Define result type for detectTextContent
interface TextDetectionResult {
  isPlainText: boolean
  detectedMimeType: string | null
  encoding: string
}

// Import using require after mocks
const {
  isTextContent,
  getMimeTypeFromExtension,
  isTextMimeType,
  detectTextContent,
  getBestMimeType,
} = require('@/lib/files/text-detection') as {
  isTextContent: (buffer: Buffer) => boolean
  getMimeTypeFromExtension: (filename: string) => string | null
  isTextMimeType: (mimeType: string) => boolean
  detectTextContent: (buffer: Buffer, filename: string, providedMimeType: string) => TextDetectionResult
  getBestMimeType: (result: TextDetectionResult, providedMimeType: string) => string
}

describe('Text Detection Utility', () => {
  describe('isTextContent', () => {
    it('returns true for empty buffer (empty files are considered text)', () => {
      const buffer = Buffer.from('')
      expect(isTextContent(buffer)).toBe(true)
    })

    it('returns true for plain ASCII text', () => {
      const buffer = Buffer.from('Hello, World! This is plain text.')
      expect(isTextContent(buffer)).toBe(true)
    })

    it('returns true for text with common whitespace', () => {
      const buffer = Buffer.from('Line 1\nLine 2\tTabbed\rCarriage return')
      expect(isTextContent(buffer)).toBe(true)
    })

    it('returns true for UTF-8 text with high bytes', () => {
      const buffer = Buffer.from('Hello 世界 🌍 Ñoño')
      expect(isTextContent(buffer)).toBe(true)
    })

    it('returns true for code content', () => {
      const code = `function hello() {
  console.log("Hello, World!");
  return 42;
}`
      const buffer = Buffer.from(code)
      expect(isTextContent(buffer)).toBe(true)
    })

    it('returns true for JSON content', () => {
      const json = JSON.stringify({ name: 'test', value: 123, nested: { array: [1, 2, 3] } })
      const buffer = Buffer.from(json)
      expect(isTextContent(buffer)).toBe(true)
    })

    it('returns false for binary content with null bytes', () => {
      // Simulate binary file with null bytes
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64])
      expect(isTextContent(buffer)).toBe(false)
    })

    it('returns false for PNG header', () => {
      // PNG magic bytes
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
      expect(isTextContent(buffer)).toBe(false)
    })

    it('returns false for JPEG header', () => {
      // JPEG magic bytes with many non-printable chars
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
      expect(isTextContent(buffer)).toBe(false)
    })

    it('returns false for PDF header', () => {
      // PDF typically has binary content after header
      const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0x00, 0x00, 0x00])
      expect(isTextContent(buffer)).toBe(false)
    })

    it('handles buffer with low non-printable ratio as text', () => {
      // Mostly printable with a few control chars (below threshold)
      const text = 'This is mostly printable text with a bell \x07 character'
      const buffer = Buffer.from(text)
      expect(isTextContent(buffer)).toBe(true)
    })
  })

  describe('getMimeTypeFromExtension', () => {
    describe('TypeScript/JavaScript', () => {
      it('returns correct MIME type for .ts files', () => {
        expect(getMimeTypeFromExtension('component.ts')).toBe('text/typescript')
      })

      it('returns correct MIME type for .tsx files', () => {
        expect(getMimeTypeFromExtension('Component.tsx')).toBe('text/typescript')
      })

      it('returns correct MIME type for .js files', () => {
        expect(getMimeTypeFromExtension('script.js')).toBe('text/javascript')
      })

      it('returns correct MIME type for .jsx files', () => {
        expect(getMimeTypeFromExtension('Component.jsx')).toBe('text/javascript')
      })

      it('returns correct MIME type for .mjs files', () => {
        expect(getMimeTypeFromExtension('module.mjs')).toBe('text/javascript')
      })
    })

    describe('Web files', () => {
      it('returns correct MIME type for .html files', () => {
        expect(getMimeTypeFromExtension('index.html')).toBe('text/html')
      })

      it('returns correct MIME type for .css files', () => {
        expect(getMimeTypeFromExtension('styles.css')).toBe('text/css')
      })

      it('returns correct MIME type for .scss files', () => {
        expect(getMimeTypeFromExtension('styles.scss')).toBe('text/x-scss')
      })
    })

    describe('Data formats', () => {
      it('returns correct MIME type for .json files', () => {
        expect(getMimeTypeFromExtension('config.json')).toBe('application/json')
      })

      it('returns correct MIME type for .yaml files', () => {
        expect(getMimeTypeFromExtension('config.yaml')).toBe('text/yaml')
      })

      it('returns correct MIME type for .yml files', () => {
        expect(getMimeTypeFromExtension('config.yml')).toBe('text/yaml')
      })

      it('returns correct MIME type for .xml files', () => {
        expect(getMimeTypeFromExtension('data.xml')).toBe('application/xml')
      })

      it('returns correct MIME type for .csv files', () => {
        expect(getMimeTypeFromExtension('data.csv')).toBe('text/csv')
      })
    })

    describe('Documentation', () => {
      it('returns correct MIME type for .md files', () => {
        expect(getMimeTypeFromExtension('README.md')).toBe('text/markdown')
      })

      it('returns correct MIME type for .markdown files', () => {
        expect(getMimeTypeFromExtension('doc.markdown')).toBe('text/markdown')
      })

      it('returns correct MIME type for .txt files', () => {
        expect(getMimeTypeFromExtension('notes.txt')).toBe('text/plain')
      })
    })

    describe('Programming languages', () => {
      it('returns correct MIME type for .py files', () => {
        expect(getMimeTypeFromExtension('script.py')).toBe('text/x-python')
      })

      it('returns correct MIME type for .rb files', () => {
        expect(getMimeTypeFromExtension('app.rb')).toBe('text/x-ruby')
      })

      it('returns correct MIME type for .rs files', () => {
        expect(getMimeTypeFromExtension('main.rs')).toBe('text/x-rust')
      })

      it('returns correct MIME type for .go files', () => {
        expect(getMimeTypeFromExtension('main.go')).toBe('text/x-go')
      })

      it('returns correct MIME type for .java files', () => {
        expect(getMimeTypeFromExtension('Main.java')).toBe('text/x-java')
      })

      it('returns correct MIME type for .c files', () => {
        expect(getMimeTypeFromExtension('main.c')).toBe('text/x-c')
      })

      it('returns correct MIME type for .cpp files', () => {
        expect(getMimeTypeFromExtension('main.cpp')).toBe('text/x-c++')
      })
    })

    describe('Shell scripts', () => {
      it('returns correct MIME type for .sh files', () => {
        expect(getMimeTypeFromExtension('script.sh')).toBe('text/x-shellscript')
      })

      it('returns correct MIME type for .bash files', () => {
        expect(getMimeTypeFromExtension('script.bash')).toBe('text/x-shellscript')
      })

      it('returns correct MIME type for .zsh files', () => {
        expect(getMimeTypeFromExtension('script.zsh')).toBe('text/x-shellscript')
      })
    })

    describe('Config files', () => {
      it('returns correct MIME type for .env files', () => {
        expect(getMimeTypeFromExtension('.env')).toBe('text/plain')
      })

      it('returns correct MIME type for .gitignore files', () => {
        expect(getMimeTypeFromExtension('.gitignore')).toBe('text/plain')
      })

      it('returns correct MIME type for .eslintrc files', () => {
        expect(getMimeTypeFromExtension('.eslintrc')).toBe('application/json')
      })
    })

    describe('Special files', () => {
      it('returns correct MIME type for Dockerfile', () => {
        expect(getMimeTypeFromExtension('Dockerfile')).toBe('text/x-dockerfile')
      })

      it('returns correct MIME type for Makefile', () => {
        expect(getMimeTypeFromExtension('Makefile')).toBe('text/x-makefile')
      })

      it('returns null for unknown extensions', () => {
        expect(getMimeTypeFromExtension('file.xyz')).toBeNull()
      })

      it('handles case-insensitive extensions', () => {
        expect(getMimeTypeFromExtension('FILE.TS')).toBe('text/typescript')
        expect(getMimeTypeFromExtension('README.MD')).toBe('text/markdown')
      })

      it('handles paths with directories', () => {
        expect(getMimeTypeFromExtension('src/components/Button.tsx')).toBe('text/typescript')
      })
    })
  })

  describe('isTextMimeType', () => {
    it('returns true for text/* MIME types', () => {
      expect(isTextMimeType('text/plain')).toBe(true)
      expect(isTextMimeType('text/html')).toBe(true)
      expect(isTextMimeType('text/css')).toBe(true)
      expect(isTextMimeType('text/javascript')).toBe(true)
      expect(isTextMimeType('text/markdown')).toBe(true)
    })

    it('returns true for text-based application types', () => {
      expect(isTextMimeType('application/json')).toBe(true)
      expect(isTextMimeType('application/xml')).toBe(true)
      expect(isTextMimeType('application/javascript')).toBe(true)
      expect(isTextMimeType('application/typescript')).toBe(true)
    })

    it('returns false for binary MIME types', () => {
      expect(isTextMimeType('application/octet-stream')).toBe(false)
      expect(isTextMimeType('image/png')).toBe(false)
      expect(isTextMimeType('image/jpeg')).toBe(false)
      expect(isTextMimeType('application/pdf')).toBe(false)
      expect(isTextMimeType('audio/mpeg')).toBe(false)
      expect(isTextMimeType('video/mp4')).toBe(false)
    })
  })

  describe('detectTextContent', () => {
    it('detects plain text file with generic MIME type', () => {
      const buffer = Buffer.from('This is plain text content.')
      const result = detectTextContent(buffer, 'notes.txt', 'application/octet-stream')

      expect(result.isPlainText).toBe(true)
      expect(result.detectedMimeType).toBe('text/plain')
      expect(result.encoding).toBe('utf-8')
    })

    it('detects TypeScript file with generic MIME type', () => {
      const buffer = Buffer.from('const x: number = 42;')
      const result = detectTextContent(buffer, 'script.ts', 'application/octet-stream')

      expect(result.isPlainText).toBe(true)
      expect(result.detectedMimeType).toBe('text/typescript')
    })

    it('preserves correct MIME type when already set', () => {
      const buffer = Buffer.from('console.log("hello");')
      const result = detectTextContent(buffer, 'script.js', 'text/javascript')

      expect(result.isPlainText).toBe(true)
      expect(result.detectedMimeType).toBeNull() // No override needed
    })

    it('does not detect binary content as text', () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
      const result = detectTextContent(buffer, 'image.png', 'application/octet-stream')

      expect(result.isPlainText).toBe(false)
    })

    it('detects text even with unknown extension when content is text', () => {
      const buffer = Buffer.from('This is some text content without a known extension')
      const result = detectTextContent(buffer, 'file.unknown', 'application/octet-stream')

      expect(result.isPlainText).toBe(true)
      expect(result.detectedMimeType).toBe('text/plain')
    })

    it('handles empty provided MIME type', () => {
      const buffer = Buffer.from('Hello world')
      const result = detectTextContent(buffer, 'hello.txt', '')

      expect(result.isPlainText).toBe(true)
      expect(result.detectedMimeType).toBe('text/plain')
    })
  })

  describe('getBestMimeType', () => {
    it('returns detected MIME type when available', () => {
      const result = {
        isPlainText: true,
        detectedMimeType: 'text/typescript',
        encoding: 'utf-8',
      }

      expect(getBestMimeType(result, 'application/octet-stream')).toBe('text/typescript')
    })

    it('returns provided MIME type when no detection', () => {
      const result = {
        isPlainText: false,
        detectedMimeType: null,
        encoding: 'utf-8',
      }

      expect(getBestMimeType(result, 'image/png')).toBe('image/png')
    })

    it('returns provided MIME type when it is already correct', () => {
      const result = {
        isPlainText: true,
        detectedMimeType: null,
        encoding: 'utf-8',
      }

      expect(getBestMimeType(result, 'text/javascript')).toBe('text/javascript')
    })
  })
})
