import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { ConnectionStatusIndicator } from '../components/ConnectionStatus';
import { QRCodePanel } from '../components/QRCodePanel';
import { getRoomFromUrl } from '../utils/room';

export const ControlPage = React.memo(function ControlPage() {
  const room = useMemo(() => {
    const r = getRoomFromUrl();
    // Update URL if room was generated
    const params = new URLSearchParams(window.location.search);
    if (params.get('room') !== r) {
      const url = new URL(window.location.href);
      url.searchParams.set('room', r);
      window.history.replaceState({}, '', url.toString());
    }
    return r;
  }, []);

  const {
    status,
    content,
    settings,
    peerConnected,
    sendText,
    sendTextDebounced,
    sendSettings,
  } = useWebSocket(room, 'control');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain');
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const newContent = before + pastedText + after;

    // Immediate send — no debounce for paste
    sendText(newContent);

    // Set cursor position after paste
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = start + pastedText.length;
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
      }
    });
  }, [content, sendText]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    sendTextDebounced(e.target.value);
  }, [sendTextDebounced]);

  const handleClear = useCallback(() => {
    sendText('');
    textareaRef.current?.focus();
  }, [sendText]);

  const handleFontSize = useCallback((delta: number) => {
    const newSize = Math.max(12, Math.min(48, settings.fontSize + delta));
    sendSettings({ fontSize: newSize });
  }, [settings.fontSize, sendSettings]);

  const handleLineHeight = useCallback((delta: number) => {
    const newLH = Math.max(1.0, Math.min(3.0, Math.round((settings.lineHeight + delta) * 10) / 10));
    sendSettings({ lineHeight: newLH });
  }, [settings.lineHeight, sendSettings]);

  const toggleWordWrap = useCallback(() => {
    sendSettings({ wordWrap: !settings.wordWrap });
  }, [settings.wordWrap, sendSettings]);

  const togglePlainText = useCallback(() => {
    sendSettings({ plainText: !settings.plainText });
  }, [settings.plainText, sendSettings]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="control-page">
      {/* Header */}
      <header className="control-header">
        <h1 className="app-title">NoteShare</h1>
        <ConnectionStatusIndicator
          status={status}
          peerConnected={peerConnected}
          peerLabel="iPhone"
        />
      </header>

      {/* Main area: QR left + Textarea right */}
      <div className="control-main">
        <aside className="control-sidebar">
          <QRCodePanel room={room} />
        </aside>

        <div className="control-editor">
          <textarea
            ref={textareaRef}
            className="main-textarea"
            value={content}
            onChange={handleChange}
            onPaste={handlePaste}
            placeholder="Paste or type text here… It will appear on iPhone instantly."
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>

      {/* Controls */}
      <div className="controls-bar">
        <div className="control-group">
          <button className="btn" onClick={() => handleFontSize(-2)} title="Decrease font size" type="button">
            Font −
          </button>
          <span className="control-value">{settings.fontSize}px</span>
          <button className="btn" onClick={() => handleFontSize(2)} title="Increase font size" type="button">
            Font +
          </button>
        </div>

        <div className="control-group">
          <button className="btn" onClick={() => handleLineHeight(-0.2)} title="Decrease line height" type="button">
            Line −
          </button>
          <span className="control-value">{settings.lineHeight.toFixed(1)}</span>
          <button className="btn" onClick={() => handleLineHeight(0.2)} title="Increase line height" type="button">
            Line +
          </button>
        </div>

        <div className="control-group">
          <button
            className={`btn ${settings.wordWrap ? 'btn-active' : ''}`}
            onClick={toggleWordWrap}
            title="Toggle word wrap"
            type="button"
          >
            Wrap
          </button>
          <button
            className={`btn ${!settings.plainText ? 'btn-active' : ''}`}
            onClick={togglePlainText}
            title="Toggle formatted mode"
            type="button"
          >
            Formatted
          </button>
        </div>

        <div className="control-group">
          <button className="btn btn-danger" onClick={handleClear} title="Clear all text" type="button">
            Clear
          </button>
        </div>

        <div className="control-group-end">
          <span className="char-count">{content.length.toLocaleString()} chars</span>
        </div>
      </div>
    </div>
  );
});
