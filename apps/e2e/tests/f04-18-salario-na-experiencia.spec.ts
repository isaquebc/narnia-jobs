import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { freshStart, startTextRun, waitRun } from "../helpers/ingest";
import { login } from "../helpers/profiles";

const TEXT =
  "Trabalho com pagamentos há anos e hoje estou numa fintech como engenheira backend. " +
  "Cuido da API de cobranças e do time de conciliação, com Node.js e PostgreSQL. " +
  "Sou contratada como PJ, 30 horas semanais, e recebo R$ 95 por hora. Tenho plano de saúde pago pela empresa.";

test("F04/E2E-18 experiência com salário: o texto livre traz contrato, carga e salário para a revisão e o cartão mostra a trajetória", async ({
  page,
}) => {
  await freshStart("engineer");
  const runId = await startTextRun(TEXT);
  await waitRun(runId, ["review"], 120_000);

  await login(page, `/ingestao/${runId}`);
  const review = page.getByRole("region", { name: "Revisão" });
  await expect(
    review.getByText(
      /PJ, 30 h\/semana · R\$ 95,00\/hora \(≈ R\$ 12\.350,00\/mês com 30 h\/semana\)/,
    ),
  ).toBeVisible({
    timeout: 60_000,
  });
  // aceita tudo pela api; nos conflitos com a fixture, usa o valor novo
  const run = await api<{
    proposals: Array<{
      id: string;
      decision: string;
      conflict?: { fields: Array<{ field: string }> } | null;
    }>;
  }>(`/api/ingestions/${runId}`);
  await api(`/api/ingestions/${runId}/review`, {
    method: "POST",
    body: JSON.stringify({
      decisions: run.proposals
        .filter((p) => p.decision === "pending")
        .map((p) => ({
          proposalId: p.id,
          decision: "accepted",
          ...(p.conflict
            ? {
                resolution: Object.fromEntries(
                  p.conflict.fields.map((f) => [f.field, { choice: "use_new" }]),
                ),
              }
            : {}),
        })),
    }),
  });
  await waitRun(runId, ["done"]);

  const card = await api<{ text: string }>("/api/profiles/active/persona-card");
  expect(card.text).toMatch(/Remuneração \(equivalente mensal\): .*R\$ 12\.350,00/);
  expect(card.text).toContain("PJ, 30 h/semana");
});
