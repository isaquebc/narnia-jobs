import { expect, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { getPosting, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F06/E2E-02 vaga pela página: colar, extrair, ver a origem de cada campo, editar campos e a JD", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page, "/vagas");
  await expect(page.getByText(/Nenhuma vaga ainda/)).toBeVisible();
  await page.getByLabel("Texto da vaga").fill(JD);
  await page.getByRole("button", { name: "Salvar vaga" }).click();
  await expect(page).toHaveURL(/\/vagas\/[^/]+$/);
  const id = page.url().split("/").pop() as string;
  // extração pelo modelo (mock) no worker: a página acompanha por WS até "Pronta"
  await expect(page.getByText("Pronta", { exact: true })).toBeVisible({ timeout: 20_000 });
  const form = page.getByRole("form", { name: "Dados da vaga" });
  await expect(form.getByText("heurística + modelo").first()).toBeVisible();
  await expect(page.getByText(/Cobertura dos obrigatórios/)).toBeVisible();
  // F05: o "Criar CV" virou o menu "Gerar" (CV · Cover letter)
  await expect(page.getByRole("button", { name: "Gerar" })).toHaveAttribute(
    "aria-haspopup",
    "menu",
  );
  // edição: cliente e JD
  const client = form.getByLabel("Empresa cliente (onde vai trabalhar)");
  await client.fill("Initech Brasil");
  const jd = form.getByLabel("Descrição da vaga (job description)");
  await jd.fill(`${JD}\n- Go é um plus`);
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Vaga salva.")).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("form", { name: "Dados da vaga" })
      .getByLabel("Empresa cliente (onde vai trabalhar)"),
  ).toHaveValue("Initech Brasil");
  const saved = await getPosting(id);
  expect(saved.posting.client).toBe("Initech Brasil");
  expect(saved.posting.fieldSources.client).toBe("user");
});
