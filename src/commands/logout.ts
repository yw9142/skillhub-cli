import { configStore } from "@/service/config";
import { emitOutput } from "@/utils/output";

export type RunLogoutOptions = {
  yes?: boolean;
  json?: boolean;
};

type LogoutSummary = {
  cleared: boolean;
  removedKeys: string[];
};

export type LogoutStore = {
  clearSession: () => Promise<void>;
};

const REMOVED_KEYS = ["githubToken", "gistId", "lastSyncAt"];

function formatLogoutSummary(summary: LogoutSummary) {
  if (!summary.cleared) {
    return "Logout cancelled.";
  }
  return `Logout completed. Removed keys: ${summary.removedKeys.join(", ")}`;
}

export async function clearStoredSession(store: LogoutStore = configStore) {
  await store.clearSession();
  return [...REMOVED_KEYS];
}

export async function runLogout(options: RunLogoutOptions = {}) {
  const asJson = options.json === true;
  const force = options.yes === true;

  if (!force) {
    const { default: inquirer } = await import("inquirer");
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        default: false,
        message:
          "Delete stored GitHub session data (token, gistId, lastSyncAt)?",
      },
    ]);

    if (!confirm) {
      const cancelled: LogoutSummary = { cleared: false, removedKeys: [] };
      emitOutput(cancelled, asJson, formatLogoutSummary);
      return cancelled;
    }
  }

  const removedKeys = await clearStoredSession();
  const summary: LogoutSummary = {
    cleared: true,
    removedKeys,
  };
  emitOutput(summary, asJson, formatLogoutSummary);
  return summary;
}
