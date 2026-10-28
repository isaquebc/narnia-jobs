import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * F07/E2E-05 (M4): a janela da extensão (rota `/candidatura`) depois de "Salvar vaga" tem o Aplicar, com o mesmo
 * diálogo da página da vaga. A captura entra pela API, como a extensão a enviaria (o fluxo da extensão em si é o F12).
 */
const DESCRIPTION = `<p>Buscamos uma pessoa engenheira backend para o time de pagamentos, que cuida das APIs de
cobrança e conciliação usadas por milhares de lojistas todos os dias.</p>
<h3>Requisitos</h3><ul><li>5+ anos com Java e Spring</li><li>Kafka e PostgreSQL</li>
<li>Docker e Kubernetes em produção</li><li>Observabilidade com métricas, logs e tracing</li></ul>
<h3>Diferenciais</h3><ul><li>AWS</li><li>Experiência com meios de pagamento</li></ul>
<p>Trabalho híbrido em São Paulo, CLT, com plano de saúde, vale refeição e auxílio home office.</p>`;
const JOB_PAGE = `<!doctype html><html><head><title>Vagas</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Engenheira Backend Sênior",
  description: DESCRIPTION,
  hiringOrganization: { "@type": "Organization", name: "Acme Pagamentos" },
})}</script></head><body><main><h1>Engenheira Backend Sênior</h1>${DESCRIPTION}</main></body></html>`;

test("F07/E2E-05 janela da extensão › Aplicar na vaga salva › candidatura no quadro", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const { id: captureId } = await api<{ id: string }>("/api/extension/captures", {
    method: "POST",
    body: JSON.stringify({
      kind: "page",
      url: "https://vagas.example/acme/123",
      title: "Vagas",
      html: JOB_PAGE,
      mode: "posting",
    }),
  });
  const { posting } = await api<{ posting: { id: string } }>(
    `/api/extension/captures/${captureId}/posting`,
    { method: "POST" },
  );
  await generate({ kind: "cv", profileId: ids.profileId, postingId: posting.id });
  await waitDocuments({ postingId: posting.id }, 1);

  await login(page, `/candidatura?captura=${captureId}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Aplicar nesta vaga" })
    .getByRole("button", { name: "Confirmar candidatura" })
    .click();
  await expect(page.getByRole("link", { name: "Ver candidatura" })).toBeVisible();
  const { applications } = await api<{ applications: Array<{ postingId: string }> }>(
    "/api/job-applications",
  );
  expect(applications.map((a) => a.postingId)).toEqual([posting.id]);
});
