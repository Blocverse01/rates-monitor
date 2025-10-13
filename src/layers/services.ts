import { Layer } from "effect";
import { ByBitService } from "../services/ByBitService";
import { BlockradarService } from "../services/BlockradarService";
import { RateFetcherService } from "../services/RateFetcherService";
import { SpreadCalculatorService } from "../services/SpreadCalculatorService";
import { VolatilityDetectorService } from "../services/VolatilityDetectorService";
import { AlertManagerService } from "../services/AlertManagerService";
import { DailyAggregationService } from "../services/DailyAggregationService";
import { InfrastructureLayerLive } from "./infrastructure";
import { ConfigLayerLive } from "./config";

export const ServicesLayerLive = Layer.mergeAll(
  ByBitService.Live,
  BlockradarService.Live,
  RateFetcherService.Live.pipe(
    Layer.provide(ByBitService.Live),
    Layer.provide(BlockradarService.Live)
  ),
  SpreadCalculatorService.Live,
  VolatilityDetectorService.Live,
  AlertManagerService.Live,
  DailyAggregationService.Live
)
  .pipe(Layer.provide(InfrastructureLayerLive))
  .pipe(Layer.provide(ConfigLayerLive));
