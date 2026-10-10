import { expect, test } from "@playwright/test";
import { ingestion, jobs, onboarding, reset, setMock, waitFor } from "../helpers/api";
import { chooseFile, expectStep, openApp, passProvider, startExtraction } from "../helpers/flows";

/**
 * @ops: o lançador roda a parte 1, mata o worker (docker compose kill) no meio da etapa lenta, sobe o worker de novo
 * e roda a parte 2. A BullMQ detecta o job travado (lock de 30 s + verificação a cada 30 s), publica `stalled`
 * (bandeja: “Reprocessando”) e reprocessa a etapa; o processamento é idempotente por etapa, sem propostas duplicadas.
 */
test.describe("F01/E2E-12 worker reiniciado @ops", () => {
  test("F01/E2E-12 worker reiniciado @ops · parte 1: extração lenta em andamento", async ({
    page,
  }) => {
    await reset();
    await openApp(page);
    await passProvider(page);
    // o atraso vem antes do envio: abaixo do limiar a extração começa sozinha (F03-13 no onboarding)
    await setMock({ delayMs: 20_000 });
    await chooseFile(page, "cv.docx");
    await startExtraction(page);
    await waitFor(
      jobs,
      (j) => j.jobs.some((x) => x.status === "active" && x.stage === "extract.facts"),
      {
        timeoutMs: 30_000,
        everyMs: 500,
        label: "etapa extract.facts ativa",
      },
    );
  });

  test("F01/E2E-12 worker reiniciado @ops · parte 2: reprocessa e conclui sem duplicar", async ({
    page,
  }) => {
    const runId = (await onboarding()).runId as string;
    expect(runId).toBeTruthy();
    // O `stalled` vira `active` em milissegundos (a fila devolve o job e o worker novo o pega na hora), então o
    // polling não o vê; capturamos os quadros do WebSocket que a bandeja recebe (job.progress com stage "stalled").
    const frames: string[] = [];
    page.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
    await openApp(page);
    await expectStep(page, 3);

    await waitFor(jobs, (j) => j.jobs.length > 0 && j.jobs.every((x) => x.status === "done"), {
      timeoutMs: 150_000,
      everyMs: 1_000,
      label: "jobs concluídos após o worker voltar",
    });
    expect(frames.some((f) => f.includes('"stalled"'))).toBe(true);

    const run = await ingestion(runId);
    expect(["review", "done"]).toContain(run.status);
    expect(run.jobs.every((j) => j.status === "done")).toBe(true);
    const keys = run.proposals.map((p) => `${p.proposal.kind}:${JSON.stringify(p.proposal.data)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(run.proposals).toHaveLength(16);
    await expect(page.getByText("Extração concluída.")).toBeVisible();
  });
});
