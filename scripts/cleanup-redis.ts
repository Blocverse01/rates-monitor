import { Queue } from "bullmq";
import {
  createRedisClient,
  readRedisConfigFromEnv,
} from "../src/infrastructure/SharedRedisClient";

const QUEUE_NAMES = ["rate-polling", "daily-aggregation"];

const KEY_PATTERNS = [
  "hourly:rates:*",
  "history:rates:*",
  "rate:bybit:*",
  "rate:cngn_base:*",
  "rate:cngn_bep20:*",
  "rate:previous:*",
  "spread_alert_state:*",
];

const LOCAL_REDIS_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "redis",
  "host.docker.internal",
]);

export function isLocalRedisHost(host: string): boolean {
  return LOCAL_REDIS_HOSTS.has(host.toLowerCase());
}

export function evaluateCleanupGuards(input: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  redisHost: string;
}): { ok: true } | { ok: false; message: string } {
  if (!input.argv.includes("--confirm")) {
    return {
      ok: false,
      message: "Refusing to run cleanup-redis without --confirm",
    };
  }

  if (input.env.NODE_ENV === "production") {
    return {
      ok: false,
      message: "Refusing to run cleanup-redis when NODE_ENV=production",
    };
  }

  if (!isLocalRedisHost(input.redisHost)) {
    return {
      ok: false,
      message: `Refusing to run cleanup-redis against host ${input.redisHost}`,
    };
  }

  return { ok: true };
}

export async function runCleanup(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const redisConfig = readRedisConfigFromEnv(env);
  const verdict = evaluateCleanupGuards({
    argv,
    env,
    redisHost: redisConfig.host,
  });

  if (!verdict.ok) {
    console.error(verdict.message);
    process.exitCode = 1;
    throw new Error(verdict.message);
  }

  const connection = createRedisClient(redisConfig);

  console.log(`Connected to Redis at ${redisConfig.host}:${redisConfig.port}`);

  for (const name of QUEUE_NAMES) {
    const queue = new Queue(name, { connection });
    const completed = await queue.clean(0, 0, "completed");
    const failed = await queue.clean(0, 0, "failed");
    console.log(
      `[${name}] removed ${completed.length} completed job(s), ${failed.length} failed job(s)`
    );
    await queue.close();
  }

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

const isDirectRun = /(?:^|\/)cleanup-redis\.(ts|js)$/.test(
  process.argv[1] ?? ""
);

if (isDirectRun) {
  runCleanup().catch((error) => {
    if (process.exitCode) {
      process.exit(process.exitCode);
    }
    console.error("Redis cleanup failed:", error);
    process.exit(1);
  });
}
