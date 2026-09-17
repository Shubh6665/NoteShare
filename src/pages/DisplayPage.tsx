import React, { useMemo, useRef, useCallback, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { FormattedText } from '../components/FormattedText';

export const DisplayPage = React.memo(function DisplayPage() {
  const room = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '';
  }, []);

  // PERF: Direct DOM ref — bypasses React for text updates
  const preRef = useRef<HTMLPreElement>(null);
  // Track content for formatted mode (needs React re-render)
  const [formattedContent, setFormattedContent] = useState('');
  const hasContentRef = useRef(false);
  const waitingRef = useRef<HTMLDivElement>(null);

  /**
   * PERF CRITICAL: This callback fires on every TEXT_UPDATE.
   * Instead of: WebSocket → setState → React render → vDOM diff → DOM update
   * We do:      WebSocket → direct textContent set
   * 
   * This skips React's entire reconciliation cycle.
   * For a simple text node, React's diff is fast, but this is ZERO overhead.
   */
  const handleDirectUpdate = useCallback((content: string) => {
    // Direct DOM update for plain text (the hot path)
    if (preRef.current) {
      preRef.current.textContent = content;
    }

    // Also update formatted content state (only re-renders when formatted mode is active)
    setFormattedContent(content);

    // Show/hide waiting message
    if (waitingRef.current) {
      waitingRef.current.style.display = content ? 'none' : '';
    }
    if (preRef.current) {
      preRef.current.style.display = content ? '' : 'none';
    }
    hasContentRef.current = !!content;
  }, []);

  const { status, settings } = useWebSocket(room, 'display', {
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
      {/* Connection indicator */}
      {status !== 'connected' && (
        <div className="display-status">
          <span className="status-dot pulse" style={{
            backgroundColor: status === 'reconnecting' ? '#f59e0b' : '#ef4444'
          }} />
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

      {/* Formatted mode — needs React for markdown parsing */}
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

      {/* Waiting state */}
      <div
        ref={waitingRef}
        className="display-waiting"
        style={{ display: hasContentRef.current ? 'none' : '' }}
      >
        <p className="display-message">Waiting for text…</p>
        <p className="display-sub">Paste something on Mac to see it here.</p>
      </div>
    </div>
  );
});
