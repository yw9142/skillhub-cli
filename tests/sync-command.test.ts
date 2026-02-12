import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrompt,
  mockConfigStore,
  mockCreateOctokit,
  mockCreateSkillhubGist,
  mockFindSkillhubGist,
  mockGetSkillhubPayload,
  mockUpdateSkillhubGist,
  mockGetLocalSkills,
  mockInstallSkills,
  mockRemoveSkills,
  mockIsValidSource,
  mockEmitOutput,
} = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
  mockConfigStore: {
    getToken: vi.fn(),
    getGistId: vi.fn(),
    setGistId: vi.fn(),
    getLastSyncAt: vi.fn(),
    setLastSyncAt: vi.fn(),
  },
  mockCreateOctokit: vi.fn(),
  mockCreateSkillhubGist: vi.fn(),
  mockFindSkillhubGist: vi.fn(),
  mockGetSkillhubPayload: vi.fn(),
  mockUpdateSkillhubGist: vi.fn(),
  mockGetLocalSkills: vi.fn(),
  mockInstallSkills: vi.fn(),
  mockRemoveSkills: vi.fn(),
  mockIsValidSource: vi.fn(),
  mockEmitOutput: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: {
    prompt: mockPrompt,
  },
}));

vi.mock("@/service/config", () => ({
  configStore: mockConfigStore,
}));

vi.mock("@/service/gistService", () => ({
  createOctokit: mockCreateOctokit,
  createSkillhubGist: mockCreateSkillhubGist,
  findSkillhubGist: mockFindSkillhubGist,
  getSkillhubPayload: mockGetSkillhubPayload,
  updateSkillhubGist: mockUpdateSkillhubGist,
}));

vi.mock("@/service/skillsService", () => ({
  getLocalSkills: mockGetLocalSkills,
  installSkills: mockInstallSkills,
  removeSkills: mockRemoveSkills,
  isValidSource: mockIsValidSource,
}));

vi.mock("@/utils/output", () => ({
  emitOutput: mockEmitOutput,
}));

import {
  runSyncMerge,
  runSyncPull,
  runSyncPush,
} from "@/commands/sync";

describe("sync commands", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateOctokit.mockReturnValue({});
    mockConfigStore.getToken.mockResolvedValue("token");
    mockConfigStore.getGistId.mockResolvedValue("gist-id");
    mockConfigStore.getLastSyncAt.mockResolvedValue(undefined);
    mockGetLocalSkills.mockResolvedValue([{ name: "alpha", source: "org/repo" }]);
    mockGetSkillhubPayload.mockResolvedValue({
      skills: [{ name: "alpha", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFindSkillhubGist.mockResolvedValue(null);
    mockInstallSkills.mockResolvedValue({ succeeded: [], failed: [] });
    mockRemoveSkills.mockResolvedValue({ succeeded: [], failed: [] });
    mockIsValidSource.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
  });

  it("does not mutate config or gist on merge dry-run", async () => {
    await runSyncMerge({ dryRun: true });

    expect(mockCreateSkillhubGist).not.toHaveBeenCalled();
    expect(mockUpdateSkillhubGist).not.toHaveBeenCalled();
    expect(mockInstallSkills).not.toHaveBeenCalled();
    expect(mockRemoveSkills).not.toHaveBeenCalled();
    expect(mockConfigStore.setLastSyncAt).not.toHaveBeenCalled();
    expect(mockConfigStore.setGistId).not.toHaveBeenCalled();
  });

  it("fails pull when remote gist does not exist", async () => {
    mockConfigStore.getGistId.mockResolvedValue(undefined);
    mockFindSkillhubGist.mockResolvedValue(null);

    await expect(runSyncPull()).rejects.toThrow("Remote SkillHub Gist not found");
  });

  it("creates a gist on push when remote gist is missing", async () => {
    mockConfigStore.getGistId.mockResolvedValue(undefined);
    mockFindSkillhubGist.mockResolvedValue(null);
    mockCreateSkillhubGist.mockResolvedValue({ id: "new-gist-id" });

    await runSyncPush();

    expect(mockCreateSkillhubGist).toHaveBeenCalledTimes(1);
    expect(mockConfigStore.setGistId).toHaveBeenCalledWith("new-gist-id");
    expect(mockConfigStore.setLastSyncAt).toHaveBeenCalledTimes(1);
  });

  it("runs install/remove on pull and skips prompt with --yes", async () => {
    mockGetLocalSkills.mockResolvedValue([{ name: "alpha", source: "org/repo" }]);
    mockGetSkillhubPayload.mockResolvedValue({
      skills: [{ name: "beta", source: "org/repo" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockInstallSkills.mockResolvedValue({
      succeeded: [{ name: "beta", source: "org/repo" }],
      failed: [],
    });
    mockRemoveSkills.mockResolvedValue({
      succeeded: [{ name: "alpha", source: "org/repo" }],
      failed: [],
    });

    await runSyncPull({ yes: true });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockInstallSkills).toHaveBeenCalledWith(
      [{ name: "beta", source: "org/repo" }],
      { verbose: true }
    );
    expect(mockRemoveSkills).toHaveBeenCalledWith(
      [{ name: "alpha", source: "org/repo" }],
      { verbose: true }
    );
    expect(mockConfigStore.setLastSyncAt).toHaveBeenCalledTimes(1);
  });

  it("cancels pull when deletion is rejected", async () => {
    mockGetLocalSkills.mockResolvedValue([{ name: "alpha", source: "org/repo" }]);
    mockGetSkillhubPayload.mockResolvedValue({
      skills: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockPrompt.mockResolvedValue({ confirm: false });

    await expect(runSyncPull()).rejects.toThrow("Sync pull cancelled.");
    expect(mockInstallSkills).not.toHaveBeenCalled();
    expect(mockRemoveSkills).not.toHaveBeenCalled();
  });
});
