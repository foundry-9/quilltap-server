'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { PtySessionMeta, WsServerMessage } from '@/lib/schemas/terminal.types';

type TerminalState = 'connecting' | 'live' | 'exited' | 'error';

const MAX_REPLAY_BYTES = 512 * 1024;

interface ExitInfo {
  code: number | null;
  signal?: string;
}

interface UseTerminalSession {
  state: TerminalState;
  meta: PtySessionMeta | null;
  exitInfo: ExitInfo | null;
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onData: (cb: (chunk: string) => void) => () => void;
}

/**
 * Hook managing WebSocket lifecycle for terminal sessions
 *
 * Opens WebSocket on mount, dispatches output via subscriber callbacks.
 * Reconnects on transient close (1006/1011) with 2s backoff, max 3 retries.
 * Sends ping every 30s for keepalive.
 */
export function useTerminalSession(sessionId: string): UseTerminalSession {
  const [state, setState] = useState<TerminalState>('connecting');
  const [meta, setMeta] = useState<PtySessionMeta | null>(null);
  const [exitInfo, setExitInfo] = useState<ExitInfo | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Set<(chunk: string) => void>>(new Set());
  const reconnectCountRef = useRef(0);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Client-side replay buffer. Output (including the server-side ring buffer
  // sent on subscribe and the shell's first prompt) can arrive before xterm
  // finishes its async lazy-import / open(); without buffering, those chunks
  // would dispatch to zero subscribers and be dropped on the floor.
  const replayBufferRef = useRef<string>('');

  const dispatchOutput = useCallback((chunk: string) => {
    const next = replayBufferRef.current + chunk;
    replayBufferRef.current =
      next.length > MAX_REPLAY_BYTES ? next.slice(-MAX_REPLAY_BYTES) : next;
    subscribersRef.current.forEach((cb) => cb(chunk));
  }, []);

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  const onData = useCallback((cb: (chunk: string) => void) => {
    subscribersRef.current.add(cb);
    // Replay buffered output (server ring buffer + any chunks that arrived
    // before this subscriber attached) so a fresh xterm instance lands
    // straight on the first prompt instead of an empty screen.
    if (replayBufferRef.current.length > 0) {
      try {
        cb(replayBufferRef.current);
      } catch (err) {
        console.error('Terminal replay subscriber threw:', err);
      }
    }
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setState('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/api/v1/terminals/${sessionId}/stream`;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setState('live');
      reconnectCountRef.current = 0;

      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const message: WsServerMessage = JSON.parse(event.data);

        if (message.type === 'output') {
          dispatchOutput(message.data);
        } else if (message.type === 'meta') {
          setMeta(message.meta);
        } else if (message.type === 'exit') {
          setState('exited');
          setExitInfo({ code: message.code, signal: message.signal ?? undefined });
        }
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };

    ws.onerror = () => {
      setState('error');
    };

    ws.onclose = (event) => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

      if ((event.code === 1006 || event.code === 1011) && reconnectCountRef.current < 3) {
        reconnectCountRef.current += 1;
        const backoff = 2000 * reconnectCountRef.current;
        reconnectTimeoutRef.current = setTimeout(() => {
          connectRef.current();
        }, backoff);
      } else {
        setState('error');
      }
    };

    wsRef.current = ws;
  }, [sessionId, dispatchOutput]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return useMemo(
    () => ({
      state,
      meta,
      exitInfo,
      send,
      resize,
      onData,
    }),
    [state, meta, exitInfo, send, resize, onData],
  );
}
