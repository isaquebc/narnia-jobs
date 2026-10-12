import { expect, type Page } from "@playwright/test";
import { api, waitFor } from "./api";

/** Helpers do chat (F04/M6). O mock responde com roteiros que chamam o `/mcp` real; ver `mockChatScript`. */
export interface ChatSession {
  id: string;
  profileId: string;
  title: string;
  category: string;
  state: string;
  ingestionRunId?: string | null;
}
export interface ChatMessage {
  role: "user" | "assistant" | "system_note";
  contentMd: string;
  toolCalls: Array<{ name: string; isError?: boolean }>;
  turnIndex: number;
}

export const createSession = (body: { profileId?: string; title?: string; category?: string }) =>
  api<{ session: ChatSession }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.session);
export const listSessions = (profileId?: string) =>
  api<{ sessions: ChatSession[] }>(`/api/sessions${profileId ? `?profile=${profileId}` : ""}`).then(
    (r) => r.sessions,
  );
export const getSession = (id: string) =>
  api<{ session: ChatSession }>(`/api/sessions/${id}`).then((r) => r.session);
export const messages = (id: string) =>
  api<{ messages: ChatMessage[] }>(`/api/sessions/${id}/messages?limit=100`).then(
    (r) => r.messages,
  );
export const hibernate = (id: string) =>
  api(`/api/sessions/${id}/hibernate`, { method: "POST", body: "{}" });

/** Envia pela api e espera a resposta do recrutador gravada (um turno completo). */
export async function say(id: string, text: string) {
  const before = (await messages(id)).filter((m) => m.role === "assistant").length;
  await api(`/api/sessions/${id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  return waitFor(
    () => messages(id),
    (ms) => ms.filter((m) => m.role === "assistant").length > before,
    { timeoutMs: 60_000, label: "resposta do recrutador" },
  );
}

/** Perfil adicional pela api (mesmo corpo válido dos testes da api). */
export const createProfile = (name: string, targetTitle = "Engineering Manager") =>
  api<{ id: string }>("/api/profiles", {
    method: "POST",
    body: JSON.stringify({
      name,
      targetTitle,
      altTitles: [],
      seniority: "manager",
      area: "software",
      goal: "new_job",
      market: "BR",
      docLocale: "pt-BR",
      salary: { min: 20000, max: 28000, currency: "BRL", period: "monthly" },
      contractTypes: ["clt"],
      locations: [{ country: "BR", remote: "remote" }],
      availableFrom: "immediate",
      needsResearch: [],
    }),
  });

export const activate = (profileId: string) =>
  api(`/api/profiles/${profileId}/activate`, { method: "PUT", body: "{}" });

/** Na página do chat: escreve, envia e espera o texto da resposta aparecer na lista de mensagens. */
export async function sendInUi(page: Page, text: string, expectReply: RegExp) {
  await page.getByRole("textbox", { name: "Mensagem para o recrutador" }).fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  const list = page.getByRole("list", { name: "Mensagens" });
  await expect(list.getByText(expectReply).last()).toBeVisible({ timeout: 60_000 });
  return list;
}
