import { Context, Effect, Layer } from "effect";
import { Redis } from "ioredis";
import { StorageError } from "../domain/errors";
import type {
  HourlyRateSnapshot,
  DailyRateAverage,
  CurrentRatesData,
} from "../domain/types";

export interface RedisConfig {
  readonly host: string;
  readonly port: number;
}

export const RedisConfig = Context.GenericTag<RedisConfig>("RedisConfig");

export class RedisService extends Context.Tag("RedisService")<
  RedisService,
  {
    readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
    readonly set: (
      key: string,
      value: string,
      ttl?: number
    ) => Effect.Effect<void, StorageError>;
    readonly getNumber: (
      key: string
    ) => Effect.Effect<number | null, StorageError>;
    readonly setNumber: (
      key: string,
      value: number,
      ttl?: number
    ) => Effect.Effect<void, StorageError>;
    readonly setHourlySnapshot: (
      date: string,
      hour: number,
      rates: CurrentRatesData
    ) => Effect.Effect<void, StorageError>;
    readonly getHourlySnapshots: (
      date: string
    ) => Effect.Effect<readonly HourlyRateSnapshot[], StorageError>;
    readonly setDailyAverage: (
      dailyAverage: DailyRateAverage
    ) => Effect.Effect<void, StorageError>;
    readonly getDailyAverage: (
      date: string
    ) => Effect.Effect<DailyRateAverage | null, StorageError>;
    readonly getLastNDays: (
      days: number
    ) => Effect.Effect<readonly DailyRateAverage[], StorageError>;
    readonly deleteHourlySnapshots: (
      date: string
    ) => Effect.Effect<void, StorageError>;
  }
>() {
  static readonly Live = Layer.effect(
    RedisService,
    Effect.gen(function* () {
      const config = yield* RedisConfig;
      const redis = new Redis({
        host: config.host,
        port: config.port,
      });

      const get = (key: string): Effect.Effect<string | null, StorageError> =>
        Effect.tryPromise({
          try: () => redis.get(key),
          catch: (error) =>
            new StorageError({
              operation: "get",
              reason: error instanceof Error ? error.message : String(error),
            }),
        });

      const set = (
        key: string,
        value: string,
        ttl?: number
      ): Effect.Effect<void, StorageError> =>
        Effect.tryPromise({
          try: async () => {
            if (ttl) {
              await redis.setex(key, ttl, value);
            } else {
              await redis.set(key, value);
            }
          },
          catch: (error) =>
            new StorageError({
              operation: "set",
              reason: error instanceof Error ? error.message : String(error),
            }),
        });

      const getNumber = (
        key: string
      ): Effect.Effect<number | null, StorageError> =>
        Effect.gen(function* () {
          const value = yield* get(key);
          return value ? parseFloat(value) : null;
        });

      const setNumber = (
        key: string,
        value: number,
        ttl?: number
      ): Effect.Effect<void, StorageError> => set(key, value.toString(), ttl);

      // Historic data methods
      const setHourlySnapshot = (
        date: string,
        hour: number,
        rates: CurrentRatesData
      ): Effect.Effect<void, StorageError> => {
        const snapshot: HourlyRateSnapshot = {
          hour,
          timestamp: Date.now(),
          rates,
        };
        const key = `hourly:rates:${date}:${hour.toString().padStart(2, "0")}`;
        return set(key, JSON.stringify(snapshot), 24 * 60 * 60); // 24 hour TTL
      };

      const getHourlySnapshots = (
        date: string
      ): Effect.Effect<readonly HourlyRateSnapshot[], StorageError> =>
        Effect.tryPromise({
          try: async () => {
            const pattern = `hourly:rates:${date}:*`;
            const keys = await redis.keys(pattern);

            if (keys.length === 0) {
              return [];
            }

            const values = await redis.mget(...keys);
            return values
              .filter((value): value is string => value !== null)
              .map((value) => JSON.parse(value) as HourlyRateSnapshot)
              .sort((a, b) => a.hour - b.hour);
          },
          catch: (error) =>
            new StorageError({
              operation: "getHourlySnapshots",
              reason: error instanceof Error ? error.message : String(error),
            }),
        });

      const setDailyAverage = (
        dailyAverage: DailyRateAverage
      ): Effect.Effect<void, StorageError> => {
        const key = `history:rates:${dailyAverage.date}`;
        return set(key, JSON.stringify(dailyAverage), 8 * 24 * 60 * 60); // 8 day TTL
      };

      const getDailyAverage = (
        date: string
      ): Effect.Effect<DailyRateAverage | null, StorageError> =>
        Effect.gen(function* () {
          const key = `history:rates:${date}`;
          const value = yield* get(key);
          return value ? (JSON.parse(value) as DailyRateAverage) : null;
        });

      const getLastNDays = (
        days: number
      ): Effect.Effect<readonly DailyRateAverage[], StorageError> =>
        Effect.tryPromise({
          try: async () => {
            const dates: string[] = [];
            const today = new Date();

            // Generate last N days in YYYY-MM-DD format
            for (let i = days - 1; i >= 0; i--) {
              const date = new Date(today);
              date.setDate(date.getDate() - i);
              dates.push(date.toISOString().split("T")[0]!);
            }

            const keys = dates.map((date) => `history:rates:${date}`);
            const values = await redis.mget(...keys);

            return values
              .map((value, index) =>
                value ? (JSON.parse(value) as DailyRateAverage) : null
              )
              .filter((avg): avg is DailyRateAverage => avg !== null);
          },
          catch: (error) =>
            new StorageError({
              operation: "getLastNDays",
              reason: error instanceof Error ? error.message : String(error),
            }),
        });

      const deleteHourlySnapshots = (
        date: string
      ): Effect.Effect<void, StorageError> =>
        Effect.tryPromise({
          try: async () => {
            const pattern = `hourly:rates:${date}:*`;
            const keys = await redis.keys(pattern);

            if (keys.length > 0) {
              await redis.del(...keys);
            }
          },
          catch: (error) =>
            new StorageError({
              operation: "deleteHourlySnapshots",
              reason: error instanceof Error ? error.message : String(error),
            }),
        });

      return {
        get,
        set,
        getNumber,
        setNumber,
        setHourlySnapshot,
        getHourlySnapshots,
        setDailyAverage,
        getDailyAverage,
        getLastNDays,
        deleteHourlySnapshots,
      };
    })
  );
}
