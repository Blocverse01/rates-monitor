import { Effect } from "effect";
import { WhatsAppService, WhatsAppConfig } from "../../src/infrastructure/WhatsAppService";
import { Layer } from "effect";

const testWhatsAppProgram = Effect.gen(function* () {
    const whatsapp = yield* WhatsAppService;

    yield* whatsapp.send(
        "2348012345678", // Your test number
        "🧪 Test message from rate monitor"
    );

    console.log("WhatsApp test message sent!");
});

// Run with your config
const TestWhatsAppConfig = Layer.succeed(WhatsAppConfig, {
    apiUrl: "https://graph.facebook.com/v18.0",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
});

Effect.runPromise(
    testWhatsAppProgram.pipe(
        Effect.provide(WhatsAppService.Live),
        Effect.provide(TestWhatsAppConfig)
    )
);