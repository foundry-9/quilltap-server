/**
 * Unit tests for the plugin logger bridge.
 *
 * Regression context: the bridge's `debug()` method was an empty stub, so every
 * plugin's `logger.debug(...)` call was silently discarded regardless of the
 * configured LOG_LEVEL. (`info`/`warn`/`error` forwarded fine — only debug was
 * dropped.) The fix forwards debug to the core logger like the other levels.
 * These tests pin that all four levels forward, that the plugin/module context
 * is attached and merged, that `error` passes the Error through, and that
 * `child()` loggers accumulate context — guarding the debug stub from
 * reappearing.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { logger } from '@/lib/logger';
import {
  injectPluginLoggerFactory,
  clearPluginLoggerFactory,
} from '@/lib/plugins/plugin-logger-bridge';

// The bridge forwards into the core `logger` singleton, reading its methods at
// call time. Spy on that same instance so the forwards are observable (the
// `@/lib/logger` module mock does not apply under next/jest's SWC transform).
const mockLogger = {
  debug: jest.spyOn(logger, 'debug').mockImplementation(() => {}),
  info: jest.spyOn(logger, 'info').mockImplementation(() => {}),
  warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
  error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
};

const GLOBAL_KEY = '__quilltap_logger_factory';

type PluginLogger = {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>, error?: Error): void;
  child(context: Record<string, unknown>): PluginLogger;
};

type LoggerFactory = (pluginName: string) => PluginLogger;

function getFactory(): LoggerFactory {
  const factory = (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  if (typeof factory !== 'function') {
    throw new Error('logger factory was not injected');
  }
  return factory as LoggerFactory;
}

describe('plugin-logger-bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    injectPluginLoggerFactory();
  });

  afterEach(() => {
    clearPluginLoggerFactory();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('factory injection', () => {
    it('installs a factory function on the global key', () => {
      expect(typeof (globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBe('function');
    });

    it('clears the factory from the global key', () => {
      clearPluginLoggerFactory();
      expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBeUndefined();
    });
  });

  describe('debug forwarding (regression: empty stub dropped all debug logs)', () => {
    it('forwards debug() to the core logger instead of swallowing it', () => {
      const log = getFactory()('qtap-plugin-openai');
      log.debug('streaming chunk received');

      expect(mockLogger.debug).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'streaming chunk received',
        expect.objectContaining({ plugin: 'qtap-plugin-openai', module: 'plugin' })
      );
    });

    it('merges per-call context into the forwarded debug payload', () => {
      const log = getFactory()('qtap-plugin-z-ai');
      log.debug('reasoning delta', { reasoningChars: 42 });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'reasoning delta',
        expect.objectContaining({
          plugin: 'qtap-plugin-z-ai',
          module: 'plugin',
          reasoningChars: 42,
        })
      );
    });
  });

  describe('other levels forward correctly', () => {
    it('forwards info()', () => {
      const log = getFactory()('qtap-plugin-grok');
      log.info('provider ready');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'provider ready',
        expect.objectContaining({ plugin: 'qtap-plugin-grok', module: 'plugin' })
      );
    });

    it('forwards warn()', () => {
      const log = getFactory()('qtap-plugin-grok');
      log.warn('rate limited');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'rate limited',
        expect.objectContaining({ plugin: 'qtap-plugin-grok', module: 'plugin' })
      );
    });

    it('forwards error() including the Error argument', () => {
      const log = getFactory()('qtap-plugin-google');
      const boom = new Error('thinking config rejected');
      log.error('request failed', { model: 'gemini-3.1-pro-preview' }, boom);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'request failed',
        expect.objectContaining({
          plugin: 'qtap-plugin-google',
          module: 'plugin',
          model: 'gemini-3.1-pro-preview',
        }),
        boom
      );
    });
  });

  describe('child loggers', () => {
    it('accumulates context across child() and still forwards debug', () => {
      const log = getFactory()('qtap-plugin-anthropic').child({ requestId: 'req-1' });
      log.debug('child debug line', { phase: 'stream' });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'child debug line',
        expect.objectContaining({
          plugin: 'qtap-plugin-anthropic',
          module: 'plugin',
          requestId: 'req-1',
          phase: 'stream',
        })
      );
    });

    it('nests context through grandchild loggers', () => {
      const log = getFactory()('qtap-plugin-anthropic')
        .child({ requestId: 'req-2' })
        .child({ attempt: 2 });
      log.info('retrying');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'retrying',
        expect.objectContaining({
          plugin: 'qtap-plugin-anthropic',
          module: 'plugin',
          requestId: 'req-2',
          attempt: 2,
        })
      );
    });
  });
});
