/**
 * The Atlas's client-side request helper: POST / PUT / DELETE JSON, turning a
 * refusal into an {@link AtlasRequestError} carrying the server's `code`
 * (`NAME_TAKEN`, `INVALID_SHAPE`, …). A binding of `createItemRequest`
 * (`lib/mount-index/item-request.ts`).
 *
 * Client-safe. Re-exported from `lib/hooks/use-atlas`.
 *
 * @module lib/atlas/request
 */

import { createItemRequest } from '@/lib/mount-index/item-request'

const bound = createItemRequest('AtlasRequestError', 'The Atlas would not oblige')

/** A refused write, with the server's code and details. */
export const AtlasRequestError = bound.RequestError
export type AtlasRequestError = InstanceType<typeof AtlasRequestError>

/** POST / PUT / DELETE JSON, turning a refusal into an {@link AtlasRequestError}. */
export const atlasRequest = bound.request
