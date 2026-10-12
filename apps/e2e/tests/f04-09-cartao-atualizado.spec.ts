import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { createSession, messages, say } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-09 nota de cartão atualizado: mudança no perfil durante a conversa entra como nota no turno seguinte", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Cartão" });
  await say(s.id, "o que está fraco?");
  await api(`/api/profiles/${ids.profileId}`, {
    method: "PATCH",
    body: JSON.stringify({ pitch: "Engenheira backend focada em pagamentos e confiabilidade." }),
  });
  await say(s.id, "e agora?");
  const notes = (await messages(s.id)).filter((m) => m.role === "system_note");
  expect(notes.map((n) => n.contentMd)).toContain("Cartão do perfil atualizado");

  await login(page, `/chat/${s.id}`);
  await expect(
    page.getByRole("list", { name: "Mensagens" }).getByText("Cartão do perfil atualizado"),
  ).toBeVisible();
});
