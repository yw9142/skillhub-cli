import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { isTransientError, retryAsync } from "@/utils/retry";

const SKILLHUB_FILENAME = "skillhub.json";
const DEFAULT_SKILL_SOURCE_REPO = "vercel-labs/agent-skills";
const GITHUB_TIMEOUT_MS = 10_000;

export type SkillInfo = {
  name: string;
  source: string; // owner/repo format
};

// Backward compatibility: allow legacy payload with string[].
export type SkillhubPayload = {
  skills: SkillInfo[] | string[];
  updatedAt: string;
};

type Gist = RestEndpointMethodTypes["gists"]["list"]["response"]["data"][number];
type GistFile = { filename?: string; content?: string };

function withGitHubRetry<T>(label: string, fn: () => Promise<T>) {
  return retryAsync(fn, { label, shouldRetry: isTransientError });
}

export function createOctokit(token: string) {
  return new Octokit({
    auth: token,
    request: {
      timeout: GITHUB_TIMEOUT_MS,
    },
  });
}

export async function verifyToken(token: string) {
  const octokit = createOctokit(token);
  await withGitHubRetry("users.getAuthenticated", () =>
    octokit.users.getAuthenticated()
  );
  await withGitHubRetry("gists.list", () =>
    octokit.rest.gists.list({ per_page: 1 })
  );
}

export async function checkGistAccess(octokit: Octokit) {
  await withGitHubRetry("gists.list", () =>
    octokit.rest.gists.list({ per_page: 1 })
  );
}

export async function findSkillhubGist(octokit: Octokit) {
  const gists = await withGitHubRetry("gists.paginate", () =>
    octokit.paginate(octokit.rest.gists.list, { per_page: 100 })
  );

  return gists.find((gist: Gist) => {
    const files = Object.values(gist.files ?? {}) as GistFile[];
    return files.some((file) => file?.filename === SKILLHUB_FILENAME);
  });
}

export async function getSkillhubPayload(octokit: Octokit, gistId: string) {
  const gist = await withGitHubRetry("gists.get", () =>
    octokit.gists.get({ gist_id: gistId })
  );
  const file = Object.values(gist.data.files ?? {}).find(
    (item) => item?.filename === SKILLHUB_FILENAME
  ) as GistFile | undefined;

  if (!file?.content) {
    return null;
  }

  try {
    const parsed = JSON.parse(file.content) as SkillhubPayload;
    if (!Array.isArray(parsed.skills)) {
      return null;
    }

    const normalizedSkills = parsed.skills.map((skill) => {
      if (typeof skill === "string") {
        return { name: skill, source: DEFAULT_SKILL_SOURCE_REPO };
      }
      return skill;
    });

    return {
      ...parsed,
      skills: normalizedSkills,
    };
  } catch {
    return null;
  }
}

export async function createSkillhubGist(
  octokit: Octokit,
  payload: SkillhubPayload
) {
  const response = await withGitHubRetry("gists.create", () =>
    octokit.gists.create({
      description: "SkillHub sync",
      public: false,
      files: {
        [SKILLHUB_FILENAME]: {
          content: JSON.stringify(payload, null, 2),
        },
      },
    })
  );

  return response.data;
}

export async function updateSkillhubGist(
  octokit: Octokit,
  gistId: string,
  payload: SkillhubPayload
) {
  await withGitHubRetry("gists.update", () =>
    octokit.gists.update({
      gist_id: gistId,
      files: {
        [SKILLHUB_FILENAME]: {
          content: JSON.stringify(payload, null, 2),
        },
      },
    })
  );
}
