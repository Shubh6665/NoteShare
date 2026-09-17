import React from 'react';
import type { ConnectionStatus } from '../hooks/useWebSocket';

interface Props {
  status: ConnectionStatus;
  peerConnected: boolean;
  peerLabel?: string;
}

const STATUS_CONFIG = {
  connected: { color: '#22c55e', label: 'Connected' },
  connecting: { color: '#f59e0b', label: 'Connecting…' },
  reconnecting: { color: '#f59e0b', label: 'Reconnecting…' },
  disconnected: { color: '#ef4444', label: 'Disconnected' },
} as const;

export const ConnectionStatusIndicator = React.memo(function ConnectionStatusIndicator({
  status,
  peerConnected,
  peerLabel = 'Display',
}: Props) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="connection-status">
      <div className="status-item">
        <span
          className={`status-dot ${status === 'reconnecting' ? 'pulse' : ''}`}
          style={{ backgroundColor: config.color }}
        />
        <span className="status-label">{config.label}</span>
      </div>
      {status === 'connected' && (
        <div className="status-item">
          <span
            className="status-dot"
            style={{ backgroundColor: peerConnected ? '#22c55e' : '#6b7280' }}
          />
          <span className="status-label">
            {peerLabel}: {peerConnected ? 'Online' : 'Waiting…'}
          </span>
        </div>
      )}
    </div>
  );
});
