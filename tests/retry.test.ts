import { describe, expect, it, vi } from "vitest";
import { isTransientError, retryAsync } from "@/utils/retry";

describe("retry utils", () => {
  it("retries transient failures and eventually succeeds", async () => {
    let calls = 0;
    const result = await retryAsync(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error("temporary network issue"), {
            code: "ECONNRESET",
          });
        }
        return "ok";
      },
      { initialDelayMs: 1, factor: 1, maxAttempts: 3 }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("fails after max attempts with attempt count", async () => {
    await expect(
      retryAsync(
        async () => {
          throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
        },
        { initialDelayMs: 1, factor: 1, maxAttempts: 2, label: "sample-op" }
      )
    ).rejects.toThrow("sample-op failed after 2 attempt(s)");
  });

  it("does not retry non-transient errors", async () => {
    const fn = vi.fn(async () => {
      throw new Error("validation failed");
    });

    await expect(
      retryAsync(fn, { maxAttempts: 3, initialDelayMs: 1, factor: 1 })
    ).rejects.toThrow("after 1 attempt(s)");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("detects transient HTTP and socket errors", () => {
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientError({ message: "Request timed out" })).toBe(true);
    expect(isTransientError({ message: "Bad request" })).toBe(false);
  });
});
