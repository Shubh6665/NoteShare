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

const INITIAL_BACKOFF = 500;   // Start faster
const MAX_BACKOFF = 10000;

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseWebSocketOptions {
  /**
   * PERF: Direct DOM update callback for display page.
   * When provided, TEXT_UPDATE content is passed here INSTEAD of
   * going through React state → re-render → reconcile → DOM.
   * This bypasses React entirely for the hot path.
   */
  onDirectContentUpdate?: (content: string) => void;
}

export function useWebSocket(
  room: string,
  role: 'control' | 'display',
  options?: UseWebSocketOptions
) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [content, setContent] = useState<string>(() => {
    try {
      return localStorage.getItem(`noteshare_content_${room}`) || '';
    } catch {
      return '';
    }
  });
  const [settings, setSettings] = useState<DisplaySettings>(() => {
    try {
      const saved = localStorage.getItem(`noteshare_settings_${room}`);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });
  const [peerConnected, setPeerConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content); // PERF: avoid stale closures
  const onDirectUpdateRef = useRef(options?.onDirectContentUpdate);

  // Keep refs fresh
  onDirectUpdateRef.current = options?.onDirectContentUpdate;

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

    // PERF: Set binary type to arraybuffer for faster parsing
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus('connected');
      backoffRef.current = INITIAL_BACKOFF;
      ws.send(JSON.stringify({ type: 'JOIN', room, role }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;

      // PERF: Parse once, act fast
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      let msg: any;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'SYNC': {
          const c = msg.content || '';
          contentRef.current = c;

          // Direct DOM update if available (display page)
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

          // PERF: Direct DOM path — skip React state entirely
          if (onDirectUpdateRef.current) {
            onDirectUpdateRef.current(c);
          } else {
            setContent(c);
          }

          try {
            localStorage.setItem(`noteshare_content_${room}`, c);
          } catch { /* ignore */ }
          break;
        }

        case 'SETTINGS_UPDATE': {
          const s = msg.settings || DEFAULT_SETTINGS;
          setSettings(s);
          try {
            localStorage.setItem(`noteshare_settings_${room}`, JSON.stringify(s));
          } catch { /* ignore */ }
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

  // ─── Send text (immediate — paste) ──────────────────────────────────────

  const sendText = useCallback((text: string) => {
    contentRef.current = text;
    setContent(text);
    try {
      localStorage.setItem(`noteshare_content_${room}`, text);
    } catch { /* ignore */ }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'TEXT_UPDATE', content: text }));
    }
  }, [room]);

  // ─── Send text debounced (typing) ────────────────────────────────────────

  const sendTextDebounced = useCallback((text: string) => {
    contentRef.current = text;
    setContent(text);
    try {
      localStorage.setItem(`noteshare_content_${room}`, text);
    } catch { /* ignore */ }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'TEXT_UPDATE', content: contentRef.current }));
      }
    }, 150);
  }, [room]);

  // ─── Send settings ──────────────────────────────────────────────────────

  const sendSettings = useCallback((newSettings: Partial<DisplaySettings>) => {
    setSettings(prev => {
      const merged = { ...prev, ...newSettings };
      try {
        localStorage.setItem(`noteshare_settings_${room}`, JSON.stringify(merged));
      } catch { /* ignore */ }

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
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    status,
    content,
    settings,
    peerConnected,
    sendText,
    sendTextDebounced,
    sendSettings,
  };
}
