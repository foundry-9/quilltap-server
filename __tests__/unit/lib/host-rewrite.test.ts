/**
 * Tests for host URL rewriting utility
 *
 * @module __tests__/unit/lib/host-rewrite.test
 */

// Mock dependencies before imports
jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn(),
}));


describe('lib/host-rewrite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DOCKER_CONTAINER;
    delete process.env.LIMA_CONTAINER;
    delete process.env.QUILLTAP_HOST_IP;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('rewriteLocalhostUrl', () => {
    it('should return URL unchanged on bare metal (no VM env)', async () => {
      // No DOCKER_CONTAINER or LIMA_CONTAINER set
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');
      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://localhost:11434');
    });

    it('should return non-localhost URLs unchanged in VM environment', async () => {
      process.env.LIMA_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('https://api.openai.com/v1/chat')).toBe('https://api.openai.com/v1/chat');
    });

    it('should rewrite http://localhost:11434 in Lima environment', async () => {
      process.env.LIMA_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://192.168.5.2:11434/');
    });

    it('should rewrite http://127.0.0.1:8080 in Docker environment', async () => {
      process.env.DOCKER_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '172.17.0.1';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('http://127.0.0.1:8080')).toBe('http://172.17.0.1:8080/');
    });

    it('should respect QUILLTAP_HOST_IP override', async () => {
      process.env.LIMA_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '10.0.0.1';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('http://localhost:3030')).toBe('http://10.0.0.1:3030/');
    });

    it('should handle URLs with paths', async () => {
      process.env.LIMA_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      const result = rewriteLocalhostUrl('http://localhost:11434/api/chat');
      expect(result).toBe('http://192.168.5.2:11434/api/chat');
    });

    it('should handle URLs with query strings', async () => {
      process.env.LIMA_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      const result = rewriteLocalhostUrl('http://localhost:8080/v1/models?limit=10');
      expect(result).toBe('http://192.168.5.2:8080/v1/models?limit=10');
    });

    it('should return invalid URLs unchanged', async () => {
      process.env.LIMA_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('not-a-url')).toBe('not-a-url');
    });

    it('should resolve gateway from /etc/hosts (host.docker.internal)', async () => {
      process.env.DOCKER_CONTAINER = 'true';
      // No QUILLTAP_HOST_IP — should fall through to /etc/hosts

      const { readFileSync } = require('node:fs');
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path === '/etc/hosts') {
          return [
            '127.0.0.1\tlocalhost',
            '::1\tlocalhost',
            '192.168.65.254\thost.docker.internal',
            '172.17.0.2\tcontainer-name',
          ].join('\n');
        }
        throw new Error('ENOENT');
      });

      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');
      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://192.168.65.254:11434/');
    });

    it('should resolve gateway from /proc/net/route', async () => {
      process.env.LIMA_CONTAINER = 'true';
      // No QUILLTAP_HOST_IP — should fall through to /proc/net/route

      const { readFileSync } = require('node:fs');
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path === '/etc/hosts') {
          // No host.docker.internal entry
          return '127.0.0.1\tlocalhost\n::1\tlocalhost\n';
        }
        if (path === '/proc/net/route') {
          // Default gateway 192.168.5.2 = hex C0A80502 -> little-endian 0205A8C0
          return [
            'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
            'eth0\t00000000\t0205A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0',
            'eth0\t0005A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0',
          ].join('\n');
        }
        throw new Error('ENOENT');
      });

      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');
      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://192.168.5.2:11434/');
    });

    it('should return URL unchanged when all resolution strategies fail', async () => {
      process.env.LIMA_CONTAINER = 'true';
      // No QUILLTAP_HOST_IP, and file reads will fail

      const { readFileSync } = require('node:fs');
      (readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');
      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://localhost:11434');
    });
  });

  describe('isVMEnvironment', () => {
    it('should return false on bare metal', async () => {
      const { isVMEnvironment } = await import('@/lib/host-rewrite');
      expect(isVMEnvironment()).toBe(false);
    });

    it('should return true in Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';
      const { isVMEnvironment } = await import('@/lib/host-rewrite');
      expect(isVMEnvironment()).toBe(true);
    });

    it('should return true in Lima', async () => {
      process.env.LIMA_CONTAINER = 'true';
      const { isVMEnvironment } = await import('@/lib/host-rewrite');
      expect(isVMEnvironment()).toBe(true);
    });
  });
});
