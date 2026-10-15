import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelSettingsSection } from "../../src/features/settings/ModelSettingsSection";
import { renderWithProviders } from "../helpers";

/** F06/M6 · Configurações › Modelos: modelo do Claude por tarefa (F06-5, F06-13). */
describe("F06/M6 · Modelos por tarefa", () => {
  it("mostra o padrão de cada tarefa e grava a troca", async () => {
    const models = {
      posting_extract: "haiku",
      posting_merge: "haiku",
      posting_duplicate: "haiku",
      posting_analyze: "sonnet",
    };
    const putModelSettings = vi.fn(async (p: Record<string, string>) => ({
      models: { ...models, ...p },
      defaults: models,
    }));
    renderWithProviders(<ModelSettingsSection />, {
      api: {
        getModelSettings: async () => ({ models, defaults: models }),
        putModelSettings,
      } as never,
    });
    const analyze = await screen.findByLabelText("Análise da vaga (recrutador)");
    expect(screen.getByText("padrão: sonnet")).toBeInTheDocument();
    expect([...(analyze as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      "haiku",
      "sonnet",
      "opus",
    ]);
    await userEvent.selectOptions(analyze, "opus");
    expect(putModelSettings).toHaveBeenCalledWith({ posting_analyze: "opus" });
    await waitFor(() => expect(screen.getByText("Modelos salvos.")).toBeInTheDocument());
  });
});
