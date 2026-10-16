import { describe, expect, it } from "vitest";
import { atsScore, termInText } from "../../src/documents/ats";
import { layoutIssues, linkIssues } from "../../src/documents/checks";
import type { PdfPageInfo, PdfTextItem } from "../../src/documents/inspect";
import { checkLink } from "../../src/documents/link-check";

/** F05/M1 · checagens por código da revisão (F05-13): layout, links (F05-23) e ATS (F05-20). */
const A4 = { width: 595, height: 842 };
const item = (str: string, x: number, y: number, size = 10, width = 120): PdfTextItem => ({
  str,
  x,
  y,
  width,
  size,
});
const page = (items: PdfTextItem[], links: string[] = []): PdfPageInfo => ({ ...A4, items, links });
const lines = (n: number, from = 60, gap = 14) =>
  Array.from({ length: n }, (_, i) => item(`linha ${i}`, 50, from + i * gap));

describe("F05/M1 core · layout", () => {
  const headings = ["Experiência", "Formação"];

  it("página limpa não tem apontamento", () => {
    expect(layoutIssues({ pages: [page(lines(40))], text: "" }, { headings })).toEqual([]);
  });

  it("mais de 2 páginas reprova", () => {
    const p = page(lines(50));
    expect(layoutIssues({ pages: [p, p, p], text: "" }, { headings })).toContainEqual(
      expect.objectContaining({ area: "pages", severity: "error" }),
    );
  });

  it("fonte abaixo de 8 pt, texto fora da margem, sobreposição e linhas apertadas reprovam", () => {
    const issues = layoutIssues(
      {
        pages: [
          page([
            ...lines(10),
            item("miúdo", 50, 300, 6.5),
            item("vazando", 520, 330, 10, 90),
            item("por cima A", 50, 400, 10, 200),
            item("por cima B", 60, 403, 10, 200),
            item("apertada 1", 50, 500, 10),
            item("apertada 2", 50, 509, 10),
          ]),
        ],
        text: "",
      },
      { headings },
    );
    const msgs = issues.map((i) => i.message).join("\n");
    expect(issues.every((i) => i.area === "layout" && i.severity === "error")).toBe(true);
    expect(msgs).toMatch(/6\.5 pt/);
    expect(msgs).toMatch(/margem/);
    expect(msgs).toMatch(/sobrepost/);
    expect(msgs).toMatch(/apertad/);
  });

  it("título de seção sozinho no fim da página e última página quase vazia", () => {
    const issues = layoutIssues(
      {
        pages: [
          page([...lines(50), item("Formação", 50, 800, 11)]),
          page([item("Unicamp", 50, 60)]),
        ],
        text: "",
      },
      { headings },
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ area: "layout", severity: "error", where: "página 1" }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ area: "layout", severity: "warning", where: "página 2" }),
    );
  });
});

describe("F05/M1 core · links", () => {
  const expected = ["mailto:ana@example.com", "https://www.linkedin.com/in/ana"];

  it("link dos dados ausente no PDF, link do PDF fora dos dados e link quebrado reprovam", () => {
    const insp = {
      pages: [page([], ["mailto:ana@example.com", "https://golpe.example"])],
      text: "",
    };
    const issues = linkIssues(
      insp,
      expected,
      new Map([["mailto:ana@example.com", { ok: false as const, reason: "e-mail inválido" }]]),
    );
    const msgs = issues.map((i) => i.message).join("\n");
    expect(issues.every((i) => i.area === "links" && i.severity === "error")).toBe(true);
    expect(msgs).toMatch(/linkedin\.com\/in\/ana.*não está clicável/);
    expect(msgs).toMatch(/golpe\.example.*não está nos seus dados/);
    expect(msgs).toMatch(/e-mail inválido/);
  });

  const head = (status: number) =>
    (async () => new Response(null, { status })) as unknown as typeof fetch;
  const dns = async () => ["93.184.216.34"];

  it("F05-23: domínio que resolve e resposta diferente de 404 = funciona (999 do LinkedIn, 403, sem resposta)", async () => {
    for (const s of [200, 301, 403, 999])
      expect(
        await checkLink("https://www.linkedin.com/in/ana", { fetch: head(s), lookup: dns }),
        String(s),
      ).toMatchObject({ ok: true });
    const timeout = (async () => {
      throw new DOMException("x", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await checkLink("https://ana.dev", { fetch: timeout, lookup: dns })).toMatchObject({
      ok: true,
      note: expect.stringMatching(/sem resposta/),
    });
  });

  it("404, domínio que não existe e endereço interno reprovam; mailto e wa.me pelo formato", async () => {
    expect(await checkLink("https://ana.dev/x", { fetch: head(404), lookup: dns })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/404/),
    });
    const nx = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(
      await checkLink("https://nao-existe.example", { fetch: head(200), lookup: nx }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/domínio/) });
    expect(
      await checkLink("https://intranet.example", {
        fetch: head(200),
        lookup: async () => ["10.0.0.2"],
      }),
    ).toMatchObject({ ok: false });
    expect(await checkLink("mailto:ana@example.com", { fetch: head(500), lookup: nx })).toEqual({
      ok: true,
    });
    expect(await checkLink("mailto:ana", { fetch: head(500), lookup: nx })).toMatchObject({
      ok: false,
    });
    expect(
      await checkLink("https://wa.me/5519999990000", { fetch: head(500), lookup: nx }),
    ).toEqual({ ok: true });
    expect(await checkLink("https://wa.me/12", { fetch: head(500), lookup: nx })).toMatchObject({
      ok: false,
    });
  });

  it("redireciona para endereço interno = reprova", async () => {
    const redir = (async (u: string | URL) =>
      String(u).includes("ana.dev")
        ? new Response(null, { status: 302, headers: { location: "http://intranet.example/" } })
        : new Response(null, { status: 200 })) as unknown as typeof fetch;
    const lookup = async (h: string) =>
      h === "intranet.example" ? ["10.0.0.9"] : ["93.184.216.34"];
    expect(await checkLink("https://ana.dev", { fetch: redir, lookup })).toMatchObject({
      ok: false,
    });
  });
});

describe("F05/M1 core · ATS", () => {
  const text = `Ana Souza
ana@example.com · (19) 99999-0000
Resumo
Engenheira backend com nove anos em pagamentos, performance, confiabilidade e times distribuídos.
Experiência
Acme · mar 2021 – atual
Reduziu a latência com Node.js e PostgreSQL; containers com Docker.
Habilidades
Node.js, PostgreSQL, Docker
Formação
Unicamp 2012 – 2016`;
  const base = {
    text,
    headings: ["Resumo", "Experiência", "Habilidades", "Formação"],
    contact: { email: "ana@example.com", phone: "(19) 99999-0000" },
    contentLines: ["Reduziu a latência com Node.js e PostgreSQL; containers com Docker."],
    periods: ["mar 2021 – atual", "2012 – 2016"],
  };

  it("termo casa pelo nome e pelos sinônimos, com fronteira de palavra", () => {
    expect(termInText(["Node.js", "nodejs"], "usa NodeJS no backend")).toBe(true);
    expect(termInText(["Go", "golang"], "Google Cloud")).toBe(false);
    expect(termInText(["PostgreSQL", "postgres"], "Postgres 15")).toBe(true);
  });

  it("nota = leitura (30) + termos com evidência (70); lacunas não contam; adjacente não vale o termo", () => {
    const r = atsScore({
      ...base,
      terms: [
        { term: "Node.js", aliases: ["nodejs"], weight: 2, hasEvidence: true },
        { term: "PostgreSQL", aliases: [], weight: 2, hasEvidence: true },
        { term: "Docker", aliases: [], weight: 1, hasEvidence: true },
        { term: "Kubernetes", aliases: ["k8s"], weight: 2, hasEvidence: false },
      ],
    });
    expect(r.reading).toBe(30);
    expect(r.score).toBe(100);
    expect(r.gaps).toEqual(["Kubernetes"]);
    expect(r.missing).toEqual([]);
  });

  it("termo com evidência fora do texto derruba a nota; sem termos, só a leitura", () => {
    const r = atsScore({
      ...base,
      terms: [
        { term: "Node.js", aliases: [], weight: 2, hasEvidence: true },
        { term: "Kafka", aliases: [], weight: 2, hasEvidence: true },
      ],
    });
    expect(r.missing).toEqual(["Kafka"]);
    expect(r.score).toBe(65);
    expect(atsScore({ ...base, terms: [] }).score).toBe(100);
    const semContato = atsScore({
      ...base,
      text: text.replace(/ana@example.com · \(19\) 99999-0000/, ""),
      terms: [],
    });
    expect(semContato.score).toBe(80);
  });
});
