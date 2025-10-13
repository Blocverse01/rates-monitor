import { Layer } from "effect";
import { ByBitConfig } from "../services/ByBitService";
import { BlockradarConfig } from "../services/BlockradarService";
import { RedisConfig } from "../infrastructure/RedisService";
import { WhatsAppConfig } from "../infrastructure/WhatsAppService";
import { SMTPConfig } from "../infrastructure/EmailService";
import { VolatilityConfig } from "../services/VolatilityDetectorService";
import { AlertConfigTag } from "../services/AlertManagerService";

export const ConfigLayerLive = Layer.mergeAll(
  Layer.succeed(ByBitConfig, {
    apiKey: process.env.BYBIT_API_KEY!,
    apiSecret: process.env.BYBIT_API_SECRET!,
    baseUrl: "https://api.bybit.com",
  }),
  Layer.succeed(BlockradarConfig, {
    apiKey: process.env.BLOCKRADAR_API_KEY!,
    baseUrl: process.env.BLOCKRADAR_BASE_URL!,
    walletIds: {
      BASE: "006bfc36-7c04-4d6f-acf4-8bc7a5e2ed3b",
      BEP20: "59369735-9b6a-4575-b5ea-054773047589",
    },
    assetIds: {
      USDC_BASE: "d504c83c-5c99-41a9-a8e2-ef56166643c3",
      USDT_BEP20: "7c56a91a-d98c-4a22-afe8-282bbe30539e",
      USDC_BEP20: "f2e5ad81-a3a0-4a70-a047-5a6c5abe3566",
      CNGN_BASE: "ed810307-423b-4185-9d1d-33778824a434",
      CNGN_BEP20: "73e146a3-019c-48f5-a9c3-304c91a25818",
    },
  }),
  Layer.succeed(RedisConfig, {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  }),
  Layer.succeed(WhatsAppConfig, {
    apiUrl: process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v18.0",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  }),
  Layer.succeed(SMTPConfig, {
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
    fromEmail: process.env.SMTP_FROM_EMAIL!,
    fromName: process.env.SMTP_FROM_NAME || "Rate Monitor",
  }),
  Layer.succeed(VolatilityConfig, {
    threshold: parseFloat(process.env.VOLATILITY_THRESHOLD || "2"),
  }),
  Layer.succeed(AlertConfigTag, {
    spreadThreshold: parseFloat(process.env.SPREAD_THRESHOLD || "3"),
    volatilityThreshold: parseFloat(process.env.VOLATILITY_THRESHOLD || "2"),
    recipients: {
      whatsapp: process.env.ALERT_WHATSAPP_NUMBERS!.split(","),
      email: process.env.ALERT_EMAILS!.split(","),
    },
  })
);
