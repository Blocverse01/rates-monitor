import { Data } from "effect";

export class RateFetchError extends Data.TaggedError("RateFetchError")<{
  readonly source: string;
  readonly reason: string;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string;
  readonly reason: string;
}> {}

export class NotificationError extends Data.TaggedError("NotificationError")<{
  readonly channel: string;
  readonly recipient: string;
  readonly reason: string;
}> {}

export class APIError extends Data.TaggedError("APIError")<{
  readonly endpoint: string;
  readonly statusCode: number;
  readonly message: string;
}> {}
