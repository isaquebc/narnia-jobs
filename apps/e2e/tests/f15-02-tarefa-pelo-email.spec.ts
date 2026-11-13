import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * F15/E2E-02 · tarefa e fases pelo e-mail (plans/plan-v0/tasks/F15-tarefas-e-avisos.md §7), com o Gmail falso e o
 * classificador do mock (linhas `AÇÃO:` e `FASES:`). A candidatura nasce da confirmação ("aplicar mesmo assim"); o
 * e-mail seguinte pede a triagem e lista as fases: a tarefa nasce em A fazer, sem o link (remetente sem autenticação),
 * com a tag `confira`, e as etapas padrão viram as fases do e-mail.
 */
const eml = (o: { subject: string; date: string; body: string }) =>
  [
    "From: RH Acme <rh@acme.example>",
    "To: pessoa@example.com",
    `Subject: ${o.subject}`,
    `Date: ${new Date(o.date).toUTCString()}`,
    `Message-ID: <${Math.random().toString(16).slice(2)}@example.com>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    o.body,
    "",
  ].join("\r\n");
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

test("F15/E2E-02 e-mail que pede a triagem vira tarefa e as fases viram as etapas", async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.on("dialog", (d) => void d.accept());
  await freshStart("engineer");
  const confirmation = {
    id: "18c2f0a1b2c3d5e1",
    receivedAt: ago(3),
    raw: eml({
      subject: "Recebemos sua candidatura",
      date: ago(3),
      body: "Olá! Recebemos sua candidatura.\nEmpresa: Acme\nCargo: Dev Backend",
    }),
  };
  await api("/api/_test/gmail", {
    method: "POST",
    body: JSON.stringify({ messages: [confirmation] }),
  });
  await api("/api/mail/settings", { method: "PUT", body: JSON.stringify({ since: ago(30) }) });
  await api("/api/scheduled-tasks/mail.sync/run", { method: "POST" });

  await login(page, "/emails");
  const card = page.getByRole("article", { name: "Recebemos sua candidatura" });
  await expect(async () => {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 150_000 });
  await card.getByRole("button", { name: "Aplicar mesmo assim" }).click();
  let appId = "";
  await expect(async () => {
    const list = await api<{ applications: Array<{ id: string; source: string }> }>(
      "/api/job-applications",
    );
    appId = list.applications.find((a) => a.source === "email")?.id ?? "";
    expect(appId).not.toBe("");
  }).toPass({ timeout: 150_000 });

  await api("/api/_test/gmail", {
    method: "POST",
    body: JSON.stringify({
      messages: [
        confirmation,
        {
          id: "18c2f0a1b2c3d5e2",
          // chega depois da primeira leitura (a próxima só busca o que é mais novo)
          receivedAt: new Date().toISOString(),
          raw: eml({
            subject: "Próxima etapa: triagem",
            date: new Date().toISOString(),
            body: [
              "Olá! A próxima etapa é uma triagem pelo WhatsApp.",
              "Empresa: Acme",
              "Cargo: Dev Backend",
              "AÇÃO: screening | Fazer a triagem da Acme pelo WhatsApp | https://triagem.example/start |",
              "FASES: Inscrição > Triagem* > Entrevista técnica > Proposta",
            ].join("\n"),
          }),
        },
      ],
    }),
  });

  const board = page.getByRole("region", { name: "Quadro de tarefas" });
  const task = board
    .getByRole("list", { name: "A fazer", exact: true })
    .getByRole("listitem", { name: "Fazer a triagem da Acme pelo WhatsApp" });
  // a leitura pedida enquanto a anterior (do "aplicar mesmo assim") ainda roda não entra na fila: pede de novo
  await expect(async () => {
    await api("/api/scheduled-tasks/mail.sync/run", { method: "POST" });
    await page.goto("/tarefas");
    await expect(task).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 180_000 });
  await expect(task.getByText("Do e-mail")).toBeVisible();
  await expect(task.getByText("#confira")).toBeVisible();
  await expect(task.getByRole("link", { name: "Abrir a ação" })).toHaveCount(0);
  await expect(task.getByRole("link", { name: "Ver o e-mail" })).toBeVisible();

  await task.getByRole("link", { name: /Acme/ }).click();
  await expect(page).toHaveURL(new RegExp(`/candidaturas/${appId}`));
  const stages = page.getByRole("list", { name: "Etapas do processo" });
  await expect(stages.getByRole("listitem")).toHaveText([
    /1\. Inscrição/,
    /2\. Triagem/,
    /3\. Entrevista técnica/,
    /4\. Proposta/,
  ]);
  await expect(
    page
      .getByRole("region", { name: "Tarefas" })
      .getByText("Fazer a triagem da Acme pelo WhatsApp"),
  ).toBeVisible();
});
