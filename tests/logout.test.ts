import { describe, expect, it, vi } from "vitest";
import { clearStoredSession } from "@/commands/logout";

describe("logout", () => {
  it("clears all stored session keys through store interface", async () => {
    const store = {
      clearSession: vi.fn(async () => {}),
    };

    const removed = await clearStoredSession(store);
    expect(store.clearSession).toHaveBeenCalledTimes(1);
    expect(removed).toEqual(["githubToken", "gistId", "lastSyncAt"]);
  });
});
