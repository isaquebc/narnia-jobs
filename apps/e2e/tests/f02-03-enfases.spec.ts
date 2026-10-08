import { expect, test } from "@playwright/test";
import { reset } from "../helpers/api";
import { createPm, getCard, listEmphasis, login, seed } from "../helpers/profiles";

test("F02/E2E-03 ênfases: ocultar, destacar, reordenar por botões e por arraste; cartão do PM muda, do engenheiro não", async ({
  page,
}) => {
  await reset();
  const { ids } = await seed("engineer");
  await login(page);
  const pm = await createPm(page);
  const engineerBefore = await getCard(ids.profileId);
  expect(engineerBefore.valid).toBe(true);

  await page.goto(`/perfis/${pm.id}/enfases`);
  await page.getByRole("tab", { name: "Experiências" }).click();
  const list = page.locator('ul[aria-label="Experiências"]');
  await expect(list.locator("li")).toHaveCount(6);
  await expect(list.locator("li").first()).toContainText("Engenheira de Software Sênior");

  await page.getByLabel("Ênfase de Desenvolvedora Backend").selectOption("hidden");
  await page.getByLabel("Ênfase de Engenheira de Software Pleno").selectOption("highlight");
  await expect(page.getByText("Alterações não salvas")).toBeVisible();

  // botões: a 1ª desce para a 2ª posição
  await list.locator("li").first().getByRole("button", { name: "Descer" }).click();
  await expect(list.locator("li").nth(1)).toContainText("Engenheira de Software Sênior");

  // um único arraste (@dnd-kit): "Desenvolvedora Full Stack" vai para o topo
  const handle = page.getByRole("button", { name: "Arrastar Desenvolvedora Full Stack" });
  const hb = await handle.boundingBox();
  const tb = await list.locator("li").first().boundingBox();
  if (!hb || !tb) throw new Error("sem caixa para arrastar");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 8, { steps: 4 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 4, { steps: 20 });
  await page.mouse.up();
  await expect(list.locator("li").first()).toContainText("Desenvolvedora Full Stack");
  // o @dnd-kit engole o primeiro clique depois de um arraste com o mouse: um clique neutro antes de salvar
  await page.getByRole("heading", { name: "Ênfases" }).click();

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const put = page
    .waitForResponse((r) => r.url().includes("/emphasis") && r.request().method() === "PUT", {
      timeout: 10_000,
    })
    .catch(() => null);
  await page.getByRole("button", { name: "Salvar ênfases" }).click();
  const res = await put;
  expect(errors, "erros no navegador").toEqual([]);
  expect(res, "PUT /emphasis enviado").not.toBeNull();
  expect(res?.status()).toBe(200);
  await expect(page.getByText("Ênfases salvas.")).toBeVisible();
  await expect(page.getByText("Prévia do cartão")).toBeVisible();

  const items = (await listEmphasis(pm.id)).items.filter((i) => i.kind === "experience");
  const byPos = [...items].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  expect(byPos[0]?.label).toBe("Desenvolvedora Full Stack");
  expect(items.find((i) => i.label === "Desenvolvedora Backend")?.mode).toBe("hidden");
  expect(items.find((i) => i.label === "Engenheira de Software Pleno")?.mode).toBe("highlight");

  const pmCard = await getCard(pm.id);
  expect(pmCard.text).toContain("Engenheira de Software Pleno");
  expect(pmCard.text).not.toContain("Desenvolvedora Backend");
  const engineerAfter = await getCard(ids.profileId);
  expect(engineerAfter.hash).toBe(engineerBefore.hash);
  expect(engineerAfter.builtAt).toBe(engineerBefore.builtAt);
});
