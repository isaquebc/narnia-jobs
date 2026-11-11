import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * F14/E2E-01 · leitura do Gmail com o Gmail falso (plans/plan-v0/tasks/F14-leitura-de-emails.md §7): caixa preparada
 * por `/api/_test/gmail` (conta já conectada, sem o login do Google), leitura disparada pela tarefa agendada e
 * classificação pelo mock (linhas `VAGA:`, `Empresa:`, `Cargo:`). Os dois e-mails vêm de remetente sem autenticação
 * (risco neutro): o alerta vira vagas no feed (o link que não abre ganha a marca) e a confirmação espera "aplicar mesmo
 * assim" na revisão; aplicada, a candidatura nasce com o e-mail e o desfazer a apaga.
 */
const eml = (o: { from: string; subject: string; date: string; body: string }) =>
  [
    `From: ${o.from}`,
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

test("F14/E2E-01 Gmail: alerta no feed com link que não abriu, confirmação na revisão, aplicar mesmo assim e desfazer", async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.on("dialog", (d) => void d.accept());
  await freshStart("engineer");
  await api("/api/_test/gmail", {
    method: "POST",
    body: JSON.stringify({
      messages: [
        {
          id: "18c2f0a1b2c3d4e1",
          receivedAt: ago(3),
          raw: eml({
            from: "Vagas <alertas@vagas.example>",
            subject: "Vagas para você",
            date: ago(3),
            body: [
              "Novas vagas que combinam com você:",
              "VAGA: Analista de Dados | Globex | Remoto | https://vagas.invalid/vaga/1",
              "VAGA: Engenheira de Dados | Initech | São Paulo, SP | https://vagas.invalid/vaga/2",
            ].join("\n"),
          }),
        },
        {
          id: "18c2f0a1b2c3d4e2",
          receivedAt: ago(2),
          raw: eml({
            from: "RH Acme <rh@acme.example>",
            subject: "Recebemos sua candidatura",
            date: ago(2),
            body: "Olá! Recebemos sua candidatura.\nEmpresa: Acme\nCargo: Dev Backend",
          }),
        },
      ],
    }),
  });
  await api("/api/mail/settings", { method: "PUT", body: JSON.stringify({ since: ago(30) }) });
  await api("/api/scheduled-tasks/mail.sync/run", { method: "POST" });

  // alerta → duas vagas no feed, com a origem e a marca do link que não abriu
  await login(page, "/vagas");
  await page.getByRole("tab", { name: "Feed do e-mail" }).click();
  const feed = page.getByRole("list", { name: "Feed do e-mail" });
  await expect(async () => {
    await page.reload();
    await page.getByRole("tab", { name: "Feed do e-mail" }).click();
    await expect(feed.getByRole("listitem")).toHaveCount(2, { timeout: 2_000 });
    await expect(feed.getByText("link não abriu")).toHaveCount(2, { timeout: 2_000 });
  }).toPass({ timeout: 150_000 });
  await expect(feed.getByText("do e-mail").first()).toBeVisible();

  // confirmação de remetente sem confiança: na revisão, pedindo confirmação
  await page.goto("/emails");
  const card = page.getByRole("article", { name: "Recebemos sua candidatura" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/remetente ainda sem confiança/)).toBeVisible();
  await card.getByRole("button", { name: "Aplicar mesmo assim" }).click();

  // aplicada: a candidatura nasce com o e-mail, com o desfazer em "Pelo e-mail"
  await expect(async () => {
    const list = await api<{ applications: Array<{ id: string; source: string }> }>(
      "/api/job-applications",
    );
    expect(list.applications.filter((a) => a.source === "email")).toHaveLength(1);
  }).toPass({ timeout: 60_000 });
  const { applications } = await api<{ applications: Array<{ id: string; source: string }> }>(
    "/api/job-applications",
  );
  const appId = applications.find((a) => a.source === "email")?.id as string;
  await page.goto(`/candidaturas/${appId}`);
  await expect(page.getByText("Candidatura registrada por e-mail.")).toBeVisible();
  const activity = page.getByRole("region", { name: "Pelo e-mail" });
  await expect(activity.getByText(/Candidatura recebida/)).toBeVisible();
  await activity.getByRole("button", { name: "Desfazer" }).click();
  await expect(page).toHaveURL(/\/candidaturas$/);
  const after = await api<{ applications: Array<{ id: string }> }>("/api/job-applications");
  expect(after.applications.map((a) => a.id)).not.toContain(appId);
});
