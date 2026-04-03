import { Context, Effect, Layer } from "effect";
import axios from "axios";
import * as crypto from "node:crypto";
import { RateFetchError } from "../domain/errors";
import type { TokenType, ByBitTieredRates, ByBitTier } from "../domain/types";

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

// NGN amount boundaries for each rate tier
const TIERS = {
  spot:  { min: 3_000,     max: 100_000    }, // retail/individual
  desk:  { min: 100_000,   max: 2_000_000  }, // commercial/SME
  block: { min: 2_000_000, max: 10_000_000 }, // wholesale/institutional
  BLENDED_MAX: 10_000_000,
  MIN_ADS: 3, // minimum ads required to produce a reliable rate for a tier
} as const;

export class ByBitService extends Context.Tag("ByBitService")<
  ByBitService,
  {
    readonly getP2PRates: (
      tokenId: TokenType,
      side: 0 | 1 // 0 = user wants to sell (merchants buying), 1 = user wants to buy (merchants selling)
    ) => Effect.Effect<readonly ByBitP2PAd[], RateFetchError>;

    readonly getTieredRates: (
      tokenId: TokenType,
      side: 0 | 1 // 0 = user wants to sell (merchants buying), 1 = user wants to buy (merchants selling)
    ) => Effect.Effect<ByBitTieredRates, RateFetchError>;
  }
>() {
  static readonly Live = Layer.effect(
    ByBitService,
    Effect.gen(function* () {
      const config = yield* ByBitConfig;

      // IQR-filtered median over a sorted price list.
      // Returns null when there are fewer than MIN_ADS prices (insufficient data for a tier).
      const computeIQRMedian = (prices: number[]): number | null => {
        if (prices.length < TIERS.MIN_ADS) return null;

        const sorted = [...prices].sort((a, b) => a - b);

        if (sorted.length === 1) return Math.round(sorted[0]!);

        const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
        const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
        const iqr = q3 - q1;
        const lowerFence = q1 - 1.5 * iqr;
        const upperFence = q3 + 1.5 * iqr;

        const inliers = sorted.filter((p) => p >= lowerFence && p <= upperFence);
        const finalPrices = inliers.length > 0 ? inliers : sorted;

        const mid = Math.floor(finalPrices.length / 2);
        const median =
          finalPrices.length % 2 === 0
            ? (finalPrices[mid - 1]! + finalPrices[mid]!) / 2
            : finalPrices[mid]!;

        return Math.round(median);
      };

      // Compute IQR-filtered median for each tier + a blended rate across all tiers.
      const extractTieredRates = (ads: readonly ByBitP2PAd[]): ByBitTieredRates => {
        const pricesForTier = (tier: { min: number; max: number }) =>
          ads
            .filter(
              (ad) =>
                parseFloat(ad.minAmount) <= tier.max &&
                parseFloat(ad.maxAmount) >= tier.min
            )
            .map((ad) => parseFloat(ad.price));

        const blendedPrices = ads
          .filter((ad) => parseFloat(ad.maxAmount) <= TIERS.BLENDED_MAX)
          .map((ad) => parseFloat(ad.price));

        return {
          spot:    computeIQRMedian(pricesForTier(TIERS.spot)),
          desk:    computeIQRMedian(pricesForTier(TIERS.desk)),
          block:   computeIQRMedian(pricesForTier(TIERS.block)),
          blended: computeIQRMedian(blendedPrices),
        };
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
              size: "200", // Increased size for better filtering
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

      const getTieredRates = (
        tokenId: TokenType,
        side: 0 | 1
      ): Effect.Effect<ByBitTieredRates, RateFetchError> =>
        Effect.gen(function* () {
          const ads = yield* getP2PRates(tokenId, side);

          if (ads.length === 0) {
            return yield* Effect.fail(
              new RateFetchError({
                source: "bybit",
                reason: "No rates available",
              })
            );
          }

          const tiers = extractTieredRates(ads);

          console.log(
            `Tiered rates for ${tokenId} (side ${side}):`,
            `spot=${tiers.spot} desk=${tiers.desk} block=${tiers.block} blended=${tiers.blended}`,
            `(${ads.length} reliable ads)`
          );

          return tiers;
        });

      return { getP2PRates, getTieredRates };
    })
  );
}
