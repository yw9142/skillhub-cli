import { Command } from "commander";
import { runLogin } from "@/commands/login";
import { runSync } from "@/commands/sync";

function getPackageVersion() {
  try {
    const pkg = require("../package.json") as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
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
  .option(
    "-s, --strategy <strategy>",
    "merge strategy (union|latest)",
    "union"
  )
  .action(async (options: { strategy?: string }) => {
    await runSync(options.strategy);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
