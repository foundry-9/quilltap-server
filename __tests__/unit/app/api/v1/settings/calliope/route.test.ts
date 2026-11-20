/**
 * Tests for the instance-wide Calliope settings route
 * (GET / PUT /api/v1/settings/calliope).
 *
 * Accessors are mocked; the REAL CalliopeSettingsSchema runs, since PUT merges
 * the body over the stored value and validates the result.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any) =>
      handler(req, { user: { id: 'user-1' }, repos: {} }),
}));

jest.mock('@/lib/instance-settings', () => ({
  getCalliopeSettings: jest.fn(),
  setCalliopeSettings: jest.fn(),
  CalliopeSettingsSchema: jest.requireActual('@/lib/schemas/settings.types').CalliopeSettingsSchema,
}));

import { GET, PUT } from '@/app/api/v1/settings/calliope/route';
import { getCalliopeSettings, setCalliopeSettings } from '@/lib/instance-settings';

const getSettings = getCalliopeSettings as jest.MockedFunction<typeof getCalliopeSettings>;
const setSettings = setCalliopeSettings as jest.MockedFunction<typeof setCalliopeSettings>;

const PROFILE = '66666666-6666-4666-8666-666666666666';

function req(body?: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  getSettings.mockResolvedValue({ maxAgentTurns: 8 });
  setSettings.mockImplementation(async (value) => value);
});

describe('GET /api/v1/settings/calliope', () => {
  it('returns the stored settings', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 5, connectionProfileId: PROFILE });
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ maxAgentTurns: 5, connectionProfileId: PROFILE });
  });

  it('500s when the accessor throws', async () => {
    getSettings.mockRejectedValue(new Error('boom'));
    const res = await GET({} as never);
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to fetch calliope settings' });
  });
});

describe('PUT /api/v1/settings/calliope', () => {
  it('merges a partial body over the stored value and persists it', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 5 });
    const res = await PUT(req({ connectionProfileId: PROFILE }));
    expect(res.status).toBe(200);
    expect(setSettings).toHaveBeenCalledWith({ maxAgentTurns: 5, connectionProfileId: PROFILE });
    await expect(res.json()).resolves.toEqual({ maxAgentTurns: 5, connectionProfileId: PROFILE });
  });

  it('an empty body leaves stored values intact', async () => {
    getSettings.mockResolvedValue({ maxAgentTurns: 3 });
    const res = await PUT(req({}));
    expect(res.status).toBe(200);
    expect(setSettings).toHaveBeenCalledWith({ maxAgentTurns: 3 });
  });

  it('accepts a null profile id (the default profile)', async () => {
    const res = await PUT(req({ connectionProfileId: null }));
    expect(res.status).toBe(200);
    expect(setSettings).toHaveBeenCalledWith({ maxAgentTurns: 8, connectionProfileId: null });
  });

  it('400s on a non-UUID profile id without writing', async () => {
    const res = await PUT(req({ connectionProfileId: 'nope' }));
    expect(res.status).toBe(400);
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('400s on a non-positive turn budget', async () => {
    const res = await PUT(req({ maxAgentTurns: 0 }));
    expect(res.status).toBe(400);
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('500s when the setter throws', async () => {
    setSettings.mockRejectedValue(new Error('disk'));
    const res = await PUT(req({ maxAgentTurns: 2 }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to update calliope settings' });
  });
});
