import React, { useMemo, useRef, useCallback, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { FormattedText } from '../components/FormattedText';

// ── Latency Meter ─────────────────────────────────────────────────────────────
// Small overlay in corner showing real-time one-way latency.
// Green < 30ms | Yellow 30-100ms | Red > 100ms

const LatencyMeter = React.memo(function LatencyMeter({
  latency,
}: {
  latency: number | null;
}) {
  if (latency === null) return null;

  const color =
    latency < 30 ? '#22c55e'
    : latency < 100 ? '#f59e0b'
    : '#ef4444';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        background: 'rgba(0,0,0,0.7)',
        color,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 11,
        padding: '4px 8px',
        borderRadius: 6,
        zIndex: 999,
        backdropFilter: 'blur(4px)',
        border: `1px solid ${color}33`,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      ⚡ {latency}ms
    </div>
  );
});

// ── Display Page ──────────────────────────────────────────────────────────────

export const DisplayPage = React.memo(function DisplayPage() {
  const room = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '';
  }, []);

  // Direct DOM ref — bypasses React for the hot text-update path
  const preRef = useRef<HTMLPreElement>(null);
  const [formattedContent, setFormattedContent] = useState('');
  const hasContentRef = useRef(false);
  const waitingRef = useRef<HTMLDivElement>(null);

  // Latency tracking (rolling last-5 average for stability)
  const [latency, setLatency] = useState<number | null>(null);
  const latencyBuf = useRef<number[]>([]);

  /**
   * HOT PATH: called directly from WebSocket onmessage.
   * No React setState for content — just set textContent on the DOM node.
   * Also updates latency meter.
   */
  const handleDirectUpdate = useCallback((content: string, latencyMs?: number) => {
    // 1. Direct DOM write (plain text)
    if (preRef.current) {
      preRef.current.textContent = content;
    }

    // 2. Update formatted content (only re-renders in formatted mode)
    setFormattedContent(content);

    // 3. Show/hide waiting overlay
    if (waitingRef.current) {
      waitingRef.current.style.display = content ? 'none' : '';
    }
    if (preRef.current) {
      preRef.current.style.display = content ? '' : 'none';
    }
    hasContentRef.current = !!content;

    // 4. Update latency meter (rolling average of last 5 measurements)
    if (latencyMs !== undefined && latencyMs >= 0 && latencyMs < 5000) {
      latencyBuf.current.push(latencyMs);
      if (latencyBuf.current.length > 5) latencyBuf.current.shift();
      const avg = Math.round(
        latencyBuf.current.reduce((a, b) => a + b, 0) / latencyBuf.current.length
      );
      setLatency(avg);
    }
  }, []);

  const { status, settings } = useWebSocket(room, 'display', {
    onDirectContentUpdate: handleDirectUpdate,
  });

  if (!room) {
    return (
      <div className="display-container display-empty">
        <p className="display-message">No room specified.</p>
        <p className="display-sub">
          Add <code>?room=XXXX-00</code> to the URL.
        </p>
      </div>
    );
  }

  return (
    <div className="display-container">
      {/* Connection status */}
      {status !== 'connected' && (
        <div className="display-status">
          <span
            className="status-dot pulse"
            style={{ backgroundColor: status === 'reconnecting' ? '#f59e0b' : '#ef4444' }}
          />
          <span>{status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
        </div>
      )}

      {/* Plain text — direct DOM, zero React overhead */}
      {settings.plainText && (
        <pre
          ref={preRef}
          className="display-text"
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            whiteSpace: settings.wordWrap ? 'pre-wrap' : 'pre',
            wordWrap: settings.wordWrap ? 'break-word' : 'normal',
            overflowWrap: settings.wordWrap ? 'break-word' : 'normal',
            display: hasContentRef.current ? '' : 'none',
          }}
        />
      )}

      {/* Formatted mode */}
      {!settings.plainText && formattedContent && (
        <div
          className="display-formatted"
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
          }}
        >
          <FormattedText content={formattedContent} />
        </div>
      )}

      {/* Waiting placeholder */}
      <div
        ref={waitingRef}
        className="display-waiting"
        style={{ display: hasContentRef.current ? 'none' : '' }}
      >
        <p className="display-message">Waiting for text…</p>
        <p className="display-sub">Paste something on Mac to see it here.</p>
      </div>

      {/* Latency meter overlay */}
      <LatencyMeter latency={latency} />
    </div>
  );
});
