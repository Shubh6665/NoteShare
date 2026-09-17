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

  // ── rAF-based send queue ──────────────────────────────────────────────────
  // Instead of a fixed debounce, we batch within one animation frame (≤16ms).
  // This makes typing feel instant while never sending more than ~60 msgs/sec.
  const pendingContentRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (pendingContentRef.current !== null && wsRef.current?.readyState === WebSocket.OPEN) {
      // Include send-timestamp for latency measurement
      const msg = JSON.stringify({
        type: 'TEXT_UPDATE',
        content: pendingContentRef.current,
        ts: Date.now(),
      });
      wsRef.current.send(msg);
      pendingContentRef.current = null;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled this frame
    rafRef.current = requestAnimationFrame(flushPending);
  }, [flushPending]);

  // ─── URL ─────────────────────────────────────────────────────────────────

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }, []);

  // ─── Connect ─────────────────────────────────────────────────────────────

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
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus('connected');
      backoffRef.current = INITIAL_BACKOFF;
      ws.send(JSON.stringify({ type: 'JOIN', room, role }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      const receiveTime = Date.now(); // capture immediately on receive

      const data = typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer);

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
          try {
            localStorage.setItem(`noteshare_content_${room}`, c);
            localStorage.setItem(`noteshare_settings_${room}`, JSON.stringify(msg.settings));
          } catch { /* ignore */ }
          break;
        }

        case 'TEXT_UPDATE': {
          const c = msg.content || '';
          contentRef.current = c;

          // Calculate latency if sender embedded a timestamp
          const latencyMs = msg.ts ? receiveTime - msg.ts : undefined;

          if (onDirectUpdateRef.current) {
            onDirectUpdateRef.current(c, latencyMs);
          } else {
            setContent(c);
          }

          try { localStorage.setItem(`noteshare_content_${room}`, c); }
          catch { /* ignore */ }
          break;
        }

        case 'SETTINGS_UPDATE': {
          const s = msg.settings || DEFAULT_SETTINGS;
          setSettings(s);
          try { localStorage.setItem(`noteshare_settings_${room}`, JSON.stringify(s)); }
          catch { /* ignore */ }
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

    ws.onerror = () => { /* onclose handles it */ };
  }, [getWsUrl, room, role]);

  // ─── Reconnect ───────────────────────────────────────────────────────────

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
        connect();
      }
    }, backoffRef.current);
  }, [connect]);

  // ─── Send text (IMMEDIATE — paste) ───────────────────────────────────────
  // Paste: cancel any pending rAF, send right now with timestamp

  const sendText = useCallback((text: string) => {
    contentRef.current = text;
    setContent(text);
    try { localStorage.setItem(`noteshare_content_${room}`, text); }
    catch { /* ignore */ }

    // Cancel pending rAF flush
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingContentRef.current = null;

    // Send immediately with timestamp
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'TEXT_UPDATE',
        content: text,
        ts: Date.now(),
      }));
    }
  }, [room]);

  // ─── Send text (rAF batched — typing) ────────────────────────────────────
  // Queue update, flush on next animation frame (max ~16ms wait, not 150ms)

  const sendTextDebounced = useCallback((text: string) => {
    contentRef.current = text;
    setContent(text);
    try { localStorage.setItem(`noteshare_content_${room}`, text); }
    catch { /* ignore */ }

    pendingContentRef.current = text;
    scheduleFlush();
  }, [room, scheduleFlush]);

  // ─── Send settings ───────────────────────────────────────────────────────

  const sendSettings = useCallback((newSettings: Partial<DisplaySettings>) => {
    setSettings(prev => {
      const merged = { ...prev, ...newSettings };
      try { localStorage.setItem(`noteshare_settings_${room}`, JSON.stringify(merged)); }
      catch { /* ignore */ }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'SETTINGS_UPDATE', settings: merged }));
      }
      return merged;
    });
  }, [room]);

  // ─── Lifecycle ───────────────────────────────────────────────────────────

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
