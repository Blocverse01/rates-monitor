import React from 'react'
import type { VolatilityAlert } from '../../../domain/types'

interface AlertPanelProps {
  alerts: VolatilityAlert[]
}

const AlertPanel: React.FC<AlertPanelProps> = ({ alerts }) => {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString()
  }

  const formatChange = (change: number, changePercent: number) => {
    const sign = change >= 0 ? '+' : ''
    return `${sign}₦${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)`
  }

  return (
    <div className="alert-panel">
      <h3 className="panel-title">🚨 Recent Volatility Alerts</h3>

      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div className="no-alerts">
            <p>No recent alerts</p>
          </div>
        ) : (
          alerts.map((alert, index) => (
            <div key={index} className="alert-item">
              <div className="alert-header">
                <span className="alert-token">{alert.token}</span>
                <span className="alert-source">
                  {alert.source}{alert.tier ? ` • ${alert.tier}` : ''}
                </span>
                <span className="alert-time">{formatTime(alert.timestamp)}</span>
              </div>

              <div className="alert-details">
                <span className="alert-change">
                  {formatChange(alert.change, alert.changePercent)}
                </span>
                <span className="alert-rates">
                  ₦{alert.previousRate.toFixed(2)} → ₦{alert.currentRate.toFixed(2)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default AlertPanel