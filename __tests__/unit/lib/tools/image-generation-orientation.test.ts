/**
 * Regression tests for bug 149 — the default orientation must not erase an
 * explicit size.
 *
 * `buildImageGenParams` lets orientation outrank a raw `size`, which is right:
 * a caller asking for a shape means the shape. But the handler passed
 * `toolInput.orientation ?? 'square'`, so that precedence applied even when the
 * caller had asked for no shape at all — every `size` the model supplied was
 * overwritten by square's 1024x1024, and the tool's `size` parameter could
 * never do anything.
 */

import { requestedOrientation } from '@/lib/tools/handlers/image-generation-handler';
import type { ImageGenerationToolInput } from '@/lib/tools/image-generation-tool';

const input = (over: Partial<ImageGenerationToolInput> = {}): ImageGenerationToolInput =>
  ({ prompt: 'a brass zeppelin', ...over }) as ImageGenerationToolInput;

describe('requestedOrientation', () => {
  it('defaults to square when the model asked for neither shape nor size', () => {
    expect(requestedOrientation(input())).toBe('square');
  });

  it('yields to an explicit size, so the size actually reaches the provider', () => {
    expect(requestedOrientation(input({ size: '1536x1024' }))).toBeUndefined();
  });

  it('still honours an explicit orientation', () => {
    expect(requestedOrientation(input({ orientation: 'portrait' }))).toBe('portrait');
    expect(requestedOrientation(input({ orientation: 'landscape' }))).toBe('landscape');
  });

  it('lets orientation win when the model supplied both', () => {
    // The documented precedence: a shape request outranks a raw string.
    expect(requestedOrientation(input({ orientation: 'portrait', size: '1536x1024' }))).toBe(
      'portrait',
    );
  });
});
