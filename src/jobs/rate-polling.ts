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
import { getSharedRedisClient } from "../infrastructure/SharedRedisClient";

const ratePollingProgram = Effect.gen(function* () {
  const rateFetcher = yield* RateFetcherService;
  const volatilityDetector = yield* VolatilityDetectorService;
  const spreadCalc = yield* SpreadCalculatorService;
  const alertManager = yield* AlertManagerService;
  const redis = yield* RedisService;

  console.log("Fetching rates...");

  // Fetch all rates
  const rates = yield* rateFetcher.fetchAllRates();

  // Detect volatility for each rate
  const volatilityAlerts = yield* Effect.all(
    rates.map((rate) =>
      Effect.gen(function* () {
        const { token, timestamp } = rate;
        const rateValue = rate.rate;
        const source = rate._tag;

        return yield* volatilityDetector.detectVolatility(
          token,
          source,
          rateValue
        );
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))
    ),
    { concurrency: "unbounded" }
  );

  // Filter out nulls
  const alerts = volatilityAlerts.filter((alert) => alert !== null);

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
  const redisConfig = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  };

  // Use shared Redis client to prevent connection leaks
  const sharedRedisClient = getSharedRedisClient(redisConfig);

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
