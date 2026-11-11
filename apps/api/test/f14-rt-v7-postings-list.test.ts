import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14 · RT-V7 (§2.0.1): `GET /api/postings` sem filtro devolve o mesmo conjunto e a mesma ordem (mais nova primeiro,
 * `archived=1` traz só as arquivadas) depois que a F14 acrescentar o filtro do feed.
 */
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("F14 · RT-V7 · lista de vagas", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("sem filtro: todas as não arquivadas, da mais nova para a mais antiga; archived=1 traz só as arquivadas", async () => {
    t = makeTestApp();
    const ids: string[] = [];
    for (const title of ["Primeira", "Segunda", "Terceira"]) {
      const r = (await (await t.api("/api/postings", json({ company: "Acme", title }))).json()) as {
        posting: { id: string };
      };
      ids.push(r.posting.id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const archived = await t.api(`/api/postings/${ids[0]}/archive`, json({ reason: "salary" }));
    expect(archived.status).toBe(200);
    const list = (await (await t.api("/api/postings")).json()) as {
      postings: Array<{ id: string; title: string }>;
    };
    expect(list.postings.map((p) => p.title)).toEqual(["Terceira", "Segunda"]);
    const only = (await (await t.api("/api/postings?archived=1")).json()) as {
      postings: Array<{ title: string }>;
    };
    expect(only.postings.map((p) => p.title)).toEqual(["Primeira"]);
  });
});
