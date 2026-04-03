import { Context, Layer } from "effect";
import type {
  TokenType,
  SpreadData,
  CurrentRatesData,
  ByBitTier,
} from "../domain/types";

const TIERS: Array<ByBitTier | "blended"> = ["spot", "desk", "block", "blended"];

const computeSpread = (
  bybitRate: number,
  cngnRate: number,
  token: TokenType,
  tier: ByBitTier | "blended",
  chain: "base" | "bep20"
): SpreadData => {
  const absoluteSpread = Math.abs(bybitRate - cngnRate);
  const percentageSpread = (absoluteSpread / bybitRate) * 100;
  return {
    token,
    tier,
    chain,
    bybitRate,
    cngnRate,
    absoluteSpread,
    percentageSpread,
    direction: bybitRate > cngnRate ? "bybit_higher" : "cngn_higher",
    timestamp: Date.now(),
  };
};

export class SpreadCalculatorService extends Context.Tag(
  "SpreadCalculatorService"
)<
  SpreadCalculatorService,
  {
    readonly calculateSpread: (
      bybitRate: number,
      cngnRate: number,
      token: TokenType,
      tier: ByBitTier | "blended",
      chain: "base" | "bep20"
    ) => SpreadData;
    readonly calculateAllSpreads: (
      rates: CurrentRatesData
    ) => readonly SpreadData[];
  }
>() {
  static readonly Live = Layer.succeed(
    SpreadCalculatorService,
    SpreadCalculatorService.of({
      calculateSpread: computeSpread,

      calculateAllSpreads: (rates) => {
        const spreads: SpreadData[] = [];

        for (const [token, data] of Object.entries(rates)) {
          // Guard against null and legacy plain-number values stored before tiered rates
          if (data.bybit === null || typeof data.bybit !== "object") continue;

          for (const tier of TIERS) {
            const bybitRate = data.bybit[tier];
            // Use loose equality to catch both null and undefined (stale tier data)
            if (bybitRate == null) continue;

            if (data.cngn_base !== null) {
              spreads.push(
                computeSpread(bybitRate, data.cngn_base, token as TokenType, tier, "base")
              );
            }

            if (data.cngn_bep20 !== null) {
              spreads.push(
                computeSpread(bybitRate, data.cngn_bep20, token as TokenType, tier, "bep20")
              );
            }
          }
        }

        return spreads;
      },
    })
  );
}
