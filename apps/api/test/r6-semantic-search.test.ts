import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * R6 (F04-fix-fundamentacao, FF-5, FF-7): Configurações › Busca por sentido. Opcional: o alerta aparece quando o índice
 * no contexto do recrutador chega ao teto (fatos cortados), e o usuário pode ligar antes. Com o provider mock, o
 * vetorizador é o de conceitos (nada é baixado).
 */
const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

type View = {
  enabled: boolean;
  status: "off" | "loading" | "indexing" | "ready" | "error";
  cutFacts: number;
  alert: boolean;
  model: string;
  vectors: number;
};

async function until(t: TestApp, want: View["status"]): Promise<View> {
  for (let i = 0; i < 100; i++) {
    const v = (await (await t.api("/api/settings/semantic-search")).json()) as View;
    if (v.status === want) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`status nunca virou ${want}`);
}

async function factSearch(t: TestApp, q: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://narnia.test/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    fetch: (url, init) => Promise.resolve(t.app.fetch(new Request(url, init))),
  });
  const client = new Client({ name: "teste-r6", version: "0.0.0" });
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
  const r = (await client.callTool({ name: "fact_search", arguments: { q } })) as {
    content: Array<{ text?: string }>;
  };
  await client.close();
  return JSON.parse(r.content[0]?.text ?? "{}") as {
    items: Array<{ kind: string; line: string; bySense?: boolean }>;
  };
}

describe("R6 · busca por sentido (api)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("começa desligada, sem alerta com o índice inteiro no contexto", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const v = (await (await t.api("/api/settings/semantic-search")).json()) as View;
    expect(v).toMatchObject({ enabled: false, status: "off", cutFacts: 0, alert: false });
  });

  it("ligar vetoriza os fatos e a fact_search passa a achar pelo sentido; desligar volta e apaga os vetores", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const off = await factSearch(t, "fintech");
    expect(off.items.some((i) => i.bySense)).toBe(false);

    expect((await t.api("/api/settings/semantic-search", put({ enabled: true }))).status).toBe(200);
    const ready = await until(t, "ready");
    expect(ready.enabled).toBe(true);
    expect(ready.vectors).toBeGreaterThan(0);
    const on = await factSearch(t, "fintech");
    expect(on.items.find((i) => i.bySense)?.line).toContain("Acme");

    await t.api("/api/settings/semantic-search", put({ enabled: false }));
    const v = await until(t, "off");
    expect(v).toMatchObject({ enabled: false, vectors: 0 });
    expect((await factSearch(t, "fintech")).items.some((i) => i.bySense)).toBe(false);
  });

  it("alerta quando o índice corta fatos e a busca está desligada; ligada, sem alerta", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    t.repos.settings.set("chat.fact_index_max_chars", 400);
    const v = (await (await t.api("/api/settings/semantic-search")).json()) as View;
    expect(v.cutFacts).toBeGreaterThan(0);
    expect(v.alert).toBe(true);
    // o aviso também vai para o sino (uma pendência só), e sai quando a busca é ligada
    const open = () =>
      t.repos.notifications.list({ status: "open" }).filter((n) => n.kind === "search.index_full");
    expect(open()).toHaveLength(1);
    expect(open()[0]?.actionUrl).toBe("/configuracoes#busca-por-sentido");
    await t.api("/api/settings/semantic-search");
    expect(open()).toHaveLength(1);
    await t.api("/api/settings/semantic-search", put({ enabled: true }));
    expect((await until(t, "ready")).alert).toBe(false);
    expect(open()).toHaveLength(0);
  });

  it("PUT inválido é 400", async () => {
    t = makeTestApp();
    expect((await t.api("/api/settings/semantic-search", put({ enabled: "sim" }))).status).toBe(
      400,
    );
  });
});
