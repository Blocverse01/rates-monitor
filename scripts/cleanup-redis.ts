import { Queue } from "bullmq";
import { Redis } from "ioredis";

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
};

// Queues defined in src/jobs/*
const QUEUE_NAMES = ["rate-polling", "daily-aggregation"];

// Key patterns written by RedisService.set / setJSON / setNumber / setHourlySnapshot / setDailyAverage,
// plus the alert-state keys written directly via redis.set in AlertManagerService
const KEY_PATTERNS = [
  "hourly:rates:*",
  "history:rates:*",
  "rate:bybit:*",
  "rate:cngn_base:*",
  "rate:cngn_bep20:*",
  "rate:previous:*",
  "spread_alert_state:*",
];

async function main() {
  const connection = new Redis({ ...redisConfig, maxRetriesPerRequest: null });

  console.log(`Connected to Redis at ${redisConfig.host}:${redisConfig.port}`);

  // Empty completed/failed jobs from each queue
  for (const name of QUEUE_NAMES) {
    const queue = new Queue(name, { connection });
    const completed = await queue.clean(0, 0, "completed");
    const failed = await queue.clean(0, 0, "failed");
    console.log(
      `[${name}] removed ${completed.length} completed job(s), ${failed.length} failed job(s)`
    );
    await queue.close();
  }

  // Delete all app-managed key/value pairs
  let totalDeleted = 0;
  for (const pattern of KEY_PATTERNS) {
    const keys = await connection.keys(pattern);
    if (keys.length > 0) {
      await connection.del(...keys);
      totalDeleted += keys.length;
    }
    console.log(`Pattern "${pattern}": deleted ${keys.length} key(s)`);
  }
  console.log(`Total keys deleted: ${totalDeleted}`);

  await connection.quit();
}

main().catch((error) => {
  console.error("Redis cleanup failed:", error);
  process.exit(1);
});
