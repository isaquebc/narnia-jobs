import type { CvContent } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  buildHeaderLinks,
  missingHeaderLinks,
  pruneDeadLinks,
  whatsappUrl,
} from "../../src/documents/links";
import { CV_SHORT, LETTER } from "./fixtures/cv";

/** F05/M1 · links do cabeçalho do CV (F05-19): portfólio, GitHub, LinkedIn, e-mail e WhatsApp, só dos dados. */
describe("F05/M1 core · links do cabeçalho", () => {
  const user = {
    email: "ana@example.com",
    phone: { e164: "+5519999990000", country: "BR", national: "(19) 99999-0000" },
    links: [
      { label: "LinkedIn", url: "https://www.linkedin.com/in/ana-souza/" },
      { label: "GitHub", url: "https://github.com/anasouza" },
      { label: "Meu portfólio", url: "https://ana.dev" },
      { label: "Blog", url: "https://blog.ana.dev" },
    ],
  };

  it("e-mail vira mailto, telefone vira wa.me só com dígitos, links pelo domínio e portfólio pelo rótulo", () => {
    const links = buildHeaderLinks(user, { githubOwner: null });
    expect(links.map((l) => l.kind)).toEqual([
      "email",
      "whatsapp",
      "linkedin",
      "github",
      "portfolio",
    ]);
    expect(links[0]).toEqual({
      kind: "email",
      url: "mailto:ana@example.com",
      label: "ana@example.com",
    });
    expect(links[1]?.url).toBe("https://wa.me/5519999990000");
    expect(links[2]).toMatchObject({
      url: "https://www.linkedin.com/in/ana-souza/",
      label: "linkedin.com/in/ana-souza",
    });
    expect(links[3]).toMatchObject({ label: "github.com/anasouza" });
    expect(links[4]).toMatchObject({ url: "https://ana.dev", label: "ana.dev" });
  });

  it("sem rótulo de portfólio, o primeiro link que sobra é o portfólio; GitHub cai para o dono dos repositórios", () => {
    const links = buildHeaderLinks(
      { email: null, phone: null, links: [{ label: "Site", url: "https://ana.dev" }] },
      { githubOwner: "anasouza" },
    );
    expect(links).toEqual([
      { kind: "github", url: "https://github.com/anasouza", label: "github.com/anasouza" },
      { kind: "portfolio", url: "https://ana.dev", label: "ana.dev" },
    ]);
  });

  it("o que falta é avisado; link que não é http(s) é ignorado", () => {
    const only = {
      email: "a@b.com",
      phone: null,
      links: [{ label: "x", url: "javascript:alert(1)" }],
    };
    expect(buildHeaderLinks(only, { githubOwner: null }).map((l) => l.kind)).toEqual(["email"]);
    expect(missingHeaderLinks(buildHeaderLinks(only, { githubOwner: null }))).toEqual([
      "whatsapp",
      "linkedin",
      "github",
      "portfolio",
    ]);
  });

  it("wa.me usa só os dígitos do E.164", () => {
    expect(whatsappUrl("+1 (415) 555-0100")).toBe("https://wa.me/14155550100");
  });
});

/**
 * Link morto nos dados da pessoa (404/410, domínio que não existe): sai do PDF e vira aviso para corrigir nos dados. O
 * gerador não tem como consertar um dado, então não reprova nem gasta a regeração.
 */
describe("F05 core · links mortos ficam fora do PDF", () => {
  const cv: CvContent = {
    ...CV_SHORT,
    projects: [
      {
        factId: "p1",
        name: "narnia-jobs",
        description: "Assistente.",
        url: "https://x.dev/morto",
        tech: [],
      },
      { factId: "p2", name: "fila", description: "Fila.", url: "https://x.dev/vivo", tech: [] },
    ],
  };
  const dead = new Set(["https://github.com/anasouza", "https://x.dev/morto"]);

  it("tira o link do cabeçalho e o do projeto (o projeto continua) e devolve um aviso para cada um", async () => {
    const checked: string[] = [];
    const r = await pruneDeadLinks(cv, async (u) => {
      checked.push(u);
      return dead.has(u) ? { ok: false, reason: `A página ${u} não existe (404).` } : { ok: true };
    });
    const out = r.content as CvContent;
    expect(out.header.links.map((l) => l.kind)).toEqual(["email", "whatsapp", "linkedin"]);
    expect(out.projects.map((p) => [p.name, p.url])).toEqual([
      ["narnia-jobs", null],
      ["fila", "https://x.dev/vivo"],
    ]);
    expect(r.issues).toEqual([
      {
        area: "links",
        severity: "warning",
        message:
          "A página https://github.com/anasouza não existe (404). O link ficou fora do PDF: corrija nos seus dados e use Atualizar.",
        where: "https://github.com/anasouza",
      },
      expect.objectContaining({ severity: "warning", where: "https://x.dev/morto" }),
    ]);
    expect(new Set(checked).size).toBe(checked.length);
  });

  it("tudo funcionando: conteúdo igual e sem aviso; carta só tem os links do cabeçalho", async () => {
    const ok = async () => ({ ok: true }) as const;
    expect(await pruneDeadLinks(cv, ok)).toEqual({ content: cv, issues: [] });
    const letter = await pruneDeadLinks(LETTER, async (u) =>
      u.startsWith("https://github.com") ? { ok: false, reason: "404" } : { ok: true },
    );
    expect(letter.content.header.links.some((l) => l.kind === "github")).toBe(false);
    expect(letter.issues).toHaveLength(
      LETTER.header.links.some((l) => l.kind === "github") ? 1 : 0,
    );
  });
});
