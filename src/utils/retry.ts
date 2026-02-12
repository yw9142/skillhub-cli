export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  factor?: number;
  shouldRetry?: (error: unknown) => boolean;
  label?: string;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 300;
const DEFAULT_FACTOR = 3;

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ESOCKETTIMEDOUT",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
  "ABORT_ERR",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isTransientError(error: unknown) {
  const candidate = error as {
    code?: string;
    status?: number;
    message?: string;
  };

  if (typeof candidate.status === "number") {
    return candidate.status === 429 || candidate.status >= 500;
  }

  if (candidate.code && TRANSIENT_ERROR_CODES.has(candidate.code)) {
    return true;
  }

  const message = `${candidate.message ?? ""}`.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("socket hang up") ||
    message.includes("temporarily unavailable") ||
    message.includes("econnreset")
  );
}

export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const factor = options.factor ?? DEFAULT_FACTOR;
  const shouldRetry = options.shouldRetry ?? isTransientError;

  let delayMs = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && shouldRetry(error);
      if (!canRetry) {
        const labelPrefix = options.label ? `${options.label} failed` : "Operation failed";
        throw new Error(
          `${labelPrefix} after ${attempt} attempt(s): ${getErrorMessage(error)}`
        );
      }

      await sleep(delayMs);
      delayMs *= factor;
    }
  }

  throw new Error(getErrorMessage(lastError));
}
