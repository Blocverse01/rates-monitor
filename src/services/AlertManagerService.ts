import { Context, Effect, Layer } from "effect";
import { WhatsAppService } from "../infrastructure/WhatsAppService";
import { EmailService } from "../infrastructure/EmailService";
import { RedisService } from "../infrastructure/RedisService";
import type { SpreadData, VolatilityAlert, AlertConfig } from "../domain/types";
import type { NotificationError } from "../domain/errors";

export const AlertConfigTag = Context.GenericTag<AlertConfig>("AlertConfig");

export class AlertManagerService extends Context.Tag("AlertManagerService")<
  AlertManagerService,
  {
    readonly checkAndSendSpreadAlerts: (
      spreads: readonly SpreadData[]
    ) => Effect.Effect<void, NotificationError>;
    readonly checkAndSendVolatilityAlerts: (
      alerts: readonly VolatilityAlert[]
    ) => Effect.Effect<void, NotificationError>;
  }
>() {
  static readonly Live = Layer.effect(
    AlertManagerService,
    Effect.gen(function* () {
      const whatsapp = yield* WhatsAppService;
      const email = yield* EmailService;
      const redis = yield* RedisService;
      const config = yield* AlertConfigTag;

      const formatSpreadAlert = (spread: SpreadData): string =>
        `
🚨 SPREAD ALERT ACTIVATED - ${spread.token}

ByBit Rate: ₦${spread.bybitRate.toFixed(2)}
CNGN Rate: ₦${spread.cngnRate.toFixed(2)}

Spread: ₦${spread.absoluteSpread.toFixed(2)} (${spread.percentageSpread.toFixed(2)}%)
Direction: ${spread.direction === "bybit_higher" ? "ByBit is higher" : "CNGN is higher"}

⚠️ Threshold: ₦${config.spreadThreshold}

Time: ${new Date(spread.timestamp).toLocaleString()}
      `.trim();

      const formatSpreadClearedAlert = (spread: SpreadData): string =>
        `
✅ SPREAD ALERT CLEARED - ${spread.token}

ByBit Rate: ₦${spread.bybitRate.toFixed(2)}
CNGN Rate: ₦${spread.cngnRate.toFixed(2)}

Spread: ₦${spread.absoluteSpread.toFixed(2)} (${spread.percentageSpread.toFixed(2)}%)
Direction: ${spread.direction === "bybit_higher" ? "ByBit is higher" : "CNGN is higher"}

✅ Back below threshold: ₦${config.spreadThreshold}

Time: ${new Date(spread.timestamp).toLocaleString()}
      `.trim();

      const formatVolatilityAlert = (alert: VolatilityAlert): string =>
        `
⚠️ VOLATILITY ALERT - ${alert.token} (${alert.source.toUpperCase()})

Previous Rate: ₦${alert.previousRate.toFixed(2)}
Current Rate: ₦${alert.currentRate.toFixed(2)}

Change: ${alert.change > 0 ? "+" : ""}${alert.change.toFixed(2)} (${alert.changePercent.toFixed(2)}%)

Time: ${new Date(alert.timestamp).toLocaleString()}
      `.trim();

      const sendAlerts = (
        message: string
      ): Effect.Effect<void, NotificationError> =>
        Effect.gen(function* () {
          // Send WhatsApp notifications in parallel
          yield* Effect.all(
            config.recipients.whatsapp.map((phone) =>
              Effect.catchAll(whatsapp.send(phone, message), (error) => {
                console.error(`WhatsApp send failed:`, error);
                return Effect.succeed(void 0);
              })
            ),
            { concurrency: "unbounded" }
          );

          // Send email notifications in parallel
          yield* Effect.all(
            config.recipients.email.map((emailAddr) =>
              Effect.catchAll(
                email.send(emailAddr, "Rate Alert", message),
                (error) => {
                  console.error(`Email send failed:`, error);
                  return Effect.succeed(void 0);
                }
              )
            ),
            { concurrency: "unbounded" }
          );
        });

      const checkAndSendSpreadAlerts = (
        spreads: readonly SpreadData[]
      ): Effect.Effect<void, NotificationError> =>
        Effect.gen(function* () {
          for (const spread of spreads) {
            // Get previous alert state for this token
            const alertStateKey = `spread_alert_state:${spread.token}`;
            const previouslyAboveThreshold = yield* Effect.catchAll(
              redis
                .get(alertStateKey)
                .pipe(Effect.map((value) => value === "true")),
              () => Effect.succeed(false)
            );

            const currentlyAboveThreshold =
              spread.absoluteSpread >= config.spreadThreshold;

            // Only send alerts on state changes
            if (currentlyAboveThreshold && !previouslyAboveThreshold) {
              // Spread just crossed above threshold - send alert
              const message = formatSpreadAlert(spread);
              yield* sendAlerts(message);

              // Update state in Redis
              yield* Effect.catchAll(
                redis.set(alertStateKey, "true"),
                (error) => {
                  console.error(
                    `Failed to update Redis alert state for ${spread.token}:`,
                    error
                  );
                  return Effect.succeed(void 0);
                }
              );
              console.log(
                `Spread alert activated for ${spread.token}: ₦${spread.absoluteSpread.toFixed(2)}`
              );
            } else if (!currentlyAboveThreshold && previouslyAboveThreshold) {
              // Spread just dropped below threshold - send cleared alert
              const message = formatSpreadClearedAlert(spread);
              yield* sendAlerts(message);

              // Update state in Redis
              yield* Effect.catchAll(
                redis.set(alertStateKey, "false"),
                (error) => {
                  console.error(
                    `Failed to update Redis alert state for ${spread.token}:`,
                    error
                  );
                  return Effect.succeed(void 0);
                }
              );
              console.log(
                `Spread alert cleared for ${spread.token}: ₦${spread.absoluteSpread.toFixed(2)}`
              );
            }
            // If state hasn't changed, don't send any alerts
          }
        });

      const checkAndSendVolatilityAlerts = (
        alerts: readonly VolatilityAlert[]
      ): Effect.Effect<void, NotificationError> =>
        Effect.gen(function* () {
          for (const alert of alerts) {
            const message = formatVolatilityAlert(alert);
            yield* sendAlerts(message);
          }
        });

      return { checkAndSendSpreadAlerts, checkAndSendVolatilityAlerts };
    })
  );
}
