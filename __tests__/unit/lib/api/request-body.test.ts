/**
 * @jest-environment node
 *
 * A body that cannot be parsed is the caller's 400, never a 500 (#221) and
 * never silently `{}` (#220).
 */

import { describe, it, expect, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: { child: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}))

import { guardRequestBodyParsers, readJsonBody, RequestBodyParseError } from '@/lib/api/request-body'

const post = (body: string, contentType = 'application/json') =>
  new Request('http://localhost/api/v1/x', { method: 'POST', body, headers: { 'content-type': contentType } })

describe('guardRequestBodyParsers', () => {
  it('turns a malformed JSON body into a RequestBodyParseError', async () => {
    const req = post('not json')
    guardRequestBodyParsers(req)
    await expect(req.json()).rejects.toBeInstanceOf(RequestBodyParseError)
  })

  it('leaves a good JSON body alone', async () => {
    const req = post('{"a":1}')
    guardRequestBodyParsers(req)
    await expect(req.json()).resolves.toEqual({ a: 1 })
  })

  it('turns a non-multipart body into a RequestBodyParseError for formData()', async () => {
    const req = post('{"a":1}')
    guardRequestBodyParsers(req)
    await expect(req.formData()).rejects.toMatchObject({ name: 'RequestBodyParseError', kind: 'form-data' })
  })

  it('is idempotent', async () => {
    const req = post('nope')
    guardRequestBodyParsers(req)
    guardRequestBodyParsers(req)
    await expect(req.json()).rejects.toBeInstanceOf(RequestBodyParseError)
  })
})

describe('readJsonBody', () => {
  it('answers the default for an empty body', async () => {
    await expect(readJsonBody(post(''), {})).resolves.toEqual({})
    await expect(readJsonBody(post('   '), {})).resolves.toEqual({})
  })

  it('throws for a body that is present but not JSON', async () => {
    await expect(readJsonBody(post('not-json{'), {})).rejects.toBeInstanceOf(RequestBodyParseError)
  })

  it('parses a JSON body', async () => {
    await expect(readJsonBody(post('{"swipeIndex":2}'), {})).resolves.toEqual({ swipeIndex: 2 })
  })
})
