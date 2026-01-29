import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";

const SKILLHUB_FILENAME = "skillhub.json";

export type SkillhubPayload = {
  skills: string[];
  updatedAt: string;
};

type Gist = RestEndpointMethodTypes["gists"]["list"]["response"]["data"][number];
type GistFile = { filename?: string; content?: string };

export function createOctokit(token: string) {
  return new Octokit({ auth: token });
}

export async function verifyToken(token: string) {
  const octokit = createOctokit(token);
  await octokit.users.getAuthenticated();
  // Also verify that the token can actually talk to the Gist API
  // (this catches fine-grained tokens that don't have gist access).
  await octokit.rest.gists.list({ per_page: 1 });
}

export async function findSkillhubGist(octokit: Octokit) {
  const gists = await octokit.paginate(
    octokit.rest.gists.list,
    {
      per_page: 100,
    }
  );

  return gists.find((gist: Gist) => {
    const files = Object.values(gist.files ?? {}) as GistFile[];
    return files.some((file) => file?.filename === SKILLHUB_FILENAME);
  });
}

export async function getSkillhubPayload(octokit: Octokit, gistId: string) {
  const gist = await octokit.gists.get({ gist_id: gistId });
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
    return parsed;
  } catch {
    return null;
  }
}

export async function createSkillhubGist(
  octokit: Octokit,
  payload: SkillhubPayload
) {
  const response = await octokit.gists.create({
    description: "SkillHub sync",
    public: false,
    files: {
      [SKILLHUB_FILENAME]: {
        content: JSON.stringify(payload, null, 2),
      },
    },
  });

  return response.data;
}

export async function updateSkillhubGist(
  octokit: Octokit,
  gistId: string,
  payload: SkillhubPayload
) {
  await octokit.gists.update({
    gist_id: gistId,
    files: {
      [SKILLHUB_FILENAME]: {
        content: JSON.stringify(payload, null, 2),
      },
    },
  });
}
