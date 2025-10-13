import { Effect, Layer } from "effect";
import { EmailService, SMTPConfig } from "../../src/infrastructure/EmailService";

const testEmailProgram = Effect.gen(function* () {
    const email = yield* EmailService;

    yield* email.send(
        "test@example.com",
        "Test Email from Rate Monitor",
        "This is a test email to verify SMTP configuration."
    );

    console.log("Test email sent!");
});

// Run with your SMTP config
const TestSMTPConfig = Layer.succeed(SMTPConfig, {
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT!),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
    },
    fromEmail: process.env.SMTP_FROM_EMAIL!,
    fromName: "Rate Monitor Test",
});

Effect.runPromise(
    testEmailProgram.pipe(
        Effect.provide(EmailService.Live),
        Effect.provide(TestSMTPConfig)
    )
);