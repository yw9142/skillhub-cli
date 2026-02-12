import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConfigStore,
  mockCreateOctokit,
  mockCreateSkillhubGist,
  mockFindSkillhubGist,
  mockGetSkillhubPayload,
  mockUpdateSkillhubGist,
  mockGetLocalSkills,
  mockInstallSkills,
  mockIsValidSource,
  mockEmitOutput,
} = vi.hoisted(() => ({
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
  mockIsValidSource: vi.fn(),
  mockEmitOutput: vi.fn(),
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
  isValidSource: mockIsValidSource,
}));

vi.mock("@/utils/output", () => ({
  emitOutput: mockEmitOutput,
}));

import { runSync } from "@/commands/sync";

describe("runSync", () => {
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
    mockIsValidSource.mockReturnValue(true);
  });

  it("does not mutate config or gist when dry-run is enabled", async () => {
    await runSync({ dryRun: true });

    expect(mockCreateSkillhubGist).not.toHaveBeenCalled();
    expect(mockUpdateSkillhubGist).not.toHaveBeenCalled();
    expect(mockInstallSkills).not.toHaveBeenCalled();
    expect(mockConfigStore.setLastSyncAt).not.toHaveBeenCalled();
    expect(mockConfigStore.setGistId).not.toHaveBeenCalled();
  });
});
