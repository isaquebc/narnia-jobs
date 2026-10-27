import { profile } from "../components/profile-fixture";

/** API mínima do shell (seletor de perfil, provider, bandeja) para testes de rota da F03. */
export const shellApi = {
  // janela da extensão (2026-10-27): o andamento das abas
  getCaptureActivity: async () => ({ items: [] }),
  // menu em grupos: sem onboarding concluído só "Primeiro uso" aparece
  getOnboardingState: async () => ({ step: 5, completed: true }),
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
  // F05: página da vaga e aba do perfil listam os documentos
  listDocuments: async () => ({ documents: [] }),
  // Configurações › Avaliações (AV-2): Phoenix fora do ar por padrão nos testes
  getEvalsSettings: async () => ({
    bridge: {
      settings: { enabled: true, defaultModel: "sonnet", concurrency: 2 },
      key: "narnia-ponte-teste",
      url: "http://api:3100/bridge/anthropic",
    },
    phoenix: {
      url: null,
      reachable: false,
      providerName: "narnia-assinatura",
      providerRegistered: false,
      anthropicKeySet: false,
    },
    prompts: { count: 17, lastSync: null },
  }),
};
