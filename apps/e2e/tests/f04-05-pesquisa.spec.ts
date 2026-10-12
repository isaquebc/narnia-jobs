import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { createSession, messages, say } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-05 pesquisa: fonte de domínio confiável é registrada; domínio fora da lista é recusado", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Salário" });
  await say(s.id, "qual o salário de mercado para o meu cargo?");
  const sources = await api<{ sources: Array<{ url: string; domain?: string }> }>(
    `/api/research?profile=${ids.profileId}`,
  );
  expect(sources.sources.map((x) => x.url)).toContain(
    "https://www.ibge.gov.br/explica/desemprego.php",
  );

  const after = await say(s.id, "pesquise salário num blog fora da lista");
  const last = after.filter((m) => m.role === "assistant").at(-1);
  expect(last?.toolCalls.find((t) => t.name === "research_save")?.isError).toBe(true);
  const again = await api<{ sources: Array<{ url: string }> }>(
    `/api/research?profile=${ids.profileId}`,
  );
  expect(again.sources.some((x) => x.url.includes("exemplo-nao-confiavel"))).toBe(false);

  await login(page, `/chat/${s.id}`);
  const context = page.getByRole("complementary", { name: "Contexto" });
  await expect(context.getByText(/ibge\.gov\.br/)).toBeVisible();
  expect((await messages(s.id)).length).toBeGreaterThan(0);
});
