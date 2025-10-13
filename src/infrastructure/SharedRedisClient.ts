import { Redis } from "ioredis";

// Singleton Redis client instance
let sharedClient: Redis | null = null;

export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
}

export function getSharedRedisClient(config: RedisConnectionConfig): Redis {
  if (!sharedClient) {
    console.log(
      `Creating shared Redis connection to ${config.host}:${config.port}`
    );

    sharedClient = new Redis({
      host: config.host,
      port: config.port,
    });

    // Handle process termination
    const cleanup = () => {
      if (sharedClient) {
        console.log("Closing shared Redis connection...");
        sharedClient.disconnect();
        sharedClient = null;
      }
    };

    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
    process.on("beforeExit", cleanup);
  }

  return sharedClient;
}

// Get the current shared client (if exists)
export function getCurrentRedisClient(): Redis | null {
  return sharedClient;
}

// Force close the shared connection (for testing/cleanup)
export async function closeSharedRedisClient(): Promise<void> {
  if (sharedClient) {
    console.log("Manually closing shared Redis connection...");
    await sharedClient.quit();
    sharedClient = null;
  }
}
