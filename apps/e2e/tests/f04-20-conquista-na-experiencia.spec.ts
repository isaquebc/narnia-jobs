import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { createSession } from "../helpers/chat";
import { freshStart, getRun, listRuns, STORY, waitRun } from "../helpers/ingest";
import { login } from "../helpers/profiles";

type Detail = {
  proposals: Array<{
    proposal: { kind: string; data: { text?: string } };
    decision: string;
    reference?: { experience: { label: string } | null };
  }>;
};

test("F04/E2E-20 conquista dita na conversa: liga à experiência do perfil, cada card diz onde entra e a sem experiência pede escolha", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Conquistas" });
  await login(page, `/chat/${s.id}`);
  await page
    .getByRole("textbox", { name: "Mensagem para o recrutador" })
    .fill(
      `texto: ${STORY}\nConquista: liderei 7 pessoas na Acme Pagamentos\nConquista: criei o guia de onboarding dos estagiários`,
    );
  await page.getByRole("button", { name: "Enviar" }).click();

  const panel = page.getByRole("region", { name: "Ingestão da conversa" });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const run = (await listRuns()).runs.find((r) => r.source === "text");
  if (!run) throw new Error("execução de texto não criada pela conversa");
  await waitRun(run.id, ["review"]);

  // a ingestão diz de onde veio: o começo do texto e a conversa
  await expect(panel.getByTestId("review-origin")).toContainText(
    "Origem: Texto: “Comecei como estagiária de suporte",
  );
  await expect(panel.getByTestId("review-origin")).toContainText("conversa “Conquistas”");

  const list = panel.getByRole("list", { name: "Propostas para revisar" });
  const lead = list.getByRole("listitem", { name: /^liderei 7 pessoas na Acme Pagamentos/ });
  const guide = list.getByRole("listitem", { name: /^criei o guia de onboarding/ });
  await expect(lead.getByTestId("entry-reference")).toHaveText(
    "Entra em: Experiências › Engenheira de Software Sênior · Acme Pagamentos · 2023-02–atual › conquistas",
    { timeout: 30_000 },
  );
  await expect(guide.getByTestId("entry-reference")).toHaveText(
    "Entra em: Conquistas › sem experiência definida: escolha abaixo",
  );
  // todo card diz onde entra
  const items = list.getByRole("listitem");
  const count = await items.count();
  for (let i = 0; i < count; i++)
    await expect(items.nth(i).getByTestId("entry-reference")).toContainText("Entra em:");

  // a conquista sem experiência bloqueia o salvar até escolher
  await lead.getByRole("button", { name: "Aceitar" }).click();
  await guide.getByRole("button", { name: "Aceitar" }).click();
  await panel.getByRole("button", { name: "Rejeitar todos" }).click();
  const save = panel
    .getByTestId("review-save-slot")
    .getByRole("button", { name: "Salvar revisão" });
  await expect(
    panel.getByText("Escolha a experiência de cada conquista aceita antes de salvar."),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await guide
    .getByRole("combobox", { name: "Experiência da conquista" })
    .selectOption({ label: "Engenheira de Software Pleno · Beta Logística · 2020-06–2023-01" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(async () => (await getRun(run.id)).status, { timeout: 30_000 }).toBe("done");

  // gravadas nas experiências escolhidas, sem experiência nova da Acme
  const detail = await api<Detail>(`/api/ingestions/${run.id}`);
  const achievement = (prefix: string) =>
    detail.proposals.find(
      (p) => p.proposal.kind === "achievement" && p.proposal.data.text?.startsWith(prefix),
    );
  expect(achievement("liderei")?.decision).toBe("accepted");
  expect(achievement("liderei")?.reference?.experience?.label).toBe(
    "Engenheira de Software Sênior · Acme Pagamentos · 2023-02–atual",
  );
  expect(achievement("criei")?.decision).toBe("edited");
  expect(achievement("criei")?.reference?.experience?.label).toBe(
    "Engenheira de Software Pleno · Beta Logística · 2020-06–2023-01",
  );

  // a página da ingestão terminada mostra o que entrou e o que foi salvo, com onde cada item entrou
  await page.goto(`/ingestao/${run.id}`);
  const content = page.getByRole("region", { name: "O que foi ingerido" });
  await expect(content.getByTestId("ingested-text")).toContainText(
    "Conquista: liderei 7 pessoas na Acme Pagamentos",
  );
  await expect(content).toContainText("conversa “Conquistas”");
  const result = page.getByRole("region", { name: "Resultado da revisão" });
  const saved = result.getByRole("listitem", { name: /^liderei 7 pessoas na Acme Pagamentos/ });
  await expect(saved.getByText("Aceito")).toBeVisible();
  await expect(saved.getByTestId("entry-reference")).toHaveText(
    "Entra em: Experiências › Engenheira de Software Sênior · Acme Pagamentos · 2023-02–atual › conquistas",
  );
});
