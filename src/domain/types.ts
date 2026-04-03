import { Data } from "effect";

// ByBit P2P rate tiers — named after OTC/FX trading desk conventions
export type ByBitTier = "spot" | "desk" | "block";

export interface ByBitTieredRates {
  readonly spot: number | null; // ₦3K–₦100K  (retail/individual)
  readonly desk: number | null; // ₦100K–₦2M  (commercial/SME)
  readonly block: number | null; // ₦2M–₦10M   (wholesale/institutional)
  readonly blended: number | null; // IQR median across all tiers (≤₦10M maxAmount cap)
}

type ByBitRateResult = {
  readonly token: TokenType;
  readonly tiers: ByBitTieredRates;
  readonly timestamp: number;
};

type RateResult = {
  readonly token: TokenType;
  readonly rate: number;
  readonly timestamp: number;
};

type RateResultRecord = {
  ByBit: ByBitRateResult;
  CNGNBase: RateResult;
  CNGNBep20: RateResult;
};

export type TokenType = "USDT" | "USDC";
export type RateSource = keyof RateResultRecord;

export type CurrentRatesData = Record<
  TokenType,
  {
    bybit: ByBitTieredRates | null;
    cngn_base: number | null;
    cngn_bep20: number | null;
  }
>;

export type RateDataType = Data.TaggedEnum<RateResultRecord>;

interface RateResultEnumDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: RateDataType;
}

export const RateData = Data.taggedEnum<RateResultEnumDefinition>();

export interface SpreadData {
  readonly token: TokenType;
  readonly tier: ByBitTier | "blended";
  readonly chain: "base" | "bep20";
  readonly bybitRate: number;
  readonly cngnRate: number;
  readonly absoluteSpread: number;
  readonly percentageSpread: number;
  readonly direction: "bybit_higher" | "cngn_higher";
  readonly timestamp: number;
}

export interface VolatilityAlert {
  readonly token: TokenType;
  readonly source: RateSource;
  readonly tier?: ByBitTier | "blended";
  readonly change: number;
  readonly changePercent: number;
  readonly previousRate: number;
  readonly currentRate: number;
  readonly timestamp: number;
}

export interface AlertConfig {
  readonly spreadThreshold: number;
  readonly volatilityThreshold: number;
  readonly recipients: {
    readonly whatsapp: readonly string[];
    readonly email: readonly string[];
  };
}

// Historic rate data types
export interface HourlyRateSnapshot {
  readonly hour: number; // 0-23
  readonly timestamp: number;
  readonly rates: CurrentRatesData;
}

export interface DailyRateAverage {
  readonly date: string; // YYYY-MM-DD
  readonly rates: Record<
    TokenType,
    {
      readonly bybit: ByBitTieredRates | null;
      readonly cngn_base: number | null;
      readonly cngn_bep20: number | null;
    }
  >;
  readonly sampleCount: Record<
    TokenType,
    {
      readonly bybit: {
        readonly spot: number;
        readonly desk: number;
        readonly block: number;
        readonly blended: number;
      };
      readonly cngn_base: number;
      readonly cngn_bep20: number;
    }
  >;
}

export interface RateHistoryResponse {
  readonly days: readonly DailyRateAverage[];
  readonly totalDays: number;
}
