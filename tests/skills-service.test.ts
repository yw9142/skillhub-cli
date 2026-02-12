import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile, mockReadFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mockReadFile,
  },
  readFile: mockReadFile,
}));

import { getLocalSkills, isValidSource, removeSkills } from "@/service/skillsService";

describe("skills service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReadFile.mockRejectedValue(new Error("not found"));
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

  it("hydrates skill sources from .skill-lock.json metadata", async () => {
    mockExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(
          null,
          [
            "Global Skills",
            "",
            "building-native-ui ~/.agents/skills/building-native-ui",
            "  Agents: Claude Code",
            "web-design-guidelines ~/.agents/skills/web-design-guidelines",
            "  Agents: Claude Code",
          ].join("\n"),
          ""
        );
      }
    );

    mockReadFile.mockImplementation(async (lockPath: string) => {
      if (lockPath.replace(/\\/g, "/").endsWith("/.agents/.skill-lock.json")) {
        return JSON.stringify({
          version: 3,
          skills: {
            "building-native-ui": {
              source: "expo/skills",
            },
            "web-design-guidelines": {
              source: "vercel-labs/agent-skills",
            },
          },
        });
      }
      throw new Error("not found");
    });

    const skills = await getLocalSkills();

    expect(skills).toEqual([
      {
        name: "building-native-ui",
        source: "expo/skills",
      },
      {
        name: "web-design-guidelines",
        source: "vercel-labs/agent-skills",
      },
    ]);
  });
});
