import { Command } from "commander";
import { runLogin } from "@/commands/login";
import { runLogout } from "@/commands/logout";
import { runStatus } from "@/commands/status";
import { runSync } from "@/commands/sync";

function getPackageVersion() {
  try {
    const pkg = require("../package.json") as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const program = new Command();

program.name("skillhub").description("SkillHub CLI").version(getPackageVersion());

program
  .command("login")
  .description("Login: register your GitHub PAT with gist access")
  .action(async () => {
    await runLogin();
  });

program
  .command("sync")
  .description("Sync: reconcile local skills with remote Gist backup")
  .option("-s, --strategy <strategy>", "merge strategy (union|latest)", "union")
  .option("--dry-run", "show planned changes without applying them", false)
  .option("--json", "print output as JSON", false)
  .action(
    async (options: { strategy?: string; dryRun?: boolean; json?: boolean }) => {
      try {
        await runSync({
          strategyInput: options.strategy,
          dryRun: options.dryRun,
          json: options.json,
        });
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: false,
                error: errorMessage(error),
              },
              null,
              2
            )
          );
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    }
  );

program
  .command("status")
  .description("Show local auth/sync status")
  .option("--json", "print output as JSON", false)
  .action(async (options: { json?: boolean }) => {
    try {
      await runStatus({ json: options.json });
    } catch (error) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              error: errorMessage(error),
            },
            null,
            2
          )
        );
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  });

program
  .command("logout")
  .description("Clear stored session data (token, gist id, last sync)")
  .option("--yes", "skip confirmation prompt", false)
  .option("--json", "print output as JSON", false)
  .action(async (options: { yes?: boolean; json?: boolean }) => {
    try {
      await runLogout({ yes: options.yes, json: options.json });
    } catch (error) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              error: errorMessage(error),
            },
            null,
            2
          )
        );
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Error: ${errorMessage(error)}`);
  process.exitCode = 1;
});
