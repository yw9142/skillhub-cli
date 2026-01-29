import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { configStore, MergeStrategy } from "@/service/config";
import {
  createOctokit,
  createSkillhubGist,
  findSkillhubGist,
  getSkillhubPayload,
  updateSkillhubGist,
  SkillhubPayload,
  SkillInfo,
} from "@/service/gistService";

const execAsync = promisify(exec);

const SKILLS_LOCK_FILENAME = "skills-lock.json";
const DEFAULT_STRATEGY: MergeStrategy = "union";
const DEFAULT_SKILL_SOURCE_REPO = "vercel-labs/agent-skills";

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
      const foundId = found.id;
      gistId = foundId;
      await configStore.setGistId(foundId);
      remotePayload = await safeGetPayload(octokit, foundId);
    }
  }

  if (!gistId) {
    const created = await createSkillhubGist(octokit, localPayload);
    if (!created.id) {
      throw new Error("Gist was created, but the ID could not be determined.");
    }
    await configStore.setGistId(created.id);
    console.log("No existing SkillHub Gist found. A new one has been created.");
    console.log(`Uploaded 1 change, installed 0 skills`);
    return;
  }

  const resolvedRemote = remotePayload
    ? {
        ...remotePayload,
        skills: normalizeSkills(remotePayload.skills ?? []),
      }
    : { skills: [], updatedAt: "" };

  if (strategy === "latest") {
    await applyLatestStrategy({
      octokit,
      gistId,
      local: localPayload,
      remote: resolvedRemote,
    });
    return;
  }

  await applyUnionStrategy({
    octokit,
    gistId,
    local: localPayload,
    remote: resolvedRemote,
  });
}

function parseStrategy(input?: string): MergeStrategy {
  if (input === "latest" || input === "union") {
    return input;
  }
  return DEFAULT_STRATEGY;
}

async function getLocalSkills(): Promise<SkillInfo[]> {
  // 1) Primary source: `skills list -g` output
  // - generate-lock can be flaky (e.g. "already in lock file" without writing),
  //   so we prefer parsing the list output when possible.
  const listResult = await execAsync("npx skills list -g");
  const listOutput = `${listResult.stdout ?? ""}\n${listResult.stderr ?? ""}`.trim();

  // When there are no global skills, skills CLI prints:
  // "No global skills found.\nTry listing project skills without -g"
  // In that case we treat it as an empty list and avoid polluting Gist.
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

  if (output.includes("No installed skills found") || listOutput.includes("No project skills found")) {
    return [];
  }

  throw new Error(
    [
      `Unable to construct local skills list.`,
      `- skills list -g output:`,
      listOutput,
      ``,
      `- Searched ${SKILLS_LOCK_FILENAME} paths:`,
      ...candidatePaths.map((p) => `  - ${p}`),
      ``,
      `- npx skills generate-lock output:`,
      output,
    ].join("\n")
  );
}

function getCandidateSkillsLockPaths() {
  const cwdPath = path.resolve(process.cwd(), SKILLS_LOCK_FILENAME);
  const homePath = path.resolve(os.homedir(), SKILLS_LOCK_FILENAME);

  // Cross-platform candidates when we don't know exactly where the tool writes
  const homeConfigPaths = [
    path.resolve(os.homedir(), ".config", "skills", SKILLS_LOCK_FILENAME),
    path.resolve(os.homedir(), ".config", "skillhub", SKILLS_LOCK_FILENAME),
    path.resolve(os.homedir(), ".skills", SKILLS_LOCK_FILENAME),
  ];

  // Windows-specific candidates
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

  // skills-lock.json에서 source 정보 추출 시도
  const extractSkills = (items: any[]): SkillInfo[] => {
    return items.map((item) => {
      if (typeof item === "string") {
        return { name: item, source: DEFAULT_SKILL_SOURCE_REPO };
      }
      if (typeof item === "object" && item !== null) {
        const name = item.name || item.skill || String(item);
        const source = item.source || item.repo || DEFAULT_SKILL_SOURCE_REPO;
        return { name: String(name), source: String(source) };
      }
      return { name: String(item), source: DEFAULT_SKILL_SOURCE_REPO };
    });
  };

  const fromSkills = parsed?.skills;
  if (Array.isArray(fromSkills)) {
    return extractSkills(fromSkills);
  }

  if (Array.isArray(parsed)) {
    return extractSkills(parsed);
  }

  const fromInstalled = parsed?.installedSkills;
  if (Array.isArray(fromInstalled)) {
    return extractSkills(fromInstalled);
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

    // Example: "find-skills ~\\.agents\\skills\\find-skills"
    // We only take the first token as the skill name
    const [name] = line.split(/\s+/);
    if (!name) continue;

    // Skip obvious path-like tokens as a safety net
    if (name.includes("\\") || name.includes("/") || name.includes("~")) continue;
    
    // skills list 출력에는 source 정보가 없으므로 기본값 사용
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
      return skill;
    })
    .filter(
      (skill) =>
        !!skill.name &&
        !bannedSubstrings.some((bad) => skill.name.includes(bad))
    );

  return uniqueSortedSkills(normalized);
}

async function safeGetPayload(octokit: ReturnType<typeof createOctokit>, gistId: string) {
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
  const failed: { skill: SkillInfo; reason: string }[] = [];

  for (const skill of skills) {
    try {
      const { stdout, stderr } = await execAsync(
        `npx skills add ${skill.source} --skill "${skill.name}" --global --yes`
      );
      const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
      if (output) {
        console.log(output);
      }
      succeeded.push(skill);
    } catch (error: any) {
      const stdout = error?.stdout ?? "";
      const stderr = error?.stderr ?? "";
      const reason = `${stdout}\n${stderr}`.trim() || String(error);
      failed.push({ skill, reason });
      console.warn(
        [
          `스킬 설치 실패: ${skill.name} (from ${skill.source})`,
          reason && `  └─ ${reason}`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  return { succeeded, failed };
}

async function applyUnionStrategy(params: {
  octokit: ReturnType<typeof createOctokit>;
  gistId: string;
  local: SkillhubPayload;
  remote: SkillhubPayload;
}) {
  const localSkills = normalizeSkills(params.local.skills);
  const remoteSkills = normalizeSkills(params.remote.skills);

  const unionSkills = uniqueSortedSkills([...localSkills, ...remoteSkills]);

  const missingLocally = unionSkills.filter(
    (skill) =>
      !localSkills.some(
        (local) => local.name === skill.name && local.source === skill.source
      )
  );

  const payload: SkillhubPayload = {
    skills: unionSkills,
    updatedAt: new Date().toISOString(),
  };

  const { succeeded, failed } = await installSkills(missingLocally);
  await updateSkillhubGist(params.octokit, params.gistId, payload);

  const uploadCount = areSameSkills(remoteSkills, unionSkills) ? 0 : 1;
  const installCount = succeeded.length;
  const failedCount = failed.length;

  console.log(
    `업로드 ${uploadCount}건, 설치 ${installCount}건${
      failedCount ? ` (실패 ${failedCount}건은 로그 참고)` : ""
    }`
  );
}

async function applyLatestStrategy(params: {
  octokit: ReturnType<typeof createOctokit>;
  gistId: string;
  local: SkillhubPayload;
  remote: SkillhubPayload;
}) {
  const localTime = Date.parse(params.local.updatedAt);
  const remoteTime = Date.parse(params.remote.updatedAt);

  const isRemoteNewer = Number.isFinite(remoteTime) && remoteTime > localTime;

  if (isRemoteNewer) {
    const localSkills = normalizeSkills(params.local.skills);
    const remoteSkills = normalizeSkills(params.remote.skills);
    const missingLocally = remoteSkills.filter(
      (skill) =>
        !localSkills.some(
          (local) => local.name === skill.name && local.source === skill.source
        )
    );
    const { succeeded, failed } = await installSkills(missingLocally);
    const failedCount = failed.length;
    console.log(
      `업로드 0건, 설치 ${succeeded.length}건${
        failedCount ? ` (실패 ${failedCount}건은 로그 참고)` : ""
      }`
    );
    return;
  }

  await updateSkillhubGist(params.octokit, params.gistId, params.local);
  console.log("업로드 1건, 설치 0건");
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
