/**
 * Next.js Proxy: the request-origin gate
 *
 * Quilltap is single-user with no login, so this proxy is the boundary between
 * the API and every other web page the operator's browser visits. Every request
 * is checked by `checkRequestOrigin` (`lib/api/request-origin.ts`, shared with
 * the WebSocket upgrade):
 *
 *  - any request whose `Host` the server does not answer to is refused (DNS
 *    rebinding);
 *  - an `/api/` request a browser marks as coming from another site or origin
 *    is refused, whatever its method.
 *
 * No CORS headers are sent: the app is same-origin and needs none.
 *
 * Only headers are read here, never the body, so large uploads pass through
 * untouched. Static security headers (CSP and friends) are set for every path
 * in `next.config.js` `headers()`, so they cover bodies and static assets too.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { checkRequestOrigin } from '@/lib/api/request-origin';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  const verdict = checkRequestOrigin(
    {
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site'),
    },
    { requireSameOrigin: isApi },
  );

  if (!verdict.ok) {
    console.warn(`[proxy] refused ${request.method} ${pathname}: ${verdict.reason}`);
    return new NextResponse(
      JSON.stringify({ error: 'Forbidden', message: verdict.reason }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Same-origin preflight: nothing to grant, since no CORS is offered.
  if (isApi && request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.next();
}

/**
 * Run on every path except Next's own build output.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
