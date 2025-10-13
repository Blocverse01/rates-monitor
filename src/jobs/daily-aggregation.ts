import { Effect } from "effect";
import { Queue, Worker } from "bullmq";
import { DailyAggregationService } from "../services/DailyAggregationService";
import { ServicesLayerLive } from "../layers/services";
import { ConfigLayerLive } from "../layers/config";
import { broadcastDailyDataUpdate } from "../api/server";
import { RedisService } from "../infrastructure/RedisService";
import { InfrastructureLayerLive } from "../layers/infrastructure";

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

  const queue = new Queue("daily-aggregation", {
    connection: redisConfig,
  });

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
      connection: redisConfig,
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

  return { queue, worker };
}
