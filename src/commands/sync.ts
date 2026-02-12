import {
  buildAutoPlan,
  buildMergePlan,
  buildPullPlan,
  buildPushPlan,
} from "@/core/syncCore";
import { configStore } from "@/service/config";
import {
  createOctokit,
  createSkillhubGist,
  findSkillhubGist,
  getSkillhubPayload,
  SkillInfo,
  SkillhubPayload,
  updateSkillhubGist,
} from "@/service/gistService";
import {
  getLocalSkills,
  InstallFailure,
  installSkills,
  isValidSource,
  RemoveFailure,
  removeSkills,
} from "@/service/skillsService";
import { emitOutput } from "@/utils/output";

type SyncMode = "pull" | "push" | "merge" | "auto";
type SyncFailure = InstallFailure | RemoveFailure;

export type RunSyncModeOptions = {
  dryRun?: boolean;
  json?: boolean;
};

export type RunSyncPullOptions = RunSyncModeOptions & {
  yes?: boolean;
};

type SyncSummary = {
  ok: boolean;
  mode: SyncMode;
  dryRun: boolean;
  gistFound: boolean;
  gistCreated: boolean;
  remoteNewer: boolean | null;
  uploaded: number;
  installPlanned: number;
  installed: number;
  removePlanned: number;
  removed: number;
  failed: SyncFailure[];
  lastSyncAtUpdated: boolean;
};

function formatSyncSummary(summary: SyncSummary) {
  const prefix = summary.dryRun ? "Dry-run" : "Sync";
  const failurePart =
    summary.failed.length > 0
      ? ` (${summary.failed.length} failed - check logs or JSON output)`
      : "";

  const actionLine = summary.dryRun
    ? `${prefix} ${summary.mode}: would upload ${summary.uploaded} change(s), would install ${summary.installPlanned} skill(s), would remove ${summary.removePlanned} skill(s)`
    : `${prefix} ${summary.mode}: uploaded ${summary.uploaded} change(s), installed ${summary.installed} skill(s), removed ${summary.removed} skill(s)`;

  const details = [
    actionLine + failurePart,
    `mode=${summary.mode}`,
    `gistFound=${summary.gistFound}`,
    `gistCreated=${summary.gistCreated}`,
    `remoteNewer=${
      summary.remoteNewer === null ? "n/a" : String(summary.remoteNewer)
    }`,
    `lastSyncAtUpdated=${summary.lastSyncAtUpdated}`,
  ];

  return details.join("\n");
}

function createSummary(params: {
  mode: SyncMode;
  dryRun: boolean;
  gistFound: boolean;
  gistCreated: boolean;
  remoteNewer: boolean | null;
  uploaded: number;
  installPlanned: number;
  installed: number;
  removePlanned: number;
  removed: number;
  failed: SyncFailure[];
  lastSyncAtUpdated: boolean;
}): SyncSummary {
  return {
    ok: params.failed.length === 0,
    mode: params.mode,
    dryRun: params.dryRun,
    gistFound: params.gistFound,
    gistCreated: params.gistCreated,
    remoteNewer: params.remoteNewer,
    uploaded: params.uploaded,
    installPlanned: params.installPlanned,
    installed: params.installed,
    removePlanned: params.removePlanned,
    removed: params.removed,
    failed: params.failed,
    lastSyncAtUpdated: params.lastSyncAtUpdated,
  };
}

function finalizeWithFailures(summary: SyncSummary, asJson: boolean) {
  if (summary.failed.length === 0) {
    return summary;
  }

  if (asJson) {
    process.exitCode = 1;
    return summary;
  }

  throw new Error(
    `Sync ${summary.mode} completed with ${summary.failed.length} failed operation(s). Check logs above.`
  );
}

async function ensureToken() {
  const token = await configStore.getToken();
  if (!token) {
    throw new Error(
      "You must login first. Run `skillhub auth login` and try again."
    );
  }
  return token;
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

async function resolveRemoteState(token: string) {
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
    gistFound: Boolean(gistId),
    remotePayload,
  };
}

function asPlanPayload(payload: SkillhubPayload | null): SkillhubPayload {
  return payload ?? { skills: [], updatedAt: "" };
}

function splitInstallCandidates(candidates: SkillInfo[]) {
  const invalidInstallCandidates: InstallFailure[] = candidates
    .filter((skill) => !isValidSource(skill.source))
    .map((skill) => ({
      skill,
      reason: `Invalid source "${skill.source}". Expected owner/repo format.`,
    }));

  const validInstallCandidates = candidates.filter((skill) =>
    isValidSource(skill.source)
  );

  return {
    invalidInstallCandidates,
    validInstallCandidates,
  };
}

async function confirmPullRemovalsIfNeeded(
  removeCandidates: SkillInfo[],
  options: RunSyncPullOptions
) {
  if (removeCandidates.length === 0 || options.yes === true) {
    return;
  }

  const { default: inquirer } = await import("inquirer");
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      default: false,
      message: `Pull sync will remove ${removeCandidates.length} local skill(s). Continue?`,
    },
  ]);

  if (!confirm) {
    throw new Error("Sync pull cancelled.");
  }
}

export async function runSyncMerge(options: RunSyncModeOptions = {}) {
  const dryRun = options.dryRun === true;
  const asJson = options.json === true;

  const token = await ensureToken();
  const nowIso = new Date().toISOString();
  const localSkills = await getLocalSkills();
  const localPayload: SkillhubPayload = {
    skills: localSkills,
    updatedAt: nowIso,
  };

  const { octokit, gistId, gistFound, remotePayload } =
    await resolveRemoteState(token);

  if (!gistFound) {
    if (dryRun) {
      const summary = createSummary({
        mode: "merge",
        dryRun: true,
        gistFound: false,
        gistCreated: false,
        remoteNewer: null,
        uploaded: 1,
        installPlanned: 0,
        installed: 0,
        removePlanned: 0,
        removed: 0,
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

    const summary = createSummary({
      mode: "merge",
      dryRun: false,
      gistFound: false,
      gistCreated: true,
      remoteNewer: null,
      uploaded: 1,
      installPlanned: 0,
      installed: 0,
      removePlanned: 0,
      removed: 0,
      failed: [],
      lastSyncAtUpdated: true,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  const plan = buildMergePlan({
    localPayload,
    remotePayload: asPlanPayload(remotePayload),
    nowIso,
  });
  const { invalidInstallCandidates, validInstallCandidates } =
    splitInstallCandidates(plan.installCandidates);

  if (dryRun) {
    const summary = createSummary({
      mode: "merge",
      dryRun: true,
      gistFound: true,
      gistCreated: false,
      remoteNewer: null,
      uploaded: plan.uploadPayload ? 1 : 0,
      installPlanned: plan.installCandidates.length,
      installed: 0,
      removePlanned: 0,
      removed: 0,
      failed: invalidInstallCandidates,
      lastSyncAtUpdated: false,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  const installResult = await installSkills(validInstallCandidates, {
    verbose: !asJson,
  });
  const failed: SyncFailure[] = [
    ...invalidInstallCandidates,
    ...installResult.failed,
  ];

  if (plan.uploadPayload) {
    await updateSkillhubGist(octokit, gistId!, plan.uploadPayload);
  }

  const summary = createSummary({
    mode: "merge",
    dryRun: false,
    gistFound: true,
    gistCreated: false,
    remoteNewer: null,
    uploaded: plan.uploadPayload ? 1 : 0,
    installPlanned: plan.installCandidates.length,
    installed: installResult.succeeded.length,
    removePlanned: 0,
    removed: 0,
    failed,
    lastSyncAtUpdated: false,
  });

  if (failed.length === 0) {
    await configStore.setLastSyncAt(nowIso);
    summary.lastSyncAtUpdated = true;
  }

  emitOutput(summary, asJson, formatSyncSummary);
  return finalizeWithFailures(summary, asJson);
}

export async function runSyncAuto(options: RunSyncModeOptions = {}) {
  const dryRun = options.dryRun === true;
  const asJson = options.json === true;

  const token = await ensureToken();
  const nowIso = new Date().toISOString();
  const localSkills = await getLocalSkills();
  const localPayload: SkillhubPayload = {
    skills: localSkills,
    updatedAt: nowIso,
  };

  const { octokit, gistId, gistFound, remotePayload } =
    await resolveRemoteState(token);

  if (!gistFound) {
    if (dryRun) {
      const summary = createSummary({
        mode: "auto",
        dryRun: true,
        gistFound: false,
        gistCreated: false,
        remoteNewer: null,
        uploaded: 1,
        installPlanned: 0,
        installed: 0,
        removePlanned: 0,
        removed: 0,
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

    const summary = createSummary({
      mode: "auto",
      dryRun: false,
      gistFound: false,
      gistCreated: true,
      remoteNewer: null,
      uploaded: 1,
      installPlanned: 0,
      installed: 0,
      removePlanned: 0,
      removed: 0,
      failed: [],
      lastSyncAtUpdated: true,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  const lastSyncAt = await configStore.getLastSyncAt();
  const plan = buildAutoPlan({
    localPayload,
    remotePayload: asPlanPayload(remotePayload),
    lastSyncAt,
    nowIso,
  });
  const { invalidInstallCandidates, validInstallCandidates } =
    splitInstallCandidates(plan.installCandidates);

  if (dryRun) {
    const summary = createSummary({
      mode: "auto",
      dryRun: true,
      gistFound: true,
      gistCreated: false,
      remoteNewer: plan.isRemoteNewer,
      uploaded: plan.uploadPayload ? 1 : 0,
      installPlanned: plan.installCandidates.length,
      installed: 0,
      removePlanned: 0,
      removed: 0,
      failed: invalidInstallCandidates,
      lastSyncAtUpdated: false,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  const installResult = await installSkills(validInstallCandidates, {
    verbose: !asJson,
  });
  const failed: SyncFailure[] = [
    ...invalidInstallCandidates,
    ...installResult.failed,
  ];

  if (plan.uploadPayload) {
    await updateSkillhubGist(octokit, gistId!, plan.uploadPayload);
  }

  const summary = createSummary({
    mode: "auto",
    dryRun: false,
    gistFound: true,
    gistCreated: false,
    remoteNewer: plan.isRemoteNewer,
    uploaded: plan.uploadPayload ? 1 : 0,
    installPlanned: plan.installCandidates.length,
    installed: installResult.succeeded.length,
    removePlanned: 0,
    removed: 0,
    failed,
    lastSyncAtUpdated: false,
  });

  if (failed.length === 0) {
    await configStore.setLastSyncAt(nowIso);
    summary.lastSyncAtUpdated = true;
  }

  emitOutput(summary, asJson, formatSyncSummary);
  return finalizeWithFailures(summary, asJson);
}

export async function runSyncPush(options: RunSyncModeOptions = {}) {
  const dryRun = options.dryRun === true;
  const asJson = options.json === true;

  const token = await ensureToken();
  const nowIso = new Date().toISOString();
  const localSkills = await getLocalSkills();
  const localPayload: SkillhubPayload = {
    skills: localSkills,
    updatedAt: nowIso,
  };

  const { octokit, gistId, gistFound, remotePayload } =
    await resolveRemoteState(token);

  if (!gistFound) {
    if (dryRun) {
      const summary = createSummary({
        mode: "push",
        dryRun: true,
        gistFound: false,
        gistCreated: false,
        remoteNewer: null,
        uploaded: 1,
        installPlanned: 0,
        installed: 0,
        removePlanned: 0,
        removed: 0,
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

    const summary = createSummary({
      mode: "push",
      dryRun: false,
      gistFound: false,
      gistCreated: true,
      remoteNewer: null,
      uploaded: 1,
      installPlanned: 0,
      installed: 0,
      removePlanned: 0,
      removed: 0,
      failed: [],
      lastSyncAtUpdated: true,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  const plan = buildPushPlan({
    localPayload,
    remotePayload: asPlanPayload(remotePayload),
    nowIso,
  });

  if (dryRun) {
    const summary = createSummary({
      mode: "push",
      dryRun: true,
      gistFound: true,
      gistCreated: false,
      remoteNewer: null,
      uploaded: plan.uploadPayload ? 1 : 0,
      installPlanned: 0,
      installed: 0,
      removePlanned: 0,
      removed: 0,
      failed: [],
      lastSyncAtUpdated: false,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  if (plan.uploadPayload) {
    await updateSkillhubGist(octokit, gistId!, plan.uploadPayload);
  }

  await configStore.setLastSyncAt(nowIso);
  const summary = createSummary({
    mode: "push",
    dryRun: false,
    gistFound: true,
    gistCreated: false,
    remoteNewer: null,
    uploaded: plan.uploadPayload ? 1 : 0,
    installPlanned: 0,
    installed: 0,
    removePlanned: 0,
    removed: 0,
    failed: [],
    lastSyncAtUpdated: true,
  });

  emitOutput(summary, asJson, formatSyncSummary);
  return summary;
}

export async function runSyncPull(options: RunSyncPullOptions = {}) {
  const dryRun = options.dryRun === true;
  const asJson = options.json === true;

  const token = await ensureToken();
  const nowIso = new Date().toISOString();
  const localSkills = await getLocalSkills();
  const localPayload: SkillhubPayload = {
    skills: localSkills,
    updatedAt: nowIso,
  };

  const { gistFound, remotePayload } = await resolveRemoteState(token);
  if (!gistFound) {
    throw new Error(
      "Remote SkillHub Gist not found. Run `skillhub sync push` to create it first."
    );
  }
  if (!remotePayload) {
    throw new Error(
      "Remote SkillHub payload is missing or invalid. Fix the remote `skillhub.json` and retry."
    );
  }

  const plan = buildPullPlan({
    localPayload,
    remotePayload,
  });
  const { invalidInstallCandidates, validInstallCandidates } =
    splitInstallCandidates(plan.installCandidates);

  if (dryRun) {
    const summary = createSummary({
      mode: "pull",
      dryRun: true,
      gistFound: true,
      gistCreated: false,
      remoteNewer: null,
      uploaded: 0,
      installPlanned: plan.installCandidates.length,
      installed: 0,
      removePlanned: plan.removeCandidates.length,
      removed: 0,
      failed: invalidInstallCandidates,
      lastSyncAtUpdated: false,
    });
    emitOutput(summary, asJson, formatSyncSummary);
    return summary;
  }

  await confirmPullRemovalsIfNeeded(plan.removeCandidates, options);

  const installResult = await installSkills(validInstallCandidates, {
    verbose: !asJson,
  });
  const removeResult = await removeSkills(plan.removeCandidates, {
    verbose: !asJson,
  });
  const failed: SyncFailure[] = [
    ...invalidInstallCandidates,
    ...installResult.failed,
    ...removeResult.failed,
  ];

  const summary = createSummary({
    mode: "pull",
    dryRun: false,
    gistFound: true,
    gistCreated: false,
    remoteNewer: null,
    uploaded: 0,
    installPlanned: plan.installCandidates.length,
    installed: installResult.succeeded.length,
    removePlanned: plan.removeCandidates.length,
    removed: removeResult.succeeded.length,
    failed,
    lastSyncAtUpdated: false,
  });

  if (failed.length === 0) {
    await configStore.setLastSyncAt(nowIso);
    summary.lastSyncAtUpdated = true;
  }

  emitOutput(summary, asJson, formatSyncSummary);
  return finalizeWithFailures(summary, asJson);
}
