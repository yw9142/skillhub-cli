import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI_ENTRY = resolve(process.cwd(), "dist", "index.js");

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync("node", [CLI_ENTRY, ...args], {
    encoding: "utf-8",
    env,
  });
}

describe.skipIf(!existsSync(CLI_ENTRY))("cli smoke", () => {
  let sandboxDir = "";
  let sandboxEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    sandboxDir = mkdtempSync(resolve(tmpdir(), "skillhub-cli-test-"));
    sandboxEnv = {
      ...process.env,
      HOME: sandboxDir,
      USERPROFILE: sandboxDir,
      APPDATA: sandboxDir,
      LOCALAPPDATA: sandboxDir,
      XDG_CONFIG_HOME: sandboxDir,
    };
  });

  afterAll(() => {
    if (sandboxDir) {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  });

  it("prints help", () => {
    const result = runCli(["--help"], sandboxEnv);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: skillhub");
    expect(result.stdout).toContain("auth");
    expect(result.stdout).toContain("sync");
  });

  it("prints version", () => {
    const result = runCli(["--version"], sandboxEnv);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("fails when sync mode is missing", () => {
    const result = runCli(["sync"], sandboxEnv);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing sync mode");
  });

  it("fails removed top-level login command", () => {
    const result = runCli(["login"], sandboxEnv);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command 'login'");
  });

  it("fails removed strategy option", () => {
    const result = runCli(["sync", "merge", "--strategy", "union"], sandboxEnv);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown option '--strategy'");
  });

  it("returns status as json", () => {
    const result = runCli(["auth", "status", "--json"], sandboxEnv);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("loggedIn");
    expect(parsed).toHaveProperty("gistId");
    expect(parsed).toHaveProperty("lastSyncAt");
  });

  it("supports auth logout --yes", () => {
    const result = runCli(["auth", "logout", "--yes"], sandboxEnv);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Logout completed");
  });
});
