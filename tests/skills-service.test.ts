import { describe, expect, it } from "vitest";
import { isValidSource } from "@/service/skillsService";

describe("skills service", () => {
  it("validates source format owner/repo", () => {
    expect(isValidSource("vercel-labs/agent-skills")).toBe(true);
    expect(isValidSource("my-org/repo_1")).toBe(true);
    expect(isValidSource("missing-slash")).toBe(false);
    expect(isValidSource("owner/repo/extra")).toBe(false);
    expect(isValidSource("")).toBe(false);
  });
});
