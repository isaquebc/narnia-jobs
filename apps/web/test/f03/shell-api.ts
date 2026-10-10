import { profile } from "../components/profile-fixture";

/** API mínima do shell (seletor de perfil, provider, bandeja) para testes de rota da F03. */
export const shellApi = {
  listJobs: async () => ({ jobs: [] }),
  getProviderStatus: async () => ({
    installed: true,
    loggedIn: true,
    authMethod: "claude.ai" as const,
    version: "1",
    loginHint: null,
  }),
  listProfiles: async () => ({ profiles: [profile("p1", { isActive: true, name: "Eng" })] }),
  listSuggestions: async () => ({ suggestions: [] }),
  getUser: async () => ({ user: null }),
  getBackupSettings: async () => ({ max: 5, enabled: true, latest: null, count: 0 }),
};
