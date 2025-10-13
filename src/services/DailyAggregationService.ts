import { Context, Effect, Layer } from "effect";
import { RedisService } from "../infrastructure/RedisService";
import type { DailyRateAverage, TokenType } from "../domain/types";
import type { StorageError } from "../domain/errors";

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
          // Get all hourly snapshots for the day
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
              bybit: number | null;
              cngn_base: number | null;
              cngn_bep20: number | null;
            }
          > = {} as any;

          const sampleCount: Record<
            TokenType,
            {
              bybit: number;
              cngn_base: number;
              cngn_bep20: number;
            }
          > = {} as any;

          // Initialize accumulators
          for (const token of tokens) {
            rates[token] = { bybit: null, cngn_base: null, cngn_bep20: null };
            sampleCount[token] = { bybit: 0, cngn_base: 0, cngn_bep20: 0 };
          }

          // Accumulate values
          const accumulators: Record<string, number[]> = {};

          for (const snapshot of hourlySnapshots) {
            for (const token of tokens) {
              const tokenRates = snapshot.rates[token];

              if (tokenRates.bybit !== null) {
                if (!accumulators[`${token}_bybit`])
                  accumulators[`${token}_bybit`] = [];
                accumulators[`${token}_bybit`]?.push(tokenRates.bybit);
                sampleCount[token].bybit++;
              }

              if (tokenRates.cngn_base !== null) {
                if (!accumulators[`${token}_cngn_base`])
                  accumulators[`${token}_cngn_base`] = [];
                accumulators[`${token}_cngn_base`]?.push(tokenRates.cngn_base);
                sampleCount[token].cngn_base++;
              }

              if (tokenRates.cngn_bep20 !== null) {
                if (!accumulators[`${token}_cngn_bep20`])
                  accumulators[`${token}_cngn_bep20`] = [];
                accumulators[`${token}_cngn_bep20`]?.push(
                  tokenRates.cngn_bep20
                );
                sampleCount[token].cngn_bep20++;
              }
            }
          }

          // Calculate averages
          for (const token of tokens) {
            const bybitValues = accumulators[`${token}_bybit`];
            if (bybitValues && bybitValues.length > 0) {
              rates[token].bybit =
                bybitValues.reduce((a, b) => a + b, 0) / bybitValues.length;
            }

            const cngnBaseValues = accumulators[`${token}_cngn_base`];
            if (cngnBaseValues && cngnBaseValues.length > 0) {
              rates[token].cngn_base =
                cngnBaseValues.reduce((a, b) => a + b, 0) /
                cngnBaseValues.length;
            }

            const cngnBep20Values = accumulators[`${token}_cngn_bep20`];
            if (cngnBep20Values && cngnBep20Values.length > 0) {
              rates[token].cngn_bep20 =
                cngnBep20Values.reduce((a, b) => a + b, 0) /
                cngnBep20Values.length;
            }
          }

          // Create daily average record
          const dailyAverage: DailyRateAverage = {
            date,
            rates,
            sampleCount,
          };

          // Store the daily average
          yield* redis.setDailyAverage(dailyAverage);

          // Delete hourly snapshots for the day
          yield* redis.deleteHourlySnapshots(date);

          console.log(`Daily average stored for ${date}:`, {
            sampleCounts: sampleCount,
            averages: Object.fromEntries(
              Object.entries(rates).map(([token, tokenRates]) => [
                token,
                Object.fromEntries(
                  Object.entries(tokenRates).map(([source, rate]) => [
                    source,
                    rate ? Math.round(rate * 100) / 100 : null,
                  ])
                ),
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
