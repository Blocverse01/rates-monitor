import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateCleanupGuards,
  isLocalRedisHost,
} from "../../scripts/cleanup-redis.ts";

const scriptPath = fileURLToPath(
  new URL("../../scripts/cleanup-redis.ts", import.meta.url)
);

function runCleanupScript(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync("pnpm", ["exec", "tsx", scriptPath, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

describe("cleanup-redis guards", () => {
  it("treats only local redis hosts as safe", () => {
    assert.equal(isLocalRedisHost("localhost"), true);
    assert.equal(isLocalRedisHost("127.0.0.1"), true);
    assert.equal(isLocalRedisHost("prod-cache.example.com"), false);
  });

  it("refuses to run without --confirm", () => {
    const verdict = evaluateCleanupGuards({
      argv: ["tsx", "scripts/cleanup-redis.ts"],
      env: { NODE_ENV: "development" },
      redisHost: "localhost",
    });
    assert.equal(verdict.ok, false);

    const spawned = runCleanupScript([], {
      NODE_ENV: "development",
      REDIS_HOST: "localhost",
    });
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, /--confirm/);
  });

  it("refuses to run when NODE_ENV=production", () => {
    const verdict = evaluateCleanupGuards({
      argv: ["tsx", "scripts/cleanup-redis.ts", "--confirm"],
      env: { NODE_ENV: "production" },
      redisHost: "localhost",
    });
    assert.equal(verdict.ok, false);

    const spawned = runCleanupScript(["--confirm"], {
      NODE_ENV: "production",
      REDIS_HOST: "localhost",
    });
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, /NODE_ENV=production/);
  });

  it("refuses to run against a non-local host", () => {
    const verdict = evaluateCleanupGuards({
      argv: ["tsx", "scripts/cleanup-redis.ts", "--confirm"],
      env: { NODE_ENV: "development" },
      redisHost: "prod-cache.example.com",
    });
    assert.equal(verdict.ok, false);

    const spawned = runCleanupScript(["--confirm"], {
      NODE_ENV: "development",
      REDIS_HOST: "prod-cache.example.com",
    });
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, /prod-cache\.example\.com/);
  });
});
