import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/db";
import { notificationsRepo } from "../../src/db/repos/notifications";

/**
 * Corrida entre api e worker (e2e de 2026-10-12: o worker caiu com "UNIQUE constraint failed: notification.kind…"):
 * os dois processos procuravam a notificação aberta, não achavam e inseriam ao mesmo tempo. O `upsert` precisa ser
 * atômico no banco, não "procura e depois insere".
 */
describe("notificações · upsert atômico entre processos", () => {
  it("outro processo inseriu a mesma notificação aberta entre a busca e a inserção: atualiza, não lança", () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-notif-"));
    try {
      const file = join(dir, "n.sqlite");
      const a = openDatabase(file);
      migrate(a);
      const b = openDatabase(file);
      const worker = notificationsRepo(a);
      const api = notificationsRepo(b);
      const input = {
        kind: "ingestion.error",
        subjectKind: "ingestion_run",
        subjectId: "run-1",
        title: "Falhou",
        actionUrl: "/ingestao/run-1",
      } as const;
      // "api" insere no meio da operação do "worker": simulado com um gatilho que, na primeira busca do worker,
      // insere a linha pela outra conexão (a busca do worker já não a vê)
      const origPrepare = a.prepare.bind(a);
      let raced = false;
      const racing = Object.create(a) as typeof a;
      racing.prepare = ((sql: string) => {
        const st = origPrepare(sql);
        if (/^\s*select \* from notification where kind = \?/i.test(sql)) {
          const get = st.get.bind(st);
          (st as unknown as { get: typeof get }).get = ((...args: Parameters<typeof get>) => {
            const r = get(...args);
            if (!raced) {
              raced = true;
              api.upsert({ ...input, title: "Falhou (api)" });
              return undefined;
            }
            return r;
          }) as typeof get;
        }
        return st;
      }) as typeof a.prepare;
      const racer = notificationsRepo(racing);
      const r = racer.upsert({ ...input, title: "Falhou (worker)" });
      expect(r.notification.title).toBe("Falhou (worker)");
      expect(r.created).toBe(false);
      expect(worker.list().filter((n) => n.subjectId === "run-1")).toHaveLength(1);
      a.close();
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
