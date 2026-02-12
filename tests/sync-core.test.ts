import { describe, expect, it } from "vitest";
import {
  areSameSkills,
  buildSyncPlan,
  normalizeSkills,
  parseStrategy,
} from "@/core/syncCore";
import { SkillhubPayload } from "@/service/gistService";

describe("sync core", () => {
  it("parses default strategy", () => {
    expect(parseStrategy(undefined)).toBe("union");
  });

  it("rejects invalid strategy", () => {
    expect(() => parseStrategy("invalid")).toThrow(
      'Invalid strategy "invalid". Use one of: union, latest.'
    );
  });

  it("keeps legacy string[] payload compatibility", () => {
    const normalized = normalizeSkills(["alpha", "beta"]);
    expect(normalized).toEqual([
      { name: "alpha", source: "vercel-labs/agent-skills" },
      { name: "beta", source: "vercel-labs/agent-skills" },
    ]);
  });

  it("computes union plan without upload when sets match", () => {
    const localPayload: SkillhubPayload = {
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const remotePayload: SkillhubPayload = {
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const plan = buildSyncPlan({
      strategy: "union",
      localPayload,
      remotePayload,
      nowIso: "2026-01-02T00:00:00.000Z",
    });

    expect(plan.installCandidates).toHaveLength(0);
    expect(plan.uploadPayload).toBeNull();
  });

  it("computes latest strategy using remote.updatedAt and lastSyncAt", () => {
    const localPayload: SkillhubPayload = {
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const remotePayload: SkillhubPayload = {
      skills: [
        { name: "alpha", source: "org/repo" },
        { name: "beta", source: "org/repo" },
      ],
      updatedAt: "2026-01-03T00:00:00.000Z",
    };

    const plan = buildSyncPlan({
      strategy: "latest",
      localPayload,
      remotePayload,
      lastSyncAt: "2026-01-02T00:00:00.000Z",
      nowIso: "2026-01-04T00:00:00.000Z",
    });

    expect(plan.isRemoteNewer).toBe(true);
    expect(plan.installCandidates).toEqual([{ name: "beta", source: "org/repo" }]);
    expect(plan.uploadPayload).toBeNull();
  });

  it("compares skill sets deterministically", () => {
    const a = [
      { name: "b", source: "org/repo" },
      { name: "a", source: "org/repo" },
    ];
    const b = [
      { name: "a", source: "org/repo" },
      { name: "b", source: "org/repo" },
    ];
    expect(areSameSkills(a, b)).toBe(true);
  });
});
