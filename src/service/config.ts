export type MergeStrategy = "union" | "latest";

type ConfigShape = {
  githubToken?: string;
  gistId?: string;
  lastSyncAt?: string;
};

type ConfigApi<T> = {
  get: <K extends keyof T>(key: K) => T[K] | undefined;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
};

let configPromise: Promise<ConfigApi<ConfigShape>> | null = null;

async function getConfig() {
  if (!configPromise) {
    configPromise = import("conf").then(
      (module) =>
        new module.default<ConfigShape>({ projectName: "skillhub" }) as ConfigApi<
          ConfigShape
        >
    );
  }
  return configPromise;
}

export const configStore = {
  async getToken() {
    const config = await getConfig();
    return config.get("githubToken");
  },
  async setToken(token: string) {
    const config = await getConfig();
    config.set("githubToken", token);
  },
  async getGistId() {
    const config = await getConfig();
    return config.get("gistId");
  },
  async setGistId(gistId: string) {
    const config = await getConfig();
    config.set("gistId", gistId);
  },
  async getLastSyncAt() {
    const config = await getConfig();
    return config.get("lastSyncAt");
  },
  async setLastSyncAt(lastSyncAt: string) {
    const config = await getConfig();
    config.set("lastSyncAt", lastSyncAt);
  },
};
