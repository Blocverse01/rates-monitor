import { Context, Layer } from "effect";
import type { TokenType, SpreadData, CurrentRatesData } from "../domain/types";

export class SpreadCalculatorService extends Context.Tag(
  "SpreadCalculatorService"
)<
  SpreadCalculatorService,
  {
    readonly calculateSpread: (
      bybitRate: number,
      cngnRate: number,
      token: TokenType
    ) => SpreadData;
    readonly calculateAllSpreads: (
      rates: CurrentRatesData
    ) => readonly SpreadData[];
  }
>() {
  static readonly Live = Layer.succeed(
    SpreadCalculatorService,
    SpreadCalculatorService.of({
      calculateSpread: (bybitRate, cngnRate, token) => {
        const absoluteSpread = Math.abs(bybitRate - cngnRate);
        const percentageSpread = (absoluteSpread / bybitRate) * 100;

        return {
          token,
          bybitRate,
          cngnRate,
          absoluteSpread,
          percentageSpread,
          direction: bybitRate > cngnRate ? "bybit_higher" : "cngn_higher",
          timestamp: Date.now(),
        };
      },

      calculateAllSpreads: (rates) => {
        const spreads: SpreadData[] = [];

        for (const [token, data] of Object.entries(rates)) {
          // Calculate spread for ByBit vs CNGN Base
          if (data.bybit !== null && data.cngn_base !== null) {
            spreads.push(
              SpreadCalculatorService.of({
                calculateSpread: (b, c, t) => ({
                  token: t,
                  bybitRate: b,
                  cngnRate: c,
                  absoluteSpread: Math.abs(b - c),
                  percentageSpread: (Math.abs(b - c) / b) * 100,
                  direction: b > c ? "bybit_higher" : "cngn_higher",
                  timestamp: Date.now(),
                }),
                calculateAllSpreads: () => [],
              }).calculateSpread(data.bybit, data.cngn_base, token as TokenType)
            );
          }

          // Calculate spread for ByBit vs CNGN BEP20
          if (data.bybit !== null && data.cngn_bep20 !== null) {
            spreads.push(
              SpreadCalculatorService.of({
                calculateSpread: (b, c, t) => ({
                  token: t,
                  bybitRate: b,
                  cngnRate: c,
                  absoluteSpread: Math.abs(b - c),
                  percentageSpread: (Math.abs(b - c) / b) * 100,
                  direction: b > c ? "bybit_higher" : "cngn_higher",
                  timestamp: Date.now(),
                }),
                calculateAllSpreads: () => [],
              }).calculateSpread(
                data.bybit,
                data.cngn_bep20,
                token as TokenType
              )
            );
          }
        }

        return spreads;
      },
    })
  );
}
