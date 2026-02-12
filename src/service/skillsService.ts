import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SkillInfo } from "@/service/gistService";
import { normalizeSkills } from "@/core/syncCore";
import { isTransientError, retryAsync } from "@/utils/retry";

const execFileAsync = promisify(execFile);

const SKILLS_LOCK_FILENAMES = ["skills-lock.json", ".skill-lock.json"] as const;
const DEFAULT_SKILL_SOURCE_REPO = "vercel-labs/agent-skills";
const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";
const SOURCE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_MAX_BUFFER = 10 * 1024 * 1024;

export type InstallFailure = {
  skill: SkillInfo;
  reason: string;
};

export type RemoveFailure = {
  skill: SkillInfo;
  reason: string;
};

function stringifyCommandResult(result: { stdout?: string; stderr?: string }) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

async function runSkillsCommand(args: string[], label: string) {
  return retryAsync(
    async () => {
      return execFileAsync(NPX_COMMAND, ["skills", ...args], {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER,
        shell: process.platform === "win32",
      });
    },
    { label, shouldRetry: isTransientError }
  );
}

export function isValidSource(source: string) {
  return SOURCE_PATTERN.test(source);
}

function getCandidateSkillsLockPaths(filename: string) {
  const cwdPath = path.resolve(process.cwd(), filename);
  const homePath = path.resolve(os.homedir(), filename);

  const homeConfigPaths = [
    path.resolve(os.homedir(), ".config", "skills", filename),
    path.resolve(os.homedir(), ".config", "skillhub", filename),
    path.resolve(os.homedir(), ".skills", filename),
    path.resolve(os.homedir(), ".agents", filename),
  ];

  const winAppData = process.env.APPDATA;
  const winLocalAppData = process.env.LOCALAPPDATA;
  const windowsConfigPaths = [
    ...(winAppData
      ? [path.resolve(winAppData, "skills", filename)]
      : []),
    ...(winLocalAppData
      ? [path.resolve(winLocalAppData, "skills", filename)]
      : []),
  ];

  return [cwdPath, homePath, ...homeConfigPaths, ...windowsConfigPaths];
}

function getAllCandidateSkillsLockPaths() {
  const paths = SKILLS_LOCK_FILENAMES.flatMap((filename) =>
    getCandidateSkillsLockPaths(filename)
  );
  return [...new Set(paths)];
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

  if (parsed?.skills && typeof parsed.skills === "object") {
    const objectSkills = parsed.skills as Record<string, unknown>;
    return Object.entries(objectSkills).map(([name, metadata]) => {
      if (typeof metadata === "object" && metadata !== null) {
        const objectItem = metadata as Record<string, unknown>;
        const source =
          typeof objectItem.source === "string"
            ? objectItem.source
            : typeof objectItem.repo === "string"
              ? objectItem.repo
              : DEFAULT_SKILL_SOURCE_REPO;
        return { name, source };
      }
      return { name, source: DEFAULT_SKILL_SOURCE_REPO };
    });
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

  return normalizeSkills(skills);
}

async function tryReadSkillsLock(lockPath: string) {
  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    return parseSkillsLock(raw);
  } catch {
    return null;
  }
}

async function readFirstAvailableSkillsLock() {
  const candidatePaths = getAllCandidateSkillsLockPaths();
  for (const lockPath of candidatePaths) {
    const parsed = await tryReadSkillsLock(lockPath);
    if (parsed && parsed.length > 0) {
      return {
        skills: normalizeSkills(parsed),
        candidatePaths,
      };
    }
  }

  return {
    skills: [] as SkillInfo[],
    candidatePaths,
  };
}

function hydrateSourcesFromLock(listSkills: SkillInfo[], lockSkills: SkillInfo[]) {
  const lockByName = new Map<string, SkillInfo[]>();
  for (const skill of lockSkills) {
    const existing = lockByName.get(skill.name);
    if (existing) {
      existing.push(skill);
      continue;
    }
    lockByName.set(skill.name, [skill]);
  }

  const hydrated = listSkills.map((skill) => {
    const matches = lockByName.get(skill.name);
    if (!matches || matches.length === 0) {
      return skill;
    }
    const preferred = matches.find((item) => isValidSource(item.source)) ?? matches[0]!;
    return {
      name: skill.name,
      source: preferred.source,
    };
  });

  return normalizeSkills(hydrated);
}

export async function getLocalSkills(): Promise<SkillInfo[]> {
  const listResult = await runSkillsCommand(["list", "-g"], "skills list -g");
  const listOutput = stringifyCommandResult(listResult);

  if (
    listOutput.includes("No global skills found") ||
    listOutput.includes("Try listing project skills without -g")
  ) {
    return [];
  }

  const fromList = parseSkillsListOutput(listOutput);
  const fromLock = await readFirstAvailableSkillsLock();

  if (fromList.length > 0) {
    if (fromLock.skills.length > 0) {
      return hydrateSourcesFromLock(fromList, fromLock.skills);
    }
    return fromList;
  }

  if (fromLock.skills.length > 0) {
    return fromLock.skills;
  }

  throw new Error(
    [
      "Unable to construct local skills list.",
      "- skills list -g output:",
      listOutput,
      "",
      "- Searched lock paths:",
      ...fromLock.candidatePaths.map((p) => `  - ${p}`),
    ].join("\n")
  );
}

export async function installSkills(
  skills: SkillInfo[],
  options: { verbose?: boolean } = {}
) {
  const succeeded: SkillInfo[] = [];
  const failed: InstallFailure[] = [];

  for (const skill of skills) {
    if (!isValidSource(skill.source)) {
      const reason = `Invalid source "${skill.source}". Expected owner/repo format.`;
      failed.push({ skill, reason });
      if (options.verbose) {
        console.warn(`Skill install failed: ${skill.name} (from ${skill.source})`);
        console.warn(`  - ${reason}`);
      }
      continue;
    }

    try {
      const result = await runSkillsCommand(
        ["add", skill.source, "--skill", skill.name, "--global", "--yes"],
        `skills add ${skill.source} --skill ${skill.name}`
      );
      const output = stringifyCommandResult(result);
      if (options.verbose && output) {
        console.log(output);
      }
      succeeded.push(skill);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ skill, reason });
      if (options.verbose) {
        console.warn(`Skill install failed: ${skill.name} (from ${skill.source})`);
        console.warn(`  - ${reason}`);
      }
    }
  }

  return { succeeded, failed };
}

export async function removeSkills(
  skills: SkillInfo[],
  options: { verbose?: boolean } = {}
) {
  const succeeded: SkillInfo[] = [];
  const failed: RemoveFailure[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    const key = `${skill.source}:${skill.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    try {
      const result = await runSkillsCommand(
        ["remove", "--skill", skill.name, "--global", "--yes"],
        `skills remove --skill ${skill.name}`
      );
      const output = stringifyCommandResult(result);
      if (options.verbose && output) {
        console.log(output);
      }
      succeeded.push(skill);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ skill, reason });
      if (options.verbose) {
        console.warn(`Skill remove failed: ${skill.name} (from ${skill.source})`);
        console.warn(`  - ${reason}`);
      }
    }
  }

  return { succeeded, failed };
}
