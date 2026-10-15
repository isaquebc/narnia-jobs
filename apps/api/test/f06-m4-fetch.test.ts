import { describe, expect, it } from "vitest";
import { fetchPostingPage, isBlockedAddress, robotsAllows } from "../src/postings/fetch";

/** F06/M4 · busca por URL: anti-SSRF, robots.txt, redirects, teto de tamanho e extração sem JS. */
const ARTICLE = `<!doctype html><html><head><title>Vaga</title>
<meta property="og:title" content="Backend Sênior · Acme Pay"><meta property="og:site_name" content="Acme Pay Jobs"></head>
<body><nav>Menu Início Vagas Contato</nav><main><article><h1>Backend Sênior</h1>
<p>${"Construímos a infraestrutura de pagamentos da América Latina com Node.js e PostgreSQL. ".repeat(6)}</p>
<h2>Requisitos</h2><ul><li>5+ anos com Node.js</li><li>PostgreSQL</li></ul></article></main><footer>Rodapé © 2026</footer></body></html>`;

const JS_ONLY = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

function server(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const f = (async (input: URL | string) => {
    const u = new URL(String(input));
    calls.push(u.pathname);
    const r = routes[`${u.host}${u.pathname}`];
    return r ? r() : new Response("não achei", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}
const publicDns = async () => ["93.184.216.34"];

describe("F06/M4 · fetchPostingPage", () => {
  it("bloqueia rede interna, loopback, link-local e IPv6 local", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.10",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
      "0.0.0.0",
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("recusa localhost, IP interno, DNS que resolve para IP interno e esquema que não é http", async () => {
    const { f } = server({});
    expect(
      await fetchPostingPage("http://localhost:3100/x", { fetch: f, lookup: publicDns }),
    ).toMatchObject({ ok: false, code: "blocked_host" });
    expect(
      await fetchPostingPage("http://169.254.169.254/latest", { fetch: f, lookup: publicDns }),
    ).toMatchObject({ ok: false, code: "blocked_host" });
    expect(
      await fetchPostingPage("https://intranet.exemplo.com/v", {
        fetch: f,
        lookup: async () => ["10.0.0.5"],
      }),
    ).toMatchObject({ ok: false, code: "blocked_host" });
    expect(
      await fetchPostingPage("file:///etc/passwd", { fetch: f, lookup: publicDns }),
    ).toMatchObject({ ok: false, code: "invalid_url" });
    expect(await fetchPostingPage("não é url", { fetch: f, lookup: publicDns })).toMatchObject({
      ok: false,
      code: "invalid_url",
    });
  });

  it("extrai o texto principal sem menu e rodapé, com og:title e og:site_name", async () => {
    const { f } = server({
      "vagas.exemplo.com/1": () =>
        new Response(ARTICLE, { headers: { "content-type": "text/html" } }),
    });
    const r = await fetchPostingPage("https://vagas.exemplo.com/1", {
      fetch: f,
      lookup: publicDns,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("5+ anos com Node.js");
    expect(r.text).not.toContain("Rodapé");
    expect(r).toMatchObject({ title: "Backend Sênior · Acme Pay", siteName: "Acme Pay Jobs" });
  });

  it("página só com JS: extract_failed", async () => {
    const { f } = server({ "app.exemplo.com/v": () => new Response(JS_ONLY) });
    expect(
      await fetchPostingPage("https://app.exemplo.com/v", { fetch: f, lookup: publicDns }),
    ).toMatchObject({ ok: false, code: "extract_failed" });
  });

  it("robots.txt com Disallow: não busca a página", async () => {
    const { f, calls } = server({
      "vagas.exemplo.com/robots.txt": () => new Response("User-agent: *\nDisallow: /vagas/\n"),
      "vagas.exemplo.com/vagas/9": () => new Response(ARTICLE),
    });
    expect(
      await fetchPostingPage("https://vagas.exemplo.com/vagas/9", { fetch: f, lookup: publicDns }),
    ).toMatchObject({ ok: false, code: "robots" });
    expect(calls).toEqual(["/robots.txt"]);
  });

  it("robots: Allow mais específico vence; grupo do nosso agente vence o *", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /vagas/", "/vagas/1")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/x")).toBe(false);
    expect(
      robotsAllows("User-agent: narnia-jobs\nDisallow:\n\nUser-agent: *\nDisallow: /", "/x"),
    ).toBe(true);
    expect(robotsAllows("", "/x")).toBe(true);
  });

  it("segue até 3 redirects conferindo cada destino; redirect para rede interna é bloqueado", async () => {
    const hop = (to: string) => () =>
      new Response(null, { status: 302, headers: { location: to } });
    const { f } = server({
      "a.exemplo.com/1": hop("https://b.exemplo.com/2"),
      "b.exemplo.com/2": () => new Response(ARTICLE),
      "c.exemplo.com/1": hop("http://127.0.0.1/admin"),
      "d.exemplo.com/1": hop("https://d.exemplo.com/2"),
      "d.exemplo.com/2": hop("https://d.exemplo.com/3"),
      "d.exemplo.com/3": hop("https://d.exemplo.com/4"),
      "d.exemplo.com/4": hop("https://d.exemplo.com/5"),
    });
    expect(
      (await fetchPostingPage("https://a.exemplo.com/1", { fetch: f, lookup: publicDns })).ok,
    ).toBe(true);
    expect(
      await fetchPostingPage("https://c.exemplo.com/1", { fetch: f, lookup: publicDns }),
    ).toMatchObject({ ok: false, code: "blocked_host" });
    expect(
      await fetchPostingPage("https://d.exemplo.com/1", { fetch: f, lookup: publicDns }),
    ).toMatchObject({ ok: false, code: "http_error" });
  });

  it("corta acima do teto de bytes e respeita o timeout", async () => {
    const { f } = server({ "big.exemplo.com/1": () => new Response("x".repeat(5000)) });
    expect(
      await fetchPostingPage("https://big.exemplo.com/1", {
        fetch: f,
        lookup: publicDns,
        maxBytes: 1000,
      }),
    ).toMatchObject({ ok: false, code: "too_large" });
    const slow = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(new Error("abort"))),
      )) as typeof fetch;
    expect(
      await fetchPostingPage("https://lento.exemplo.com/1", {
        fetch: slow,
        lookup: publicDns,
        timeoutMs: 50,
      }),
    ).toMatchObject({ ok: false, code: "timeout" });
  });
});
