import "./setup-env.ts";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import type { Express } from "express";
import { createServer } from "../../src/api/server.ts";
import { utcToday } from "../../src/api/aggregateDate.ts";

const OPERATOR_USER = "operator";
const OPERATOR_PASSWORD = "test-operator-password";

type ListedRoute = {
  method: string;
  path: string;
};

function normalizePath(pathValue: unknown, prefix: string): string {
  if (typeof pathValue === "string") {
    if (pathValue.startsWith("/")) {
      return prefix === "/" ? pathValue : `${prefix}${pathValue}`;
    }
    return `${prefix}/${pathValue}`.replace(/\/{2,}/g, "/");
  }
  if (pathValue instanceof RegExp) {
    return prefix || "/";
  }
  return prefix || "/";
}

function mountPathFromLayer(layer: {
  path?: unknown;
  regexp?: { source?: string };
}): string {
  if (typeof layer.path === "string") {
    return layer.path.startsWith("/") ? layer.path : `/${layer.path}`;
  }

  const source = layer.regexp?.source;
  if (!source) {
    return "";
  }

  const match = source.match(/^\^\\\/([^\\?]+)/);
  if (!match?.[1]) {
    return "";
  }

  return `/${match[1].replace(/\\\//g, "/")}`;
}

function walkRouterStack(stack: unknown[], prefix = ""): ListedRoute[] {
  const routes: ListedRoute[] = [];
  if (!Array.isArray(stack)) {
    return routes;
  }

  for (const raw of stack) {
    const layer = raw as {
      route?: { path?: unknown; methods?: Record<string, boolean> };
      handle?: { stack?: unknown[] };
      name?: string;
      path?: unknown;
      regexp?: { source?: string };
    };

    if (layer.route?.methods) {
      const path = normalizePath(layer.route.path, prefix || "");
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled && method.toLowerCase() !== "_all") {
          routes.push({ method: method.toUpperCase(), path: path || "/" });
        }
      }
      continue;
    }

    if (layer.handle?.stack) {
      const mount = mountPathFromLayer(layer);
      const nextPrefix = `${prefix}${mount}`.replace(/\/{2,}/g, "/") || "";
      routes.push(...walkRouterStack(layer.handle.stack, nextPrefix));
    }
  }

  return routes;
}

export function listExpressRoutes(app: Express): ListedRoute[] {
  const router =
    (
      app as Express & {
        router?: { stack?: unknown[] };
        _router?: { stack?: unknown[] };
      }
    ).router ?? (app as Express & { _router?: { stack?: unknown[] } })._router;
  return walkRouterStack(router?.stack ?? []);
}

function materializePath(path: string): string {
  return (
    path
      .replace(/:date/g, "2000-01-01")
      .replace(/:token/g, "USDT")
      .replace(/:queueName|:name/g, "rate-polling")
      .replace(/:jobId|:id/g, "1")
      .replace(/:[A-Za-z0-9_]+/g, "test")
      .replace(/\*/g, "x") || "/"
  );
}

describe("operator HTTP auth invariants", () => {
  let app: Express;
  let httpServer: { close: (cb?: () => void) => void };
  let io: { close: () => void };

  before(() => {
    process.env.OPERATOR_AUTH_USER = OPERATOR_USER;
    process.env.OPERATOR_AUTH_PASSWORD = OPERATOR_PASSWORD;
    const server = createServer();
    app = server.app;
    httpServer = server.httpServer;
    io = server.io;
  });

  after(async () => {
    io.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  it("leaves GET /health public", async () => {
    const response = await request(app).get("/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
  });

  it("returns 401 for unauthenticated GET /admin/queues", async () => {
    const response = await request(app).get("/admin/queues");
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("returns 401 for unauthenticated dashboard and API GETs", async () => {
    const paths = ["/", "/api/rates", "/api/rates/spreads", "/api/rates/USDT"];
    for (const path of paths) {
      const response = await request(app).get(path);
      assert.equal(response.status, 401, `${path} should be 401`);
    }
  });

  it("rejects every non-GET Express route without credentials", async () => {
    const listed = listExpressRoutes(app);
    const nonGet = listed.filter(
      (route) => route.method !== "GET" && route.method !== "HEAD"
    );

    const explicit = [
      { method: "POST", path: "/api/rates/aggregate/yesterday" },
      { method: "POST", path: "/api/rates/aggregate/2000-01-01" },
    ];

    const unique = new Map<string, ListedRoute>();
    for (const route of [...nonGet, ...explicit]) {
      unique.set(`${route.method} ${route.path}`, route);
    }

    assert.ok(unique.size > 0, "expected at least one non-GET route");

    for (const route of unique.values()) {
      const path = materializePath(route.path);
      const method = route.method.toLowerCase();
      const agent = request(app);
      const started =
        method === "post"
          ? agent.post(path)
          : method === "put"
            ? agent.put(path)
            : method === "patch"
              ? agent.patch(path)
              : method === "delete"
                ? agent.delete(path)
                : null;
      if (!started) {
        continue;
      }
      const response = await started.send({});
      assert.ok(
        response.status === 401 || response.status === 403,
        `${route.method} ${path} returned ${response.status}`
      );
    }
  });

  it("rejects aggregating today or a future date even with credentials", async () => {
    const today = utcToday();
    const future = "2099-01-01";
    for (const date of [today, future]) {
      const response = await request(app)
        .post(`/api/rates/aggregate/${date}`)
        .auth(OPERATOR_USER, OPERATOR_PASSWORD)
        .send({});
      assert.equal(response.status, 400, `${date} should be 400`);
      assert.match(String(response.body.error), /today|future/i);
    }
  });

  it("fails closed when operator credentials are not configured", async () => {
    const previousUser = process.env.OPERATOR_AUTH_USER;
    const previousPassword = process.env.OPERATOR_AUTH_PASSWORD;
    delete process.env.OPERATOR_AUTH_USER;
    delete process.env.OPERATOR_AUTH_PASSWORD;

    try {
      const response = await request(app).get("/admin/queues");
      assert.ok(response.status === 401 || response.status === 403);
    } finally {
      process.env.OPERATOR_AUTH_USER = previousUser;
      process.env.OPERATOR_AUTH_PASSWORD = previousPassword;
    }
  });
});
