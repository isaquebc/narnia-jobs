import { expect, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/** A ponte é chamada pelo Phoenix direto no api (rede dos containers), não pelo web. */
const BRIDGE = `${process.env.API_URL ?? "http://api:3100"}/bridge/anthropic/v1/messages`;

const ask = (key: string | null) =>
  fetch(BRIDGE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(key ? { "x-api-key": key } : {}),
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: "Resuma: engenheira backend" }],
    }),
  });

test("F04/E2E-17 Configurações › Avaliações: a ponte pela assinatura responde só com a chave mostrada na tela e obedece ao liga/desliga", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page, "/configuracoes");
  const s = page.getByRole("region", { name: "Avaliações (Phoenix)" });
  await expect(s.getByRole("switch", { name: "Ponte pela assinatura ligada" })).toBeChecked();
  // sem Phoenix nos e2e: aviso acionável e registro desabilitado
  await expect(s.getByText(/O Phoenix não respondeu/)).toBeVisible();
  await expect(s.getByRole("button", { name: "Registrar no Phoenix" })).toBeDisabled();

  await s.getByRole("button", { name: "Mostrar chave" }).click();
  const key = (await s.getByText(/^narnia-ponte-[0-9a-f]{48}$/).textContent()) ?? "";
  expect((await ask(null)).status).toBe(401);
  const ok = await ask(key);
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { content: Array<{ text: string }> }).content[0]?.text).toContain(
    "Resuma: engenheira backend",
  );

  await s.getByRole("switch", { name: "Ponte pela assinatura ligada" }).click();
  await s.getByRole("button", { name: "Salvar ponte" }).click();
  await expect(s.getByText("Ponte salva.")).toBeVisible();
  expect((await ask(key)).status).toBe(403);

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Avaliações (Phoenix)" })
      .getByRole("switch", { name: "Ponte pela assinatura ligada" }),
  ).not.toBeChecked();
});
