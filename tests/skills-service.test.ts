import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

import { isValidSource, removeSkills } from "@/service/skillsService";

describe("skills service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("validates source format owner/repo", () => {
    expect(isValidSource("vercel-labs/agent-skills")).toBe(true);
    expect(isValidSource("my-org/repo_1")).toBe(true);
    expect(isValidSource("missing-slash")).toBe(false);
    expect(isValidSource("owner/repo/extra")).toBe(false);
    expect(isValidSource("")).toBe(false);
  });

  it("removes unique skills with the skills CLI command", async () => {
    mockExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, "", "");
      }
    );

    const result = await removeSkills([
      { name: "alpha", source: "org/repo" },
      { name: "alpha", source: "org/repo" },
    ]);

    const expectedCommand = process.platform === "win32" ? "npx.cmd" : "npx";
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith(
      expectedCommand,
      ["skills", "remove", "--skill", "alpha", "--global", "--yes"],
      expect.objectContaining({
        timeout: 120000,
      }),
      expect.any(Function)
    );
    expect(result.succeeded).toEqual([{ name: "alpha", source: "org/repo" }]);
    expect(result.failed).toHaveLength(0);
  });

  it("collects remove failures", async () => {
    mockExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(new Error("remove failed"), "", "");
      }
    );

    const result = await removeSkills([{ name: "alpha", source: "org/repo" }]);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.skill).toEqual({
      name: "alpha",
      source: "org/repo",
    });
    expect(result.failed[0]?.reason).toContain("remove failed");
  });
});
