/** Helpers dos cenários e2e da F03 (ingestão, GitHub com `gh` falso, notificações). */
import { expect, type Page } from "@playwright/test";
import { api, reset, waitFor } from "./api";
import { openApp } from "./flows";
import { type FixtureName, seed } from "./profiles";

export interface FakeGithub {
  authenticated?: boolean;
  rateLimited?: boolean;
  heads?: Record<string, string>;
  hostTokenAvailable?: boolean;
  deviceComplete?: boolean;
  offline?: boolean;
}

/** Estado do `gh` falso (persistido na pasta de dados da stack e2e; o reset do banco não o limpa). */
export const setGithub = (s: FakeGithub) =>
  api("/api/_test/github", { method: "POST", body: JSON.stringify(s) });

export interface PlanUsage {
  subscriptionType: string | null;
  windows: {
    fiveHour: { utilization: number; resetsAt: string | null } | null;
    weekly: { utilization: number; resetsAt: string | null } | null;
  };
  approximate?: boolean;
}

export const setMockF03 = (m: {
  unsupportedEvidence?: boolean;
  planUsage?: unknown;
  delayMs?: number;
  errors?: Record<string, string>;
}) => api("/api/_test/mock", { method: "POST", body: JSON.stringify(m) });

/** Reset do banco + fixture + `gh` falso num estado conhecido (logado, online, sem rate limit, sem push novo). */
export async function freshStart(fixture: FixtureName = "engineer") {
  await reset();
  await setGithub({
    authenticated: true,
    rateLimited: false,
    offline: false,
    heads: {},
    hostTokenAvailable: true,
  });
  await setMockF03({ unsupportedEvidence: false });
  return seed(fixture);
}

export async function openIngestion(page: Page) {
  await openApp(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/ingestao");
  await expect(page.getByRole("tab", { name: "GitHub" })).toBeVisible();
}

export interface RunRow {
  id: string;
  status: string;
  source: string;
  report?: { repos: Array<{ fullName: string; status: string }> } | null;
  analyses?: Array<{ kind: string; repoId: string }>;
  proposals: Array<{
    id: string;
    decision: string;
    match: string | null;
    checkStatus: string | null;
    proposal: { kind: string; data: Record<string, unknown> };
  }>;
}

export const getRun = (id: string) => api<RunRow>(`/api/ingestions/${id}`);
export const listRuns = () =>
  api<{ runs: Array<{ id: string; status: string; source: string }> }>("/api/ingestions");

export const waitRun = (id: string, statuses: string[], timeoutMs = 90_000) =>
  waitFor(
    () => getRun(id),
    (r) => statuses.includes(r.status),
    { timeoutMs, everyMs: 500, label: `execução ${id} em ${statuses.join("|")}` },
  );

/** Cria uma execução do GitHub pela api (atalho para cenários cujo foco não é o formulário). */
export async function createGithubRun(body: {
  mode?: "public" | "private";
  repos: string[];
  depth?: "quick" | "balanced" | "deep";
  model?: string;
  budget?: { amount: number; unit: "thousand" | "million" | "window_pct" };
  login?: string;
}) {
  const run = await api<{ id: string }>("/api/ingestions", {
    method: "POST",
    body: JSON.stringify({
      source: "github",
      mode: body.mode ?? "private",
      depth: body.depth ?? "quick",
      model: body.model ?? "haiku",
      ...body,
    }),
  });
  await waitRun(run.id, ["awaiting_confirmation"]);
  return run.id;
}

export const confirmRun = (id: string) =>
  api(`/api/ingestions/${id}/confirm`, { method: "POST", body: "{}" });

export interface NotificationRow {
  id: string;
  kind: string;
  subjectId: string;
  actionUrl: string;
  resolvedAt: string | null;
}
export const notifications = (status: "open" | "resolved" | "all" = "open") =>
  api<{ notifications: NotificationRow[]; unresolved: number }>(
    `/api/notifications?status=${status}`,
  );

/** Revisão na página da execução: aceita todas e salva. */
export async function acceptAllAndSave(page: Page) {
  const review = page.getByRole("region", { name: "Revisão" });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.getByRole("button", { name: "Aceitar todos" }).click();
  await review.getByRole("button", { name: "Salvar revisão" }).click();
}

export const HEAD = (c: string) => c.repeat(40);

/** Expande todos os grupos e desmarca tudo; depois marca só os repositórios pedidos. */
export async function selectOnly(page: Page, fullNames: string[]) {
  const collapsed = page.getByRole("button", { expanded: false });
  while ((await collapsed.count()) > 0) await collapsed.first().click();
  for (const cb of await page.getByRole("checkbox").all())
    if (await cb.isChecked()) await cb.uncheck();
  for (const n of fullNames) await page.getByRole("checkbox", { name: n, exact: true }).check();
}

/** Conclui a revisão pela api rejeitando tudo (cenários cujo foco não é a revisão; evita conflitos). */
export async function finishByRejecting(runId: string) {
  const run = await getRun(runId);
  const decisions = run.proposals
    .filter((p) => p.decision === "pending")
    .map((p) => ({ proposalId: p.id, decision: "rejected" }));
  if (decisions.length > 0)
    await api(`/api/ingestions/${runId}/review`, {
      method: "POST",
      body: JSON.stringify({ decisions }),
    });
  return waitRun(runId, ["done"]);
}

/** Execução completa do GitHub pela api até a revisão. */
export async function runGithubToReview(repos: string[]) {
  const id = await createGithubRun({ repos });
  await confirmRun(id);
  await waitRun(id, ["review"]);
  return id;
}

/** Cria uma execução de texto livre pela api (sobe o texto e inicia). */
export async function startTextRun(text: string) {
  const file = await api<{ id: string }>("/api/texts", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  const run = await api<{ id: string }>("/api/ingestions", {
    method: "POST",
    body: JSON.stringify({ fileId: file.id }),
  });
  return run.id;
}

export const STORY =
  "Comecei como estagiária de suporte em 2014 numa empresa de logística, onde aprendi SQL resolvendo chamados. " +
  "Em 2016 virei desenvolvedora backend na Acme Pagamentos, cuidando da API de cobranças em Node.js e PostgreSQL. " +
  "Liderei a migração para filas com RabbitMQ, que reduziu o tempo de conciliação de horas para minutos. " +
  "Hoje sou engenheira sênior e mentoro duas pessoas do time, além de cuidar da observabilidade da plataforma.";
