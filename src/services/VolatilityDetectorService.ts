import { Context, Effect, Layer } from "effect";
import { RedisService } from "../infrastructure/RedisService";
import type { TokenType, RateSource, VolatilityAlert, ByBitTier } from "../domain/types";
import type { StorageError } from "../domain/errors";

export interface VolatilityConfig {
  readonly threshold: number; // NGN amount
}

export const VolatilityConfig =
  Context.GenericTag<VolatilityConfig>("VolatilityConfig");

export class VolatilityDetectorService extends Context.Tag(
  "VolatilityDetectorService"
)<
  VolatilityDetectorService,
  {
    readonly detectVolatility: (
      token: TokenType,
      source: RateSource,
      currentRate: number,
      tier?: ByBitTier | "blended"
    ) => Effect.Effect<VolatilityAlert | null, StorageError>;
  }
>() {
  static readonly Live = Layer.effect(
    VolatilityDetectorService,
    Effect.gen(function* () {
      const redis = yield* RedisService;
      const config = yield* VolatilityConfig;

      const detectVolatility = (
        token: TokenType,
        source: RateSource,
        currentRate: number,
        tier?: ByBitTier | "blended"
      ): Effect.Effect<VolatilityAlert | null, StorageError> =>
        Effect.gen(function* () {
          const key = tier
            ? `rate:previous:${source}:${tier}:${token}`
            : `rate:previous:${source}:${token}`;

          const previousRate = yield* redis.getNumber(key);

          // Update previous rate
          yield* redis.setNumber(key, currentRate, 3600);

          if (previousRate === null) {
            return null;
          }

          const change = currentRate - previousRate;
          const changePercent = Math.abs((change / previousRate) * 100);

          if (change >= config.threshold) {
            return {
              token,
              source,
              ...(tier !== undefined ? { tier } : {}),
              change,
              changePercent,
              previousRate,
              currentRate,
              timestamp: Date.now(),
            } satisfies VolatilityAlert;
          }

          return null;
        });

      return { detectVolatility };
    })
  );
}
