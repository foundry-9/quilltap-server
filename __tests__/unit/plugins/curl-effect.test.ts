/**
 * @jest-environment node
 */
import { plugin } from '@/plugins/dist/qtap-plugin-curl/index';
import { CURL_READ_ONLY_NOTE, isReadOnlyCurlCall } from '@/plugins/dist/qtap-plugin-curl/curl-tool';
import { isComputedToolEffect, toolEffectSpecFromDeclaration } from '@/lib/tools/effect-types';
import { offeredTools, resolveToolPermit } from '@/lib/tools/effects';

const url = 'https://example.com/';

describe('curl plugin: which calls only read', () => {
  it.each([undefined, 'GET', 'HEAD', 'OPTIONS'])('counts %s as read-only', (request) => {
    expect(isReadOnlyCurlCall(request ? { url, request } : { url })).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('counts %s as a write', (request) => {
    expect(isReadOnlyCurlCall({ url, request })).toBe(false);
  });

  it('counts invalid input as a write', () => {
    expect(isReadOnlyCurlCall({})).toBe(false);
    expect(isReadOnlyCurlCall({ url, request: 'get' })).toBe(false);
    expect(isReadOnlyCurlCall({ url, request: 'TRACE' })).toBe(false);
    expect(isReadOnlyCurlCall(null)).toBe(false);
  });
});

describe('curl plugin: declared effect', () => {
  const declare = async () => {
    const declared = await plugin.getToolEffects!({});
    const spec = toolEffectSpecFromDeclaration(declared.curl);
    if (!spec || !isComputedToolEffect(spec)) throw new Error('curl should declare a call effect');
    return spec;
  };

  it('is a write at most, and says what a read-only turn allows', async () => {
    const spec = await declare();
    expect(spec.maxEffect).toBe('write');
    expect(spec.usesAllowedUnder('read')).toBe(CURL_READ_ONLY_NOTE);
    expect(spec.usesAllowedUnder('none')).toBeNull();
  });

  it('passes a fetch and refuses a POST under a read ceiling', async () => {
    const ctx = {
      offer: offeredTools(['curl']),
      effectCeiling: 'read' as const,
      pluginToolEffects: new Map([['curl', await declare()]]),
    };
    expect(resolveToolPermit('curl', { url }, ctx)).toMatchObject({ permitted: true, effect: 'read' });
    expect(resolveToolPermit('curl', { url, request: 'POST', data: '{}' }, ctx)).toMatchObject({
      permitted: false,
      effect: 'write',
    });
    expect(resolveToolPermit('curl', { request: 'GET' }, ctx)).toMatchObject({ permitted: false });
  });
});
