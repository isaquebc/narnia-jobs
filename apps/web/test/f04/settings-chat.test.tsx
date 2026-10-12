import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

const settings = {
  maxLiveSessions: 5,
  hibernateAfterMin: 60,
  maxTurns: 8,
  defaultModel: "sonnet",
  maxBudgetUsd: null,
  requireTrustedResearch: true,
};
const domain = (id: string, pattern: string, builtin = true) => ({
  id,
  pattern,
  trustTag: "official" as const,
  builtin,
  enabled: true,
  createdAt: "2026-10-11T12:00:00.000Z",
});

describe("F04/M4 · Configurações › Chat", () => {
  it("salva as preferências e gerencia domínios confiáveis", async () => {
    const api = {
      ...shellApi,
      listNotifications: async () => ({ notifications: [], unresolved: 0 }),
      getIngestSettings: async () => ingestSettings(),
      getGithubAuth: async () => githubAuth(),
      listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
      getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
      getChatSettings: vi.fn(async () => ({ settings })),
      putChatSettings: vi.fn(async (p: Record<string, unknown>) => ({
        settings: { ...settings, ...p },
      })),
      listTrustedDomains: vi.fn(async () => ({ domains: [domain("d1", "*.gov.br")] })),
      addTrustedDomain: vi.fn(async (d: { pattern: string }) => ({
        domain: domain("d2", d.pattern, false),
      })),
      patchTrustedDomain: vi.fn(async () => ({ domains: [] })),
      restoreTrustedDomains: vi.fn(async () => ({ domains: [domain("d1", "*.gov.br")] })),
    };
    renderApp({ api, initialUrl: "/configuracoes" });
    const sessions = await screen.findByLabelText("Conversas simultâneas");
    await userEvent.clear(sessions);
    await userEvent.type(sessions, "3");
    await userEvent.click(screen.getByRole("button", { name: "Salvar preferências do chat" }));
    await waitFor(() =>
      expect(api.putChatSettings).toHaveBeenCalledWith(
        expect.objectContaining({ maxLiveSessions: 3 }),
      ),
    );
    expect(await screen.findByText("*.gov.br")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Novo domínio"), "glassdoor.*");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar domínio" }));
    await waitFor(() =>
      expect(api.addTrustedDomain).toHaveBeenCalledWith({
        pattern: "glassdoor.*",
        trustTag: "jobboard",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Restaurar padrões" }));
    await waitFor(() => expect(api.restoreTrustedDomains).toHaveBeenCalled());
  });
});
