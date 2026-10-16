import { expect, test } from "@playwright/test";
import { api, BASE_URL, TOKEN } from "../helpers/api";
import { documents, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F05/E2E-01 CV do perfil: aba Currículo → Gerar → bandeja → prévia → PDF de até 2 páginas → versão com data", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await login(page, `/perfis/${ids.profileId}/curriculo`);
  await expect(page.getByText("Ainda não há currículo para este perfil.")).toBeVisible();
  await page.getByRole("button", { name: "Gerar currículo" }).click();
  const dialog = page.getByRole("dialog", { name: "Gerar currículo" });
  await dialog.getByLabel("Instruções (opcional)").fill("dê mais peso à liderança");
  await dialog.getByRole("button", { name: "Gerar" }).click();
  const [doc] = await waitDocuments({ profileId: ids.profileId });
  expect(doc?.current).toMatchObject({ status: "ready" });
  expect(doc?.current?.pagesRendered).toBeLessThanOrEqual(2);
  expect(doc?.current?.atsScore).toBeGreaterThanOrEqual(90);
  // a tela recebe o resultado pelo WS: pronto, data, prévia e download
  await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
  await expect(page.getByText(/Gerado em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Página 1" })).toBeVisible();
  const href = await page.getByRole("link", { name: "Baixar PDF" }).getAttribute("href");
  const pdf = await fetch(`${BASE_URL}${href}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  // bandeja: "pronto" com o link para a aba
  const open = await api<{ notifications: Array<{ kind: string; actionUrl: string }> }>(
    "/api/notifications?status=open",
  );
  expect(open.notifications).toContainEqual(
    expect.objectContaining({
      kind: "document.ready",
      actionUrl: `/perfis/${ids.profileId}/curriculo`,
    }),
  );
  expect((await documents({ profileId: ids.profileId }))[0]?.versions).toHaveLength(1);
});
