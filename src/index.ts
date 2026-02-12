import { Command } from "commander";
import { runLogin } from "@/commands/login";
import { runLogout } from "@/commands/logout";
import { runStatus } from "@/commands/status";
import {
  runSyncAuto,
  runSyncMerge,
  runSyncPull,
  runSyncPush,
} from "@/commands/sync";

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

function withJsonErrorHandling<T extends { json?: boolean }>(
  action: (options: T) => Promise<void>
) {
  return async (options: T) => {
    try {
      await action(options);
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
  };
}

const program = new Command();

program.name("skillhub").description("SkillHub CLI").version(getPackageVersion());

const authCommand = program.command("auth").description("Authentication commands");

authCommand
  .command("login")
  .description("Register your GitHub PAT with gist access")
  .action(async () => {
    await runLogin();
  });

authCommand
  .command("status")
  .description("Show local auth/sync status")
  .option("--json", "print output as JSON", false)
  .action(
    withJsonErrorHandling(async (options: { json?: boolean }) => {
      await runStatus({ json: options.json });
    })
  );

authCommand
  .command("logout")
  .description("Clear stored session data (token, gist id, last sync)")
  .option("--yes", "skip confirmation prompt", false)
  .option("--json", "print output as JSON", false)
  .action(
    withJsonErrorHandling(async (options: { yes?: boolean; json?: boolean }) => {
      await runLogout({ yes: options.yes, json: options.json });
    })
  );

const syncCommand = program
  .command("sync")
  .description("Sync local skills and remote Gist backup");

syncCommand
  .command("pull")
  .description("Mirror remote skills into local skills (remote -> local)")
  .option("--dry-run", "show planned changes without applying them", false)
  .option("--yes", "skip deletion confirmation prompt", false)
  .option("--json", "print output as JSON", false)
  .action(
    withJsonErrorHandling(
      async (options: { dryRun?: boolean; yes?: boolean; json?: boolean }) => {
        await runSyncPull({
          dryRun: options.dryRun,
          yes: options.yes,
          json: options.json,
        });
      }
    )
  );

syncCommand
  .command("push")
  .description("Mirror local skills into remote backup (local -> remote)")
  .option("--dry-run", "show planned changes without applying them", false)
  .option("--json", "print output as JSON", false)
  .action(
    withJsonErrorHandling(async (options: { dryRun?: boolean; json?: boolean }) => {
      await runSyncPush({
        dryRun: options.dryRun,
        json: options.json,
      });
    })
  );

syncCommand
  .command("merge")
  .description("Merge local and remote skills (union behavior)")
  .option("--dry-run", "show planned changes without applying them", false)
  .option("--json", "print output as JSON", false)
  .action(
    withJsonErrorHandling(async (options: { dryRun?: boolean; json?: boolean }) => {
      await runSyncMerge({
        dryRun: options.dryRun,
        json: options.json,
      });
    })
  );

syncCommand
  .command("auto")
  .description("Sync using remote.updatedAt and lastSyncAt comparison")
  .option("--dry-run", "show planned changes without applying them", false)
  .option("--json", "print output as JSON", false)
  .action(
    withJsonErrorHandling(async (options: { dryRun?: boolean; json?: boolean }) => {
      await runSyncAuto({
        dryRun: options.dryRun,
        json: options.json,
      });
    })
  );

syncCommand.action(() => {
  syncCommand.outputHelp();
  throw new Error("Missing sync mode. Use one of: pull, push, merge, auto.");
});

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Error: ${errorMessage(error)}`);
  process.exitCode = 1;
});
