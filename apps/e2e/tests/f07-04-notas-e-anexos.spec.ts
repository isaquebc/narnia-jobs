import { expect, test } from "@playwright/test";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

// PNG 1×1 transparente
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("F07/E2E-04 candidatura › registro com data anterior, texto, imagem e PDF › prévia, abrir, editar e apagar", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);

  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Aplicar nesta vaga" })
    .getByRole("button", { name: "Confirmar candidatura" })
    .click();
  await page.getByRole("link", { name: "Ver candidatura" }).click();

  const form = page.getByRole("form", { name: "Novo registro" });
  await form.getByRole("textbox", { name: "Nota" }).fill("E-mail da recrutadora: case até sexta.");
  await form.getByLabel("Data do registro").fill("2026-10-20");
  await form.getByLabel("Anexos").setInputFiles([
    { name: "convite.png", mimeType: "image/png", buffer: PNG },
    { name: "case.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") },
  ]);
  await form.getByRole("button", { name: "Salvar registro" }).click();

  const list = page.getByRole("list", { name: "Registros da candidatura" });
  const item = list.getByRole("listitem");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("20/10/2026");
  await expect(item).toContainText("case até sexta");
  const img = item.getByRole("img", { name: "convite.png" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  const pdf = item.getByRole("link", { name: /case\.pdf/ });
  const res = await page.request.get((await pdf.getAttribute("href")) ?? "");
  expect(res.headers()["content-type"]).toBe("application/pdf");

  await item.getByRole("button", { name: "Editar registro" }).click();
  await item.getByRole("textbox", { name: "Nota" }).fill("Case entregue.");
  await item.getByRole("button", { name: "Salvar" }).click();
  await expect(item).toContainText("Case entregue.");

  page.once("dialog", (d) => void d.accept());
  await item.getByRole("button", { name: "Apagar registro" }).click();
  await expect(page.getByText("Nenhum registro ainda.")).toBeVisible();
});
