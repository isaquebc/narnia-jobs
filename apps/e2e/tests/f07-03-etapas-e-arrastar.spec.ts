import { expect, test } from "@playwright/test";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F07/E2E-03 etapas lidas da vaga › adicionar, reordenar arrastando, etapa atual › arrastar o cartão para Em processo (x/N)", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({
    text: `${JD}\n\nEtapas do processo:\n1. Triagem\n2. Case técnico\n3. Conversa com o CTO`,
  });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);

  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Aplicar nesta vaga" })
    .getByRole("button", { name: "Confirmar candidatura" })
    .click();
  await page.getByRole("link", { name: "Ver candidatura" }).click();

  const stages = page.getByRole("list", { name: "Etapas do processo" });
  await expect(stages.getByRole("listitem")).toHaveText([
    /1\. Triagem/,
    /2\. Case técnico/,
    /3\. Conversa com o CTO/,
  ]);
  await page.getByRole("textbox", { name: "Nova etapa" }).fill("Pair programming");
  await page.getByRole("button", { name: "Adicionar etapa" }).click();
  await expect(stages.getByRole("listitem")).toHaveCount(4);
  await stages.getByRole("button", { name: "Marcar Case técnico como a etapa atual" }).click();
  await expect(stages.locator('[aria-current="step"]')).toContainText("Case técnico");

  // arrastar com o mouse: a alça de "Pair programming" até a linha de "Case técnico"
  const drag = async (
    from: import("@playwright/test").Locator,
    to: import("@playwright/test").Locator,
  ) => {
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
    stages.getByRole("button", { name: "Arrastar a etapa Pair programming" }),
    stages.getByRole("listitem").filter({ hasText: "Case técnico" }),
  );
  await expect(stages.getByRole("listitem")).toHaveText([
    /1\. Triagem/,
    /2\. Pair programming/,
    /3\. Case técnico/,
    /4\. Conversa com o CTO/,
  ]);
  await expect(stages.locator('[aria-current="step"]')).toContainText("Case técnico");

  await page.goto("/candidaturas");
  const board = page.getByRole("region", { name: "Quadro das candidaturas" });
  const card = board.getByRole("list", { name: "Aplicado" }).getByRole("listitem");
  const target = board.getByRole("list", { name: "Em processo" });
  await drag(card.getByRole("button", { name: /Arrastar a candidatura/ }), target);
  await expect(target.getByRole("listitem").getByText("3/4")).toBeVisible();
  await expect(target.getByText(/Case técnico/)).toBeVisible();
  await page.reload();
  await expect(board.getByRole("list", { name: "Em processo" }).getByRole("listitem")).toHaveCount(
    1,
  );
});
