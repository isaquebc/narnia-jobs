import { describe, expect, it } from "vitest";
import { browserUserAgent, COOKIE_ACCEPT, requestDecision } from "../src/postings/browser";
import {
  extractPosting,
  fetchPostingPage,
  isBlockedAddress,
  robotsAllows,
} from "../src/postings/fetch";

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
    // blocos e itens viram linhas (sem "frase.Outra frase" grudadas)
    expect(r.text).toMatch(/Requisitos\n- 5\+ anos com Node\.js\n- PostgreSQL/);
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

/** Correção do teste do dono (2026-10-15): página com banner de cookies ou só com JS. */
const COOKIE_WALL = `<!doctype html><html><head><title>Vaga</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", name: "Vagas" },
    {
      "@type": "JobPosting",
      title: "Pessoa Desenvolvedora Backend Sênior",
      hiringOrganization: { "@type": "Organization", name: "Acme Pay" },
      employmentType: ["FULL_TIME"],
      jobLocationType: "TELECOMMUTE",
      jobLocation: {
        "@type": "Place",
        address: { addressLocality: "São Paulo", addressRegion: "SP" },
      },
      datePosted: "2026-10-01",
      description: `<p>${"Construímos pagamentos para a América Latina. ".repeat(5)}</p><h3>Requisitos</h3><ul><li>Node.js e TypeScript</li><li>PostgreSQL</li></ul><p>Benefícios:<br>Vale refeição<br>Plano de saúde</p>`,
    },
  ],
})}</script></head>
<body><div class="cookie">Usamos cookies. <button>Aceitar todos</button></div><div id="root"></div></body></html>`;

describe("F06 · vaga atrás de banner de cookies ou JS (2026-10-15)", () => {
  it("JSON-LD JobPosting: texto da descrição em linhas, cargo, empresa e local", () => {
    const r = extractPosting(COOKIE_WALL, "https://vagas.exemplo.com/1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({
      title: "Pessoa Desenvolvedora Backend Sênior",
      company: "Acme Pay",
    });
    expect(r.text).toContain("Pessoa Desenvolvedora Backend Sênior");
    expect(r.text).toContain("Empresa: Acme Pay");
    expect(r.text).toContain("Local: São Paulo - SP · Remoto");
    expect(r.text).toMatch(/Requisitos\n- Node\.js e TypeScript\n- PostgreSQL/);
    expect(r.text).toMatch(/Benefícios:\nVale refeição\nPlano de saúde/);
    expect(r.text).not.toContain("Usamos cookies");
  });

  it("sem JSON-LD e sem texto: tenta o navegador; o HTML renderizado é extraído", async () => {
    const { f } = server({ "app.exemplo.com/v": () => new Response(JS_ONLY) });
    const calls: string[] = [];
    const r = await fetchPostingPage("https://app.exemplo.com/v", {
      fetch: f,
      lookup: publicDns,
      render: async (url) => {
        calls.push(url);
        return { ok: true, html: ARTICLE, url };
      },
    });
    expect(calls).toEqual(["https://app.exemplo.com/v"]);
    expect(r).toMatchObject({ ok: true, via: "browser" });
  });

  it("site que recusa o fetch (403) também tenta o navegador; sem navegador, a falha original", async () => {
    const { f } = server({
      "bloq.exemplo.com/v": () => new Response("proibido", { status: 403 }),
    });
    const ok = await fetchPostingPage("https://bloq.exemplo.com/v", {
      fetch: f,
      lookup: publicDns,
      render: async (url) => ({ ok: true, html: ARTICLE, url }),
    });
    expect(ok).toMatchObject({ ok: true, via: "browser" });
    const failed = await fetchPostingPage("https://bloq.exemplo.com/v", {
      fetch: f,
      lookup: publicDns,
      render: async () => ({ ok: false, message: "navegador fora do ar" }),
    });
    expect(failed).toMatchObject({ ok: false, code: "http_error" });
    expect(
      await fetchPostingPage("https://bloq.exemplo.com/v", {
        fetch: f,
        lookup: publicDns,
        render: null,
      }),
    ).toMatchObject({ ok: false, code: "http_error" });
  });

  it("vaga em vários módulos (Prisma Consultoria): o texto traz todas as seções, não só a maior", () => {
    const mod = (h: string, body: string) =>
      `<div class="module"><div><h2>${h}</h2><div class="description">${body}</div></div></div>`;
    const html = `<html><head><title>Jobs</title></head><body><header><nav>Menu Insights Careers Search</nav></header><main><header><a href="/x">Tech &amp; AI</a><h1>Senior Software Engineer - QuantumBlack</h1><ul><li>Doha</li><li>Dubai</li></ul></header>
${mod("Your impact", `<p>${"You will work with clients across many industries advising them on technology. ".repeat(12)}</p><p>${"You will drive architectural design and make key technology decisions. ".repeat(10)}</p>`)}
${mod("Your growth", `<ul><li>${"Continuous learning with structured programs. ".repeat(3)}</li><li>Global community</li></ul>`)}
${mod("Your qualifications and skills", "<ul><li>7+ years of experience in software development</li><li>TypeScript, React and Node.js</li><li>AWS, Azure or GCP</li></ul>")}
</main><footer>© 1996-2026 Prisma Consultoria</footer><script>var x = 1;</script></body></html>`;
    const r = extractPosting(html, "https://www.prisma.example/careers/x", "browser");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("Tech & AI\nSenior Software Engineer - QuantumBlack");
    expect(r.title).toBe("Senior Software Engineer - QuantumBlack");
    expect(r.text).toContain("Your qualifications and skills");
    expect(r.text).toContain("- 7+ years of experience in software development");
    expect(r.text).toContain("You will drive architectural design");
    expect(r.text).not.toContain("Menu Insights");
    expect(r.text).not.toContain("Prisma Consultoria");
    expect(r.text).not.toContain("var x");
  });

  it("página de bloqueio ou captcha não vira vaga", () => {
    const blocked = `<html><head><title>Blocked - Indeed.com</title></head><body><main><article><h1>Solicitação bloqueada</h1><p>${"O sistema bloqueou você. Se acredita que houve erro, acesse o suporte e informe o código. ".repeat(4)}</p></article></main></body></html>`;
    expect(extractPosting(blocked, "https://x.com/", "browser")).toMatchObject({
      ok: false,
      code: "blocked_page",
    });
    const cf = `<html><head><title>Just a moment...</title></head><body><main><article><p>${"Verifying you are human. This may take a few seconds. ".repeat(6)}</p></article></main></body></html>`;
    expect(extractPosting(cf, "https://x.com/")).toMatchObject({ ok: false, code: "blocked_page" });
  });

  it("robots.txt e rede interna nunca chegam ao navegador", async () => {
    const { f } = server({
      "vagas.exemplo.com/robots.txt": () => new Response("User-agent: *\nDisallow: /\n"),
    });
    let called = false;
    const render = async () => {
      called = true;
      return { ok: false as const, message: "x" };
    };
    expect(
      await fetchPostingPage("https://vagas.exemplo.com/1", {
        fetch: f,
        lookup: publicDns,
        render,
      }),
    ).toMatchObject({ ok: false, code: "robots" });
    expect(
      await fetchPostingPage("http://10.0.0.1/x", { fetch: f, lookup: publicDns, render }),
    ).toMatchObject({ ok: false, code: "blocked_host" });
    expect(called).toBe(false);
  });

  it("navegador: só http(s) público; imagens, mídia e fontes não carregam; data: passa", async () => {
    const guard = async (u: URL) => (u.hostname === "redis" ? "interno" : null);
    expect(await requestDecision("https://vagas.exemplo.com/a.js", "script", guard)).toBe(
      "continue",
    );
    expect(await requestDecision("http://redis:6379/", "fetch", guard)).toBe("abort");
    expect(await requestDecision("https://cdn.exemplo.com/x.png", "image", guard)).toBe("abort");
    expect(await requestDecision("https://cdn.exemplo.com/f.woff2", "font", guard)).toBe("abort");
    expect(await requestDecision("file:///etc/passwd", "document", guard)).toBe("abort");
    expect(await requestDecision("data:text/plain,oi", "other", guard)).toBe("continue");
  });

  it("navegador se apresenta como Chrome comum, sem 'HeadlessChrome' (CDN anti-robô derruba o headless, 2026-10-15)", () => {
    const ua = browserUserAgent("155.0.8059.39");
    expect(ua).toContain("Chrome/155.0.0.0");
    expect(ua).not.toMatch(/headless/i);
  });

  it("com navegador disponível, o fetch simples desiste antes (8 s) para sobrar tempo ao navegador", async () => {
    const started: number[] = [];
    const slow = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        started.push(Date.now());
        init?.signal?.addEventListener("abort", () => rej(new Error("abort")));
      })) as typeof fetch;
    const t0 = Date.now();
    const r = await fetchPostingPage("https://lento.exemplo.com/1", {
      fetch: slow,
      lookup: publicDns,
      plainTimeoutWithBrowserMs: 60,
      render: async (url) => ({ ok: true, html: ARTICLE, url }),
    });
    expect(r).toMatchObject({ ok: true, via: "browser" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("botões de aceitar cookies em pt e en", () => {
    for (const t of [
      "Aceitar",
      "Aceitar todos",
      "Aceitar todos os cookies",
      "Accept all",
      "Accept cookies",
      "Concordo",
      "I agree",
      "Allow all",
      "Permitir todos",
      "OK",
      "Entendi",
    ])
      expect(COOKIE_ACCEPT.test(t), t).toBe(true);
    for (const t of ["Recusar", "Configurar cookies", "Candidatar-se", "Reject all"])
      expect(COOKIE_ACCEPT.test(t), t).toBe(false);
  });
});
