import { Redis, type RedisOptions } from "ioredis";

let sharedClient: Redis | null = null;

export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly password?: string;
  readonly tls?: boolean;
  readonly url?: string;
}

export function readRedisConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): RedisConnectionConfig {
  const url = env.REDIS_URL?.trim() || undefined;
  const password = env.REDIS_PASSWORD?.trim() || undefined;
  const tlsEnabled = env.REDIS_TLS === "true" || env.REDIS_TLS === "1";

  if (url) {
    const parsed = new URL(url);
    const urlPassword = parsed.password
      ? decodeURIComponent(parsed.password)
      : undefined;
    const resolvedPassword = urlPassword || password;
    const useTls = parsed.protocol === "rediss:" || tlsEnabled;
    return {
      url,
      host: parsed.hostname,
      port: parsed.port
        ? Number(parsed.port)
        : parsed.protocol === "rediss:"
          ? 6380
          : 6379,
      ...(resolvedPassword ? { password: resolvedPassword } : {}),
      ...(useTls ? { tls: true } : {}),
    };
  }

  return {
    host: env.REDIS_HOST || "localhost",
    port: parseInt(env.REDIS_PORT || "6379", 10),
    ...(password ? { password } : {}),
    ...(tlsEnabled ? { tls: true } : {}),
  };
}

export function createRedisClient(config: RedisConnectionConfig): Redis {
  const options = {
    host: config.host,
    port: config.port,
    password: config.password,
    tls: config.tls ? {} : undefined,
    maxRetriesPerRequest: null,
  } as RedisOptions;

  if (config.url) {
    return new Redis(config.url, options);
  }

  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    tls: config.tls ? {} : undefined,
    maxRetriesPerRequest: null,
  } as RedisOptions);
}

export function getSharedRedisClient(
  config: RedisConnectionConfig = readRedisConfigFromEnv()
): Redis {
  if (!sharedClient) {
    console.log(
      `Creating shared Redis connection to ${config.host}:${config.port}`
    );
    sharedClient = createRedisClient(config);

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

export function getCurrentRedisClient(): Redis | null {
  return sharedClient;
}

export async function closeSharedRedisClient(): Promise<void> {
  if (sharedClient) {
    console.log("Manually closing shared Redis connection...");
    await sharedClient.quit();
    sharedClient = null;
  }
}
