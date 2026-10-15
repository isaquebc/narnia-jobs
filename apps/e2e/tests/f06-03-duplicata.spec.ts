import { expect, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { intake, JD, listPostings } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F06/E2E-03 duplicata: mesma vaga colada de novo abre o modal com a certeza e o diff; atualizar mantém uma só", async ({
  page,
}) => {
  await freshStart("engineer");
  const first = await intake({ text: JD });
  await expect
    .poll(async () => (await listPostings()).find((p) => p.id === first.id)?.status, {
      timeout: 20_000,
    })
    .toBe("ready");
  await login(page, "/vagas");
  await page.getByLabel("Texto da vaga").fill(JD);
  await page.getByRole("button", { name: "Salvar vaga" }).click();
  const dialog = page.getByRole("dialog", { name: "Vaga repetida?" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText("95% de certeza de que é a mesma vaga");
  await dialog.getByRole("button", { name: "Atualizar a vaga salva" }).click();
  await expect(page).toHaveURL(new RegExp(`/vagas/${first.id}$`));
  expect((await listPostings()).map((p) => p.id)).toEqual([first.id]);
});
