import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DisplaySettings {
  fontSize: number;
  lineHeight: number;
  wordWrap: boolean;
  plainText: boolean;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

const DEFAULT_SETTINGS: DisplaySettings = {
  fontSize: 22,
  lineHeight: 1.6,
  wordWrap: true,
  plainText: true,
};

const INITIAL_BACKOFF = 500;
const MAX_BACKOFF = 10000;

// ─── Deferred localStorage ──────────────────────────────────────────────────
// localStorage.setItem is SYNCHRONOUS and blocks the main thread.
// We defer writes so they don't sit in the critical path.

let _storageTimer: ReturnType<typeof setTimeout> | null = null;
const _storagePending = new Map<string, string>();

function deferredStorage(key: string, value: string) {
  _storagePending.set(key, value);
  if (_storageTimer !== null) return;
  _storageTimer = setTimeout(() => {
    _storageTimer = null;
    for (const [k, v] of _storagePending) {
      try { localStorage.setItem(k, v); } catch { /* full */ }
    }
    _storagePending.clear();
  }, 500); // write at most 2x per second — off the hot path
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseWebSocketOptions {
  onDirectContentUpdate?: (content: string, latencyMs?: number) => void;
}

export function useWebSocket(
  room: string,
  role: 'control' | 'display',
  options?: UseWebSocketOptions
) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [content, setContent] = useState<string>(() => {
    try { return localStorage.getItem(`noteshare_content_${room}`) || ''; }
    catch { return ''; }
  });
  const [settings, setSettings] = useState<DisplaySettings>(() => {
    try {
      const saved = localStorage.getItem(`noteshare_settings_${room}`);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
    } catch { return { ...DEFAULT_SETTINGS }; }
  });
  const [peerConnected, setPeerConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const contentRef = useRef(content);
  const onDirectUpdateRef = useRef(options?.onDirectContentUpdate);
  onDirectUpdateRef.current = options?.onDirectContentUpdate;

  // ── rAF send queue ────────────────────────────────────────────────────────
  const pendingContentRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (pendingContentRef.current !== null && wsRef.current?.readyState === WebSocket.OPEN) {
      // BINARY PROTOCOL: "T" + 13-digit timestamp + raw content
      // No JSON.stringify — just string concatenation
      wsRef.current.send('T' + Date.now() + pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(flushPending);
  }, [flushPending]);

  // ─── URL ──────────────────────────────────────────────────────────────────

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }, []);

  // ─── Connect ──────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
    }

    setStatus('connecting');
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus('connected');
      backoffRef.current = INITIAL_BACKOFF;
      // JOIN is cold path — JSON is fine
      ws.send(JSON.stringify({ type: 'JOIN', room, role }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      const receiveTime = Date.now();
      const data: string = event.data;

      // ── HOT PATH: Binary text protocol ────────────────────────────────
      // First char = "T" → format: "T" + 13-digit-ts + content
      // No JSON.parse needed — just string slicing
      if (data.charCodeAt(0) === 84 /* 'T' */) {
        const ts = parseInt(data.slice(1, 14), 10);
        const c = data.length > 14 ? data.slice(14) : '';
        const latencyMs = ts > 0 ? receiveTime - ts : undefined;

        contentRef.current = c;

        if (onDirectUpdateRef.current) {
          onDirectUpdateRef.current(c, latencyMs);
        } else {
          setContent(c);
        }

        // DEFERRED: localStorage write off the hot path
        deferredStorage(`noteshare_content_${room}`, c);
        return;
      }

      // ── COLD PATH: JSON messages ──────────────────────────────────────
      let msg: any;
      try { msg = JSON.parse(data); }
      catch { return; }

      switch (msg.type) {
        case 'SYNC': {
          const c = msg.content || '';
          contentRef.current = c;
          if (onDirectUpdateRef.current) {
            onDirectUpdateRef.current(c);
          } else {
            setContent(c);
          }
          setSettings(msg.settings || DEFAULT_SETTINGS);
          deferredStorage(`noteshare_content_${room}`, c);
          deferredStorage(`noteshare_settings_${room}`, JSON.stringify(msg.settings));
          break;
        }

        case 'SETTINGS_UPDATE': {
          const s = msg.settings || DEFAULT_SETTINGS;
          setSettings(s);
          deferredStorage(`noteshare_settings_${room}`, JSON.stringify(s));
          break;
        }

        case 'PEER_STATUS': {
          setPeerConnected(msg.connected);
          break;
        }
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setStatus('reconnecting');
      scheduleReconnect();
    };

    ws.onerror = () => {};
  }, [getWsUrl, room, role]);

  // ─── Reconnect ────────────────────────────────────────────────────────────

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
        connect();
      }
    }, backoffRef.current);
  }, [connect]);

  // ─── Send text IMMEDIATE (paste) ──────────────────────────────────────────
  // Paste = send NOW, no batching, binary protocol

  const sendText = useCallback((text: string) => {
    contentRef.current = text;
    setContent(text);
    deferredStorage(`noteshare_content_${room}`, text);

    // Cancel any pending rAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingContentRef.current = null;

    // BINARY PROTOCOL: immediate send
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send('T' + Date.now() + text);
    }
  }, [room]);

  // ─── Send text BATCHED (typing) ───────────────────────────────────────────
  // Queued via rAF — max ≤16ms wait

  const sendTextDebounced = useCallback((text: string) => {
    contentRef.current = text;
    setContent(text);
    deferredStorage(`noteshare_content_${room}`, text);

    pendingContentRef.current = text;
    scheduleFlush();
  }, [room, scheduleFlush]);

  // ─── Send settings (cold path, JSON) ──────────────────────────────────────

  const sendSettings = useCallback((newSettings: Partial<DisplaySettings>) => {
    setSettings(prev => {
      const merged = { ...prev, ...newSettings };
      deferredStorage(`noteshare_settings_${room}`, JSON.stringify(merged));
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'SETTINGS_UPDATE', settings: merged }));
      }
      return merged;
    });
  }, [room]);

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { status, content, settings, peerConnected, sendText, sendTextDebounced, sendSettings };
}
