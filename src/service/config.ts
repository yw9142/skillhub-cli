type ConfigShape = {
  githubToken?: string;
  gistId?: string;
  lastSyncAt?: string;
};

type ConfigApi<T> = {
  get: <K extends keyof T>(key: K) => T[K] | undefined;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  delete: <K extends keyof T>(key: K) => void;
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
  async clearToken() {
    const config = await getConfig();
    config.delete("githubToken");
  },
  async clearGistId() {
    const config = await getConfig();
    config.delete("gistId");
  },
  async clearLastSyncAt() {
    const config = await getConfig();
    config.delete("lastSyncAt");
  },
  async clearSession() {
    const config = await getConfig();
    config.delete("githubToken");
    config.delete("gistId");
    config.delete("lastSyncAt");
  },
};
