import { describe, expect, it } from "vitest";
import {
  areSameSkills,
  buildAutoPlan,
  buildMergePlan,
  buildPullPlan,
  buildPushPlan,
  normalizeSkills,
} from "@/core/syncCore";
import { SkillhubPayload } from "@/service/gistService";

describe("sync core", () => {
  it("keeps legacy string[] payload compatibility", () => {
    const normalized = normalizeSkills(["alpha", "beta"]);
    expect(normalized).toEqual([
      { name: "alpha", source: "vercel-labs/agent-skills" },
      { name: "beta", source: "vercel-labs/agent-skills" },
    ]);
  });

  it("computes merge plan without upload when sets match", () => {
    const localPayload: SkillhubPayload = {
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const remotePayload: SkillhubPayload = {
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const plan = buildMergePlan({
      localPayload,
      remotePayload,
      nowIso: "2026-01-02T00:00:00.000Z",
    });

    expect(plan.mode).toBe("merge");
    expect(plan.installCandidates).toHaveLength(0);
    expect(plan.uploadPayload).toBeNull();
  });

  it("computes auto plan using remote.updatedAt and lastSyncAt", () => {
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

    const plan = buildAutoPlan({
      localPayload,
      remotePayload,
      lastSyncAt: "2026-01-02T00:00:00.000Z",
      nowIso: "2026-01-04T00:00:00.000Z",
    });

    expect(plan.mode).toBe("auto");
    expect(plan.isRemoteNewer).toBe(true);
    expect(plan.installCandidates).toEqual([{ name: "beta", source: "org/repo" }]);
    expect(plan.uploadPayload).toBeNull();
  });

  it("computes pull plan install and remove candidates", () => {
    const localPayload: SkillhubPayload = {
      skills: [
        { name: "alpha", source: "org/repo" },
        { name: "gamma", source: "org/repo" },
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const remotePayload: SkillhubPayload = {
      skills: [
        { name: "alpha", source: "org/repo" },
        { name: "beta", source: "org/repo" },
      ],
      updatedAt: "2026-01-03T00:00:00.000Z",
    };

    const plan = buildPullPlan({
      localPayload,
      remotePayload,
    });

    expect(plan.mode).toBe("pull");
    expect(plan.installCandidates).toEqual([{ name: "beta", source: "org/repo" }]);
    expect(plan.removeCandidates).toEqual([{ name: "gamma", source: "org/repo" }]);
  });

  it("computes push upload payload when local and remote differ", () => {
    const localPayload: SkillhubPayload = {
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const remotePayload: SkillhubPayload = {
      skills: [{ name: "beta", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const plan = buildPushPlan({
      localPayload,
      remotePayload,
      nowIso: "2026-01-05T00:00:00.000Z",
    });

    expect(plan.mode).toBe("push");
    expect(plan.uploadPayload).toEqual({
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
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
