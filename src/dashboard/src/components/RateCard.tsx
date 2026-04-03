import React from 'react'
import type { TokenType, SpreadData, ByBitTieredRates } from '../../../domain/types'

interface RateCardProps {
  token: TokenType
  rates: {
    bybit: ByBitTieredRates | null
    cngn_base: number | null
    cngn_bep20: number | null
  }
  spreads: SpreadData[]
}

const RateCard: React.FC<RateCardProps> = ({ token, rates, spreads }) => {
  const formatRate = (rate: number | null) => {
    if (rate === null) return '--'
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(rate)
  }

  // Primary spread shown in the headline — blended ByBit vs the relevant CNGN chain
  const primaryChain = token === 'USDT' ? 'bep20' : 'base'
  const blendedSpread = spreads.find(
    (s) => s.tier === 'blended' && s.chain === primaryChain
  )

  const formatSpread = (spread?: SpreadData) => {
    if (!spread) return '--'
    const nairaSpread = Math.abs(spread.bybitRate - spread.cngnRate)
    const sign = spread.direction === 'bybit_higher' ? '+' : '-'
    return `₦${nairaSpread.toFixed(2)} (${sign}${spread.percentageSpread.toFixed(2)}%)`
  }

  const getSpreadColor = (spread?: SpreadData) => {
    if (!spread) return 'text-gray-500'
    const absSpread = Math.abs(spread.percentageSpread)
    if (absSpread > 3) return 'text-red-500'
    if (absSpread > 1) return 'text-yellow-500'
    return 'text-green-500'
  }

  const bybitTiers: Array<{ key: keyof ByBitTieredRates; label: string; range: string }> = [
    { key: 'spot',    label: 'Spot',    range: '₦3K–₦100K'  },
    { key: 'desk',    label: 'Desk',    range: '₦100K–₦2M'  },
    { key: 'block',   label: 'Block',   range: '₦2M–₦10M'   },
    { key: 'blended', label: 'Blended', range: 'all tiers'  },
  ]

  return (
    <div className="rate-card">
      <h3 className="token-title">{token}/NGN</h3>

      <div className="rate-sources">
        <div className="source-section-header">ByBit P2P</div>

        {bybitTiers.map(({ key, label, range }) => (
          <div key={key} className={`source-row ${key === 'blended' ? 'source-row-blended' : 'source-row-tier'}`}>
            <span className="source-label">
              {label}
              <span className="tier-range">{range}</span>
            </span>
            <span className="rate-value">
              {formatRate(rates.bybit?.[key] ?? null)}
            </span>
          </div>
        ))}

        <div className="source-divider" />

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
        <span className="spread-label">Blended Spread:</span>
        <span className={`spread-value ${getSpreadColor(blendedSpread)}`}>
          {formatSpread(blendedSpread)}
        </span>
      </div>

      {blendedSpread && (
        <div className="spread-direction">
          <span className="spread-label">Direction:</span>
          <span className="direction-text">
            {blendedSpread.direction.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      )}
    </div>
  )
}

export default RateCard
