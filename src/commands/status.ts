import { configStore } from "@/service/config";
import { checkGistAccess, createOctokit } from "@/service/gistService";
import { getLocalSkills } from "@/service/skillsService";
import { emitOutput } from "@/utils/output";

export type RunStatusOptions = {
  json?: boolean;
};

type StatusSummary = {
  loggedIn: boolean;
  gistId: string | null;
  lastSyncAt: string | null;
  localSkillCount: number | null;
  remoteAccessible: boolean | null;
  errors: string[];
};

function formatStatusSummary(summary: StatusSummary) {
  const lines = [
    `loggedIn=${summary.loggedIn}`,
    `gistId=${summary.gistId ?? "none"}`,
    `lastSyncAt=${summary.lastSyncAt ?? "none"}`,
    `localSkillCount=${
      summary.localSkillCount === null ? "unavailable" : String(summary.localSkillCount)
    }`,
    `remoteAccessible=${
      summary.remoteAccessible === null
        ? "unknown"
        : String(summary.remoteAccessible)
    }`,
  ];

  if (summary.errors.length > 0) {
    lines.push(`errors=${summary.errors.length}`);
    for (const error of summary.errors) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join("\n");
}

export async function runStatus(options: RunStatusOptions = {}) {
  const asJson = options.json === true;
  const token = await configStore.getToken();
  const gistId = await configStore.getGistId();
  const lastSyncAt = await configStore.getLastSyncAt();

  const summary: StatusSummary = {
    loggedIn: Boolean(token),
    gistId: gistId ?? null,
    lastSyncAt: lastSyncAt ?? null,
    localSkillCount: null,
    remoteAccessible: token ? null : false,
    errors: [],
  };

  try {
    const localSkills = await getLocalSkills();
    summary.localSkillCount = localSkills.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(`Failed to read local skills: ${message}`);
  }

  if (token) {
    try {
      const octokit = createOctokit(token);
      await checkGistAccess(octokit);
      summary.remoteAccessible = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.remoteAccessible = false;
      summary.errors.push(`Failed to access GitHub Gist API: ${message}`);
    }
  }

  emitOutput(summary, asJson, formatStatusSummary);
  return summary;
}
