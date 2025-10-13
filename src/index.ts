import { createServer } from "./api/server";
import { setupRatePollingJob } from "./jobs/rate-polling";
import { setupDailyAggregationJob } from "./jobs/daily-aggregation";

async function main() {
  // Start rate polling job
  const ratePolling = setupRatePollingJob();
  console.log("Rate polling job started");

  // Start daily aggregation job
  const dailyAggregation = setupDailyAggregationJob();
  console.log("Daily aggregation job scheduled (runs at 1:00 AM)");

  // Start Express server with WebSocket support
  const { app, httpServer, io } = createServer();
  const PORT = process.env.PORT || 3000;

  httpServer.listen(PORT, () => {
    console.log(`Rate monitoring service running on port ${PORT}`);
    console.log(`Dashboard available at http://localhost:${PORT}`);
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down gracefully...");
    await ratePolling.worker.close();
    await ratePolling.queue.close();
    await dailyAggregation.worker.close();
    await dailyAggregation.queue.close();
    process.exit(0);
  });
}

main().catch(console.error);
