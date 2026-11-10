import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/api";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F13/M1.5 · Configurações › Análise de vídeo (R2, R4, F13-1, F13-5, F13-11): desligada mostra o comando; ligada sem
 * token, o passo a passo do Hugging Face; pronta, remover o token; a regra de uso sempre visível; limites do envio.
 */
const status = (state: "off" | "needs_token" | "ready") => ({
  state,
  enableCommand: "./start.sh media on",
  version: state === "off" ? null : "0.1.0",
  busy: false,
  steps: state === "off" ? [] : ["probe"],
});

const api = (state: "off" | "needs_token" | "ready", over: Record<string, unknown> = {}) => ({
  ...shellApi,
  listNotifications: async () => ({ notifications: [], unresolved: 0 }),
  getIngestSettings: async () => ingestSettings(),
  getGithubAuth: async () => githubAuth(),
  listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
  getGoogleCalendarStatus: async () => ({
    status: "not_configured",
    detail: null,
    mcpUrl: "",
    callbackPort: 8089,
    redirectUri: "",
    steps: { add: "", login: "" },
  }),
  getMediaStatus: vi.fn(async () => status(state)),
  putMediaToken: vi.fn(async () => status("ready")),
  deleteMediaToken: vi.fn(async () => status("needs_token")),
  getRecordingSettings: vi.fn(async () => ({ maxBytes: 4 * 1024 ** 3, maxSeconds: 3 * 3600 })),
  putRecordingSettings: vi.fn(async (b: unknown) => b),
  ...over,
});

const card = () => screen.findByRole("region", { name: "Análise de vídeo (opcional)" });

describe("F13/M1.5 · Configurações › Análise de vídeo", () => {
  it("desligada: comando para ligar e a regra de uso", async () => {
    renderApp({ api: api("off") as never, initialUrl: "/configuracoes" });
    const c = await card();
    expect(await within(c).findByText("Desligada")).toBeInTheDocument();
    expect(within(c).getByText("./start.sh media on")).toBeInTheDocument();
    expect(within(c).getByText(/nada pode ser publicado/i)).toBeInTheDocument();
    expect(within(c).queryByLabelText("Token do Hugging Face")).toBeNull();
  });

  it("sem token: passo a passo, salva o token e limpa o campo", async () => {
    const a = api("needs_token");
    renderApp({ api: a as never, initialUrl: "/configuracoes" });
    const c = await card();
    expect(await within(c).findByText("Falta o token")).toBeInTheDocument();
    const steps = within(c).getByRole("list", { name: "Como criar o token" });
    expect(
      within(steps).getByRole("link", { name: /speaker-diarization-community-1/ }),
    ).toHaveAttribute("href", "https://huggingface.co/pyannote/speaker-diarization-community-1");
    expect(within(c).getByText(/movimento da boca/)).toBeInTheDocument();
    const input = within(c).getByLabelText("Token do Hugging Face");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "hf_abc123");
    await userEvent.click(within(c).getByRole("button", { name: "Salvar token" }));
    await waitFor(() => expect(a.putMediaToken).toHaveBeenCalledWith("hf_abc123"));
    expect(await within(c).findByText("Pronta")).toBeInTheDocument();
    expect(within(c).queryByLabelText("Token do Hugging Face")).toBeNull();
  });

  it("token recusado: mostra a mensagem do Hugging Face", async () => {
    const a = api("needs_token", {
      putMediaToken: vi.fn(async () => {
        throw new ApiError(
          422,
          "token_rejected",
          "Aceite os termos do pyannote/speaker-diarization-community-1.",
        );
      }),
    });
    renderApp({ api: a as never, initialUrl: "/configuracoes" });
    const c = await card();
    await userEvent.type(await within(c).findByLabelText("Token do Hugging Face"), "hf_x12");
    await userEvent.click(within(c).getByRole("button", { name: "Salvar token" }));
    expect(await within(c).findByText(/Aceite os termos/)).toBeInTheDocument();
  });

  it("pronta: remover o token pede confirmação", async () => {
    const a = api("ready");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp({ api: a as never, initialUrl: "/configuracoes" });
    const c = await card();
    expect(await within(c).findByText("Pronta")).toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "Remover token" }));
    await waitFor(() => expect(a.deleteMediaToken).toHaveBeenCalled());
    expect(await within(c).findByText("Falta o token")).toBeInTheDocument();
  });

  it("limites do envio em GB e horas", async () => {
    const a = api("ready");
    renderApp({ api: a as never, initialUrl: "/configuracoes" });
    const c = await card();
    const gb = await within(c).findByLabelText("Tamanho máximo por vídeo (GB)");
    expect(gb).toHaveValue(4);
    await userEvent.clear(gb);
    await userEvent.type(gb, "6");
    const h = within(c).getByLabelText("Duração máxima (horas)");
    await userEvent.clear(h);
    await userEvent.type(h, "1.5");
    await userEvent.click(within(c).getByRole("button", { name: "Salvar limites" }));
    await waitFor(() =>
      expect(a.putRecordingSettings).toHaveBeenCalledWith({
        maxBytes: 6 * 1024 ** 3,
        maxSeconds: 5400,
      }),
    );
  });
});
