import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'react-qr-code';

interface Props {
  room: string;
}

/**
 * Checks if the app is running on localhost / local network.
 * If yes → fetch LAN IP from server so iPhone can connect.
 * If no (deployed on Render/domain) → use window.location.origin directly.
 */
function isLocalhost(): boolean {
  const h = window.location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.startsWith('192.168.') ||
    h.startsWith('10.') ||
    h.startsWith('172.')
  );
}

export const QRCodePanel = React.memo(function QRCodePanel({ room }: Props) {
  const [lanIP, setLanIP] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const local = useMemo(() => isLocalhost(), []);

  useEffect(() => {
    if (!local) return; // deployed → no need to fetch LAN IP
    fetch('/api/ip')
      .then(res => res.json())
      .then(data => setLanIP(data.ip))
      .catch(() => setLanIP(window.location.hostname));
  }, [local]);

  // Build the correct display URL:
  // - Local: http://{LAN_IP}:{port}/display?room=...  (so iPhone on same Wi-Fi can reach Mac)
  // - Deployed: https://noteshare.shubhis.me/display?room=...  (public domain)
  const displayUrl = useMemo(() => {
    if (!local) {
      // Deployed — always use the real origin (includes https:// and domain)
      return `${window.location.origin}/display?room=${room}`;
    }
    // Local — wait for LAN IP, then build with port
    if (!lanIP) return '';
    const port = window.location.port;
    const portStr = port ? `:${port}` : '';
    return `http://${lanIP}${portStr}/display?room=${room}`;
  }, [local, lanIP, room]);

  const handleCopy = async () => {
    if (!displayUrl) return;
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = displayUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="qr-panel">
      <div className="qr-header">
        <span className="qr-title">Display on iPhone</span>
        <span className="room-badge">Room: {room}</span>
      </div>
      <div className="qr-body">
        <div className="qr-code-wrapper">
          {displayUrl ? (
            <QRCode
              value={displayUrl}
              size={160}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
            />
          ) : (
            <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 12 }}>
              Loading…
            </div>
          )}
        </div>
        <div className="qr-info">
          <p className="qr-instruction">Scan with iPhone camera to open display</p>
          <div className="url-row">
            <code className="display-url">{displayUrl || 'Loading…'}</code>
            <button
              className="btn btn-small"
              onClick={handleCopy}
              type="button"
              disabled={!displayUrl}
            >
              {copied ? '✓ Copied' : 'Copy URL'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
