import { Context, Effect, Layer } from "effect";
import { RedisService } from "../infrastructure/RedisService";
import type { DailyRateAverage, TokenType, ByBitTieredRates } from "../domain/types";
import type { StorageError } from "../domain/errors";

const BYBIT_TIERS = ["spot", "desk", "block", "blended"] as const;

export class DailyAggregationService extends Context.Tag(
  "DailyAggregationService"
)<
  DailyAggregationService,
  {
    readonly aggregateDay: (date: string) => Effect.Effect<void, StorageError>;
    readonly aggregateYesterday: () => Effect.Effect<void, StorageError>;
  }
>() {
  static readonly Live = Layer.effect(
    DailyAggregationService,
    Effect.gen(function* () {
      const redis = yield* RedisService;

      const aggregateDay = (date: string): Effect.Effect<void, StorageError> =>
        Effect.gen(function* () {
          const hourlySnapshots = yield* redis.getHourlySnapshots(date);

          if (hourlySnapshots.length === 0) {
            console.log(`No hourly snapshots found for ${date}`);
            return;
          }

          console.log(
            `Aggregating ${hourlySnapshots.length} hourly snapshots for ${date}`
          );

          const tokens: TokenType[] = ["USDT", "USDC"];

          const rates: Record<
            TokenType,
            {
              bybit: ByBitTieredRates | null;
              cngn_base: number | null;
              cngn_bep20: number | null;
            }
          > = {} as any;

          const sampleCount: Record<
            TokenType,
            {
              bybit: { spot: number; desk: number; block: number; blended: number };
              cngn_base: number;
              cngn_bep20: number;
            }
          > = {} as any;

          // Initialize accumulators
          for (const token of tokens) {
            rates[token] = { bybit: null, cngn_base: null, cngn_bep20: null };
            sampleCount[token] = {
              bybit: { spot: 0, desk: 0, block: 0, blended: 0 },
              cngn_base: 0,
              cngn_bep20: 0,
            };
          }

          const accumulators: Record<string, number[]> = {};

          // Accumulate values
          for (const snapshot of hourlySnapshots) {
            for (const token of tokens) {
              const tokenRates = snapshot.rates[token];

              // ByBit tiers — snapshots written before this feature will have
              // bybit as a plain number; guard both shapes gracefully.
              const bybit = tokenRates.bybit;
              if (bybit !== null && bybit !== undefined) {
                if (typeof bybit === "number") {
                  // Legacy snapshot — treat as blended only
                  const key = `${token}_bybit_blended`;
                  if (!accumulators[key]) accumulators[key] = [];
                  accumulators[key]!.push(bybit);
                  sampleCount[token].bybit.blended++;
                } else {
                  for (const tier of BYBIT_TIERS) {
                    const v = (bybit as ByBitTieredRates)[tier];
                    if (v !== null && v !== undefined) {
                      const key = `${token}_bybit_${tier}`;
                      if (!accumulators[key]) accumulators[key] = [];
                      accumulators[key]!.push(v);
                      sampleCount[token].bybit[tier]++;
                    }
                  }
                }
              }

              if (tokenRates.cngn_base !== null) {
                const key = `${token}_cngn_base`;
                if (!accumulators[key]) accumulators[key] = [];
                accumulators[key]!.push(tokenRates.cngn_base);
                sampleCount[token].cngn_base++;
              }

              if (tokenRates.cngn_bep20 !== null) {
                const key = `${token}_cngn_bep20`;
                if (!accumulators[key]) accumulators[key] = [];
                accumulators[key]!.push(tokenRates.cngn_bep20);
                sampleCount[token].cngn_bep20++;
              }
            }
          }

          // Calculate averages
          for (const token of tokens) {
            // ByBit tiers
            const tierAverages: Record<string, number | null> = {};
            let hasAnyTier = false;
            for (const tier of BYBIT_TIERS) {
              const values = accumulators[`${token}_bybit_${tier}`];
              if (values && values.length > 0) {
                tierAverages[tier] = values.reduce((a, b) => a + b, 0) / values.length;
                hasAnyTier = true;
              } else {
                tierAverages[tier] = null;
              }
            }
            rates[token].bybit = hasAnyTier
              ? {
                  spot:    tierAverages["spot"]    ?? null,
                  desk:    tierAverages["desk"]    ?? null,
                  block:   tierAverages["block"]   ?? null,
                  blended: tierAverages["blended"] ?? null,
                }
              : null;

            const cngnBaseValues = accumulators[`${token}_cngn_base`];
            if (cngnBaseValues && cngnBaseValues.length > 0) {
              rates[token].cngn_base =
                cngnBaseValues.reduce((a, b) => a + b, 0) / cngnBaseValues.length;
            }

            const cngnBep20Values = accumulators[`${token}_cngn_bep20`];
            if (cngnBep20Values && cngnBep20Values.length > 0) {
              rates[token].cngn_bep20 =
                cngnBep20Values.reduce((a, b) => a + b, 0) / cngnBep20Values.length;
            }
          }

          const dailyAverage: DailyRateAverage = {
            date,
            rates,
            sampleCount,
          };

          yield* redis.setDailyAverage(dailyAverage);
          yield* redis.deleteHourlySnapshots(date);

          console.log(`Daily average stored for ${date}:`, {
            sampleCounts: sampleCount,
            averages: Object.fromEntries(
              Object.entries(rates).map(([token, tokenRates]) => [
                token,
                {
                  bybit: tokenRates.bybit,
                  cngn_base: tokenRates.cngn_base ? Math.round(tokenRates.cngn_base * 100) / 100 : null,
                  cngn_bep20: tokenRates.cngn_bep20 ? Math.round(tokenRates.cngn_bep20 * 100) / 100 : null,
                },
              ])
            ),
          });
        });

      const aggregateYesterday = (): Effect.Effect<void, StorageError> =>
        Effect.gen(function* () {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const dateStr = yesterday.toISOString().split("T")[0]!;

          yield* aggregateDay(dateStr);
        });

      return { aggregateDay, aggregateYesterday };
    })
  );
}
