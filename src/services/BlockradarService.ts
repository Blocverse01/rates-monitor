import { Context, Effect, Layer } from "effect";
import axios from "axios";
import { RateFetchError } from "../domain/errors";
import type { TokenType } from "../domain/types";

export type ChainType = "BASE" | "BEP20";
export type AssetPair = Exclude<
  `${TokenType}_${ChainType}` | `CNGN_${ChainType}`,
  "USDT_BASE"
>;

export interface BlockradarConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly walletIds: {
    readonly BASE: string;
    readonly BEP20: string;
  };
  readonly assetIds: {
    readonly USDC_BASE: string;
    readonly USDT_BEP20: string;
    readonly USDC_BEP20: string;
    readonly CNGN_BASE: string;
    readonly CNGN_BEP20: string;
  };
}

export const BlockradarConfig =
  Context.GenericTag<BlockradarConfig>("BlockradarConfig");

interface CNGNQuote {
  rate: number;
  amount: number;
  timestamp: number;
}

export class BlockradarService extends Context.Tag("BlockradarService")<
  BlockradarService,
  {
    readonly getCNGNQuote: (
      fromToken: TokenType,
      chain: ChainType,
      amount?: number
    ) => Effect.Effect<CNGNQuote, RateFetchError>;
  }
>() {
  static readonly Live = Layer.effect(
    BlockradarService,
    Effect.gen(function* () {
      const config = yield* BlockradarConfig;

      const getCNGNQuote = (
        fromToken: TokenType,
        chain: ChainType,
        amount: number = 1
      ): Effect.Effect<CNGNQuote, RateFetchError> =>
        Effect.tryPromise({
          try: async () => {
            // Get asset IDs based on token and chain
            const fromAssetId =
              config.assetIds[`${fromToken}_${chain}` as AssetPair];
            const toAssetId = config.assetIds[`CNGN_${chain}` as AssetPair];

            const response = await axios.post(
              `${config.baseUrl}/v1/wallets/${config.walletIds[chain]}/swaps/quote`,
              {
                fromAssetId,
                toAssetId,
                amount: amount.toString(),
              },
              {
                headers: {
                  "x-api-key": config.apiKey,
                  "Content-Type": "application/json",
                },
              }
            );

            return {
              rate: response.data.data.rate,
              amount: parseFloat(response.data.data.amount),
              timestamp: Date.now(),
            };
          },
          catch: (error) =>
            new RateFetchError({
              source: `cngn_${chain.toLowerCase()}`,
              reason: error instanceof Error ? error.message : String(error),
            }),
        });

      return { getCNGNQuote };
    })
  );
}
