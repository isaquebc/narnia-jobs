import { expect, test } from "@playwright/test";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F06/E2E-06 página da vaga: contato pela modal com LinkedIn, duplicata recusada, fixar; o topo mostra o fixado e os dois últimos", async ({
  page,
}) => {
  await freshStart("engineer");
  const p = await intake({ text: JD });
  await login(page, `/vagas/${p.id}`);
  const recent = page.getByRole("region", { name: "Últimos contatos" });
  await expect(recent.getByText(/Nenhum contato ainda/)).toBeVisible();
  const add = async (name: string, linkedin: string) => {
    await recent.getByRole("button", { name: "Adicionar contato" }).click();
    const dialog = page.getByRole("dialog", { name: "Adicionar contato" });
    await dialog.getByLabel("Nome").fill(name);
    await dialog.getByLabel("LinkedIn (link do perfil)").fill(linkedin);
    await dialog.getByRole("button", { name: "Salvar contato" }).click();
    return dialog;
  };
  await expect(await add("Joana", "linkedin.com/in/joana-e2e")).toBeHidden();
  await expect(recent.getByRole("link", { name: "LinkedIn de Joana" })).toHaveAttribute(
    "href",
    "https://linkedin.com/in/joana-e2e",
  );
  // mesmo perfil por outro endereço: recusado, a modal fica aberta com o motivo
  const dup = await add("Joana Silva", "https://www.linkedin.com/in/joana-e2e/");
  await expect(dup.getByText(/já está na vaga/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(await add("Rui", "linkedin.com/in/rui-e2e")).toBeHidden();
  await recent.getByRole("button", { name: "Fixar Joana" }).click();
  await expect(recent.getByText("Fixado")).toBeVisible();
  await expect(await add("Bia", "linkedin.com/in/bia-e2e")).toBeHidden();
  // fixado + os dois últimos (Bia e Rui); a Joana não aparece duas vezes
  await expect(recent.getByRole("listitem")).toHaveCount(3);
  await expect(recent.getByRole("listitem").first()).toContainText("Joana");
  await expect(page.getByRole("list", { name: "Contatos" }).getByRole("listitem")).toHaveCount(3);
});

test("F06/E2E-06b assets: CV pequeno com baixar; Regerar com mensagem abre a conversa da vaga com o pedido", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);
  await login(page, `/vagas/${p.id}`);
  const assets = page.getByRole("region", { name: "Currículo e carta" });
  const cv = assets.getByRole("group", { name: "Currículo" });
  await expect(cv.getByRole("img")).toBeVisible();
  await expect(cv.getByRole("link", { name: "Baixar PDF" })).toBeVisible();
  await expect(
    assets.getByRole("group", { name: "Carta de apresentação" }).getByRole("button", {
      name: "Gerar carta",
    }),
  ).toBeVisible();
  await cv.getByRole("button", { name: "Regerar com mensagem" }).click();
  const dialog = page.getByRole("dialog", { name: "Regerar com mensagem" });
  await dialog.getByLabel("O que mudar").fill("Mais destaque à liderança técnica.");
  await dialog.getByRole("button", { name: "Abrir conversa" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]+$/);
  await expect(page.getByText("Mais destaque à liderança técnica.").first()).toBeVisible();
});
