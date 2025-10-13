import { Context, Effect, Layer } from "effect";
import axios from "axios";
import { NotificationError } from "../domain/errors";

export interface WhatsAppConfig {
  readonly apiUrl: string; // WhatsApp Business API URL
  readonly accessToken: string;
  readonly phoneNumberId: string; // Your WhatsApp Business phone number ID
}

export const WhatsAppConfig =
  Context.GenericTag<WhatsAppConfig>("WhatsAppConfig");

export class WhatsAppService extends Context.Tag("WhatsAppService")<
  WhatsAppService,
  {
    readonly send: (
      toNumber: string,
      message: string
    ) => Effect.Effect<void, NotificationError>;
  }
>() {
  static readonly Live = Layer.effect(
    WhatsAppService,
    Effect.gen(function* () {
      const config = yield* WhatsAppConfig;

      const send = (
        toNumber: string,
        message: string
      ): Effect.Effect<void, NotificationError> =>
        Effect.tryPromise({
          try: async () => {
            // WhatsApp Business API endpoint
            const url = `${config.apiUrl}/${config.phoneNumberId}/messages`;

            await axios.post(
              url,
              {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: toNumber, // Should be in international format: e.g., "2348012345678"
                type: "text",
                text: {
                  preview_url: false,
                  body: message,
                },
              },
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${config.accessToken}`,
                },
              }
            );

            console.log(`WhatsApp message sent to ${toNumber}`);
          },
          catch: (error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(`WhatsApp send failed to ${toNumber}:`, errorMessage);

            return new NotificationError({
              channel: "whatsapp",
              recipient: toNumber,
              reason: errorMessage,
            });
          },
        });

      return { send };
    })
  );
}
