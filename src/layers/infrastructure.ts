import { Layer } from "effect";
import { RedisService } from "../infrastructure/RedisService";
import { WhatsAppService } from "../infrastructure/WhatsAppService";
import { EmailService } from "../infrastructure/EmailService";

export const InfrastructureLayerLive = Layer.mergeAll(
  RedisService.Live,
  WhatsAppService.Live,
  EmailService.Live
);
