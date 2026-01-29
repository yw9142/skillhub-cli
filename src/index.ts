import { Command } from "commander";
import { runLogin } from "@/commands/login";
import { runSync } from "@/commands/sync";

const program = new Command();

program.name("skillhub").description("SkillHub CLI").version("0.1.0");

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

program.parseAsync(process.argv);
