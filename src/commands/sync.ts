import { exec, execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { configStore, MergeStrategy } from "@/service/config";
import {
  createOctokit,
  createSkillhubGist,
  findSkillhubGist,
  getSkillhubPayload,
  updateSkillhubGist,
  SkillInfo,
  SkillhubPayload,
} from "@/service/gistService";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const SKILLS_LOCK_FILENAME = "skills-lock.json";
const DEFAULT_STRATEGY: MergeStrategy = "union";
const DEFAULT_SKILL_SOURCE_REPO = "vercel-labs/agent-skills";
const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";
const SOURCE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type InstallFailure = {
  skill: SkillInfo;
  reason: string;
};

type StrategyResult = {
  uploaded: number;
  installed: number;
  failed: InstallFailure[];
};

export async function runSync(strategyInput?: string) {
  const strategy = parseStrategy(strategyInput);
  const token = await configStore.getToken();

  if (!token) {
    throw new Error("You must login first. Run `skillhub login` and try again.");
  }

  const localSkills = await getLocalSkills();
  const localPayload: SkillhubPayload = {
    skills: uniqueSortedSkills(localSkills),
    updatedAt: new Date().toISOString(),
  };

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

  if (!gistId) {
    const created = await createSkillhubGist(octokit, localPayload);
    if (!created.id) {
      throw new Error("Gist was created, but the ID could not be determined.");
    }
    await configStore.setGistId(created.id);
    await configStore.setLastSyncAt(new Date().toISOString());
    console.log("No existing SkillHub Gist found. A new one has been created.");
    console.log(formatSummary({ uploaded: 1, installed: 0, failed: [] }));
    return;
  }

  const resolvedRemote: SkillhubPayload = remotePayload
    ? {
        ...remotePayload,
        skills: normalizeSkills(remotePayload.skills ?? []),
      }
    : { skills: [], updatedAt: "" };

  const lastSyncAt = await configStore.getLastSyncAt();

  const result =
    strategy === "latest"
      ? await applyLatestStrategy({
          octokit,
          gistId,
          local: localPayload,
          remote: resolvedRemote,
          lastSyncAt,
        })
      : await applyUnionStrategy({
          octokit,
          gistId,
          local: localPayload,
          remote: resolvedRemote,
        });

  console.log(formatSummary(result));

  if (result.failed.length > 0) {
    throw new Error(
      `Sync completed with ${result.failed.length} failed install(s). Check logs above.`
    );
  }

  await configStore.setLastSyncAt(new Date().toISOString());
}

function parseStrategy(input?: string): MergeStrategy {
  if (!input) {
    return DEFAULT_STRATEGY;
  }

  if (input === "latest" || input === "union") {
    return input;
  }

  throw new Error(
    `Invalid strategy "${input}". Use one of: union, latest.`
  );
}

async function getLocalSkills(): Promise<SkillInfo[]> {
  // 1) Primary source: `skills list -g` output
  // generate-lock can be flaky, so list parsing is preferred.
  const listResult = await execAsync("npx skills list -g");
  const listOutput = `${listResult.stdout ?? ""}\n${listResult.stderr ?? ""}`.trim();

  if (
    listOutput.includes("No global skills found") ||
    listOutput.includes("Try listing project skills without -g")
  ) {
    return [];
  }

  const fromList = parseSkillsListOutput(listOutput);
  if (fromList.length > 0) {
    return fromList;
  }

  // 2) Fallback: generate-lock + search for a skills-lock.json file
  const { stdout, stderr } = await execAsync("npx skills generate-lock");
  const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();

  const candidatePaths = getCandidateSkillsLockPaths();
  for (const lockPath of candidatePaths) {
    const parsed = await tryReadSkillsLock(lockPath);
    if (parsed) {
      return parsed;
    }
  }

  if (
    output.includes("No installed skills found") ||
    listOutput.includes("No project skills found")
  ) {
    return [];
  }

  throw new Error(
    [
      "Unable to construct local skills list.",
      "- skills list -g output:",
      listOutput,
      "",
      `- Searched ${SKILLS_LOCK_FILENAME} paths:`,
      ...candidatePaths.map((p) => `  - ${p}`),
      "",
      "- npx skills generate-lock output:",
      output,
    ].join("\n")
  );
}

function getCandidateSkillsLockPaths() {
  const cwdPath = path.resolve(process.cwd(), SKILLS_LOCK_FILENAME);
  const homePath = path.resolve(os.homedir(), SKILLS_LOCK_FILENAME);

  const homeConfigPaths = [
    path.resolve(os.homedir(), ".config", "skills", SKILLS_LOCK_FILENAME),
    path.resolve(os.homedir(), ".config", "skillhub", SKILLS_LOCK_FILENAME),
    path.resolve(os.homedir(), ".skills", SKILLS_LOCK_FILENAME),
  ];

  const winAppData = process.env.APPDATA;
  const winLocalAppData = process.env.LOCALAPPDATA;
  const windowsConfigPaths = [
    ...(winAppData
      ? [path.resolve(winAppData, "skills", SKILLS_LOCK_FILENAME)]
      : []),
    ...(winLocalAppData
      ? [path.resolve(winLocalAppData, "skills", SKILLS_LOCK_FILENAME)]
      : []),
  ];

  return [cwdPath, homePath, ...homeConfigPaths, ...windowsConfigPaths];
}

async function tryReadSkillsLock(lockPath: string) {
  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    return parseSkillsLock(raw);
  } catch {
    return null;
  }
}

function parseSkillsLock(raw: string): SkillInfo[] {
  const parsed = JSON.parse(raw);

  const extractSkills = (items: unknown[]): SkillInfo[] => {
    return items.map((item) => {
      if (typeof item === "string") {
        return { name: item, source: DEFAULT_SKILL_SOURCE_REPO };
      }

      if (typeof item === "object" && item !== null) {
        const objectItem = item as Record<string, unknown>;
        const name =
          typeof objectItem.name === "string"
            ? objectItem.name
            : typeof objectItem.skill === "string"
              ? objectItem.skill
              : String(item);
        const source =
          typeof objectItem.source === "string"
            ? objectItem.source
            : typeof objectItem.repo === "string"
              ? objectItem.repo
              : DEFAULT_SKILL_SOURCE_REPO;

        return { name, source };
      }

      return { name: String(item), source: DEFAULT_SKILL_SOURCE_REPO };
    });
  };

  if (Array.isArray(parsed?.skills)) {
    return extractSkills(parsed.skills);
  }

  if (Array.isArray(parsed)) {
    return extractSkills(parsed);
  }

  if (Array.isArray(parsed?.installedSkills)) {
    return extractSkills(parsed.installedSkills);
  }

  return [];
}

function parseSkillsListOutput(output: string): SkillInfo[] {
  const cleaned = output.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim());

  const skills: SkillInfo[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (line === "Global Skills") continue;
    if (line.startsWith("Agents:")) continue;
    if (line.startsWith("No project skills found")) continue;
    if (line.startsWith("Try listing global skills")) continue;
    if (line.startsWith("No global skills found")) continue;
    if (line.startsWith("Try listing project skills without -g")) continue;

    const [name] = line.split(/\s+/);
    if (!name) continue;

    if (name.includes("\\") || name.includes("/") || name.includes("~")) continue;

    skills.push({ name, source: DEFAULT_SKILL_SOURCE_REPO });
  }

  return uniqueSortedSkills(skills);
}

function normalizeSkills(skills: SkillInfo[] | string[]): SkillInfo[] {
  const bannedSubstrings = [
    "No global skills found",
    "Try listing project skills without -g",
    "No project skills found",
    "Try listing global skills",
  ];

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
        !bannedSubstrings.some((bad) => skill.name.includes(bad))
    );

  return uniqueSortedSkills(normalized);
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

function uniqueSortedSkills(skills: SkillInfo[]): SkillInfo[] {
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

async function installSkills(skills: SkillInfo[]) {
  const succeeded: SkillInfo[] = [];
  const failed: InstallFailure[] = [];

  for (const skill of skills) {
    if (!isValidSource(skill.source)) {
      const reason = `Invalid source "${skill.source}". Expected owner/repo format.`;
      failed.push({ skill, reason });
      console.warn(`Skill install failed: ${skill.name} (from ${skill.source})`);
      console.warn(`  - ${reason}`);
      continue;
    }

    try {
      const { stdout, stderr } = await execFileAsync(NPX_COMMAND, [
        "skills",
        "add",
        skill.source,
        "--skill",
        skill.name,
        "--global",
        "--yes",
      ]);
      const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
      if (output) {
        console.log(output);
      }
      succeeded.push(skill);
    } catch (error: unknown) {
      const detail = error as { stdout?: string; stderr?: string; message?: string };
      const stdout = detail.stdout ?? "";
      const stderr = detail.stderr ?? "";
      const reason = `${stdout}\n${stderr}`.trim() || detail.message || String(error);
      failed.push({ skill, reason });
      console.warn(`Skill install failed: ${skill.name} (from ${skill.source})`);
      console.warn(`  - ${reason}`);
    }
  }

  return { succeeded, failed };
}

function isValidSource(source: string) {
  return SOURCE_PATTERN.test(source);
}

async function applyUnionStrategy(params: {
  octokit: ReturnType<typeof createOctokit>;
  gistId: string;
  local: SkillhubPayload;
  remote: SkillhubPayload;
}): Promise<StrategyResult> {
  const localSkills = normalizeSkills(params.local.skills);
  const remoteSkills = normalizeSkills(params.remote.skills);

  const unionSkills = uniqueSortedSkills([...localSkills, ...remoteSkills]);
  const missingLocally = unionSkills.filter(
    (skill) =>
      !localSkills.some(
        (local) => local.name === skill.name && local.source === skill.source
      )
  );

  const { succeeded, failed } = await installSkills(missingLocally);
  const shouldUpload = !areSameSkills(remoteSkills, unionSkills);
  if (shouldUpload) {
    await updateSkillhubGist(params.octokit, params.gistId, {
      skills: unionSkills,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    uploaded: shouldUpload ? 1 : 0,
    installed: succeeded.length,
    failed,
  };
}

async function applyLatestStrategy(params: {
  octokit: ReturnType<typeof createOctokit>;
  gistId: string;
  local: SkillhubPayload;
  remote: SkillhubPayload;
  lastSyncAt?: string;
}): Promise<StrategyResult> {
  const lastSyncTime = parseTimestamp(params.lastSyncAt) ?? 0;
  const remoteTime = parseTimestamp(params.remote.updatedAt);
  const isRemoteNewer = remoteTime !== null && remoteTime > lastSyncTime;

  const localSkills = normalizeSkills(params.local.skills);
  const remoteSkills = normalizeSkills(params.remote.skills);

  if (isRemoteNewer) {
    const missingLocally = remoteSkills.filter(
      (skill) =>
        !localSkills.some(
          (local) => local.name === skill.name && local.source === skill.source
        )
    );
    const { succeeded, failed } = await installSkills(missingLocally);
    return {
      uploaded: 0,
      installed: succeeded.length,
      failed,
    };
  }

  const shouldUpload = !areSameSkills(localSkills, remoteSkills);
  if (shouldUpload) {
    await updateSkillhubGist(params.octokit, params.gistId, params.local);
  }

  return {
    uploaded: shouldUpload ? 1 : 0,
    installed: 0,
    failed: [],
  };
}

function parseTimestamp(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSummary(result: StrategyResult) {
  const failPart =
    result.failed.length > 0
      ? ` (${result.failed.length} install failed - check logs)`
      : "";
  const uploadLabel = result.uploaded === 1 ? "change" : "changes";
  const installLabel = result.installed === 1 ? "skill" : "skills";
  return `Uploaded ${result.uploaded} ${uploadLabel}, installed ${result.installed} ${installLabel}${failPart}`;
}

function areSameSkills(left: SkillInfo[], right: SkillInfo[]) {
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
