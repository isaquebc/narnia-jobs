import { describe, expect, it } from "vitest";
import { buildHeaderLinks, missingHeaderLinks, whatsappUrl } from "../../src/documents/links";

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
