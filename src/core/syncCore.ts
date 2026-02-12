import { SkillInfo, SkillhubPayload } from "@/service/gistService";

const DEFAULT_SKILL_SOURCE_REPO = "vercel-labs/agent-skills";
const BANNED_SKILL_NAME_SUBSTRINGS = [
  "No global skills found",
  "Try listing project skills without -g",
  "No project skills found",
  "Try listing global skills",
];

export type MergeSyncPlan = {
  mode: "merge";
  localSkills: SkillInfo[];
  remoteSkills: SkillInfo[];
  installCandidates: SkillInfo[];
  uploadPayload: SkillhubPayload | null;
};

export type AutoSyncPlan = {
  mode: "auto";
  localSkills: SkillInfo[];
  remoteSkills: SkillInfo[];
  installCandidates: SkillInfo[];
  uploadPayload: SkillhubPayload | null;
  isRemoteNewer: boolean;
};

export type PullSyncPlan = {
  mode: "pull";
  localSkills: SkillInfo[];
  remoteSkills: SkillInfo[];
  installCandidates: SkillInfo[];
  removeCandidates: SkillInfo[];
};

export type PushSyncPlan = {
  mode: "push";
  localSkills: SkillInfo[];
  remoteSkills: SkillInfo[];
  uploadPayload: SkillhubPayload | null;
};

export function parseTimestamp(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSkills(skills: SkillInfo[] | string[]): SkillInfo[] {
  const normalized = skills
    .map((skill) => {
      if (typeof skill === "string") {
        return { name: skill, source: DEFAULT_SKILL_SOURCE_REPO };
      }
      return {
        name: String(skill?.name ?? ""),
        source: String(skill?.source ?? DEFAULT_SKILL_SOURCE_REPO),
      };
    })
    .filter(
      (skill) =>
        skill.name.length > 0 &&
        !BANNED_SKILL_NAME_SUBSTRINGS.some((bad) => skill.name.includes(bad))
    );

  return uniqueSortedSkills(normalized);
}

export function uniqueSortedSkills(skills: SkillInfo[]): SkillInfo[] {
  const seen = new Set<string>();
  const result: SkillInfo[] = [];

  for (const skill of skills) {
    const key = `${skill.source}:${skill.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(skill);
    }
  }

  return result.sort((a, b) => {
    if (a.source !== b.source) {
      return a.source.localeCompare(b.source);
    }
    return a.name.localeCompare(b.name);
  });
}

export function areSameSkills(left: SkillInfo[], right: SkillInfo[]) {
  const leftSorted = uniqueSortedSkills(left);
  const rightSorted = uniqueSortedSkills(right);

  if (leftSorted.length !== rightSorted.length) {
    return false;
  }

  return leftSorted.every(
    (skill, index) =>
      skill.name === rightSorted[index].name &&
      skill.source === rightSorted[index].source
  );
}

export function buildMergePlan(params: {
  localPayload: SkillhubPayload;
  remotePayload: SkillhubPayload;
  nowIso: string;
}): MergeSyncPlan {
  const localSkills = normalizeSkills(params.localPayload.skills);
  const remoteSkills = normalizeSkills(params.remotePayload.skills);
  const unionSkills = uniqueSortedSkills([...localSkills, ...remoteSkills]);
  const installCandidates = unionSkills.filter(
    (skill) =>
      !localSkills.some(
        (local) => local.name === skill.name && local.source === skill.source
      )
  );
  const uploadPayload = areSameSkills(remoteSkills, unionSkills)
    ? null
    : {
        skills: unionSkills,
        updatedAt: params.nowIso,
      };

  return {
    mode: "merge",
    localSkills,
    remoteSkills,
    installCandidates,
    uploadPayload,
  };
}

export function buildAutoPlan(params: {
  localPayload: SkillhubPayload;
  remotePayload: SkillhubPayload;
  lastSyncAt?: string;
  nowIso: string;
}): AutoSyncPlan {
  const localSkills = normalizeSkills(params.localPayload.skills);
  const remoteSkills = normalizeSkills(params.remotePayload.skills);
  const lastSyncTime = parseTimestamp(params.lastSyncAt) ?? 0;
  const remoteTime = parseTimestamp(params.remotePayload.updatedAt);
  const isRemoteNewer = remoteTime !== null && remoteTime > lastSyncTime;

  if (isRemoteNewer) {
    const installCandidates = remoteSkills.filter(
      (skill) =>
        !localSkills.some(
          (local) => local.name === skill.name && local.source === skill.source
        )
    );

    return {
      mode: "auto",
      localSkills,
      remoteSkills,
      installCandidates,
      uploadPayload: null,
      isRemoteNewer,
    };
  }

  const uploadPayload = areSameSkills(localSkills, remoteSkills)
    ? null
    : {
        skills: localSkills,
      updatedAt: params.nowIso,
    };

  return {
    mode: "auto",
    localSkills,
    remoteSkills,
    installCandidates: [],
    uploadPayload,
    isRemoteNewer,
  };
}

export function buildPullPlan(params: {
  localPayload: SkillhubPayload;
  remotePayload: SkillhubPayload;
}): PullSyncPlan {
  const localSkills = normalizeSkills(params.localPayload.skills);
  const remoteSkills = normalizeSkills(params.remotePayload.skills);

  const installCandidates = remoteSkills.filter(
    (remote) =>
      !localSkills.some(
        (local) =>
          local.name === remote.name && local.source === remote.source
      )
  );
  const removeCandidates = localSkills.filter(
    (local) =>
      !remoteSkills.some(
        (remote) =>
          remote.name === local.name && remote.source === local.source
      )
  );

  return {
    mode: "pull",
    localSkills,
    remoteSkills,
    installCandidates,
    removeCandidates,
  };
}

export function buildPushPlan(params: {
  localPayload: SkillhubPayload;
  remotePayload: SkillhubPayload;
  nowIso: string;
}): PushSyncPlan {
  const localSkills = normalizeSkills(params.localPayload.skills);
  const remoteSkills = normalizeSkills(params.remotePayload.skills);

  const uploadPayload = areSameSkills(localSkills, remoteSkills)
    ? null
    : {
        skills: localSkills,
        updatedAt: params.nowIso,
      };

  return {
    mode: "push",
    localSkills,
    remoteSkills,
    uploadPayload,
  };
}
