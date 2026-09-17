import React, { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';

interface Props {
  room: string;
}

export const QRCodePanel = React.memo(function QRCodePanel({ room }: Props) {
  const [lanIP, setLanIP] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/ip')
      .then(res => res.json())
      .then(data => setLanIP(data.ip))
      .catch(() => setLanIP(window.location.hostname));
  }, []);

  const displayUrl = lanIP
    ? `http://${lanIP}:${window.location.port}/display?room=${room}`
    : `${window.location.origin}/display?room=${room}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
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
          <QRCode
            value={displayUrl}
            size={160}
            bgColor="#ffffff"
            fgColor="#000000"
            level="M"
          />
        </div>
        <div className="qr-info">
          <p className="qr-instruction">Scan with iPhone camera to open display</p>
          <div className="url-row">
            <code className="display-url">{displayUrl}</code>
            <button
              className="btn btn-small"
              onClick={handleCopy}
              type="button"
            >
              {copied ? '✓ Copied' : 'Copy URL'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
