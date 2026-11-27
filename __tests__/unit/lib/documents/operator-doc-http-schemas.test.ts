/**
 * @jest-environment node
 */

/**
 * The document request shapes accept the `mountPoint: null` a chat's
 * open-document row carries for a document outside any store (Quilltap
 * General, the project). Document Mode echoes that row back on every save;
 * refusing `null` made each autosave of a General document a silent 400.
 */

import { z } from 'zod'
import {
  documentTargetFields,
  openDocumentFields,
  writeDocumentFields,
} from '@/lib/documents/operator-doc-http'

const scope = z.enum(['general', 'project', 'document_store'])

describe('document request schemas: mountPoint', () => {
  it('reads a null mountPoint as no mount on a write', () => {
    const parsed = z.object(writeDocumentFields(scope)).parse({
      filePath: 'Untitled Document.md',
      scope: 'general',
      mountPoint: null,
      content: 'hello',
    })
    expect(parsed.mountPoint).toBeUndefined()
  })

  it('reads a null mountPoint as no mount on a read and an open', () => {
    expect(z.object(documentTargetFields(scope)).parse({ filePath: 'a.md', scope: 'general', mountPoint: null }).mountPoint)
      .toBeUndefined()
    expect(z.object(openDocumentFields(scope)).parse({ scope: 'general', mountPoint: null }).mountPoint)
      .toBeUndefined()
  })

  it('keeps a named mount and still refuses a non-string', () => {
    const target = z.object(documentTargetFields(scope))
    expect(target.parse({ filePath: 'a.md', scope: 'document_store', mountPoint: 'My Store' }).mountPoint).toBe('My Store')
    expect(() => target.parse({ filePath: 'a.md', scope: 'document_store', mountPoint: 42 })).toThrow()
  })
})
