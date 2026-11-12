import { expect, type Locator, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * F15/E2E-01 · tarefas (plans/plan-v0/tasks/F15-tarefas-e-avisos.md §7): pelo menu, criar duas tarefas com tags e
 * prazo, filtrar pela tag, arrastar para Fazendo, mover para Feito pelo menu e conferir que fica depois de recarregar.
 */
test("F15/E2E-01 tarefas: criar com tags e prazo, filtrar, arrastar e mover", async ({ page }) => {
  await freshStart("engineer");
  await login(page, "/");
  await page.getByRole("link", { name: "Tarefas" }).click();
  await expect(page.getByRole("heading", { name: "Tarefas", level: 1 })).toBeVisible();

  const create = async (title: string, tags: string, due?: string) => {
    await page.getByRole("button", { name: "Nova tarefa" }).click();
    const d = page.getByRole("dialog", { name: "Nova tarefa" });
    await d.getByLabel(/Título/).fill(title);
    await d.getByLabel("Tags").fill(tags);
    if (due) await d.getByLabel("Prazo").fill(due);
    await d.getByRole("button", { name: "Criar" }).click();
    await expect(d).toBeHidden();
  };
  await create("Estudar system design", "estudo, Acme", "2020-01-01T09:00");
  await create("Mandar documentos", "documentos");

  const board = page.getByRole("region", { name: "Quadro de tarefas" });
  const col = (name: string) => board.getByRole("list", { name, exact: true });
  await expect(col("A fazer").getByRole("listitem")).toHaveCount(2);
  const study = col("A fazer").getByRole("listitem", { name: "Estudar system design" });
  await expect(study.getByText("#acme")).toBeVisible();
  await expect(study.getByText(/^Vencida:/)).toBeVisible();

  await page.getByLabel("Tag").selectOption("estudo");
  await expect(col("A fazer").getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("Tag").selectOption("");
  await expect(col("A fazer").getByRole("listitem")).toHaveCount(2);

  const drag = async (from: Locator, to: Locator) => {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error("sem posição para arrastar");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 8, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
  };
  await drag(
    study.getByRole("button", { name: "Arrastar a tarefa Estudar system design" }),
    col("Fazendo"),
  );
  await expect(col("Fazendo").getByRole("listitem")).toHaveCount(1);

  const docs = col("A fazer").getByRole("listitem", { name: "Mandar documentos" });
  await docs.getByRole("button", { name: "Mover" }).click();
  await page.getByRole("menuitem", { name: "Feito" }).click();
  await expect(col("Feito").getByRole("listitem")).toHaveCount(1);

  await page.reload();
  await expect(col("Fazendo").getByRole("listitem")).toHaveText(/Estudar system design/);
  await expect(col("Feito").getByRole("listitem")).toHaveText(/Mandar documentos/);
  await expect(col("Feito").getByText(/^Feita em/)).toBeVisible();
});
