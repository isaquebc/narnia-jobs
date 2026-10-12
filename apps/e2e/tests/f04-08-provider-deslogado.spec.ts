import { expect, test } from "@playwright/test";
import { setMock } from "../helpers/api";
import { listSessions } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-08 provider deslogado: o chat orienta o login e não abre conversa", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await setMock({ loggedIn: false });
  await login(page, "/chat");
  await expect(page.getByText(/O recrutador precisa da sua assinatura do Claude/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova conversa" })).toBeDisabled();
  expect(await listSessions(ids.profileId)).toHaveLength(0);
});
