import { Context, Effect, Layer } from "effect";
import { ByBitService } from "./ByBitService";
import { BlockradarService, type ChainType } from "./BlockradarService";
import { RedisService } from "../infrastructure/RedisService";
import {
  RateData,
  type RateDataType,
  type TokenType,
  type CurrentRatesData,
} from "../domain/types";
import type { RateFetchError, StorageError } from "../domain/errors";

export class RateFetcherService extends Context.Tag("RateFetcherService")<
  RateFetcherService,
  {
    readonly fetchAllRates: () => Effect.Effect<
      readonly RateDataType[],
      RateFetchError | StorageError
    >;
    readonly getCurrentRates: () => Effect.Effect<
      CurrentRatesData,
      StorageError
    >;
  }
>() {
  static readonly Live = Layer.effect(
    RateFetcherService,
    Effect.gen(function* () {
      const bybit = yield* ByBitService;
      const blockradar = yield* BlockradarService;
      const redis = yield* RedisService;

      const fetchAllRates = (): Effect.Effect<
        readonly RateDataType[],
        RateFetchError | StorageError
      > =>
        Effect.gen(function* () {
          const tokens: TokenType[] = ["USDT", "USDC"];
          const rates: RateDataType[] = [];

          for (const token of tokens) {
            // Fetch ByBit rate (merchants buying USDT - our sell rate to users)
            const bybitRate = yield* Effect.catchAll(
              bybit.getBestRate(token, 0),
              (error) => {
                console.error(`ByBit fetch error for ${token}:`, error);
                return Effect.succeed(null);
              }
            );

            if (bybitRate !== null) {
              rates.push(
                RateData.ByBit({
                  token,
                  rate: bybitRate,
                  timestamp: Date.now(),
                })
              );

              yield* redis.setNumber(`rate:bybit:${token}`, bybitRate, 60);
            }

            // Fetch CNGN rates from different chains
            const chains: ChainType[] = ["BASE", "BEP20"];

            for (const chain of chains) {
              // Skip unsupported combinations
              if (chain === "BASE" && token === "USDT") continue;

              const cngnQuote = yield* Effect.catchAll(
                blockradar.getCNGNQuote(token, chain),
                (error) => {
                  console.error(
                    `CNGN ${chain} fetch error for ${token}:`,
                    error
                  );
                  return Effect.succeed(null);
                }
              );

              if (cngnQuote !== null) {
                const rateDataKey = chain === "BASE" ? "CNGNBase" : "CNGNBep20";
                rates.push(
                  RateData[rateDataKey]({
                    token,
                    rate: cngnQuote.rate,
                    timestamp: cngnQuote.timestamp,
                  })
                );

                const redisKey = `rate:cngn_${chain.toLowerCase()}:${token}`;
                yield* redis.setNumber(redisKey, cngnQuote.rate, 60);
              }
            }
          }

          // Store hourly snapshot
          const now = new Date();
          const dateStr = now.toISOString().split("T")[0]!;
          const hour = now.getHours();

          const currentRates = yield* getCurrentRates();
          yield* redis.setHourlySnapshot(dateStr, hour, currentRates);

          return rates;
        });

      const getCurrentRates = (): Effect.Effect<
        CurrentRatesData,
        StorageError
      > =>
        Effect.gen(function* () {
          const tokens: TokenType[] = ["USDT", "USDC"];
          const result: Record<string, any> = {};

          for (const token of tokens) {
            const bybitRate = yield* redis.getNumber(`rate:bybit:${token}`);
            const cngnBaseRate = yield* redis.getNumber(
              `rate:cngn_base:${token}`
            );
            const cngnBep20Rate = yield* redis.getNumber(
              `rate:cngn_bep20:${token}`
            );

            result[token] = {
              bybit: bybitRate,
              cngn_base: cngnBaseRate,
              cngn_bep20: cngnBep20Rate,
            };
          }

          return result as CurrentRatesData;
        });

      return { fetchAllRates, getCurrentRates };
    })
  );
}
