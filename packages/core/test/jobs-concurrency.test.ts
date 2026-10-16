import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../src/db";
import {
  resolveConcurrency,
  saveConcurrency,
  WORKER_CONCURRENCY_DEFAULTS,
} from "../src/jobs/concurrency";

/** F05/M7 · concorrência por fila em Configurações (padrão, limites de 1 a 4, gravação parcial). */
describe("F05/M7 core · concorrência das filas", () => {
  it("padrão; grava só o que veio; valores fora do limite ficam em 1 a 4", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    expect(resolveConcurrency(r.settings)).toEqual(WORKER_CONCURRENCY_DEFAULTS);
    expect(saveConcurrency(r.settings, { extract: 3 })).toEqual({ ingest: 2, ocr: 1, extract: 3 });
    expect(saveConcurrency(r.settings, { ocr: 9, ingest: 0 })).toEqual({
      ingest: 1,
      ocr: 4,
      extract: 3,
    });
    r.settings.set("workers.concurrency", { extract: "muito" });
    expect(resolveConcurrency(r.settings).extract).toBe(2);
  });
});
