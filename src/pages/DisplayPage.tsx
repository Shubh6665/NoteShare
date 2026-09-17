import React, { useMemo, useRef, useCallback, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { FormattedText } from '../components/FormattedText';

// ── Latency Meter ─────────────────────────────────────────────────────────────
// RTT-based measurement. Green < 50ms | Yellow 50-150ms | Red > 150ms

const LatencyMeter = React.memo(function LatencyMeter({ rttMs }: { rttMs: number | null }) {
  if (rttMs === null) return null;

  const oneWay = Math.round(rttMs / 2);
  const color = rttMs < 50 ? '#22c55e' : rttMs < 150 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{
      position: 'fixed',
      bottom: 12,
      right: 12,
      background: 'rgba(0,0,0,0.75)',
      color,
      fontFamily: 'ui-monospace, Menlo, monospace',
      fontSize: 11,
      padding: '4px 10px',
      borderRadius: 6,
      zIndex: 999,
      backdropFilter: 'blur(4px)',
      border: `1px solid ${color}33`,
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      ⚡ {oneWay}ms ↕{rttMs}ms
    </div>
  );
});

// ── Display Page ──────────────────────────────────────────────────────────────

export const DisplayPage = React.memo(function DisplayPage() {
  const room = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '';
  }, []);

  const preRef = useRef<HTMLPreElement>(null);
  const [formattedContent, setFormattedContent] = useState('');
  const hasContentRef = useRef(false);
  const waitingRef = useRef<HTMLDivElement>(null);

  const handleDirectUpdate = useCallback((content: string) => {
    if (preRef.current) preRef.current.textContent = content;
    setFormattedContent(content);

    if (waitingRef.current) waitingRef.current.style.display = content ? 'none' : '';
    if (preRef.current) preRef.current.style.display = content ? '' : 'none';
    hasContentRef.current = !!content;
  }, []);

  const { status, settings, rttMs } = useWebSocket(room, 'display', {
    onDirectContentUpdate: handleDirectUpdate,
  });

  if (!room) {
    return (
      <div className="display-container display-empty">
        <p className="display-message">No room specified.</p>
        <p className="display-sub">Add <code>?room=XXXX-00</code> to the URL.</p>
      </div>
    );
  }

  return (
    <div className="display-container">
      {status !== 'connected' && (
        <div className="display-status">
          <span className="status-dot pulse" style={{
            backgroundColor: status === 'reconnecting' ? '#f59e0b' : '#ef4444'
          }} />
          <span>{status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
        </div>
      )}

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

      {!settings.plainText && formattedContent && (
        <div className="display-formatted" style={{
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineHeight,
        }}>
          <FormattedText content={formattedContent} />
        </div>
      )}

      <div ref={waitingRef} className="display-waiting"
        style={{ display: hasContentRef.current ? 'none' : '' }}>
        <p className="display-message">Waiting for text…</p>
        <p className="display-sub">Paste something on Mac to see it here.</p>
      </div>

      <LatencyMeter rttMs={rttMs} />
    </div>
  );
});
