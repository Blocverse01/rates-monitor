import React from 'react'

interface ConnectionStatusProps {
  connected: boolean
  lastUpdate: number
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ connected, lastUpdate }) => {
  const formatLastUpdate = (timestamp: number) => {
    if (!timestamp) return 'Never'
    const now = Date.now()
    const diff = now - timestamp

    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    return `${Math.floor(diff / 3600000)}h ago`
  }

  return (
    <div className="connection-status">
      <div className={`status-indicator ${connected ? 'online' : 'offline'}`}>
        <div className="status-dot"></div>
        <span className="status-text">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div className="last-update">
        Last update: {formatLastUpdate(lastUpdate)}
      </div>
    </div>
  )
}

export default ConnectionStatus