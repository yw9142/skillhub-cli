import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SkillInfo } from "@/service/gistService";
import { normalizeSkills } from "@/core/syncCore";
import { isTransientError, retryAsync } from "@/utils/retry";

const execFileAsync = promisify(execFile);

const SKILLS_LOCK_FILENAME = "skills-lock.json";
const DEFAULT_SKILL_SOURCE_REPO = "vercel-labs/agent-skills";
const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";
const SOURCE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_MAX_BUFFER = 10 * 1024 * 1024;

export type InstallFailure = {
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
  if (fromList.length > 0) {
    return fromList;
  }

  const lockResult = await runSkillsCommand(
    ["generate-lock"],
    "skills generate-lock"
  );
  const lockOutput = stringifyCommandResult(lockResult);

  const candidatePaths = getCandidateSkillsLockPaths();
  for (const lockPath of candidatePaths) {
    const parsed = await tryReadSkillsLock(lockPath);
    if (parsed) {
      return normalizeSkills(parsed);
    }
  }

  if (
    lockOutput.includes("No installed skills found") ||
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
      lockOutput,
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
