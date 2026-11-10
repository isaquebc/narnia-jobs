import { expect, type Page, test } from "@playwright/test";
import { api } from "../helpers/api";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

/**
 * F13/M1.5 · entrevista gravada: Configurações › Análise de vídeo e envio do vídeo (plans/plan-v0/tasks/F13 §6.3).
 * O e2e não sobe o serviço `media` (perfil opcional): o estado real é "desligada". Os estados ligada sem token e pronta
 * vêm de um `media` falso, com as respostas de `/api/media/*` interceptadas no navegador. O envio e a reprodução usam o
 * api de verdade (não dependem do `media`).
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
  await login(page, "/configuracoes");
  const card = page.getByRole("region", { name: "Análise de vídeo (opcional)" });
  await expect(card.getByText("Desligada", { exact: true })).toBeVisible();
  await expect(card.getByText("./start.sh media on")).toBeVisible();
  await expect(card.getByText(/Nada pode ser publicado/)).toBeVisible();

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
  await expect(card.getByText(/análise de vídeo está desligada/i)).toBeVisible();

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
  await expect(item.getByText("Enviada, aguardando análise")).toBeVisible({ timeout: 60_000 });
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
  await expect(stopped.getByText("Enviada, aguardando análise")).toBeVisible({ timeout: 60_000 });
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
  await expect(item.getByText("Enviada, aguardando análise")).toBeVisible();
  const list = await api<{ recordings: Array<{ jobApplicationId: string | null }> }>(
    `/api/recordings?profileId=${ids.profileId}`,
  );
  expect(list.recordings).toHaveLength(1);
  expect(list.recordings[0]?.jobApplicationId).toBeNull();
});
