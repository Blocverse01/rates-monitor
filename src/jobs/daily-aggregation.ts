import { Effect } from "effect";
import { Queue, Worker } from "bullmq";
import { DailyAggregationService } from "../services/DailyAggregationService";
import { ServicesLayerLive } from "../layers/services";
import { ConfigLayerLive } from "../layers/config";
import { broadcastDailyDataUpdate, registerQueue } from "../api/server";
import { RedisService } from "../infrastructure/RedisService";
import { InfrastructureLayerLive } from "../layers/infrastructure";
import { getSharedRedisClient } from "../infrastructure/SharedRedisClient";

const dailyAggregationProgram = Effect.gen(function* () {
  const aggregator = yield* DailyAggregationService;
  const redis = yield* RedisService;

  console.log("Running daily aggregation for yesterday...");

  try {
    yield* aggregator.aggregateYesterday();
    console.log("Daily aggregation completed successfully");

    // Broadcast updated daily data to dashboard clients
    try {
      const dailyData = yield* redis.getLastNDays(7);
      const response = {
        days: dailyData,
        totalDays: dailyData.length,
      };
      broadcastDailyDataUpdate(response);
      console.log("Broadcasted daily data update");
    } catch (broadcastError) {
      console.error("Failed to broadcast daily data:", broadcastError);
    }
  } catch (error) {
    console.error("Daily aggregation failed:", error);
    // Re-throw to mark job as failed in the queue
    throw error;
  }
});

export function setupDailyAggregationJob() {
  const redisConfig = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  };

  // Use shared Redis client to prevent connection leaks
  const sharedRedisClient = getSharedRedisClient(redisConfig);

  const queue = new Queue("daily-aggregation", {
    connection: sharedRedisClient,
  });

  // Register queue with Bull Board
  registerQueue(queue);

  const worker = new Worker(
    "daily-aggregation",
    async () => {
      const program = dailyAggregationProgram.pipe(
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

  // Schedule job every day at 1:00 AM
  queue.add(
    "aggregate-yesterday",
    {},
    {
      repeat: {
        pattern: "0 1 * * *", // Cron pattern: 1:00 AM daily
      },
    }
  );

  // Cleanup handlers to properly close BullMQ connections
  const cleanup = async () => {
    console.log("Cleaning up daily aggregation job...");
    try {
      await worker.close();
      await queue.close();
    } catch (error) {
      console.error("Error during daily aggregation cleanup:", error);
    }
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("beforeExit", cleanup);

  return { queue, worker, cleanup };
}
