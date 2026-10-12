import { expect, test } from "@playwright/test";
import { createSession, listSessions, say } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-04 teto de 5 conversas: a sexta pergunta qual encerrar e abre depois da escolha", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  for (let i = 1; i <= 5; i++) {
    const s = await createSession({ profileId: ids.profileId, title: `Aberta ${i}` });
    await say(s.id, "o que está fraco?");
  }
  await login(page, "/chat");
  await page.getByRole("button", { name: "Nova conversa" }).click();
  const dialog = page.getByRole("dialog", {
    name: /Você tem 5 conversas abertas\. Qual encerrar\?/,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Encerrar Aberta 1" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () => (await listSessions(ids.profileId)).find((x) => x.title === "Aberta 1")?.state,
    )
    .toBe("hibernated");
  await expect
    .poll(
      async () =>
        (await listSessions(ids.profileId)).filter((x) => x.title === "Nova conversa").length,
    )
    .toBe(1);
});
