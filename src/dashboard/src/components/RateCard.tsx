import React from 'react'
import type { TokenType, SpreadData } from '../../../domain/types'

interface RateCardProps {
  token: TokenType
  rates: {
    bybit: number | null
    cngn_base: number | null
    cngn_bep20: number | null
  }
  spread?: SpreadData
}

const RateCard: React.FC<RateCardProps> = ({ token, rates, spread }) => {
  const formatRate = (rate: number | null) => {
    if (rate === null) return '--'
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(rate)
  }

  const formatSpread = (spread?: SpreadData) => {
    if (!spread) return '--'
    const sign = spread.direction === 'bybit_higher' ? '+' : '-'
    return `${sign}${spread.percentageSpread.toFixed(2)}%`
  }

  const getSpreadColor = (spread?: SpreadData) => {
    if (!spread) return 'text-gray-500'
    const absSpread = Math.abs(spread.percentageSpread)
    if (absSpread > 3) return 'text-red-500'
    if (absSpread > 1) return 'text-yellow-500'
    return 'text-green-500'
  }

  return (
    <div className="rate-card">
      <h3 className="token-title">{token}/NGN</h3>

      <div className="rate-sources">
        <div className="source-row">
          <span className="source-label">ByBit P2P</span>
          <span className="rate-value">{formatRate(rates.bybit)}</span>
        </div>

        <div className="source-row">
          <span className="source-label">CNGN Base</span>
          <span className="rate-value">{formatRate(rates.cngn_base)}</span>
        </div>

        <div className="source-row">
          <span className="source-label">CNGN BEP20</span>
          <span className="rate-value">{formatRate(rates.cngn_bep20)}</span>
        </div>
      </div>

      <div className="spread-info">
        <span className="spread-label">Spread:</span>
        <span className={`spread-value ${getSpreadColor(spread)}`}>
          {formatSpread(spread)}
        </span>
      </div>
    </div>
  )
}

export default RateCard