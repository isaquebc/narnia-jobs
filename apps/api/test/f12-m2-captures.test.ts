import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/**
 * F12/M2 · captura de vaga pela extensão: a extensão manda o HTML renderizado da aba (sem scripts nem estilos) com o
 * token de dispositivo; o api lê com o extrator da F06 (JSON-LD, Readability, página bloqueada), guarda a captura e
 * avisa se parece uma vaga já salva. "Salvar vaga" entra pelo fluxo da F06; `/api/extension/enter` autentica a
 * janela popup.
 */
const DESCRIPTION = `<p>Buscamos uma pessoa engenheira backend para o time de pagamentos.</p>
<h3>Requisitos</h3><ul><li>5+ anos com Java e Spring</li><li>Kafka e PostgreSQL</li>
<li>Docker e Kubernetes em produção</li></ul><h3>Diferenciais</h3><ul><li>AWS</li></ul>
<p>Trabalho híbrido em São Paulo, CLT, com plano de saúde e vale refeição.</p>`;

const withJsonLd = `<!doctype html><html><head><title>Vagas</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Engenheira Backend Sênior",
  description: DESCRIPTION,
  hiringOrganization: { "@type": "Organization", name: "Acme Pagamentos" },
  jobLocation: { "@type": "Place", address: { addressLocality: "São Paulo", addressRegion: "SP" } },
})}</script></head><body><main><h1>Engenheira Backend Sênior</h1>${DESCRIPTION}</main></body></html>`;

const withoutJsonLd = `<!doctype html><html><head><title>Vaga</title>
<meta property="og:site_name" content="Portal Exemplo"></head><body><nav>Início · Vagas · Entrar</nav>
<main><h1>Desenvolvedor Frontend Pleno</h1>${DESCRIPTION}</main><footer>© Portal</footer></body></html>`;

const blocked = `<!doctype html><html><head><title>Just a moment...</title></head>
<body><p>Checking your browser before accessing. Verify you are human.</p></body></html>`;

describe("F12/M2 · captura de vaga pela extensão", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function device(app: TestApp) {
    const { code } = (await (
      await app.api("/api/extension/pairing", { method: "POST" })
    ).json()) as { code: string };
    const r = await app.app.request("/api/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Chrome" }),
    });
    return ((await r.json()) as { token: string }).token;
  }

  async function capture(
    app: TestApp,
    token: string,
    html: string,
    url = "https://vagas.example/123",
  ) {
    const r = await app.app.request("/api/extension/captures", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "page", url, title: "Vagas", html }),
    });
    return { status: r.status, body: (await r.json()) as { id: string } };
  }

  const get = async (app: TestApp, id: string) =>
    (await (await app.api(`/api/extension/captures/${id}`)).json()) as {
      capture: Record<string, unknown> & { reading: Record<string, unknown> };
    };

  it("página com JSON-LD: lê cargo, empresa, local e um trecho; guarda o HTML da captura", async () => {
    t = makeTestApp();
    const token = await device(t);
    const r = await capture(t, token, withJsonLd);
    expect(r.status).toBe(201);
    const { capture: c } = await get(t, r.body.id);
    expect(c).toMatchObject({
      url: "https://vagas.example/123",
      postingId: null,
      duplicate: null,
      reading: {
        ok: true,
        title: "Engenheira Backend Sênior",
        company: "Acme Pagamentos",
        message: null,
      },
    });
    // a descrição inteira, até o fim (testes do dono, 2026-10-23: antes ia só um trecho)
    expect(String(c.reading.description)).toContain("engenheira backend");
    expect(String(c.reading.description)).toContain("vale refeição");
    expect(String(c.reading.description)).not.toMatch(/^Empresa: /m);
    expect(Number(c.reading.chars)).toBeGreaterThan(200);
    expect(existsSync(join(t.dataDir, "captures", `${r.body.id}.html`))).toBe(true);
    // a captura fica com o dispositivo que leu
    expect(t.repos.extension.getCapture(r.body.id)?.deviceId).toBe(
      t.repos.extension.listDevices()[0]?.id,
    );
  });

  it("página sem JSON-LD: conteúdo principal, sem menu nem rodapé; site pelo og:site_name", async () => {
    t = makeTestApp();
    const { body } = await capture(t, await device(t), withoutJsonLd);
    const { capture: c } = await get(t, body.id);
    expect(c.reading).toMatchObject({
      ok: true,
      title: "Desenvolvedor Frontend Pleno",
      siteName: "Portal Exemplo",
    });
    expect(String(c.reading.description)).not.toContain("Entrar");
  });

  it("página bloqueada: a leitura falha com a mensagem e Salvar vaga dá 422", async () => {
    t = makeTestApp();
    const { body } = await capture(t, await device(t), blocked);
    const { capture: c } = await get(t, body.id);
    expect(c.reading).toMatchObject({ ok: false, message: expect.stringMatching(/bloqueou/) });
    const save = await t.api(`/api/extension/captures/${body.id}/posting`, { method: "POST" });
    expect(save.status).toBe(422);
  });

  it("Salvar vaga entra pelo fluxo da F06 (extração na fila) e liga a captura; salvar de novo devolve a mesma", async () => {
    t = makeTestApp();
    const { body } = await capture(t, await device(t), withJsonLd);
    const save = await t.api(`/api/extension/captures/${body.id}/posting`, { method: "POST" });
    expect(save.status).toBe(201);
    const saved = (await save.json()) as {
      posting: { id: string; title: string; company: string; postingUrl: string; rawPath: string };
    };
    expect(saved.posting).toMatchObject({
      title: "Engenheira Backend Sênior",
      company: "Acme Pagamentos",
      postingUrl: "https://vagas.example/123",
    });
    expect(saved.posting.rawPath).toMatch(/snapshots\/postings\//);
    expect(t.queue.tasks.map((x) => x.type)).toEqual(["posting.extract"]);
    expect((await get(t, body.id)).capture.postingId).toBe(saved.posting.id);
    const again = await t.api(`/api/extension/captures/${body.id}/posting`, { method: "POST" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { posting: { id: string } }).posting.id).toBe(saved.posting.id);
    expect(t.repos.postings.list()).toHaveLength(1);
  });

  it("parece uma vaga já salva: mesmo link (sem o rastreio) ou mesma empresa e cargo", async () => {
    t = makeTestApp();
    const saved = t.repos.postings.create({
      title: "Outra coisa",
      company: "Outra",
      postingUrl: "https://vagas.example/123",
    });
    const token = await device(t);
    const a = await capture(t, token, withJsonLd, "https://vagas.example/123?utm_source=linkedin");
    expect((await get(t, a.body.id)).capture.duplicate).toEqual({
      id: saved.id,
      title: "Outra coisa",
      company: "Outra",
    });
    const same = t.repos.postings.create({
      title: "Engenheira Backend Senior",
      company: "ACME Pagamentos",
    });
    const b = await capture(t, token, withJsonLd, "https://outro.example/x");
    expect((await get(t, b.body.id)).capture.duplicate).toMatchObject({ id: same.id });
  });

  it("valida a entrada: sem HTML, link que não é http(s), sem autenticação", async () => {
    t = makeTestApp();
    const token = await device(t);
    const post = (body: unknown, auth = true) =>
      t?.app.request("/api/extension/captures", {
        method: "POST",
        headers: {
          ...(auth ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect((await post({ kind: "page", url: "https://x.example", html: "" }))?.status).toBe(400);
    expect(
      (await post({ kind: "page", url: "file:///etc/passwd", html: "<p>x</p>" }))?.status,
    ).toBe(400);
    expect(
      (await post({ kind: "page", url: "https://x.example", html: "<p>x</p>" }, false))?.status,
    ).toBe(401);
    expect((await t.api("/api/extension/captures/nao-existe")).status).toBe(404);
  });
});

describe("F12/M2 · entrada da janela popup", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function token(app: TestApp) {
    const { code } = (await (
      await app.api("/api/extension/pairing", { method: "POST" })
    ).json()) as { code: string };
    const r = await app.app.request("/api/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Chrome" }),
    });
    return ((await r.json()) as { token: string }).token;
  }

  const enter = (app: TestApp, query: string, cookie?: string) =>
    app.app.request(`/api/extension/enter?${query}`, cookie ? { headers: { cookie } } : {});

  it("token de dispositivo vira o cookie e redireciona para a janela", async () => {
    t = makeTestApp();
    const dev = await token(t);
    const r = await enter(t, `device=${dev}&next=${encodeURIComponent("/candidatura?captura=c1")}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/candidatura?captura=c1");
    expect(r.headers.get("set-cookie")).toContain(`narnia_token=${dev}`);
    // o cookie do dispositivo vale para a web da janela
    expect(
      (await t.app.request("/api/profiles", { headers: { cookie: `narnia_token=${dev}` } })).status,
    ).toBe(200);
  });

  it("navegador já autenticado pelo dono: não troca o cookie", async () => {
    t = makeTestApp();
    const dev = await token(t);
    const r = await enter(t, `device=${dev}&next=%2Fcandidatura`, `narnia_token=${TOKEN}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("token inválido dá 401; destino fora do narnia cai na janela", async () => {
    t = makeTestApp();
    expect((await enter(t, "device=nxd_nao&next=%2Fcandidatura")).status).toBe(401);
    const dev = await token(t);
    for (const next of ["//evil.example/x", "https://evil.example", "javascript:alert(1)"]) {
      const r = await enter(t, `device=${dev}&next=${encodeURIComponent(next)}`);
      expect(r.headers.get("location")).toBe("/candidatura");
    }
  });
});

describe("F12/M2 · Salvar vaga também analisa (pedido do dono, 2026-10-23)", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  async function saved(app: TestApp) {
    const { code } = (await (
      await app.api("/api/extension/pairing", { method: "POST" })
    ).json()) as { code: string };
    const pair = await app.app.request("/api/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Chrome" }),
    });
    const token = ((await pair.json()) as { token: string }).token;
    const cap = await app.app.request("/api/extension/captures", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "page", url: "https://vagas.example/9", html: withJsonLd }),
    });
    const { id } = (await cap.json()) as { id: string };
    const save = await app.api(`/api/extension/captures/${id}/posting`, { method: "POST" });
    const { posting } = (await save.json()) as { posting: { id: string } };
    return { id, postingId: posting.id };
  }

  const analysisOf = async (app: TestApp, id: string) =>
    (
      (await (await app.api(`/api/extension/captures/${id}`)).json()) as {
        capture: {
          analysis: { requested: boolean; sessionId: string | null; error: string | null };
        };
      }
    ).capture.analysis;

  /** O worker terminou a extração: a vaga fica pronta e o evento chega pelo relay. */
  function extractionDone(app: TestApp, postingId: string, status: "ready" | "error" = "ready") {
    app.repos.postings.setStatus(postingId, status);
    app.bus.emit({ type: "posting.updated", postingId });
  }

  it("a análise espera a extração e abre sozinha quando ela termina, ligada à vaga", async () => {
    t = makeTestApp();
    const { id, postingId } = await saved(t);
    expect(await analysisOf(t, id)).toEqual({ requested: true, sessionId: null, error: null });
    expect(t.repos.chatSessions.list({}).filter((s) => s.category === "job")).toHaveLength(0);
    extractionDone(t, postingId);
    const a = await analysisOf(t, id);
    expect(a.sessionId).toEqual(expect.any(String));
    const session = t.repos.chatSessions.get(a.sessionId as string);
    expect(session).toMatchObject({ category: "job", postingId });
    // eventos seguintes da mesma vaga (a própria análise grava e avisa) não abrem outra conversa
    t.bus.emit({ type: "posting.updated", postingId });
    expect(t.repos.chatSessions.list({}).filter((s) => s.category === "job")).toHaveLength(1);
  });

  it("extração com erro também analisa (o texto da vaga já está salvo)", async () => {
    t = makeTestApp();
    const { id, postingId } = await saved(t);
    extractionDone(t, postingId, "error");
    expect((await analysisOf(t, id)).sessionId).toEqual(expect.any(String));
  });

  it("teto de conversas cheio: guarda o erro; Analisar de novo abre depois de liberar", async () => {
    t = makeTestApp();
    await t.api("/api/settings/chat", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxLiveSessions: 1 }),
    });
    const other = await t.api("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "career" }),
    });
    const { session } = (await other.json()) as { session: { id: string } };
    const { id, postingId } = await saved(t);
    extractionDone(t, postingId);
    expect(await analysisOf(t, id)).toMatchObject({ sessionId: null, error: "session_limit" });
    const again = await t.api(`/api/extension/captures/${id}/analyze`, { method: "POST" });
    expect(again.status).toBe(409);
    await t.api(`/api/sessions/${session.id}/hibernate`, { method: "POST" });
    const ok = await t.api(`/api/extension/captures/${id}/analyze`, { method: "POST" });
    expect(ok.status).toBe(201);
    expect(await analysisOf(t, id)).toMatchObject({ sessionId: expect.any(String), error: null });
  });

  /** A extração achou uma vaga salva parecida: a comparação fica pendente na vaga nova. */
  function pendingDuplicate(app: TestApp, postingId: string) {
    const savedPosting = app.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    app.repos.postings.setDuplicate(postingId, {
      candidateId: savedPosting.id,
      sameJob: true,
      confidence: 92,
      differences: [],
      rationale: "Mesma vaga.",
      checkedAt: "2026-10-23T12:00:00.000Z",
      decision: null,
    });
    return savedPosting.id;
  }

  const postingOf = async (app: TestApp, id: string) =>
    (
      (await (await app.api(`/api/extension/captures/${id}`)).json()) as {
        capture: { postingId: string | null };
      }
    ).capture.postingId;

  const decide = (app: TestApp, postingId: string, action: string) =>
    app.api(`/api/postings/${postingId}/duplicate-decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });

  it("vaga repetida: a análise espera a decisão; Salvar como nova analisa a nova", async () => {
    t = makeTestApp();
    const { id, postingId } = await saved(t);
    pendingDuplicate(t, postingId);
    extractionDone(t, postingId);
    expect(await analysisOf(t, id)).toEqual({ requested: true, sessionId: null, error: null });
    expect((await decide(t, postingId, "new")).status).toBe(200);
    expect((await analysisOf(t, id)).sessionId).toEqual(expect.any(String));
    const session = t.repos.chatSessions.get((await analysisOf(t, id)).sessionId as string);
    expect(session?.postingId).toBe(postingId);
  });

  it("vaga repetida: Atualizar a salva liga a captura à salva e analisa a salva", async () => {
    t = makeTestApp();
    const { id, postingId } = await saved(t);
    const savedId = pendingDuplicate(t, postingId);
    extractionDone(t, postingId);
    expect((await decide(t, postingId, "update")).status).toBe(200);
    expect(await postingOf(t, id)).toBe(savedId);
    const session = t.repos.chatSessions.get((await analysisOf(t, id)).sessionId as string);
    expect(session?.postingId).toBe(savedId);
  });

  it("vaga repetida: Descartar liga a captura à salva; a salva já analisada não abre outra análise", async () => {
    t = makeTestApp();
    const { id, postingId } = await saved(t);
    const savedId = pendingDuplicate(t, postingId);
    t.repos.jobAnalyses.add({
      postingId: savedId,
      analysis: {},
      recommendedProfileId: null,
      factsVersion: 1,
      postingUpdatedAt: "2026-10-23T12:00:00.000Z",
      models: [],
      usage: null,
      chatSessionId: null,
    });
    extractionDone(t, postingId);
    expect((await decide(t, postingId, "cancel")).status).toBe(200);
    expect(await postingOf(t, id)).toBe(savedId);
    expect(t.repos.chatSessions.list({}).filter((s) => s.category === "job")).toHaveLength(0);
  });

  it("a página da vaga lista como repetida a de mesmo link, mesmo com outro cargo", async () => {
    t = makeTestApp();
    const a = t.repos.postings.create({
      title: "Engenheira Backend Sênior",
      company: "Acme",
      postingUrl: "https://vagas.example/1?utm_source=x",
    });
    const b = t.repos.postings.create({
      title: "Senior Backend Engineer",
      company: "Acme",
      postingUrl: "https://vagas.example/1",
    });
    const r = (await (await t.api(`/api/postings/${b.id}`)).json()) as { duplicates: string[] };
    expect(r.duplicates).toEqual([a.id]);
  });

  it("Analisar de novo: abre na hora; captura sem vaga dá 422 e inexistente 404", async () => {
    t = makeTestApp();
    const { id } = await saved(t);
    const r = await t.api(`/api/extension/captures/${id}/analyze`, { method: "POST" });
    expect(r.status).toBe(201);
    const { session } = (await r.json()) as { session: { id: string } };
    expect((await analysisOf(t, id)).sessionId).toBe(session.id);
    expect((await t.api("/api/extension/captures/nao/analyze", { method: "POST" })).status).toBe(
      404,
    );
  });
});
