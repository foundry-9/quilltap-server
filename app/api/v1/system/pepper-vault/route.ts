/**
 * Pepper Vault API v1 — DEPRECATED
 *
 * This endpoint has been replaced by /api/v1/system/unlock.
 * Returns 410 Gone for all requests to signal clients to update.
 *
 * @deprecated Use /api/v1/system/unlock instead
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GONE_BODY = {
  error: 'Gone',
  message: 'The pepper-vault endpoint has been replaced by /api/v1/system/unlock',
  replacement: '/api/v1/system/unlock',
};

export async function GET() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function POST() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}
