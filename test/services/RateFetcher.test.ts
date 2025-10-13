import { Effect, Layer } from "effect";
import { RateFetcherService } from "../../src/services/RateFetcherService";
import { ByBitService } from "../../src/services/ByBitService";
import { BlockradarService } from "../../src/services/BlockradarService";
import { RedisService } from "../../src/infrastructure/RedisService";

// Mock layers for testing
const MockByBitLayer = Layer.succeed(
    ByBitService,
    ByBitService.of({
        getBestRate: () => Effect.succeed(1650),
        getP2PRates: () => Effect.succeed([]),
    })
);

const MockBlockradarLayer = Layer.succeed(
    BlockradarService,
    BlockradarService.of({
        getCNGNQuote: () => Effect.succeed({ rate: 1645, amount: 1, timestamp: Date.now() }),
    })
);

const MockRedisLayer = Layer.succeed(
    RedisService,
    RedisService.of({
        get: () => Effect.succeed(null),
        set: () => Effect.succeed(undefined),
        getNumber: () => Effect.succeed(null),
        setNumber: () => Effect.succeed(undefined),
    })
);

// Run test
const testProgram = Effect.gen(function* () {
    const rateFetcher = yield* RateFetcherService;
    const rates = yield* rateFetcher.fetchAllRates();

    console.assert(rates.length > 0);
});

Effect.runPromise(
    testProgram.pipe(
        Effect.provide(RateFetcherService.Live),
        Effect.provide(MockByBitLayer),
        Effect.provide(MockBlockradarLayer),
        Effect.provide(MockRedisLayer)
    )
);