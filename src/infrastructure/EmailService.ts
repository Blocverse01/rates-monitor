import { Context, Effect, Layer } from "effect";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { NotificationError } from "../domain/errors";

export interface SMTPConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean; // true for 465, false for other ports
  readonly auth: {
    readonly user: string;
    readonly pass: string;
  };
  readonly fromEmail: string;
  readonly fromName?: string;
}

export const SMTPConfig = Context.GenericTag<SMTPConfig>("SMTPConfig");

export class EmailService extends Context.Tag("EmailService")<
  EmailService,
  {
    readonly send: (
      to: string,
      subject: string,
      text: string
    ) => Effect.Effect<void, NotificationError>;
    readonly sendHtml: (
      to: string,
      subject: string,
      html: string
    ) => Effect.Effect<void, NotificationError>;
  }
>() {
  static readonly Live = Layer.effect(
    EmailService,
    Effect.gen(function* () {
      const config = yield* SMTPConfig;

      // Create reusable transporter
      const transporter: Transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.auth.user,
          pass: config.auth.pass,
        },
      });

      // Verify SMTP connection on startup
      yield* Effect.tryPromise({
        try: () => transporter.verify(),
        catch: (error) => {
          console.error("SMTP connection failed:", error);
          return new NotificationError({
            channel: "email",
            recipient: "smtp_server",
            reason: error instanceof Error ? error.message : String(error),
          });
        },
      });

      console.log("SMTP server connection verified");

      const send = (
        to: string,
        subject: string,
        text: string
      ): Effect.Effect<void, NotificationError> =>
        Effect.tryPromise({
          try: async () => {
            await transporter.sendMail({
              from: config.fromName
                ? `"${config.fromName}" <${config.fromEmail}>`
                : config.fromEmail,
              to,
              subject,
              text,
              html: text.replace(/\n/g, "<br>"),
            });

            console.log(`Email sent to ${to}`);
          },
          catch: (error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(`Email send failed to ${to}:`, errorMessage);

            return new NotificationError({
              channel: "email",
              recipient: to,
              reason: errorMessage,
            });
          },
        });

      const sendHtml = (
        to: string,
        subject: string,
        html: string
      ): Effect.Effect<void, NotificationError> =>
        Effect.tryPromise({
          try: async () => {
            await transporter.sendMail({
              from: config.fromName
                ? `"${config.fromName}" <${config.fromEmail}>`
                : config.fromEmail,
              to,
              subject,
              html,
            });

            console.log(`HTML email sent to ${to}`);
          },
          catch: (error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(`HTML email send failed to ${to}:`, errorMessage);

            return new NotificationError({
              channel: "email",
              recipient: to,
              reason: errorMessage,
            });
          },
        });

      return { send, sendHtml };
    })
  );
}
