import { Effect } from "effect";
import { Queue, Worker } from "bullmq";
import { RateFetcherService } from "../services/RateFetcherService";
import { VolatilityDetectorService } from "../services/VolatilityDetectorService";
import { SpreadCalculatorService } from "../services/SpreadCalculatorService";
import { AlertManagerService } from "../services/AlertManagerService";
import { ServicesLayerLive } from "../layers/services";
import { ConfigLayerLive } from "../layers/config";
import {
  broadcastRateUpdate,
  broadcastVolatilityAlert,
  broadcastHourlyDataUpdate,
  registerQueue,
} from "../api/server";
import { RedisService } from "../infrastructure/RedisService";
import { InfrastructureLayerLive } from "../layers/infrastructure";
import {
  getSharedRedisClient,
  readRedisConfigFromEnv,
} from "../infrastructure/SharedRedisClient";
import type { VolatilityAlert, ByBitTier } from "../domain/types";

const ratePollingProgram = Effect.gen(function* () {
  const rateFetcher = yield* RateFetcherService;
  const volatilityDetector = yield* VolatilityDetectorService;
  const spreadCalc = yield* SpreadCalculatorService;
  const alertManager = yield* AlertManagerService;
  const redis = yield* RedisService;

  console.log("Fetching rates...");

  // Fetch all rates
  const rates = yield* rateFetcher.fetchAllRates();

  // Detect volatility for each rate — ByBit produces one alert per tier
  const BYBIT_TIERS: Array<ByBitTier | "blended"> = [
    "spot",
    "desk",
    "block",
    "blended",
  ];

  const volatilityAlertGroups = yield* Effect.all(
    rates.map((rate) =>
      Effect.gen(function* () {
        if (rate._tag === "ByBit") {
          const tierAlerts: (VolatilityAlert | null)[] = [];
          for (const tier of BYBIT_TIERS) {
            const tierRate = rate.tiers[tier];
            if (tierRate !== null) {
              const alert = yield* volatilityDetector.detectVolatility(
                rate.token,
                "ByBit",
                tierRate,
                tier
              );
              tierAlerts.push(alert);
            }
          }
          return tierAlerts;
        }

        const alert = yield* volatilityDetector.detectVolatility(
          rate.token,
          rate._tag,
          rate.rate
        );
        return [alert];
      }).pipe(
        Effect.catchAll(() => Effect.succeed([] as (VolatilityAlert | null)[]))
      )
    ),
    { concurrency: "unbounded" }
  );

  // Flatten and filter nulls
  const alerts = volatilityAlertGroups
    .flat()
    .filter((alert): alert is VolatilityAlert => alert !== null);

  // Calculate spreads
  const currentRates = yield* rateFetcher.getCurrentRates();
  const spreads = spreadCalc.calculateAllSpreads(currentRates);

  // Send alerts
  yield* alertManager.checkAndSendVolatilityAlerts(alerts);
  yield* alertManager.checkAndSendSpreadAlerts(spreads);

  // Broadcast updates to dashboard clients
  broadcastRateUpdate(currentRates, spreads);

  // Broadcast volatility alerts
  alerts.forEach((alert) => {
    if (alert) {
      broadcastVolatilityAlert(alert);
    }
  });

  // Check if we should broadcast hourly data update (every 10 minutes)
  const now = Date.now();
  const tenMinutesInMs = 10 * 60 * 1000;
  const shouldBroadcastHourly = now % tenMinutesInMs < 30000; // Within 30s of 10-minute interval

  if (shouldBroadcastHourly) {
    try {
      const today = new Date().toISOString().split("T")[0]!;
      const hourlyData = yield* redis.getHourlySnapshots(today);
      broadcastHourlyDataUpdate(hourlyData);
      console.log("Broadcasted hourly data update");
    } catch (error) {
      console.error("Failed to broadcast hourly data:", error);
    }
  }

  console.log("Rate polling completed");
});

export function setupRatePollingJob() {
  const sharedRedisClient = getSharedRedisClient(readRedisConfigFromEnv());

  const queue = new Queue("rate-polling", {
    connection: sharedRedisClient,
  });

  // Register queue with Bull Board
  registerQueue(queue);

  const worker = new Worker(
    "rate-polling",
    async () => {
      const program = ratePollingProgram.pipe(
        Effect.provide(ServicesLayerLive),
        Effect.provide(InfrastructureLayerLive),
        Effect.provide(ConfigLayerLive)
      );

      await Effect.runPromise(program);
    },
    {
      connection: sharedRedisClient,
    }
  );

  // Schedule job every 30 seconds
  queue.add(
    "fetch-rates",
    {},
    {
      repeat: {
        every: 30000,
      },
    }
  );

  // Cleanup handlers to properly close BullMQ connections
  const cleanup = async () => {
    console.log("Cleaning up rate polling job...");
    try {
      await worker.close();
      await queue.close();
    } catch (error) {
      console.error("Error during rate polling cleanup:", error);
    }
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("beforeExit", cleanup);

  return { queue, worker, cleanup };
}
