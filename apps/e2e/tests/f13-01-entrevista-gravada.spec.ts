import { expect, type Page, test } from "@playwright/test";
import { api } from "../helpers/api";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

/**
 * F13/M1.5 · entrevista gravada: Configurações › Análise de vídeo e envio do vídeo (plans/plan-v0/tasks/F13 §6.3).
 * O e2e sobe o serviço `media` em modo falso (sem modelos, entrevista sintética) e sem token: o estado real é "falta o
 * token". "Desligada" e o fluxo do token (que consultaria o Hugging Face) vêm de respostas de `/api/media/*`
 * interceptadas no navegador. O envio e a reprodução usam o api de verdade.
 */
const MB = 1024 * 1024;
/** 20 MB sintéticos: três partes de até 8 MB. O api não lê o conteúdo no envio (a validação é a 1ª etapa da análise). */
const VIDEO = Buffer.alloc(20 * MB, 7);

const status = (state: "needs_token" | "ready") => ({
  state,
  enableCommand: "./start.sh media on",
  version: "0.1.0",
  busy: false,
  steps: ["probe"],
});

/** `media` falso: começa sem token; o token "hf_valido…" é aceito e qualquer outro é recusado como o Hugging Face. */
async function fakeMedia(page: Page) {
  let state: "needs_token" | "ready" = "needs_token";
  await page.route("**/api/media/status", (r) => r.fulfill({ json: status(state) }));
  await page.route("**/api/media/token", async (r) => {
    if (r.request().method() === "DELETE") {
      state = "needs_token";
      return r.fulfill({ json: status(state) });
    }
    const { token } = r.request().postDataJSON() as { token: string };
    if (!token.startsWith("hf_valido"))
      return r.fulfill({
        status: 422,
        json: {
          error: {
            code: "token_rejected",
            message:
              "O Hugging Face recusou o acesso ao pyannote/speaker-diarization-community-1: aceite os termos na página do modelo.",
          },
        },
      });
    state = "ready";
    return r.fulfill({ json: status(state) });
  });
}

async function applied(page: Page) {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: `${JD}\n\nEtapas do processo:\n1. Triagem\n2. Técnica` });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);
  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Aplicar nesta vaga" })
    .getByRole("button", { name: "Confirmar candidatura" })
    .click();
  await page.getByRole("link", { name: "Ver candidatura" }).click();
  await expect(page.getByRole("list", { name: "Etapas do processo" })).toBeVisible();
  const appId = page.url().split("/candidaturas/")[1]?.split(/[?#]/)[0] ?? "";
  return { profileId: ids.profileId, appId };
}

test("F13/E2E-01 Configurações › análise de vídeo › desligada mostra o comando; media falso: token recusado, aceito e removido", async ({
  page,
}) => {
  await freshStart("engineer");
  await page.route("**/api/media/status", (r) =>
    r.fulfill({
      json: {
        state: "off",
        enableCommand: "./start.sh media on",
        version: null,
        busy: false,
        steps: [],
      },
    }),
  );
  await login(page, "/configuracoes");
  const card = page.getByRole("region", { name: "Análise de vídeo (opcional)" });
  await expect(card.getByText("Desligada", { exact: true })).toBeVisible();
  await expect(card.getByText("./start.sh media on")).toBeVisible();
  await expect(card.getByText(/Nada pode ser publicado/)).toBeVisible();

  await page.unroute("**/api/media/status");
  await fakeMedia(page);
  await card.getByRole("button", { name: "Verificar de novo" }).click();
  await expect(card.getByText("Falta o token", { exact: true })).toBeVisible();
  await expect(card.getByRole("list", { name: "Como criar o token" })).toBeVisible();
  const token = card.getByLabel("Token do Hugging Face");
  await token.fill("hf_sem_termos");
  await card.getByRole("button", { name: "Salvar token" }).click();
  await expect(card.getByText(/aceite os termos/)).toBeVisible();
  await token.fill("hf_valido_123");
  await card.getByRole("button", { name: "Salvar token" }).click();
  await expect(card.getByText("Pronta", { exact: true })).toBeVisible();
  await expect(card.getByLabel("Token do Hugging Face")).toHaveCount(0);

  page.once("dialog", (d) => void d.accept());
  await card.getByRole("button", { name: "Remover token" }).click();
  await expect(card.getByText("Falta o token", { exact: true })).toBeVisible();

  const gb = card.getByLabel("Tamanho máximo por vídeo (GB)");
  await expect(gb).toHaveValue("4");
  await gb.fill("6");
  await card.getByRole("button", { name: "Salvar limites" }).click();
  await expect(card.getByText("Limites salvos.")).toBeVisible();
  expect(await api<{ maxBytes: number }>("/api/settings/recordings")).toMatchObject({
    maxBytes: 6 * 1024 ** 3,
  });
});

test("F13/E2E-02 candidatura › envio em partes na etapa, queda de rede no meio, reprodução com Range, retomada após fechar a aba, apagar", async ({
  page,
}) => {
  const { appId } = await applied(page);
  const card = page.getByRole("region", { name: "Entrevistas gravadas" });
  await expect(card.getByText(/ainda não tem o token do Hugging Face/i)).toBeVisible();

  // a segunda parte cai uma vez (rede): o envio espera e tenta de novo sozinho
  let dropped = false;
  await page.route("**/api/recordings/*/video?offset=*", (r) => {
    if (!dropped && !r.request().url().endsWith("offset=0")) {
      dropped = true;
      return r.abort("connectionreset");
    }
    return r.continue();
  });
  const form = card.getByRole("form", { name: "Enviar entrevista" });
  await form.getByLabel("Etapa").selectOption({ label: "Técnica" });
  await form
    .getByLabel("Vídeo da entrevista")
    .setInputFiles({ name: "final.webm", mimeType: "video/webm", buffer: VIDEO });
  await form.getByRole("button", { name: "Enviar vídeo" }).click();
  const item = card.getByRole("listitem", { name: "final.webm" });
  // terminado o envio, a análise começa sozinha (o conteúdo aqui não é vídeo: ela falha, o que não importa aqui)
  await expect(item.locator("video")).toHaveCount(1, { timeout: 60_000 });
  expect(dropped).toBe(true);
  await expect(item).toContainText("Técnica");
  const video = item.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/recordings\/.+\/video$/);
  const src = (await video.getAttribute("src")) ?? "";
  const part = await page.request.get(src, { headers: { range: "bytes=0-9" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toBe(`bytes 0-9/${VIDEO.length}`);

  // outra entrevista começou e a aba fechou depois da primeira parte: escolher o mesmo arquivo continua dali
  const rec = await api<{ id: string }>("/api/recordings", {
    method: "POST",
    body: JSON.stringify({ jobApplicationId: appId, fileName: "rh.webm", size: VIDEO.length }),
  });
  await api(`/api/recordings/${rec.id}/video?offset=0`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: VIDEO.subarray(0, 8 * MB),
  });
  await page.reload();
  const stopped = card.getByRole("listitem", { name: "rh.webm" });
  await expect(stopped).toContainText("Envio parado em 40%");
  await stopped
    .getByLabel("Continuar o envio de rh.webm")
    .setInputFiles({ name: "rh.webm", mimeType: "video/webm", buffer: VIDEO });
  await expect(stopped.locator("video")).toHaveCount(1, { timeout: 60_000 });
  const bytes = await page.request.get(`/api/recordings/${rec.id}/video`);
  expect((await bytes.body()).equals(VIDEO)).toBe(true);

  page.on("dialog", (d) => void d.accept());
  await stopped.getByRole("button", { name: "Apagar só o vídeo" }).click();
  await expect(stopped.getByText(/Vídeo apagado/)).toBeVisible();
  await expect(stopped.locator("video")).toHaveCount(0);
  await stopped.getByRole("button", { name: "Apagar entrevista" }).click();
  await expect(card.getByRole("listitem", { name: "rh.webm" })).toHaveCount(0);
  await expect(card.getByRole("listitem", { name: "final.webm" })).toBeVisible();
});

test("F13/E2E-03 perfil › aba Entrevistas › envio avulso, sem candidatura", async ({ page }) => {
  const { ids } = await freshStart("engineer");
  await login(page, `/perfis/${ids.profileId}/entrevistas`);
  const card = page.getByRole("region", { name: "Entrevistas gravadas" });
  const form = card.getByRole("form", { name: "Enviar entrevista" });
  await expect(form.getByLabel("Etapa")).toHaveCount(0);
  await form.getByLabel("Título (opcional)").fill("Simulação com um amigo");
  await form.getByLabel("Vídeo da entrevista").setInputFiles({
    name: "treino.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(MB, 1),
  });
  await form.getByRole("button", { name: "Enviar vídeo" }).click();
  const item = card.getByRole("listitem", { name: "Simulação com um amigo" });
  await expect(item.locator("video")).toHaveCount(1);
  const list = await api<{ recordings: Array<{ jobApplicationId: string | null }> }>(
    `/api/recordings?profileId=${ids.profileId}`,
  );
  expect(list.recordings).toHaveLength(1);
  expect(list.recordings[0]?.jobApplicationId).toBeNull();
});

test("F13/E2E-04 análise completa com o media falso › acompanhar, quem é quem, relatório, ir ao trecho, corrigir quem falou, refazer e conversar", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await applied(page);
  const card = page.getByRole("region", { name: "Entrevistas gravadas" });
  const form = card.getByRole("form", { name: "Enviar entrevista" });
  await form.getByLabel("Etapa").selectOption({ label: "Técnica" });
  await form.getByLabel("Vídeo da entrevista").setInputFiles("fixtures/entrevista-sintetica.webm");
  await form.getByRole("button", { name: "Enviar vídeo" }).click();
  const item = card.getByRole("listitem", { name: "entrevista-sintetica.webm" });
  await expect(item.getByRole("progressbar")).toBeVisible({ timeout: 60_000 });
  await expect(item.getByText("Analisada")).toBeVisible({ timeout: 180_000 });
  await item.getByRole("link", { name: "Abrir análise" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "entrevista-sintetica.webm" }),
  ).toBeVisible();
  const people = page.getByRole("region", { name: "Quem é quem" });
  await expect(people.getByText(/Marina Duarte/).first()).toBeVisible();
  await expect(people.getByText(/Alex Souza/).first()).toBeVisible();
  const mark = people.getByRole("button", { name: "Marcar Alex Souza como você" });
  if (await mark.count()) await mark.click();
  await expect(
    people.getByRole("button", { name: "Marcar Marina Duarte como você" }),
  ).toBeVisible();

  const report = page.getByRole("region", { name: "Relatório do recrutador" });
  await expect(report.getByRole("heading", { level: 3, name: "Veredito" })).toBeVisible();
  await expect(report.getByText(/Alerta de confiabilidade/)).toBeVisible();
  const seek = report.getByRole("button", { name: /^Ir para / }).first();
  const label = (await seek.getAttribute("aria-label")) ?? "";
  const [mm, ss] = label.replace("Ir para ", "").split(":").map(Number);
  await seek.click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => Math.round((v as HTMLVideoElement).currentTime)),
    )
    // tempo citado no relatório: 3 s antes, para pegar o contexto (pedido do dono)
    .toBe(Math.max(0, (mm ?? 0) * 60 + (ss ?? 0) - 3));

  const transcript = page.getByRole("region", { name: "Transcrição" });
  const who = transcript.getByLabel("Quem falou o turno 0");
  const options = await who.locator("option").allTextContents();
  const other = options.find((o) => o.includes("Alex Souza")) ?? options[1] ?? "";
  await who.selectOption({ label: other });
  await expect(transcript.getByText("corrigido").first()).toBeVisible();

  await page.getByRole("button", { name: "Refazer o relatório" }).click();
  await expect(page.getByText("Analisada").first()).toBeVisible({ timeout: 120_000 });

  await page
    .getByRole("textbox", { name: "Conversar sobre a entrevista" })
    .fill("Como eu deveria ter respondido sobre índices?");
  await page.getByRole("button", { name: "Abrir conversa" }).click();
  await expect(page).toHaveURL(/\/chat\//);
});
