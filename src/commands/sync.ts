import { buildSyncPlan, parseStrategy } from "@/core/syncCore";
import { configStore } from "@/service/config";
import {
  createOctokit,
  createSkillhubGist,
  findSkillhubGist,
  getSkillhubPayload,
  SkillhubPayload,
  updateSkillhubGist,
} from "@/service/gistService";
import { getLocalSkills, installSkills, InstallFailure, isValidSource } from "@/service/skillsService";
import { emitOutput } from "@/utils/output";

export type RunSyncOptions = {
  strategyInput?: string;
  dryRun?: boolean;
  json?: boolean;
};

type SyncSummary = {
  ok: boolean;
  strategy: "union" | "latest";
  dryRun: boolean;
  gistFound: boolean;
  gistCreated: boolean;
  remoteNewer: boolean | null;
  uploaded: number;
  installPlanned: number;
  installed: number;
  failed: InstallFailure[];
  lastSyncAtUpdated: boolean;
};

function formatSyncSummary(summary: SyncSummary) {
  const prefix = summary.dryRun ? "Dry-run" : "Sync";
  const failurePart =
    summary.failed.length > 0
      ? ` (${summary.failed.length} failed - check logs or JSON output)`
      : "";

  const actionLine = summary.dryRun
    ? `${prefix}: would upload ${summary.uploaded} change(s), would install ${summary.installPlanned} skill(s)`
    : `${prefix}: uploaded ${summary.uploaded} change(s), installed ${summary.installed} skill(s)`;

  const details = [
    actionLine + failurePart,
    `strategy=${summary.strategy}`,
    `gistFound=${summary.gistFound}`,
    `gistCreated=${summary.gistCreated}`,
    `remoteNewer=${
      summary.remoteNewer === null ? "n/a" : String(summary.remoteNewer)
    }`,
    `lastSyncAtUpdated=${summary.lastSyncAtUpdated}`,
  ];

  return details.join("\n");
}

async function resolveRemotePayload(token: string) {
  const octokit = createOctokit(token);
  let gistId = await configStore.getGistId();
  let remotePayload: SkillhubPayload | null = null;

  if (gistId) {
    remotePayload = await safeGetPayload(octokit, gistId);
    if (!remotePayload) {
      gistId = undefined;
    }
  }

  if (!gistId) {
    const found = await findSkillhubGist(octokit);
    if (found?.id) {
      gistId = found.id;
      await configStore.setGistId(found.id);
      remotePayload = await safeGetPayload(octokit, found.id);
    }
  }

  return {
    octokit,
    gistId,
    remotePayload: remotePayload ?? { skills: [], updatedAt: "" },
  };
}

async function safeGetPayload(
  octokit: ReturnType<typeof createOctokit>,
  gistId: string
) {
  try {
    return await getSkillhubPayload(octokit, gistId);
  } catch {
    return null;
  }
}

function createSummaryFromPlan(params: {
  strategy: "union" | "latest";
  dryRun: boolean;
  gistFound: boolean;
  gistCreated: boolean;
  remoteNewer: boolean | null;
  uploaded: number;
  installPlanned: number;
  installed: number;
  failed: InstallFailure[];
  lastSyncAtUpdated: boolean;
}): SyncSummary {
  return {
    ok: params.failed.length === 0,
    strategy: params.strategy,
    dryRun: params.dryRun,
    gistFound: params.gistFound,
    gistCreated: params.gistCreated,
    remoteNewer: params.remoteNewer,
    uploaded: params.uploaded,
    installPlanned: params.installPlanned,
    installed: params.installed,
    failed: params.failed,
    lastSyncAtUpdated: params.lastSyncAtUpdated,
  };
}

export async function runSync(options: RunSyncOptions = {}) {
  const strategy = parseStrategy(options.strategyInput);
  const dryRun = options.dryRun === true;
  const asJson = options.json === true;

  const token = await configStore.getToken();
  if (!token) {
    throw new Error("You must login first. Run `skillhub login` and try again.");
  }

  const nowIso = new Date().toISOString();
  const localSkills = await getLocalSkills();
  const localPayload: SkillhubPayload = {
    skills: localSkills,
    updatedAt: nowIso,
  };

  const { octokit, gistId, remotePayload } = await resolveRemotePayload(token);
  const hasRemoteGist = Boolean(gistId);

  if (!hasRemoteGist) {
    if (dryRun) {
      const summary = createSummaryFromPlan({
        strategy,
        dryRun: true,
        gistFound: false,
        gistCreated: false,
        remoteNewer: null,
        uploaded: 1,
        installPlanned: 0,
        installed: 0,
        failed: [],
        lastSyncAtUpdated: false,
      });
      emitOutput(summary, asJson, formatSyncSummary);
      return summary;
    }

    const created = await createSkillhubGist(octokit, localPayload);
    if (!created.id) {
      throw new Error("Gist was created, but the ID could not be determined.");
    }

    await configStore.setGistId(created.id);
    await configStore.setLastSyncAt(nowIso);

    const summary = createSummaryFromPlan({
      strategy,
      dryRun: false,
      gistFound: false,
      gistCreated: true,
      remoteNewer: null,
      uploaded: 1,
      installPlanned: 0,
      installed: 0,
      failed: [],
      lastSyncAtUpdated: true,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  const lastSyncAt = await configStore.getLastSyncAt();
  const plan = buildSyncPlan({
    strategy,
    localPayload,
    remotePayload,
    lastSyncAt,
    nowIso,
  });

  const invalidInstallCandidates = plan.installCandidates
    .filter((skill) => !isValidSource(skill.source))
    .map((skill) => ({
      skill,
      reason: `Invalid source "${skill.source}". Expected owner/repo format.`,
    }));
  const validInstallCandidates = plan.installCandidates.filter((skill) =>
    isValidSource(skill.source)
  );

  if (dryRun) {
    const summary = createSummaryFromPlan({
      strategy,
      dryRun: true,
      gistFound: true,
      gistCreated: false,
      remoteNewer: strategy === "latest" ? plan.isRemoteNewer : null,
      uploaded: plan.uploadPayload ? 1 : 0,
      installPlanned: plan.installCandidates.length,
      installed: 0,
      failed: invalidInstallCandidates,
      lastSyncAtUpdated: false,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  const installResult = await installSkills(validInstallCandidates, {
    verbose: !asJson,
  });
  const failed = [...invalidInstallCandidates, ...installResult.failed];

  if (plan.uploadPayload) {
    await updateSkillhubGist(octokit, gistId!, plan.uploadPayload);
  }

  const summary = createSummaryFromPlan({
    strategy,
    dryRun: false,
    gistFound: true,
    gistCreated: false,
    remoteNewer: strategy === "latest" ? plan.isRemoteNewer : null,
    uploaded: plan.uploadPayload ? 1 : 0,
    installPlanned: plan.installCandidates.length,
    installed: installResult.succeeded.length,
    failed,
    lastSyncAtUpdated: false,
  });

  if (failed.length === 0) {
    await configStore.setLastSyncAt(nowIso);
    summary.lastSyncAtUpdated = true;
  }

  emitOutput(summary, asJson, formatSyncSummary);

  if (failed.length > 0) {
    if (asJson) {
      process.exitCode = 1;
      return summary;
    }
    throw new Error(
      `Sync completed with ${failed.length} failed install(s). Check logs above.`
    );
  }

  return summary;
}
