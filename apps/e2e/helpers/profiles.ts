/** Helpers dos cenários da F02: semeadura, leitura pela API e passos de interface dos perfis. */
import { expect, type Page } from "@playwright/test";
import { api } from "./api";
import { openApp } from "./flows";

export type FixtureName = "engineer" | "leader" | "long";
export interface SeededIds {
  userId: string;
  profileId: string;
  experienceIds: string[];
  achievementIds: string[];
  projectIds: string[];
  educationIds: string[];
  skillIds: string[];
  languageIds: string[];
}
export const seed = (fixture: FixtureName) =>
  api<{ ok: boolean; ids: SeededIds }>("/api/_test/seed", {
    method: "POST",
    body: JSON.stringify({ fixture }),
  });

export interface ProfileRow {
  id: string;
  name: string;
  targetTitle: string;
  isActive: boolean;
  archivedAt: string | null;
  clonedFrom: string | null;
  cardUpdatedAt: string | null;
  needsResearch: string[];
}
export const listProfiles = (archived = false) =>
  api<{ profiles: ProfileRow[] }>(`/api/profiles${archived ? "?archived=1" : ""}`);
export const profileByName = async (name: string, archived = false) => {
  const p = (await listProfiles(archived)).profiles.find((x) => x.name === name);
  if (!p) throw new Error(`perfil não encontrado: ${name}`);
  return p;
};

export interface CardResponse {
  text: string;
  tokensEst: number;
  hash: string;
  factsVersion: number;
  builtAt: string;
  profileId: string;
  valid: boolean;
}
export const getCard = (id: string) => api<CardResponse>(`/api/profiles/${id}/card`);

export interface EmphasisRow {
  kind: string;
  id: string;
  mode: "highlight" | "normal" | "hidden";
  position: number | null;
  label: string;
  sublabel: string | null;
  date: string | null;
  relevance: { score: number; reasons: string[] } | null;
}
export const listEmphasis = (id: string) =>
  api<{ items: EmphasisRow[] }>(`/api/profiles/${id}/emphasis`);

export const dashboardFull = () =>
  api<{
    profile: { id: string; name: string; targetTitle: string } | null;
    card: { text: string; builtAt: string; valid: boolean } | null;
    emphasis: { highlighted: number; hidden: number };
    suggestions: number;
    counts: {
      experiences: number;
      skills: number;
      education: number;
      files: number;
      projects: number;
    };
  }>("/api/dashboard");

export interface SuggestionRow {
  id: string;
  source: "heuristic" | "model";
  model: string | null;
  status: string;
  payload: { title: string; rationale: string; supportingFactIds: string[] };
}
export const listSuggestions = () =>
  api<{ suggestions: SuggestionRow[] }>("/api/profiles/suggestions");

export const patchFact = (kind: string, id: string, patch: Record<string, unknown>) =>
  api(`/api/_test/facts/${kind}/${id}`, { method: "PATCH", body: JSON.stringify(patch) });

/** Primeiro acesso com token (cai no dashboard, onboarding concluído pelo seed) e navegação para a rota pedida. */
export async function login(page: Page, path?: string) {
  await openApp(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  if (path) await page.goto(path);
}

export async function gotoProfiles(page: Page) {
  await page.goto("/perfis");
  await expect(page.getByRole("heading", { name: "Perfis", exact: true })).toBeVisible();
}

export const profileItem = (page: Page, name: string) =>
  page.locator('ul[aria-label="Perfis"]').locator(`li[aria-label="${name}"]`);

export const switcher = (page: Page) => page.getByRole("button", { name: "Trocar perfil" });

/** Troca o perfil ativo pelo seletor do topo e espera o botão refletir o nome. */
export async function switchTo(page: Page, name: string) {
  await switcher(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(name) }).click();
  await expect(switcher(page)).toContainText(name);
}

export interface NewProfileOpts {
  name: string;
  title?: string;
  area?: string;
  salary?: { min: string; max: string } | "dontKnow";
}

/** Preenche o formulário de /perfis/novo (já aberto) e cria; volta para /perfis. */
export async function fillNewProfileAndCreate(page: Page, opts: NewProfileOpts) {
  await expect(page.getByRole("heading", { name: "Novo perfil" })).toBeVisible();
  await page.locator("#pname").fill(opts.name);
  if (opts.title) await page.locator("#ptitle").fill(opts.title);
  if (opts.area) await page.locator("#parea").fill(opts.area);
  const salary = opts.salary ?? "dontKnow";
  if (salary === "dontKnow") await page.getByLabel("Não sei").first().check();
  else {
    await page.getByLabel("Mínimo").fill(salary.min);
    await page.getByLabel("Máximo").fill(salary.max);
  }
  await page.getByLabel("CLT", { exact: true }).check();
  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  await expect(page).toHaveURL(/\/perfis$/);
  await expect(profileItem(page, opts.name)).toBeVisible();
}

/** Cria um segundo perfil "Project Manager" pela interface (inativo). */
export async function createPm(page: Page) {
  await gotoProfiles(page);
  await page.getByRole("link", { name: "+ Novo perfil" }).first().click();
  await fillNewProfileAndCreate(page, {
    name: "Project Manager",
    title: "Project Manager",
    area: "management",
    salary: { min: "15000", max: "20000" },
  });
  return profileByName("Project Manager");
}
