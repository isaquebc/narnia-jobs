import { expect, test } from "@playwright/test";
import { api, waitFor } from "../helpers/api";
import { openApp } from "../helpers/flows";
import { freshStart, notifications } from "../helpers/ingest";

test("F03/E2E-12 notificações da F02: sugestão de perfil e análise concluída, resolvidas ao decidir e ao abrir Perfis", async ({
  page,
}) => {
  await freshStart("leader");
  await openApp(page);
  // o dashboard roda a heurística: as sugestões viram pendências no sino
  await expect(page.getByTestId("notifications-count")).toBeVisible();
  let open = await notifications("open");
  const suggestion = open.notifications.find((n) => n.kind === "profile.suggestion");
  expect(suggestion?.actionUrl).toBe("/perfis");

  await page.goto("/pendencias");
  const list = page.getByRole("list", { name: "Sugestões de perfil" });
  await expect(list.getByRole("listitem").first()).toBeVisible();

  // análise pelo modelo (mock) gera "análise concluída"
  const { job } = await api<{ job: { id: string } }>("/api/profiles/analyze", {
    method: "POST",
    body: "{}",
  });
  open = await waitFor(
    () => notifications("open"),
    (r) => r.notifications.some((n) => n.kind === "profile.analysis_done"),
    { timeoutMs: 60_000, label: `análise ${job.id} notificada` },
  );

  // dispensar uma sugestão resolve a dela; abrir Perfis resolve a de análise concluída
  await api(`/api/profiles/suggestions/${suggestion?.subjectId}/dismiss`, {
    method: "POST",
    body: "{}",
  });
  await page.goto("/perfis");
  await expect(page.getByRole("heading", { name: "Perfis", exact: true })).toBeVisible();
  open = await waitFor(
    () => notifications("open"),
    (r) => !r.notifications.some((n) => n.kind === "profile.analysis_done"),
    { timeoutMs: 15_000, label: "análise concluída resolvida" },
  );
  expect(open.notifications.some((n) => n.subjectId === suggestion?.subjectId)).toBe(false);
  const resolved = await notifications("resolved");
  expect(resolved.notifications.some((n) => n.kind === "profile.analysis_done")).toBe(true);
});
