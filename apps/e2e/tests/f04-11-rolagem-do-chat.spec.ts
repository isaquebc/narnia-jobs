import { expect, test } from "@playwright/test";
import { createSession, say } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-11 rolagem: a página não rola, o menu fica à vista e as mensagens rolam dentro do quadro do chat", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Longa" });
  for (let i = 0; i < 6; i++) await say(s.id, `o que está fraco no meu perfil? (${i})`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);
  await page.goto(`/chat/${s.id}`);
  const list = page.getByRole("list", { name: "Mensagens" });
  await expect(list.getByText(/conquistas sem métrica/).first()).toBeVisible();

  // a janela não rola: cabeçalho, menu e envio ficam sempre à vista
  const doc = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    view: window.innerHeight,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.view);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Perfis" })).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "Mensagem para o recrutador" })).toBeInViewport();

  // quem rola é o quadro das mensagens, e ele abre já no fim (última resposta à vista)
  const box = await list.evaluate((el) => {
    const sc = el.parentElement as HTMLElement;
    return { sh: sc.scrollHeight, ch: sc.clientHeight, top: sc.scrollTop };
  });
  expect(box.sh).toBeGreaterThan(box.ch);
  expect(box.sh - box.top - box.ch).toBeLessThan(80);
});
