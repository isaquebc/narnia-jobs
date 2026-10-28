import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

interface EventRow {
  id: string;
  startsAt: string;
  timezone: string;
}

const basic = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

test("F07/E2E-06 agendar no fuso › .ics e Google com UTC › lembrete no menu e na bandeja › funil", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);

  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Aplicar nesta vaga" })
    .getByRole("button", { name: "Confirmar candidatura" })
    .click();
  await page.getByRole("link", { name: "Ver candidatura" }).click();
  const appId = page.url().split("/candidaturas/")[1] ?? "";

  const form = page.getByRole("form", { name: "Novo evento" });
  await form.getByLabel("Título").fill("Entrevista técnica");
  await form.getByLabel("Data e hora").fill("2030-10-29T14:00");
  await form.getByLabel("Link").fill("https://meet.example/abc");
  await form.getByRole("button", { name: "Agendar" }).click();

  const agenda = page.getByRole("list", { name: "Agenda da candidatura" });
  const item = agenda.getByRole("listitem").filter({ hasText: "Entrevista técnica" });
  await expect(item).toContainText("29/10/2030 14:00");
  const [ev] = (await api<{ events: EventRow[] }>(`/api/job-applications/${appId}/events`)).events;
  if (!ev) throw new Error("evento não gravado");
  await expect(item).toContainText(ev.timezone);

  const google = await item
    .getByRole("link", { name: "Adicionar ao Google Calendar" })
    .getAttribute("href");
  expect(new URL(google ?? "").searchParams.get("dates")?.split("/")[0]).toBe(basic(ev.startsAt));
  const ics = await page.request.get(
    (await item.getByRole("link", { name: "Baixar .ics" }).getAttribute("href")) ?? "",
  );
  const text = (await ics.text()).replace(/\r\n /g, "");
  expect(text).toContain(`DTSTART:${basic(ev.startsAt)}`);
  expect(text).toContain(`UID:${ev.id}@narnia-jobs`);
  expect(text).toContain(`/candidaturas/${appId}`);

  // evento daqui a 2 h (em UTC, independe do fuso): lembrete no menu e na bandeja
  const soon = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 16);
  await api(`/api/job-applications/${appId}/events`, {
    method: "POST",
    body: JSON.stringify({
      kind: "test",
      title: "Entregar o case",
      startsLocal: soon,
      timezone: "UTC",
    }),
  });
  await page.goto("/candidaturas");
  await expect(page.getByLabel("Lembretes de candidaturas: 1")).toBeVisible();
  await page.getByRole("button", { name: "Atividades" }).click();
  await expect(
    page.getByRole("list", { name: "Agenda das candidaturas" }).getByText(/Entregar o case/),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const funnel = page.getByRole("region", { name: "Funil das candidaturas" });
  await expect(funnel).toContainText("Aplicado");
  await expect(funnel).toContainText("1 chegaram");
});
