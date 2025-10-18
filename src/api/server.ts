import express from "express";
import { createServer as createHTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { Effect } from "effect";
import { RateFetcherService } from "../services/RateFetcherService";
import { SpreadCalculatorService } from "../services/SpreadCalculatorService";
import { RedisService } from "../infrastructure/RedisService";
import { DailyAggregationService } from "../services/DailyAggregationService";
import { ServicesLayerLive } from "../layers/services";
import { ConfigLayerLive } from "../layers/config";
import type { RateHistoryResponse } from "../domain/types";
import { InfrastructureLayerLive } from "../layers/infrastructure";
import path from "path";
import fs from "node:fs";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Queue } from "bullmq";

// Global WebSocket server instance for rate broadcasting
let io: SocketIOServer | null = null;

// Global Bull Board setup
let bullBoardQueues: Queue[] = [];

export function createServer(): {
  app: express.Express;
  httpServer: any;
  io: SocketIOServer;
} {
  const app = express();
  const httpServer = createHTTPServer(app);

  // Initialize Socket.IO
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: ["http://localhost:5173", "http://localhost:3000"],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  app.use(express.json());

  // Setup Bull Board for queue monitoring
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: bullBoardQueues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter: serverAdapter,
  });

  app.use("/admin/queues", serverAdapter.getRouter());

  // Serve dashboard static files in production (if built)
  const dashboardPath = path.join(process.cwd(), "dashboard-dist");

  // Only serve static files if dashboard-dist exists (production)
  try {
    if (fs.existsSync(dashboardPath)) {
      app.use(express.static(dashboardPath));
    }
  } catch {
    // Dashboard not built - development mode
  }

  // Handle WebSocket connections
  io.on("connection", (socket) => {
    console.log("Client connected to dashboard:", socket.id);

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // GET /api/rates - All current rates
  app.get("/api/rates", async (req, res) => {
    const program = Effect.gen(function* () {
      const rateFetcher = yield* RateFetcherService;
      const rates = yield* rateFetcher.getCurrentRates();

      return {
        success: true,
        data: rates,
        timestamp: Date.now(),
      };
    }).pipe(Effect.provide(ServicesLayerLive), Effect.provide(ConfigLayerLive));

    try {
      const result = await Effect.runPromise(program);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to fetch rates",
      });
    }
  });

  // GET /api/rates/spreads - Current spreads
  app.get("/api/rates/spreads", async (req, res) => {
    const program = Effect.gen(function* () {
      const rateFetcher = yield* RateFetcherService;
      const spreadCalc = yield* SpreadCalculatorService;

      const rates = yield* rateFetcher.getCurrentRates();
      const spreads = spreadCalc.calculateAllSpreads(rates);

      return {
        success: true,
        data: spreads,
        timestamp: Date.now(),
      };
    }).pipe(Effect.provide(ServicesLayerLive), Effect.provide(ConfigLayerLive));

    try {
      const result = await Effect.runPromise(program);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to calculate spreads",
      });
    }
  });

  // GET /api/rates/:token - Token-specific rates
  app.get("/api/rates/:token", async (req, res) => {
    const { token } = req.params;

    if (!["USDT", "USDC"].includes(token.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: "Invalid token. Use USDT or USDC",
      });
    }

    const program = Effect.gen(function* () {
      const rateFetcher = yield* RateFetcherService;
      const spreadCalc = yield* SpreadCalculatorService;

      const rates = yield* rateFetcher.getCurrentRates();
      const tokenRates = rates[token.toUpperCase() as "USDT" | "USDC"];

      if (!tokenRates.bybit) {
        return yield* Effect.fail(new Error("ByBit rates not found"));
      }

      // Calculate spreads for available chains
      const spreads = [];

      if (tokenRates.cngn_base) {
        spreads.push({
          chain: "base",
          ...spreadCalc.calculateSpread(
            tokenRates.bybit,
            tokenRates.cngn_base,
            token.toUpperCase() as "USDT" | "USDC"
          ),
        });
      }

      if (tokenRates.cngn_bep20) {
        spreads.push({
          chain: "bep20",
          ...spreadCalc.calculateSpread(
            tokenRates.bybit,
            tokenRates.cngn_bep20,
            token.toUpperCase() as "USDT" | "USDC"
          ),
        });
      }

      if (spreads.length === 0) {
        return yield* Effect.fail(new Error("No CNGN rates found"));
      }

      return {
        success: true,
        data: {
          rates: tokenRates,
          spreads,
        },
        timestamp: Date.now(),
      };
    }).pipe(Effect.provide(ServicesLayerLive), Effect.provide(ConfigLayerLive));

    try {
      const result = await Effect.runPromise(program);
      return res.json(result);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: "Rates not found",
      });
    }
  });

  // GET /api/rates/history - 7-day rate history
  app.get("/api/rates/history", async (req, res) => {
    const program = Effect.gen(function* () {
      const redis = yield* RedisService;
      const days = yield* redis.getLastNDays(7);

      const response: RateHistoryResponse = {
        days,
        totalDays: days.length,
      };

      return {
        success: true,
        data: response,
        timestamp: Date.now(),
      };
    }).pipe(
      Effect.provide(ServicesLayerLive),
      Effect.provide(InfrastructureLayerLive),
      Effect.provide(ConfigLayerLive)
    );

    try {
      const result = await Effect.runPromise(program);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch rate history",
      });
    }
  });

  // GET /api/rates/hourly/:date - Hourly snapshots for a specific date
  app.get("/api/rates/hourly/:date", async (req, res) => {
    const { date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const program = Effect.gen(function* () {
      const redis = yield* RedisService;
      const hourlySnapshots = yield* redis.getHourlySnapshots(date);

      return {
        success: true,
        data: hourlySnapshots,
        timestamp: Date.now(),
      };
    }).pipe(
      Effect.provide(ServicesLayerLive),
      Effect.provide(InfrastructureLayerLive),
      Effect.provide(ConfigLayerLive)
    );

    try {
      const result = await Effect.runPromise(program);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch hourly data",
      });
    }
  });

  // POST /api/rates/aggregate/yesterday - Trigger yesterday's aggregation (MUST come before /:date)
  app.post("/api/rates/aggregate/yesterday", async (_req, res) => {
    const program = Effect.gen(function* () {
      const aggregator = yield* DailyAggregationService;
      yield* aggregator.aggregateYesterday();

      return {
        success: true,
        message: "Yesterday's aggregation completed",
        timestamp: Date.now(),
      };
    }).pipe(Effect.provide(ServicesLayerLive), Effect.provide(ConfigLayerLive));

    try {
      const result = await Effect.runPromise(program);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to aggregate yesterday's data",
      });
    }
  });

  // POST /api/rates/aggregate/:date - Manually trigger daily aggregation
  app.post("/api/rates/aggregate/:date", async (req, res) => {
    const { date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const program = Effect.gen(function* () {
      const aggregator = yield* DailyAggregationService;
      yield* aggregator.aggregateDay(date);

      return {
        success: true,
        message: `Daily aggregation completed for ${date}`,
        timestamp: Date.now(),
      };
    }).pipe(Effect.provide(ServicesLayerLive), Effect.provide(ConfigLayerLive));

    try {
      const result = await Effect.runPromise(program);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to aggregate daily data",
      });
    }
  });

  // Dashboard route - serve React app for any non-API routes
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    const indexPath = path.join(dashboardPath, "index.html");

    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({
        error:
          "Dashboard not built. Run 'pnpm run build:dashboard' or access development server at http://localhost:5173",
      });
    }
  });

  return { app, httpServer, io };
}

// Export function to broadcast rate updates to connected clients
export function broadcastRateUpdate(rates: any, spreads: any) {
  if (io) {
    io.emit("rates_update", { rates, spreads });
  }
}

export function broadcastVolatilityAlert(alert: any) {
  if (io) {
    io.emit("volatility_alert", alert);
  }
}

// Export function to broadcast hourly data updates to connected clients
export function broadcastHourlyDataUpdate(hourlyData: any) {
  if (io) {
    io.emit("hourly_data_update", { data: hourlyData, timestamp: Date.now() });
  }
}

// Export function to broadcast daily data updates to connected clients
export function broadcastDailyDataUpdate(dailyData: any) {
  if (io) {
    io.emit("daily_data_update", { data: dailyData, timestamp: Date.now() });
  }
}

// Export function to register queues with Bull Board
export function registerQueue(queue: Queue) {
  bullBoardQueues.push(queue);
}
