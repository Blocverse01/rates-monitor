import { Context, Effect, Layer } from "effect";
import axios from "axios";
import * as crypto from "node:crypto";
import { RateFetchError } from "../domain/errors";
import type { TokenType } from "../domain/types";

export interface ByBitConfig {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly baseUrl: string;
}

export const ByBitConfig = Context.GenericTag<ByBitConfig>("ByBitConfig");

// ByBit P2P API Types
interface SymbolInfo {
  readonly id: string;
  readonly exchangeId: string;
  readonly orgId: string;
  readonly tokenId: string;
  readonly currencyId: string;
  readonly status: number;
  readonly lowerLimitAlarm: number;
  readonly upperLimitAlarm: number;
  readonly itemDownRange: string;
  readonly itemUpRange: string;
  readonly currencyMinQuote: string;
  readonly currencyMaxQuote: string;
  readonly currencyLowerMaxQuote: string;
  readonly tokenMinQuote: string;
  readonly tokenMaxQuote: string;
  readonly kycCurrencyLimit: string;
  readonly itemSideLimit: number;
  readonly buyFeeRate: string;
  readonly sellFeeRate: string;
  readonly orderAutoCancelMinute: number;
  readonly orderFinishMinute: number;
  readonly tradeSide: number;
  readonly currency: object;
  readonly token: object;
  readonly buyAd: object | null;
  readonly sellAd: object | null;
}

interface TradingPreferenceSet {
  readonly hasUnPostAd: number;
  readonly isKyc: number;
  readonly isEmail: number;
  readonly isMobile: number;
  readonly hasRegisterTime: number;
  readonly registerTimeThreshold: number;
  readonly orderFinishNumberDay30: number;
  readonly completeRateDay30: string;
  readonly nationalLimit: string;
  readonly hasOrderFinishNumberDay30: number;
  readonly hasCompleteRateDay30: number;
  readonly hasNationalLimit: number;
}

export interface ByBitP2PAd {
  readonly id: string;
  readonly accountId: string;
  readonly userId: string;
  readonly nickName: string;
  readonly tokenId: string;
  readonly tokenName: string;
  readonly currencyId: string;
  readonly side: number;
  readonly priceType: number;
  readonly price: string;
  readonly premium: string;
  readonly lastQuantity: string;
  readonly quantity: string;
  readonly frozenQuantity: string;
  readonly executedQuantity: string;
  readonly minAmount: string;
  readonly maxAmount: string;
  readonly remark: string;
  readonly status: number;
  readonly createDate: string;
  readonly payments: readonly string[];
  readonly orderNum: number;
  readonly finishNum: number;
  readonly recentOrderNum: number;
  readonly recentExecuteRate: number;
  readonly fee: string;
  readonly isOnline: boolean;
  readonly lastLogoutTime: string;
  readonly blocked: string;
  readonly makerContact: boolean;
  readonly symbolInfo: SymbolInfo;
  readonly tradingPreferenceSet: TradingPreferenceSet;
  readonly version: number;
  readonly authStatus: number;
  readonly recommend: boolean;
  readonly recommendTag: string;
  readonly authTag: readonly string[];
  readonly userType: "PERSONAL" | "ORG";
  readonly itemType: string;
  readonly paymentPeriod: number;
  readonly userMaskId: string;
  readonly verificationOrderSwitch: boolean;
  readonly verificationOrderLabels: readonly string[];
  readonly verificationOrderAmount: string;
  readonly ban: boolean;
  readonly baned: boolean;
}

interface ByBitP2PResponse {
  readonly result: {
    readonly items: readonly ByBitP2PAd[];
    readonly count: string;
  };
  readonly retCode: number;
  readonly retMsg: string;
}

// Rate selection criteria for reliable NGN trades
const RELIABILITY_THRESHOLDS = {
  MIN_COMPLETION_RATE: 95,
  MIN_ORDER_COUNT: 10,
  REQUIRED_AUTH_STATUS: 1,
  REQUIRED_PAYMENT_METHOD: "14", // Bank Transfer
} as const;

export class ByBitService extends Context.Tag("ByBitService")<
  ByBitService,
  {
    readonly getP2PRates: (
      tokenId: TokenType,
      side: 0 | 1 // 0 = user wants to sell (merchants buying), 1 = user wants to buy (merchants selling)
    ) => Effect.Effect<readonly ByBitP2PAd[], RateFetchError>;

    readonly getBestRate: (
      tokenId: TokenType,
      side: 0 | 1 // 0 = user wants to sell (merchants buying), 1 = user wants to buy (merchants selling)
    ) => Effect.Effect<number, RateFetchError>;
  }
>() {
  static readonly Live = Layer.effect(
    ByBitService,
    Effect.gen(function* () {
      const config = yield* ByBitConfig;

      // Calculate mode (most frequent value) from an array of numbers
      const calculateMode = (numbers: number[]): number => {
        const frequency = new Map<number, number>();

        for (const num of numbers) {
          frequency.set(num, (frequency.get(num) || 0) + 1);
        }

        let maxCount = 0;
        let mode = numbers[0];

        for (const [value, count] of frequency.entries()) {
          if (count > maxCount) {
            maxCount = count;
            mode = value;
          }
        }

        return mode!;
      };

      // Extract market rate from reliable ads using retail volume filtering
      const extractMarketRate = (ads: readonly ByBitP2PAd[]): number => {
        // Filter for retail-volume ads to avoid high-volume premium bias (3K-500K NGN)
        const retailVolumeAds = ads.filter(
          (ad) =>
            parseFloat(ad.minAmount) <= 500000 &&
            parseFloat(ad.maxAmount) >= 3000
        );

        if (retailVolumeAds.length === 0) {
          // Fallback to all ads if no retail volume ads found
          const allRates = ads.map((ad) => Math.trunc(parseFloat(ad.price)));
          return calculateMode(allRates);
        }

        // Get whole number part and find the most common (market consensus)
        const wholeNumberRates = retailVolumeAds.map((ad) =>
          Math.trunc(parseFloat(ad.price))
        );
        return calculateMode(wholeNumberRates);
      };

      // Filter ads for reliable bank transfer merchants
      const filterReliableAds = (ads: readonly ByBitP2PAd[]): ByBitP2PAd[] => {
        return ads
          .filter((ad) => {
            // Must have bank transfer payment method
            const hasBankTransfer = ad.payments.includes(
              RELIABILITY_THRESHOLDS.REQUIRED_PAYMENT_METHOD
            );

            // Must meet reliability criteria
            const isReliable =
              ad.recentExecuteRate >=
                RELIABILITY_THRESHOLDS.MIN_COMPLETION_RATE &&
              ad.orderNum >= RELIABILITY_THRESHOLDS.MIN_ORDER_COUNT &&
              ad.authStatus === RELIABILITY_THRESHOLDS.REQUIRED_AUTH_STATUS;

            // Must be online and not banned
            const isAvailable = ad.isOnline && !ad.ban && !ad.baned;

            // Must have KYC verification
            const isVerified = ad.tradingPreferenceSet.isKyc === 1;

            return hasBankTransfer && isReliable && isAvailable && isVerified;
          })
          .sort((a, b) => {
            // Sort by reliability score (completion rate + order count)
            const scoreA = a.recentExecuteRate + a.orderNum / 100;
            const scoreB = b.recentExecuteRate + b.orderNum / 100;
            return scoreB - scoreA;
          });
      };

      const getP2PRates = (
        tokenId: TokenType,
        side: 0 | 1
      ): Effect.Effect<readonly ByBitP2PAd[], RateFetchError> =>
        Effect.tryPromise({
          try: async () => {
            const timestamp = Date.now().toString();
            const recvWindow = "5000";

            const body = {
              tokenId,
              currencyId: "NGN",
              side: side.toString(),
              size: "50", // Increased size for better filtering
            };

            // For POST requests: timestamp + api_key + recv_window + jsonBodyString
            const jsonBody = JSON.stringify(body);
            const signString =
              timestamp + config.apiKey + recvWindow + jsonBody;

            const signature = crypto
              .createHmac("sha256", config.apiSecret)
              .update(signString)
              .digest("hex");

            const response = await axios.post<ByBitP2PResponse>(
              `${config.baseUrl}/v5/p2p/item/online`,
              body,
              {
                headers: {
                  "Content-Type": "application/json",
                  "X-BAPI-API-KEY": config.apiKey,
                  "X-BAPI-TIMESTAMP": timestamp,
                  "X-BAPI-SIGN": signature,
                  "X-BAPI-RECV-WINDOW": recvWindow,
                },
              }
            );

            console.log(response);

            const allAds = response.data.result.items || [];
            const filteredAds = filterReliableAds(allAds);

            console.log(
              `Total ads: ${allAds.length}, Filtered reliable bank transfer ads: ${filteredAds.length}`
            );

            return filteredAds;
          },
          catch: (error) =>
            new RateFetchError({
              source: "bybit",
              reason: error instanceof Error ? error.message : String(error),
            }),
        });

      const getBestRate = (
        tokenId: TokenType,
        side: 0 | 1
      ): Effect.Effect<number, RateFetchError> =>
        Effect.gen(function* () {
          const rates = yield* getP2PRates(tokenId, side);

          if (rates.length === 0) {
            return yield* Effect.fail(
              new RateFetchError({
                source: "bybit",
                reason: "No rates available",
              })
            );
          }

          // Extract unbiased market rate using retail volume filtering and mode calculation
          const marketRate = extractMarketRate(rates);

          console.log(
            `Market rate extracted for ${tokenId} (side ${side}): ${marketRate} NGN`
          );
          console.log(
            `Based on ${rates.length} reliable ads, filtered for 3K-500K NGN volume range`
          );

          return marketRate;
        });

      return { getP2PRates, getBestRate };
    })
  );
}
