import { expect, test } from "@playwright/test";
import { createSession, getSession, hibernate, say, sendInUi } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-03 retomada: conversa hibernada acorda na próxima mensagem e continua com o histórico", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Retomar" });
  await say(s.id, "o que está fraco?");
  await hibernate(s.id);
  expect((await getSession(s.id)).state).toBe("hibernated");

  await login(page, `/chat/${s.id}`);
  await expect(page.getByText(/Conversa hibernada/)).toBeVisible();
  const list = await sendInUi(page, "e como eu melhoro isso?", /conquistas sem métrica/);
  await expect(list.getByText(/conquistas sem métrica/)).toHaveCount(2);
  await expect.poll(async () => (await getSession(s.id)).state).toBe("live");
});
