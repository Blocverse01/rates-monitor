import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readRedisConfigFromEnv } from "../../src/infrastructure/SharedRedisClient.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "dashboard-dist"
    ) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

describe("Redis client construction", () => {
  it("reads REDIS_URL, password, and TLS from the environment", () => {
    const config = readRedisConfigFromEnv({
      REDIS_URL: "rediss://:s3cret@cache.example.com:6380/0",
      REDIS_PASSWORD: "fallback",
      REDIS_TLS: "false",
    });

    assert.equal(config.host, "cache.example.com");
    assert.equal(config.port, 6380);
    assert.equal(config.password, "s3cret");
    assert.equal(config.tls, true);
    assert.equal(config.url, "rediss://:s3cret@cache.example.com:6380/0");
  });

  it("applies host/port/password/TLS when REDIS_URL is unset", () => {
    const config = readRedisConfigFromEnv({
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6381",
      REDIS_PASSWORD: "local-pass",
      REDIS_TLS: "true",
    });

    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 6381);
    assert.equal(config.password, "local-pass");
    assert.equal(config.tls, true);
    assert.equal(config.url, undefined);
  });

  it("does not construct Redis({ host, port }) without password/tls options", () => {
    const files = walkTsFiles(repoRoot);
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const pattern = /new Redis\(\s*\{([\s\S]*?)\}\s*as RedisOptions\)/g;
      const hostPortPattern = /new Redis\(\s*\{[^}]*host[^}]*port[^}]*\}/g;
      let match: RegExpExecArray | null;
      while ((match = hostPortPattern.exec(source))) {
        const objectLiteral = match[0];
        if (!/password/.test(objectLiteral) || !/\btls\b/.test(objectLiteral)) {
          violations.push(
            `${relative(repoRoot, file)}: ${objectLiteral.replace(/\s+/g, " ")}`
          );
        }
      }

      // URL constructor form is allowed; object form must include password + tls.
      void pattern;
    }

    assert.deepEqual(violations, []);
  });
});
