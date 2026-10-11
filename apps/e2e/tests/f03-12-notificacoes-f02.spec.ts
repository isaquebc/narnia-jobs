import { expect, test } from "@playwright/test";
import { api, waitFor } from "../helpers/api";
import { openApp } from "../helpers/flows";
import { freshStart, notifications } from "../helpers/ingest";

test("F03/E2E-12 notificações da F02: sugestões agrupadas (CM-3) e análise concluída, resolvidas ao decidir e ao abrir Perfis", async ({
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

  // CM-3: uma notificação agrupada para todas as sugestões; dispensar uma faz o grupo diminuir (ou resolver)
  const { suggestions } = await api<{ suggestions: Array<{ id: string }> }>(
    "/api/profiles/suggestions",
  );
  const groupBefore = open.notifications.find((n) => n.kind === "profile.suggestion");
  expect(open.notifications.filter((n) => n.kind === "profile.suggestion")).toHaveLength(1);
  await api(`/api/profiles/suggestions/${suggestions[0]?.id}/dismiss`, {
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
  const groupAfter = open.notifications.find((n) => n.kind === "profile.suggestion");
  if (suggestions.length === 1) expect(groupAfter).toBeUndefined();
  else expect(groupAfter?.title).not.toBe(groupBefore?.title);
  const resolved = await notifications("resolved");
  expect(resolved.notifications.some((n) => n.kind === "profile.analysis_done")).toBe(true);
});
